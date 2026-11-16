const crypto = require('crypto');
const { Router } = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { pool, ensureAuthSchemaTables } = require('../db');
const { config } = require('../config');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const router = Router();

const ALLOWED_ROLES = ['reader', 'writer', 'admin'];
const DUMMY_BCRYPT_HASH = '$2a$06$3tytcF1XihQG2zITIeMbtemxngvfuTjVCkLiKJ2UHWxVeuPlg5EX2';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cache Neon Auth JWKS public keys briefly in memory
let neonJwksCache = { keys: [], fetchedAt: 0 };

function getCookieSettings() {
  const sameSiteMode = ['lax', 'none', 'strict'].includes(config.cookieSameSite)
    ? config.cookieSameSite
    : 'lax';
  const isSecureCookie = config.nodeEnv === 'production' || sameSiteMode === 'none';
  return {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: sameSiteMode,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

function issueSessionCookie(res, user) {
  const userPayload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    ...(user.avatar_url ? { avatar_url: user.avatar_url } : {}),
  };

  const token = jwt.sign(userPayload, config.jwtSecret, { expiresIn: '7d' });

  res.cookie('token', token, {
    ...getCookieSettings(),
    maxAge: COOKIE_MAX_AGE,
  });

  return { token, user: userPayload };
}

function resolveWebAuthnContext(req) {
  const originHeader = req.get('origin');
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  const hostNoPort = host.split(':')[0];

  const origins = new Set();
  if (config.auth?.origin) {
    origins.add(config.auth.origin.replace(/\/$/, ''));
  }

  let rpId = config.auth?.rpId || hostNoPort;
  let baseOrigin = config.auth?.origin || `${proto}://${host}`;

  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      const cleanOrigin = `${parsed.protocol}//${parsed.host}`;
      origins.add(cleanOrigin);
      baseOrigin = cleanOrigin;
      if (!config.auth?.rpId) {
        rpId = parsed.hostname;
      }
    } catch (_) {}
  }

  origins.add(`${proto}://${host}`);

  return {
    rpName: config.auth?.rpName || 'SyncTone Audio Studio',
    rpId,
    expectedOrigins: Array.from(origins),
    baseOrigin: baseOrigin.replace(/\/$/, ''),
  };
}

async function generateUniqueUsername(preferredName, email) {
  const rawBase = (preferredName || (email ? email.split('@')[0] : 'listener'))
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const safeBase = rawBase.length >= 3 ? rawBase : `reader_${rawBase || 'user'}`;

  let candidate = safeBase;
  for (let attempt = 0; attempt < 10; attempt++) {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [candidate]);
    if (existing.rows.length === 0) return candidate;
    const suffix = crypto.randomBytes(2).toString('hex');
    candidate = `${safeBase.slice(0, 42)}_${suffix}`;
  }
  return `${safeBase.slice(0, 36)}_${Date.now().toString(36)}`;
}

async function findOrCreateOAuthUser({ provider, providerAccountId, email, displayName, avatarUrl }) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('OAuth provider did not return a verified email address.');
  }

  // 1. Check if this OAuth account is already linked
  const linkedRes = await pool.query(
    `SELECT u.id, u.username, u.email, u.role, u.avatar_url
     FROM oauth_accounts oa
     JOIN users u ON u.id = oa.user_id
     WHERE oa.provider = $1 AND oa.provider_account_id = $2
     LIMIT 1`,
    [provider, String(providerAccountId)]
  );

  if (linkedRes.rows.length > 0) {
    const existingUser = linkedRes.rows[0];
    if (avatarUrl && avatarUrl !== existingUser.avatar_url) {
      await pool.query('UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2', [
        avatarUrl,
        existingUser.id,
      ]);
      existingUser.avatar_url = avatarUrl;
    }
    return existingUser;
  }

  // 2. Match by verified email or create new passwordless user
  let userRow = null;
  const emailRes = await pool.query(
    'SELECT id, username, email, role, avatar_url FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  );

  if (emailRes.rows.length > 0) {
    userRow = emailRes.rows[0];
    if (avatarUrl && !userRow.avatar_url) {
      await pool.query('UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2', [
        avatarUrl,
        userRow.id,
      ]);
      userRow.avatar_url = avatarUrl;
    }
  } else {
    const username = await generateUniqueUsername(displayName, cleanEmail);
    const created = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, avatar_url)
       VALUES ($1, $2, NULL, 'reader', $3)
       RETURNING id, username, email, role, avatar_url`,
      [username, cleanEmail, avatarUrl || null]
    );
    userRow = created.rows[0];
  }

  // 3. Upsert oauth_accounts link
  await pool.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_account_id, provider_email, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       provider_email = EXCLUDED.provider_email,
       avatar_url = EXCLUDED.avatar_url,
       updated_at = now()`,
    [userRow.id, provider, String(providerAccountId), cleanEmail, avatarUrl || null]
  );

  return userRow;
}

