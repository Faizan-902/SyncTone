/**
 * Security & Authorization Regression Test Suite (Issues 1, 2, 4)
 * Exercises real Express routes, PostgreSQL constraints, MongoDB docs, and config guards.
 */

const assert = require('assert');
const http = require('http');
const axios = require('axios');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const { createApp } = require('./src/app');
const { pool, connectPostgres, connectMongo } = require('./src/db');
const { Chapter } = require('./src/models');
const chaptersRouter = require('./src/routes/chapters');

async function createUserDirect(username, email, role) {
  const res = await pool.query(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ($1, $2, crypt('TestPass2026!', gen_salt('bf')), $3)
     RETURNING id, username, email, role`,
    [username, email, role]
  );
  return res.rows[0];
}

async function loginUser(baseUrl, email, password = 'TestPass2026!') {
  const res = await axios.post(`${baseUrl}/auth/login`, { email, password });
  const cookie = res.headers['set-cookie']?.find((c) => c.includes('token='))?.split(';')[0];
  assert.ok(cookie, `Expected session cookie for ${email}`);
  return cookie;
}

async function runTests() {
  await connectPostgres();
  await connectMongo();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const createdUsers = [];
  let novelAId = null;

  try {
    console.log('\n▶ [Issue 1] Testing Chapter Ingestion Auth, Spoof Removal & Ownership...');

    const writerA = await createUserDirect(`sec_wA_${ts}`, `sec_wA_${ts}@example.com`, 'writer');
    const writerB = await createUserDirect(`sec_wB_${ts}`, `sec_wB_${ts}@example.com`, 'writer');
    const reader = await createUserDirect(`sec_r_${ts}`, `sec_r_${ts}@example.com`, 'reader');
    const admin = await createUserDirect(`sec_admin_${ts}`, `sec_admin_${ts}@example.com`, 'admin');
    createdUsers.push(writerA.id, writerB.id, reader.id, admin.id);

    const cookieA = await loginUser(baseUrl, writerA.email);
    const cookieB = await loginUser(baseUrl, writerB.email);
    const cookieReader = await loginUser(baseUrl, reader.email);
    const cookieAdmin = await loginUser(baseUrl, admin.email);

    // Seed Novel owned by writerA directly in PG
    novelAId = uuidv4();
    await pool.query(
      `INSERT INTO novels (id, title, synopsis, channel, added_by, status)
       VALUES ($1, $2, 'Ownership test novel', 'community', $3, 'draft')`,
      [novelAId, `Security Novel ${ts}`, writerA.id]
    );

    // 1.1 Unauthenticated with spoofed requested_by MUST return 401 (no fallback allowed)
    const spoofIngestRes = await axios.post(
      `${baseUrl}/novels/${novelAId}/chapters`,
      { title: 'Spoofed Ch', text: 'Spoofed text content.', requested_by: writerA.id },
      { validateStatus: () => true }
    );
    assert.strictEqual(
      spoofIngestRes.status,
      401,
      `Unauthenticated requested_by ingestion must return 401, got ${spoofIngestRes.status}`
    );

    // 1.2 Unauthenticated /upload with spoofed requested_by MUST return 401
    const spoofUploadRes = await axios.post(
      `${baseUrl}/upload`,
      { title: 'Spoofed Upload', text: 'Spoofed upload text.', novel_id: novelAId, requested_by: writerA.id },
      { validateStatus: () => true }
    );
    assert.strictEqual(
      spoofUploadRes.status,
      401,
      `Unauthenticated /upload must return 401, got ${spoofUploadRes.status}`
    );

    // 1.3 Reader role MUST return 403
    const readerIngestRes = await axios.post(
      `${baseUrl}/novels/${novelAId}/chapters`,
      { title: 'Reader Ch', text: 'Reader text content.' },
      { headers: { Cookie: cookieReader }, validateStatus: () => true }
    );
    assert.strictEqual(readerIngestRes.status, 403, `Reader ingestion must return 403, got ${readerIngestRes.status}`);

    // 1.4 Authenticated writerB (non-owner) MUST return 403 on writerA's novel
    const crossWriterRes = await axios.post(
      `${baseUrl}/novels/${novelAId}/chapters`,
      { title: 'Cross Writer Ch', text: 'Unauthorized cross-writer prose.', requested_by: writerA.id },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(
      crossWriterRes.status,
      403,
      `Non-owner writer must receive 403, got ${crossWriterRes.status}`
    );

    // 1.5 Authenticated writerB on /upload targeting writerA's novel MUST return 403
    const crossUploadRes = await axios.post(
      `${baseUrl}/upload`,
      { title: 'Cross Upload', text: 'Unauthorized cross upload.', novel_id: novelAId },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(
      crossUploadRes.status,
      403,
      `Non-owner /upload must receive 403, got ${crossUploadRes.status}`
    );

    // Confirm zero chapters or jobs were persisted on writerA's novel
    const pgChAfterFail = await pool.query('SELECT id FROM chapters WHERE novel_id = $1', [novelAId]);
    assert.strictEqual(pgChAfterFail.rows.length, 0, 'No chapters may be created by unauthorized requests');

    // 1.6 Direct ingestChapter service call enforces ownership (writerB -> 403, unauthenticated -> 401)
    assert.strictEqual(typeof chaptersRouter.ingestChapter, 'function', 'ingestChapter service must be exported');
    await assert.rejects(
      () => chaptersRouter.ingestChapter({ novelId: novelAId, title: 'Svc Unauth', text: 'Text', requestedBy: null }),
      (err) => err && err.status === 401,
      'ingestChapter must reject missing requestedBy with 401'
    );
    await assert.rejects(
      () =>
        chaptersRouter.ingestChapter({
          novelId: novelAId,
          title: 'Svc Cross',
          text: 'Text',
          requestedBy: writerB.id,
          actorRole: 'writer',
        }),
      (err) => err && err.status === 403,
      'ingestChapter must reject non-owner writer with 403'
    );

    // 1.7 Authorized owner writerA succeeds; requested_by body override is ignored (uses session id)
    const ownerRes = await axios.post(
      `${baseUrl}/novels/${novelAId}/chapters`,
      {
        title: 'Chapter 1: Owner Authorized',
        text: '"Hello," said Holmes cleanly.',
        requested_by: writerB.id,
      },
      { headers: { Cookie: cookieA }, validateStatus: () => true }
    );
    assert.strictEqual(ownerRes.status, 201, `Owner ingestion must return 201, got ${ownerRes.status}`);
    assert.strictEqual(
      ownerRes.data.job.requested_by,
      writerA.id,
      'job.requested_by must come exclusively from authenticated session'
    );

    // 1.8 Admin succeeds and requested_by comes from admin session (not spoofed requested_by)
    const adminRes = await axios.post(
      `${baseUrl}/novels/${novelAId}/chapters`,
      {
        title: 'Chapter 2: Admin Authorized',
        text: '"Follow-up," said Watson.',
        requested_by: writerB.id,
      },
      { headers: { Cookie: cookieAdmin }, validateStatus: () => true }
    );
    assert.strictEqual(adminRes.status, 201, `Admin ingestion must return 201, got ${adminRes.status}`);
    assert.strictEqual(
      adminRes.data.job.requested_by,
      admin.id,
      'Admin job.requested_by must come from authenticated admin session, not body requested_by'
    );

    console.log('  ✔ Issue 1 security & ownership checks passed!');
  } finally {
    if (novelAId) {
      await Chapter.deleteMany({ novel_id: novelAId }).catch(() => {});
      await pool.query('DELETE FROM novels WHERE id = $1', [novelAId]).catch(() => {});
    }
    if (createdUsers.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUsers]).catch(() => {});
    }
    server.close();
    await pool.end();
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('❌ SECURITY TEST FAILED:', err);
  process.exit(1);
});
