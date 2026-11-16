const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const { config } = require('../config');
const { prisma, getPrismaClient } = require('./prisma');

const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 15000,
  ...(config.pgSsl
    ? { ssl: { rejectUnauthorized: Boolean(config.pgSslRejectUnauthorized) } }
    : {}),
});

pool.on('error', (err) => {
  console.warn('[DB] Unexpected idle client error:', err.message);
});

function resolveSchemaSqlPath() {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../../../migrations/0001_initial_schema.sql'),
    path.resolve(__dirname, '../../../migrations/0001_initial_schema.sql'),
    path.resolve(__dirname, '../../migrations/0001_initial_schema.sql'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

let authSchemaEnsured = false;

const AUTH_EXTENSION_SQL = `
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_oauth_provider_account UNIQUE (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS ix_oauth_accounts_user_id ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS user_passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type VARCHAR(32) NOT NULL DEFAULT 'singleDevice',
    backed_up BOOLEAN NOT NULL DEFAULT false,
    transports TEXT[] DEFAULT '{}',
    friendly_name VARCHAR(100) NOT NULL DEFAULT 'Passkey',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_user_passkeys_user_id ON user_passkeys(user_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge_id VARCHAR(128) PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    flow_type VARCHAR(32) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auth_challenges_expires_at ON auth_challenges(expires_at);
`;

async function ensureAuthSchemaTables(pgPool = pool) {
  if (authSchemaEnsured) return false;
  const check = await pgPool.query(
    "SELECT to_regclass('public.user_passkeys') AS pk_tbl, to_regclass('public.oauth_accounts') AS oa_tbl, to_regclass('public.auth_challenges') AS ch_tbl"
  );
  const row = check.rows[0] || {};
  if (row.pk_tbl && row.oa_tbl && row.ch_tbl) {
    authSchemaEnsured = true;
    return false;
  }
  await pgPool.query(AUTH_EXTENSION_SQL);
  authSchemaEnsured = true;
  console.log('[DB] Applied OAuth & WebAuthn Passkey schema extension');
  return true;
}

/**
 * Ensures the 12-table Strict 4NF PostgreSQL schema + auth extensions exist in a database
 * (e.g., newly provisioned Supabase or Neon instance) before app queries run.
 */
async function ensurePostgresSchema(pgPool = pool) {
  const check = await pgPool.query("SELECT to_regclass('public.novels') AS tbl");
  if (check.rows[0]?.tbl) {
    await ensureAuthSchemaTables(pgPool);
    return false;
  }

  const sqlPath = resolveSchemaSqlPath();
  if (!sqlPath) {
    throw new Error('Schema SQL file not found for PostgreSQL initialization.');
  }

  const sql = fs.readFileSync(sqlPath, 'utf-8');
  await pgPool.query(sql);
  authSchemaEnsured = true;
  console.log('[DB] Initialized Strict 4NF + Auth PostgreSQL schema');
  return true;
}

async function connectMongo() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('[DB] Connected to MongoDB 7.0');
  } catch (err) {
    console.warn('[DB] MongoDB connection warning:', err.message);
  }
}

async function connectPostgres() {
  try {
    const client = await pool.connect();
    client.release();
    await ensurePostgresSchema(pool);
    const prismaClient = getPrismaClient();
    if (prismaClient) {
      await prismaClient.$connect().catch(() => {});
    }
    console.log('[DB] Connected to PostgreSQL 16 (pg pool + Prisma ORM)');
  } catch (err) {
    console.warn('[DB] PostgreSQL connection warning:', err.message);
  }
}

module.exports = {
  pool,
  prisma,
  getPrismaClient,
  ensurePostgresSchema,
  ensureAuthSchemaTables,
  connectMongo,
  connectPostgres,
};