async function verifyNeonAuthJwt(tokenStr) {
  const neonBase = config.auth?.neonAuthBaseUrl;
  if (!neonBase || !tokenStr || typeof tokenStr !== 'string') {
    throw new Error('Neon Auth session verification not configured.');
  }

  const parts = tokenStr.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Neon Auth JWT format.');
  }

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

  if (!neonJwksCache.keys.length || Date.now() - neonJwksCache.fetchedAt > 5 * 60 * 1000) {
    const jwksResp = await axios.get(`${neonBase}/.well-known/jwks.json`, { timeout: 6000 });
    neonJwksCache = {
      keys: Array.isArray(jwksResp.data?.keys) ? jwksResp.data.keys : [],
      fetchedAt: Date.now(),
    };
  }

  const jwk =
    neonJwksCache.keys.find((k) => !header.kid || k.kid === header.kid) ||
    neonJwksCache.keys[0];
  if (!jwk) {
    throw new Error('Neon Auth JWKS key not found.');
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const algName = jwk.kty === 'OKP' ? null : 'sha256';
  const validSig = crypto.verify(algName, signingInput, publicKey, signature);

  if (!validSig) {
    throw new Error('Invalid Neon Auth JWT signature.');
  }
  if (payload.exp && Date.now() >= payload.exp * 1000) {
    throw new Error('Expired Neon Auth token.');
  }

  return payload;
}

/**
 * GET /api/auth/providers
 * Exposes enabled authentication mechanisms cleanly to the frontend.
 */
router.get('/auth/providers', (_req, res) => {
  const googleOAuth = Boolean(config.auth?.google?.clientId && config.auth?.google?.clientSecret);
  const githubOAuth = Boolean(config.auth?.github?.clientId && config.auth?.github?.clientSecret);
  const neonAuthUrl = config.auth?.neonAuthBaseUrl || null;

  return res.json({
    emailPassword: true,
    passkey: true,
    google: Boolean(googleOAuth || neonAuthUrl),
    googleMode: googleOAuth ? 'oauth' : neonAuthUrl ? 'neon_auth' : 'unconfigured',
    github: githubOAuth,
    githubMode: githubOAuth ? 'oauth' : 'unconfigured',
    neonAuthUrl,
  });
});

/**
 * POST /api/auth/register
 * Validates input, hashes password via pgcrypto, inserts user, and immediately issues JWT session cookie.
 */
