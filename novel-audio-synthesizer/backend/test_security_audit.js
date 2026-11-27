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
const { config } = require('./src/config');
const fs = require('fs');
const path = require('path');

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
  let novelBId = null;

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

    // =========================================================================
    // [Issue 2] Broken Authorization: /voices/assign, /novels/:id, & mutations
    // =========================================================================
    console.log('\n▶ [Issue 2] Testing Voice Assignment, Novel Patch/Create, Parse/Synth & Playback Auth...');

    const chapterAId = ownerRes.data.chapter_id;
    novelBId = uuidv4();
    await pool.query(
      `INSERT INTO novels (id, title, synopsis, channel, added_by, status)
       VALUES ($1, $2, 'Writer B novel', 'community', $3, 'draft')`,
      [novelBId, `Writer B Novel ${ts}`, writerB.id]
    );
    // Create character owned by writerA on novelA and character owned by writerB on novelB
    const charARes = await pool.query(
      `INSERT INTO characters (novel_id, canonical_name, gender, voice_id, is_narrator, source)
       VALUES ($1, 'Hero A', 'male', 'en-GB-RyanNeural', false, 'manual')
       RETURNING id`,
      [novelAId]
    );
    const charAId = charARes.rows[0].id;
    const charBRes = await pool.query(
      `INSERT INTO characters (novel_id, canonical_name, gender, voice_id, is_narrator, source)
       VALUES ($1, 'Hero B', 'male', 'en-GB-ThomasNeural', true, 'manual')
       RETURNING id`,
      [novelBId]
    );
    const charBId = charBRes.rows[0].id;

    // 2.1 POST /api/voices/assign: unauthenticated -> 401
    const vaUnauth = await axios.post(
      `${baseUrl}/voices/assign`,
      { character_id: charAId, new_voice_id: 'en-US-GuyNeural', chapter_id: chapterAId },
      { validateStatus: () => true }
    );
    assert.strictEqual(vaUnauth.status, 401, `Unauthenticated /voices/assign must return 401, got ${vaUnauth.status}`);

    // 2.2 POST /api/voices/assign: reader -> 403
    const vaReader = await axios.post(
      `${baseUrl}/voices/assign`,
      { character_id: charAId, new_voice_id: 'en-US-GuyNeural', chapter_id: chapterAId },
      { headers: { Cookie: cookieReader }, validateStatus: () => true }
    );
    assert.strictEqual(vaReader.status, 403, `Reader /voices/assign must return 403, got ${vaReader.status}`);

    // 2.3 POST /api/voices/assign: writerB modifying writerA's chapter/character -> 403
    const vaCrossWriter = await axios.post(
      `${baseUrl}/voices/assign`,
      { character_id: charAId, new_voice_id: 'en-US-GuyNeural', chapter_id: chapterAId },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(vaCrossWriter.status, 403, `Cross-writer /voices/assign must return 403, got ${vaCrossWriter.status}`);

    // 2.4 POST /api/voices/assign: character belongs to novelA, writerB passes novelB_id trying cross-novel hijack -> 403/400
    const vaCrossCharMismatch = await axios.post(
      `${baseUrl}/voices/assign`,
      { character_id: charAId, new_voice_id: 'en-US-GuyNeural', novel_id: novelBId },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.ok(
      vaCrossCharMismatch.status === 403 || vaCrossCharMismatch.status === 400,
      `Cross-novel character mismatch must be rejected (403/400), got ${vaCrossCharMismatch.status}`
    );
    const charACheckAfterFail = await pool.query('SELECT voice_id FROM characters WHERE id = $1', [charAId]);
    assert.strictEqual(charACheckAfterFail.rows[0].voice_id, 'en-GB-RyanNeural', 'Unauthorized voice assign mutated PG!');

    // 2.5 POST /api/voices/assign: legitimate owner writerA succeeds -> 200
    const vaOwner = await axios.post(
      `${baseUrl}/voices/assign`,
      { character_id: charAId, new_voice_id: 'en-US-GuyNeural', chapter_id: chapterAId },
      { headers: { Cookie: cookieA }, validateStatus: () => true }
    );
    assert.strictEqual(vaOwner.status, 200, `Owner /voices/assign must return 200, got ${vaOwner.status}`);

    // 2.6 PATCH /api/novels/:id: unauthenticated -> 401; writerB on novelA -> 403
    const patchUnauth = await axios.patch(
      `${baseUrl}/novels/${novelAId}`,
      { title: 'Hacked Title' },
      { validateStatus: () => true }
    );
    assert.strictEqual(patchUnauth.status, 401);

    const patchCrossWriter = await axios.patch(
      `${baseUrl}/novels/${novelAId}`,
      { title: 'Cross Writer Edit', added_by: writerB.id },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(patchCrossWriter.status, 403);

    // 2.7 PATCH /api/novels/:id: writerA CANNOT promote own novel to 'verified' -> 403
    const patchWriterVerify = await axios.patch(
      `${baseUrl}/novels/${novelAId}`,
      { channel: 'verified' },
      { headers: { Cookie: cookieA }, validateStatus: () => true }
    );
    assert.strictEqual(
      patchWriterVerify.status,
      403,
      `Writer self-promotion to verified channel must return 403, got ${patchWriterVerify.status}`
    );

    // 2.8 PATCH /api/novels/:id: writerA updating title/synopsis succeeds -> 200, added_by cannot be forged
    const patchOwnerOk = await axios.patch(
      `${baseUrl}/novels/${novelAId}`,
      { title: `Owner Updated Novel ${ts}`, added_by: writerB.id },
      { headers: { Cookie: cookieA }, validateStatus: () => true }
    );
    assert.strictEqual(patchOwnerOk.status, 200, `Owner PATCH must succeed, got ${patchOwnerOk.status}`);
    assert.strictEqual(patchOwnerOk.data.novel.added_by, writerA.id, 'added_by cannot be overridden by request body');

    // 2.9 PATCH /api/novels/:id: admin CAN promote novel to 'verified' -> 200
    const patchAdminVerify = await axios.patch(
      `${baseUrl}/novels/${novelAId}`,
      { channel: 'verified' },
      { headers: { Cookie: cookieAdmin }, validateStatus: () => true }
    );
    assert.strictEqual(patchAdminVerify.status, 200);
    assert.strictEqual(patchAdminVerify.data.novel.channel, 'verified');

    // 2.10 Audited related mutation routes:
    // POST /api/novels unauthenticated added_by spoof -> 401
    const postNovelSpoof = await axios.post(
      `${baseUrl}/novels`,
      { title: 'Spoof Novel', channel: 'verified', added_by: writerA.id },
      { validateStatus: () => true }
    );
    assert.strictEqual(postNovelSpoof.status, 401, `Unauth POST /novels must return 401, got ${postNovelSpoof.status}`);

    // POST /api/novels writer cannot force channel='verified' -> 403
    const postNovelWriterVerified = await axios.post(
      `${baseUrl}/novels`,
      { title: 'Writer Verified Bypass', channel: 'verified' },
      { headers: { Cookie: cookieA }, validateStatus: () => true }
    );
    assert.strictEqual(
      postNovelWriterVerified.status,
      403,
      `Writer POST /novels channel='verified' must return 403, got ${postNovelWriterVerified.status}`
    );

    // POST /api/parse/:id & POST /api/synthesize/:id enforce auth + ownership
    const parseUnauth = await axios.post(`${baseUrl}/parse/${chapterAId}`, {}, { validateStatus: () => true });
    assert.strictEqual(parseUnauth.status, 401, `Unauth /parse must return 401, got ${parseUnauth.status}`);
    const parseCross = await axios.post(
      `${baseUrl}/parse/${chapterAId}`,
      {},
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(parseCross.status, 403, `Cross-writer /parse must return 403, got ${parseCross.status}`);

    const synthUnauth = await axios.post(
      `${baseUrl}/synthesize/${chapterAId}`,
      { engine: 'machine-tts' },
      { validateStatus: () => true }
    );
    assert.strictEqual(synthUnauth.status, 401, `Unauth /synthesize must return 401, got ${synthUnauth.status}`);
    const synthCross = await axios.post(
      `${baseUrl}/synthesize/${chapterAId}`,
      { engine: 'machine-tts' },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(synthCross.status, 403, `Cross-writer /synthesize must return 403, got ${synthCross.status}`);

    // POST/GET /api/playback/progress require auth and prevent cross-user IDOR
    const pbUnauth = await axios.post(
      `${baseUrl}/playback/progress`,
      { user_id: writerA.id, novel_id: novelAId, chapter_id: chapterAId, segment_order: 1, position_ms: 1000 },
      { validateStatus: () => true }
    );
    assert.strictEqual(pbUnauth.status, 401, `Unauth /playback/progress must return 401, got ${pbUnauth.status}`);

    const pbCross = await axios.post(
      `${baseUrl}/playback/progress`,
      { user_id: writerA.id, novel_id: novelAId, chapter_id: chapterAId, segment_order: 1, position_ms: 1000 },
      { headers: { Cookie: cookieB }, validateStatus: () => true }
    );
    assert.strictEqual(pbCross.status, 403, `Cross-user POST /playback/progress must return 403, got ${pbCross.status}`);

    // POST /api/novels/upload-asset requires writer/admin auth
    const assetUnauth = await axios.post(
      `${baseUrl}/novels/upload-asset`,
      { data_url: 'data:image/png;base64,iVBORw0KGgo=' },
      { validateStatus: () => true }
    );
    assert.strictEqual(assetUnauth.status, 401, `Unauth /upload-asset must return 401, got ${assetUnauth.status}`);

    await pool.query('DELETE FROM novels WHERE id = $1', [novelBId]).catch(() => {});
    console.log('  ✔ Issue 2 authorization & ownership checks passed!');
  } finally {
    if (novelBId) {
      await Chapter.deleteMany({ novel_id: novelBId }).catch(() => {});
      await pool.query('DELETE FROM novels WHERE id = $1', [novelBId]).catch(() => {});
    }
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