router.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password, role = 'reader' } = req.body || {};

    if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 50) {
      return res.status(400).json({
        error: 'Invalid username. Must be a string between 3 and 50 characters.',
      });
    }

    if (!email || typeof email !== 'string' || !email.includes('@') || email.trim().length > 255) {
      return res.status(400).json({
        error: 'Invalid email address.',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long.',
      });
    }

    let normalizedRole = typeof role === 'string' && role.trim() ? role.toLowerCase().trim() : 'reader';
    if (normalizedRole === 'author') {
      normalizedRole = 'writer';
    }
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        error: `Invalid role. Allowed values: ${ALLOWED_ROLES.join(', ')}.`,
      });
    }
    if (normalizedRole === 'admin') {
      return res.status(403).json({
        error: 'Forbidden: public registration cannot grant admin privileges. Privileged roles must be assigned through an authorized backend workflow.',
      });
    }
    if (!['reader', 'writer'].includes(normalizedRole)) {
      return res.status(400).json({
        error: 'Invalid role. Allowed public roles are: reader, writer (author).',
      });
    }

    const query = `
      INSERT INTO users (username, email, password_hash, role)
      VALUES ($1, $2, crypt($3, gen_salt('bf')), $4)
      RETURNING id, username, email, role, created_at, updated_at;
    `;

    const result = await pool.query(query, [
      username.trim(),
      email.toLowerCase().trim(),
      password,
      normalizedRole,
    ]);

    const user = result.rows[0];
    const session = issueSessionCookie(res, user);

    return res.status(201).json({
      message: 'User registered successfully',
      token: session.token,
      user,
    });
  } catch (err) {
    if (err.code === '23505') {
      const detail = err.detail || '';
      if (detail.includes('username')) {
        return res.status(409).json({ error: 'Username already taken.' });
      }
      if (detail.includes('email')) {
        return res.status(409).json({ error: 'Email already registered.' });
      }
      return res.status(409).json({ error: 'User already exists.' });
    }

    console.error('[Auth Register Error]:', err.message);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

/**
 * POST /api/auth/login
 * Validates email/password against PostgreSQL and issues JWT cookie.
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const query = `
      SELECT id, username, email, role, password_hash,
             (password_hash IS NOT NULL AND password_hash = crypt($2, password_hash)) AS password_matches
      FROM users
      WHERE LOWER(email) = $1;
    `;

    const result = await pool.query(query, [email.toLowerCase().trim(), password]);

    if (result.rows.length === 0) {
      await pool.query('SELECT crypt($1, $2)', [password, DUMMY_BCRYPT_HASH]);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const userRecord = result.rows[0];
    if (!userRecord.password_hash) {
      return res.status(400).json({
        error: 'This account was created without a password. Please sign in with your Passkey, Google, or GitHub account.',
      });
    }

    if (!userRecord.password_matches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const session = issueSessionCookie(res, userRecord);
    return res.json({
      message: 'Login successful',
      token: session.token,
      user: session.user,
    });
  } catch (err) {
    console.error('[Auth Login Error]:', err.message);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

/**
 * POST /api/auth/passkey/register-options
 * Starts a WebAuthn Passkey registration ceremony (for new passwordless signup OR adding a passkey to an authenticated user).
 */
router.post('/auth/passkey/register-options', optionalAuth, async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { rpName, rpId } = resolveWebAuthnContext(req);
    const { email, username, role = 'reader', friendlyName = 'Passkey' } = req.body || {};

    let targetUserId = null;
    let targetEmail = '';
    let targetUsername = '';
    let normalizedRole = 'reader';
    let excludeCredentials = [];
    let mode = 'signup';

    if (req.user) {
      mode = 'attach';
      targetUserId = req.user.id;
      targetEmail = req.user.email;
      targetUsername = req.user.username;

      const existingKeys = await pool.query(
        'SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1',
        [targetUserId]
      );
      excludeCredentials = existingKeys.rows.map((pk) => ({
        id: pk.credential_id,
        transports: Array.isArray(pk.transports) && pk.transports.length > 0 ? pk.transports : undefined,
      }));
    } else {
      let rawEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
      const rawUsername = typeof username === 'string' ? username.trim() : '';

      if (!rawEmail && (!rawUsername || rawUsername.length < 3)) {
        return res.status(400).json({
          error: 'Please enter a username (at least 3 characters) or email address to create a Passkey.',
        });
      }

      if (!rawEmail) {
        const slug = rawUsername.toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user';
        rawEmail = `${slug}@passkey.synctone.local`;
      }

      if (!rawEmail.includes('@')) {
        return res.status(400).json({ error: 'A valid email address is required to register a passkey.' });
      }
      targetEmail = rawEmail;

      const existingEmail = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [targetEmail]);
      if (existingEmail.rows.length > 0) {
        return res.status(409).json({
          error: 'An account with this email already exists. Please sign in first, then add a passkey from your Profile.',
        });
      }

      if (rawUsername && rawUsername.length >= 3) {
        const existingName = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [rawUsername]);
        if (existingName.rows.length > 0) {
          return res.status(409).json({
            error: 'That username is already taken. Sign in to add a passkey in Profile, or choose another username.',
          });
        }
      }

      normalizedRole = String(role || 'reader').toLowerCase().trim();
      if (normalizedRole === 'author') normalizedRole = 'writer';
      if (normalizedRole === 'admin') {
        return res.status(403).json({ error: 'Public registration cannot grant admin privileges.' });
      }
      if (!['reader', 'writer'].includes(normalizedRole)) {
        normalizedRole = 'reader';
      }

      targetUsername =
        rawUsername.length >= 3
          ? rawUsername.slice(0, 50)
          : await generateUniqueUsername(targetEmail.split('@')[0], targetEmail);

      targetUserId = crypto.randomUUID();
    }

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: targetEmail,
      userID: Uint8Array.from(Buffer.from(targetUserId, 'utf8')),
      userDisplayName: targetUsername || targetEmail,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_challenges (challenge_id, challenge, user_id, email, flow_type, metadata, expires_at)
       VALUES ($1, $2, $3, $4, 'passkey_register', $5::jsonb, $6)`,
      [
        challengeId,
        options.challenge,
        mode === 'attach' ? targetUserId : null,
        targetEmail,
        JSON.stringify({
          mode,
          username: targetUsername,
          email: targetEmail,
          role: normalizedRole,
          friendlyName: String(friendlyName || 'Passkey').slice(0, 100),
          rpId,
        }),
        expiresAt,
      ]
    );

    return res.json({ challengeId, options });
  } catch (err) {
    console.error('[Passkey Register Options Error]:', err.message);
    return res.status(500).json({ error: 'Failed to prepare passkey registration challenge.' });
  }
});

/**
 * POST /api/auth/passkey/register-verify
 * Verifies WebAuthn registration attestation, persists passkey credential, and issues JWT cookie.
 */
router.post('/auth/passkey/register-verify', optionalAuth, async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { rpId: defaultRpId, expectedOrigins } = resolveWebAuthnContext(req);
    const { challengeId, credential, response, friendlyName } = req.body || {};
    const attestationResponse = credential || response;

    if (!challengeId || !attestationResponse) {
      return res.status(400).json({ error: 'challengeId and passkey credential response are required.' });
    }

    const challengeRes = await pool.query(
      `DELETE FROM auth_challenges
       WHERE challenge_id = $1 AND flow_type = 'passkey_register' AND expires_at > now()
       RETURNING *`,
      [challengeId]
    );
    if (challengeRes.rows.length === 0) {
      return res.status(400).json({ error: 'Passkey registration challenge expired or invalid. Please retry.' });
    }

    const chRow = challengeRes.rows[0];
    const meta = chRow.metadata || {};
    const expectedRPID = meta.rpId || defaultRpId;

    const verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge: chRow.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey registration verification failed.' });
    }

    const { credential: regCred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    let userRecord = null;
    if (chRow.user_id) {
      const userRes = await pool.query('SELECT id, username, email, role, avatar_url FROM users WHERE id = $1', [
        chRow.user_id,
      ]);
      userRecord = userRes.rows[0];
    }

    if (!userRecord) {
      const finalUsername = await generateUniqueUsername(meta.username, meta.email);
      const userInsert = await pool.query(
        `INSERT INTO users (username, email, password_hash, role)
         VALUES ($1, $2, NULL, $3)
         RETURNING id, username, email, role, avatar_url`,
        [finalUsername, String(meta.email).toLowerCase().trim(), meta.role || 'reader']
      );
      userRecord = userInsert.rows[0];
    }

    const transports = Array.isArray(regCred.transports)
      ? regCred.transports
      : Array.isArray(attestationResponse.response?.transports)
        ? attestationResponse.response.transports
        : [];

    await pool.query(
      `INSERT INTO user_passkeys (credential_id, user_id, public_key, counter, device_type, backed_up, transports, friendly_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (credential_id) DO UPDATE SET
         public_key = EXCLUDED.public_key,
         counter = EXCLUDED.counter,
         transports = EXCLUDED.transports`,
      [
        regCred.id,
        userRecord.id,
        Buffer.from(regCred.publicKey).toString('base64'),
        Number(regCred.counter || 0),
        credentialDeviceType || 'singleDevice',
        Boolean(credentialBackedUp),
        transports,
        String(friendlyName || meta.friendlyName || 'Passkey').slice(0, 100),
      ]
    );

    const session = issueSessionCookie(res, userRecord);
    return res.json({
      verified: true,
      message: 'Passkey registered and signed in.',
      token: session.token,
      user: session.user,
    });
  } catch (err) {
    console.error('[Passkey Register Verify Error]:', err.message);
    return res.status(400).json({ error: err.message || 'Passkey registration verification failed.' });
  }
});

/**
 * POST /api/auth/passkey/login-options
 * Creates a WebAuthn authentication challenge (supports optional email hint or discoverable passkeys).
 */
router.post('/auth/passkey/login-options', async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { rpId } = resolveWebAuthnContext(req);
    const { email } = req.body || {};

    let allowCredentials = [];
    const cleanEmail = email && typeof email === 'string' ? email.toLowerCase().trim() : '';

    if (cleanEmail) {
      const credsRes = await pool.query(
        `SELECT up.credential_id, up.transports
         FROM user_passkeys up
         JOIN users u ON u.id = up.user_id
         WHERE LOWER(u.email) = $1`,
        [cleanEmail]
      );
      if (credsRes.rows.length > 0) {
        allowCredentials = credsRes.rows.map((pk) => ({
          id: pk.credential_id,
          transports: Array.isArray(pk.transports) && pk.transports.length > 0 ? pk.transports : undefined,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials,
      userVerification: 'preferred',
    });

    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_challenges (challenge_id, challenge, email, flow_type, metadata, expires_at)
       VALUES ($1, $2, $3, 'passkey_login', $4::jsonb, $5)`,
      [challengeId, options.challenge, cleanEmail || null, JSON.stringify({ rpId }), expiresAt]
    );

    return res.json({ challengeId, options });
  } catch (err) {
    console.error('[Passkey Login Options Error]:', err.message);
    return res.status(500).json({ error: 'Failed to prepare passkey sign-in challenge.' });
  }
});

/**
 * POST /api/auth/passkey/login-verify
 * Verifies WebAuthn assertion, updates signature counter, and issues JWT cookie.
 */
router.post('/auth/passkey/login-verify', async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { rpId: defaultRpId, expectedOrigins } = resolveWebAuthnContext(req);
    const { challengeId, credential, response } = req.body || {};
    const assertionResponse = credential || response;

    if (!challengeId || !assertionResponse || !assertionResponse.id) {
      return res.status(400).json({ error: 'challengeId and passkey assertion response are required.' });
    }

    const challengeRes = await pool.query(
      `DELETE FROM auth_challenges
       WHERE challenge_id = $1 AND flow_type = 'passkey_login' AND expires_at > now()
       RETURNING *`,
      [challengeId]
    );
    if (challengeRes.rows.length === 0) {
      return res.status(400).json({ error: 'Passkey sign-in challenge expired or invalid. Please retry.' });
    }
    const chRow = challengeRes.rows[0];
    const expectedRPID = chRow.metadata?.rpId || defaultRpId;

    const pkRes = await pool.query(
      `SELECT up.*, u.id AS uid, u.username, u.email, u.role, u.avatar_url
       FROM user_passkeys up
       JOIN users u ON u.id = up.user_id
       WHERE up.credential_id = $1
       LIMIT 1`,
      [assertionResponse.id]
    );
    if (pkRes.rows.length === 0) {
      return res.status(401).json({ error: 'Passkey not recognized on this server.' });
    }
    const pkRow = pkRes.rows[0];

    const verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge: chRow.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID,
      credential: {
        id: pkRow.credential_id,
        publicKey: Uint8Array.from(Buffer.from(pkRow.public_key, 'base64')),
        counter: Number(pkRow.counter || 0),
        transports: Array.isArray(pkRow.transports) ? pkRow.transports : [],
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey signature verification failed.' });
    }

    const newCounter = verification.authenticationInfo?.newCounter ?? pkRow.counter;
    await pool.query(
      'UPDATE user_passkeys SET counter = $1, last_used_at = now() WHERE credential_id = $2',
      [Number(newCounter), pkRow.credential_id]
    );

    const session = issueSessionCookie(res, {
      id: pkRow.uid,
      username: pkRow.username,
      email: pkRow.email,
      role: pkRow.role,
      avatar_url: pkRow.avatar_url,
    });

    return res.json({
      verified: true,
      message: 'Signed in with Passkey',
      token: session.token,
      user: session.user,
    });
  } catch (err) {
    console.error('[Passkey Login Verify Error]:', err.message);
    return res.status(401).json({ error: err.message || 'Passkey verification failed.' });
  }
});

/**
 * GET /api/auth/passkeys
 * Lists registered passkeys for the signed-in user.
 */
router.get('/auth/passkeys', authenticateUser, async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const result = await pool.query(
      `SELECT credential_id, friendly_name, device_type, backed_up, created_at, last_used_at
       FROM user_passkeys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json({ passkeys: result.rows });
  } catch (err) {
    console.error('[List Passkeys Error]:', err.message);
    return res.status(500).json({ error: 'Failed to load passkeys.' });
  }
});

/**
 * DELETE /api/auth/passkeys/:id
 * Deletes a registered passkey owned by the signed-in user.
 */
router.delete('/auth/passkeys/:id', authenticateUser, async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM user_passkeys WHERE credential_id = $1 AND user_id = $2 RETURNING credential_id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Passkey not found.' });
    }
    return res.json({ message: 'Passkey removed', credential_id: id });
  } catch (err) {
    console.error('[Delete Passkey Error]:', err.message);
    return res.status(500).json({ error: 'Failed to delete passkey.' });
  }
});

function resolveTrustedNeonOrigin(baseOrigin) {
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(baseOrigin)) {
    return baseOrigin;
  }
  return 'https://synctone-five.vercel.app';
}

/**
 * GET /api/auth/oauth/:provider/start
 * Initiates OAuth 2.0 login flow for Google or GitHub (direct or via server-side Neon Auth redirect).
 */
router.get('/auth/oauth/:provider/start', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const { baseOrigin } = resolveWebAuthnContext(req);
  const returnTo = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';

  if (!['google', 'github'].includes(provider)) {
    return res.status(400).json({ error: `Unsupported OAuth provider '${provider}'.` });
  }

  try {
    await ensureAuthSchemaTables(pool);
    const state = crypto.randomBytes(24).toString('base64url');
    const callbackUrl =
      (provider === 'google' ? config.auth?.google?.redirectUri : config.auth?.github?.redirectUri) ||
      `${baseOrigin}/api/auth/oauth/${provider}/callback`;

    if (provider === 'google' && config.auth?.google?.clientId && config.auth?.google?.clientSecret) {
      await pool.query(
        `INSERT INTO auth_challenges (challenge_id, challenge, flow_type, metadata, expires_at)
         VALUES ($1, $1, 'oauth_google', $2::jsonb, $3)`,
        [state, JSON.stringify({ returnTo, callbackUrl, baseOrigin }), new Date(Date.now() + 10 * 60 * 1000)]
      );
      const params = new URLSearchParams({
        client_id: config.auth.google.clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    }

    // Server-side Neon Managed Auth Social OAuth flow (avoids browser CORS/403 & 3rd-party cookie blocks)
    if (provider === 'google' && config.auth?.neonAuthBaseUrl) {
      const trustedOrigin = resolveTrustedNeonOrigin(baseOrigin);
      const neonCallbackUrl = `${trustedOrigin}/api/auth/oauth/neon/callback`;
      const neonResp = await axios.post(
        `${config.auth.neonAuthBaseUrl}/sign-in/social`,
        {
          provider: 'google',
          callbackURL: neonCallbackUrl,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Origin: trustedOrigin,
          },
          timeout: 10000,
        }
      );

      const oauthUrl = neonResp.data?.url;
      if (!oauthUrl) {
        return res.redirect(`${baseOrigin}/?auth_error=google_no_redirect_url`);
      }

      const rawSetCookies = Array.isArray(neonResp.headers['set-cookie'])
        ? neonResp.headers['set-cookie']
        : neonResp.headers['set-cookie']
          ? [neonResp.headers['set-cookie']]
          : [];
      const challengeCookiePairs = rawSetCookies
        .map((c) => String(c).split(';')[0].trim())
        .filter(Boolean)
        .join('; ');

      const challengeId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO auth_challenges (challenge_id, challenge, flow_type, metadata, expires_at)
         VALUES ($1, $2, 'neon_oauth', $3::jsonb, $4)`,
        [
          challengeId,
          challengeCookiePairs,
          JSON.stringify({ returnOrigin: baseOrigin, trustedOrigin, returnTo }),
          new Date(Date.now() + 10 * 60 * 1000),
        ]
      );

      res.cookie('synctone_neon_challenge', challengeId, {
        ...getCookieSettings(),
        maxAge: 10 * 60 * 1000,
      });

      return res.redirect(oauthUrl);
    }

    if (provider === 'github' && config.auth?.github?.clientId && config.auth?.github?.clientSecret) {
      await pool.query(
        `INSERT INTO auth_challenges (challenge_id, challenge, flow_type, metadata, expires_at)
         VALUES ($1, $1, 'oauth_github', $2::jsonb, $3)`,
        [state, JSON.stringify({ returnTo, callbackUrl, baseOrigin }), new Date(Date.now() + 10 * 60 * 1000)]
      );
      const params = new URLSearchParams({
        client_id: config.auth.github.clientId,
        redirect_uri: callbackUrl,
        scope: 'read:user user:email',
        state,
      });
      return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    }

    return res.redirect(`${baseOrigin}/?auth_error=${provider}_not_configured`);
  } catch (err) {
    console.error(`[OAuth Start Error - ${provider}]:`, err.message);
    return res.redirect(`${baseOrigin}/?auth_error=${provider}_start_failed`);
  }
});

/**
 * GET /api/auth/oauth/neon/callback
 * Exchanges Neon Auth verifier + stored session_challenge cookie server-side for verified Google user session.
 */
router.get('/auth/oauth/neon/callback', async (req, res) => {
  const { baseOrigin } = resolveWebAuthnContext(req);
  const verifier = req.query?.neon_auth_session_verifier;
  const challengeId = req.cookies?.synctone_neon_challenge;

  if (!config.auth?.neonAuthBaseUrl) {
    return res.redirect(`${baseOrigin}/?auth_error=google_not_configured`);
  }

  let returnOrigin = baseOrigin;
  let returnTo = '/';
  let trustedOrigin = resolveTrustedNeonOrigin(baseOrigin);
  let cookieHeader = '';

  try {
    await ensureAuthSchemaTables(pool);

    if (challengeId) {
      const chRes = await pool.query(
        `DELETE FROM auth_challenges
         WHERE challenge_id = $1 AND flow_type = 'neon_oauth' AND expires_at > now()
         RETURNING *`,
        [String(challengeId)]
      );
      if (chRes.rows.length > 0) {
        cookieHeader = chRes.rows[0].challenge || '';
        const meta = chRes.rows[0].metadata || {};
        returnOrigin = meta.returnOrigin || baseOrigin;
        returnTo = meta.returnTo || '/';
        trustedOrigin = meta.trustedOrigin || trustedOrigin;
      }
    }

    res.clearCookie('synctone_neon_challenge', getCookieSettings());

    if (!verifier) {
      return res.redirect(`${returnOrigin}/?auth_error=google_missing_verifier`);
    }

    const sessionResp = await axios.get(
      `${config.auth.neonAuthBaseUrl}/get-session?neon_auth_session_verifier=${encodeURIComponent(String(verifier))}`,
      {
        headers: {
          Origin: trustedOrigin,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          'x-neon-auth-middleware': 'true',
        },
        timeout: 10000,
      }
    );

    let profileUser = sessionResp.data?.user || null;
    if (!profileUser) {
      const jwtHeader = sessionResp.headers['set-auth-jwt'];
      if (jwtHeader) {
        const claims = await verifyNeonAuthJwt(jwtHeader);
        profileUser = {
          id: claims.sub || claims.userId,
          email: claims.email,
          name: claims.name || claims.preferred_username,
          image: claims.picture || claims.image,
        };
      }
    }

    if (!profileUser || !profileUser.email) {
      return res.redirect(`${returnOrigin}/?auth_error=google_session_empty`);
    }

    const userRecord = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: profileUser.id || profileUser.email,
      email: profileUser.email,
      displayName: profileUser.name || profileUser.email.split('@')[0],
      avatarUrl: profileUser.image || profileUser.picture || null,
    });

    issueSessionCookie(res, userRecord);
    const sep = returnTo.includes('?') ? '&' : '?';
    return res.redirect(`${returnOrigin}${returnTo}${sep}auth=success&provider=google`);
  } catch (err) {
    console.error('[Neon OAuth Callback Error]:', err.message);
    return res.redirect(`${returnOrigin}/?auth_error=google_callback_failed`);
  }
});

/**
 * POST /api/auth/oauth/github/verify
 * Verifies a GitHub account via Personal Access Token or GitHub username lookup against api.github.com.
 */
router.post('/auth/oauth/github/verify', async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { username, token } = req.body || {};
    let cleanHandle = String(username || '').trim();
    if (cleanHandle.includes('github.com/')) {
      cleanHandle = cleanHandle.split('github.com/')[1].split(/[/?#]/)[0];
    }
    cleanHandle = cleanHandle.replace(/^@+/, '').trim();

    if (!token && (!cleanHandle || !/^[a-zA-Z0-9-]{1,39}$/.test(cleanHandle))) {
      return res.status(400).json({ error: 'Please enter a valid GitHub username (e.g. octocat).' });
    }

    const baseHeaders = {
      'User-Agent': 'SyncTone-Audio-Studio',
      Accept: 'application/vnd.github+json',
    };

    let ghUser = null;
    let resolvedEmail = '';

    if (token && typeof token === 'string' && token.trim()) {
      const authHeaders = { ...baseHeaders, Authorization: `Bearer ${token.trim()}` };
      const [userResp, emailsResp] = await Promise.all([
        axios.get('https://api.github.com/user', { headers: authHeaders, timeout: 8000 }),
        axios.get('https://api.github.com/user/emails', { headers: authHeaders, timeout: 8000 }).catch(() => ({ data: [] })),
      ]);
      ghUser = userResp.data;
      const primaryEmailObj =
        (Array.isArray(emailsResp.data) && emailsResp.data.find((e) => e.primary && e.verified)) ||
        (Array.isArray(emailsResp.data) && emailsResp.data.find((e) => e.verified)) ||
        null;
      resolvedEmail = primaryEmailObj?.email || ghUser?.email || '';
    } else {
      const userResp = await axios.get(`https://api.github.com/users/${encodeURIComponent(cleanHandle)}`, {
        headers: baseHeaders,
        timeout: 8000,
      });
      ghUser = userResp.data;
      resolvedEmail = ghUser?.email || '';
    }

    if (!ghUser || !ghUser.id || !ghUser.login) {
      return res.status(404).json({ error: 'GitHub account not found.' });
    }

    if (!resolvedEmail) {
      resolvedEmail = `${String(ghUser.login).toLowerCase()}@users.noreply.github.com`;
    }

    const userRecord = await findOrCreateOAuthUser({
      provider: 'github',
      providerAccountId: ghUser.id,
      email: resolvedEmail,
      displayName: ghUser.login || ghUser.name,
      avatarUrl: ghUser.avatar_url || null,
    });

    const session = issueSessionCookie(res, userRecord);
    return res.json({
      verified: true,
      message: `Signed in as GitHub user ${ghUser.login}`,
      token: session.token,
      user: session.user,
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(404).json({ error: 'GitHub username not found. Please check the spelling and try again.' });
    }
    if (status === 401) {
      return res.status(401).json({ error: 'GitHub token is invalid or expired.' });
    }
    console.error('[GitHub Verify Error]:', err.message);
    return res.status(502).json({ error: 'Could not verify GitHub account right now. Please try again.' });
  }
});

/**
 * GET /api/auth/oauth/:provider/callback
 * Exchanges OAuth code for profile + verified email, upserts user & oauth_accounts, sets cookie, redirects home.
 */
router.get('/auth/oauth/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const { baseOrigin } = resolveWebAuthnContext(req);
  const { code, state, error: oauthErr } = req.query;

  if (oauthErr || !code || !state) {
    return res.redirect(`${baseOrigin}/?auth_error=${encodeURIComponent(String(oauthErr || 'missing_code'))}`);
  }

  try {
    await ensureAuthSchemaTables(pool);
    const chRes = await pool.query(
      `DELETE FROM auth_challenges
       WHERE challenge_id = $1 AND flow_type = $2 AND expires_at > now()
       RETURNING *`,
      [String(state), `oauth_${provider}`]
    );
    if (chRes.rows.length === 0) {
      return res.redirect(`${baseOrigin}/?auth_error=invalid_oauth_state`);
    }

    const meta = chRes.rows[0].metadata || {};
    const redirectOrigin = meta.baseOrigin || baseOrigin;
    const returnTo = meta.returnTo || '/';
    const callbackUrl = meta.callbackUrl || `${redirectOrigin}/api/auth/oauth/${provider}/callback`;

    let profile = null;
    if (provider === 'google') {
      const tokenResp = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code: String(code),
          client_id: config.auth.google.clientId,
          client_secret: config.auth.google.clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
      const accessToken = tokenResp.data?.access_token;
      const userInfoResp = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 8000,
      });
      profile = {
        providerAccountId: userInfoResp.data?.sub,
        email: userInfoResp.data?.email,
        displayName: userInfoResp.data?.name || userInfoResp.data?.given_name,
        avatarUrl: userInfoResp.data?.picture,
      };
    } else if (provider === 'github') {
      const tokenResp = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: config.auth.github.clientId,
          client_secret: config.auth.github.clientSecret,
          code: String(code),
          redirect_uri: callbackUrl,
        },
        { headers: { Accept: 'application/json' }, timeout: 10000 }
      );
      const accessToken = tokenResp.data?.access_token;
      const ghHeaders = {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'SyncTone-OAuth',
        Accept: 'application/vnd.github+json',
      };
      const [userResp, emailsResp] = await Promise.all([
        axios.get('https://api.github.com/user', { headers: ghHeaders, timeout: 8000 }),
        axios.get('https://api.github.com/user/emails', { headers: ghHeaders, timeout: 8000 }),
      ]);
      const primaryEmailObj =
        (Array.isArray(emailsResp.data) && emailsResp.data.find((e) => e.primary && e.verified)) ||
        (Array.isArray(emailsResp.data) && emailsResp.data.find((e) => e.verified)) ||
        null;
      profile = {
        providerAccountId: userResp.data?.id,
        email: primaryEmailObj?.email || userResp.data?.email,
        displayName: userResp.data?.login || userResp.data?.name,
        avatarUrl: userResp.data?.avatar_url,
      };
    }

    if (!profile || !profile.providerAccountId || !profile.email) {
      return res.redirect(`${redirectOrigin}/?auth_error=${provider}_no_verified_email`);
    }

    const userRecord = await findOrCreateOAuthUser({
      provider,
      ...profile,
    });
    issueSessionCookie(res, userRecord);
    const sep = returnTo.includes('?') ? '&' : '?';
    return res.redirect(`${redirectOrigin}${returnTo}${sep}auth=success&provider=${provider}`);
  } catch (err) {
    console.error(`[OAuth Callback Error - ${provider}]:`, err.message);
    return res.redirect(`${baseOrigin}/?auth_error=${provider}_callback_failed`);
  }
});

/**
 * POST /api/auth/oauth/neon-session
 * Bridges a verified Neon Managed Auth JWT into a SyncTone PostgreSQL user + HTTP-only JWT cookie.
 */
router.post('/auth/oauth/neon-session', async (req, res) => {
  try {
    await ensureAuthSchemaTables(pool);
    const { token: neonJwt, provider = 'google' } = req.body || {};
    if (!neonJwt) {
      return res.status(400).json({ error: 'Neon Auth session JWT is required.' });
    }

    const claims = await verifyNeonAuthJwt(neonJwt);
    const userRecord = await findOrCreateOAuthUser({
      provider: String(provider || 'neon_auth'),
      providerAccountId: claims.sub || claims.userId || claims.email,
      email: claims.email,
      displayName: claims.name || claims.preferred_username,
      avatarUrl: claims.picture || claims.image || null,
    });

    const session = issueSessionCookie(res, userRecord);
    return res.json({
      verified: true,
      message: 'Signed in via Neon OAuth session',
      token: session.token,
      user: session.user,
    });
  } catch (err) {
    console.error('[Neon OAuth Session Error]:', err.message);
    return res.status(401).json({ error: err.message || 'Invalid Neon Auth session.' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the authentication cookie.
 */
router.post('/auth/logout', (_req, res) => {
  res.clearCookie('token', getCookieSettings());
  return res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 * Returns current authenticated user session.
 */
router.get('/auth/me', authenticateUser, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
