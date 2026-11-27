'use strict';

/**
 * SyncTone — 20 Public Domain Classics Seeder + Existing Catalog Faithful Repair
 *
 * Idempotently populates PostgreSQL (novels, chapters, chapter_documents, characters, character_aliases)
 * and MongoDB (when connected) with 20 curated public-domain classics, fixes Sherlock Holmes's cover/chapters,
 * and cleans bogus/duplicate characters & mismatched voices on Harry Potter and the Philosopher's Stone.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const mongoose = require('mongoose');
const { pool, connectPostgres } = require('../db');
const { ensureVoiceCatalog } = require('./seedDemos');
const { PUBLIC_DOMAIN_CATALOG } = require('../data/publicDomainCatalog');

const HP_NOVEL_ID = '7f095765-a42a-4065-8510-d805cb56004e';

const HP_BOGUS_CHARACTER_NAMES = [
  "Don't",
  'Er',
  'Everywhere Harry',
  'Five',
  'Happy Birthday Harry',
  'Happy Christmas',
  "He's",
  "She's",
  "I'm",
  "You're",
  "We're",
  "They're",
  'Gryffindors',
  'Well',
  'Oh',
  'Ah',
  'Yes',
  'No',
];

const HP_ALIAS_MERGE_MAP = [
  { shortName: 'Harry', canonicalName: 'Harry Potter', gender: 'male', age_band: 'young', voice_id: 'en-GB-ThomasNeural' },
  { shortName: 'Dumbledore', canonicalName: 'Albus Dumbledore', gender: 'male', age_band: 'elder', voice_id: 'en-IE-ConnorNeural' },
  { shortName: 'Filch', canonicalName: 'Argus Filch', gender: 'male', age_band: 'elder', voice_id: 'am_george' },
  { shortName: 'Dudley', canonicalName: 'Dudley Dursley', gender: 'male', age_band: 'young', voice_id: 'en-US-EricNeural' },
  { shortName: 'Fred', canonicalName: 'Fred Weasley', gender: 'male', age_band: 'young', voice_id: 'en-GB-ThomasNeural' },
  { shortName: 'George', canonicalName: 'George Weasley', gender: 'male', age_band: 'young', voice_id: 'en-NZ-MitchellNeural' },
  { shortName: 'Hagrid', canonicalName: 'Rubeus Hagrid', gender: 'male', age_band: 'adult', voice_id: 'en-US-SteffanNeural' },
  { shortName: 'Snape', canonicalName: 'Severus Snape', gender: 'male', age_band: 'adult', voice_id: 'en-US-RogerNeural' },
  { shortName: 'McGonagall', canonicalName: 'Professor McGonagall', gender: 'female', age_band: 'adult', voice_id: 'en-GB-SoniaNeural' },
  { shortName: 'Vernon', canonicalName: 'Uncle Vernon', gender: 'male', age_band: 'adult', voice_id: 'en-US-RogerNeural' },
  { shortName: 'Ron', canonicalName: 'Ron Weasley', gender: 'male', age_band: 'young', voice_id: 'en-NZ-MitchellNeural' },
  { shortName: 'Hermione', canonicalName: 'Hermione Granger', gender: 'female', age_band: 'young', voice_id: 'en-GB-LibbyNeural' },
  { shortName: 'Malfoy', canonicalName: 'Draco Malfoy', gender: 'male', age_band: 'young', voice_id: 'en-AU-WilliamMultilingualNeural' },
];

const HP_VOICE_UPDATES = [
  { canonicalName: 'Albus Dumbledore', gender: 'male', age_band: 'elder', voice_id: 'en-IE-ConnorNeural' },
  { canonicalName: 'Argus Filch', gender: 'male', age_band: 'elder', voice_id: 'am_george' },
  { canonicalName: 'Aunt Petunia', gender: 'female', age_band: 'adult', voice_id: 'bf_alice' },
  { canonicalName: 'Bane', gender: 'male', age_band: 'adult', voice_id: 'en-US-SteffanNeural' },
  { canonicalName: 'Dean Thomas', gender: 'male', age_band: 'young', voice_id: 'en-GB-ThomasNeural' },
  { canonicalName: 'Dedalus Diggle', gender: 'male', age_band: 'elder', voice_id: 'bm_george' },
  { canonicalName: 'Draco Malfoy', gender: 'male', age_band: 'young', voice_id: 'en-AU-WilliamMultilingualNeural' },
  { canonicalName: 'Dudley Dursley', gender: 'male', age_band: 'young', voice_id: 'en-US-EricNeural' },
  { canonicalName: 'Firenze', gender: 'male', age_band: 'adult', voice_id: 'am_michael' },
  { canonicalName: 'Fred Weasley', gender: 'male', age_band: 'young', voice_id: 'en-GB-ThomasNeural' },
  { canonicalName: 'Garrick Ollivander', gender: 'male', age_band: 'elder', voice_id: 'am_george' },
  { canonicalName: 'George Weasley', gender: 'male', age_band: 'young', voice_id: 'en-NZ-MitchellNeural' },
  { canonicalName: 'Griphook', gender: 'male', age_band: 'adult', voice_id: 'am_onyx' },
  { canonicalName: 'Harry Potter', gender: 'male', age_band: 'young', voice_id: 'en-GB-ThomasNeural' },
  { canonicalName: 'Hermione Granger', gender: 'female', age_band: 'young', voice_id: 'en-GB-LibbyNeural' },
  { canonicalName: 'Ron Weasley', gender: 'male', age_band: 'young', voice_id: 'en-NZ-MitchellNeural' },
  { canonicalName: 'Rubeus Hagrid', gender: 'male', age_band: 'adult', voice_id: 'en-US-SteffanNeural' },
  { canonicalName: 'Severus Snape', gender: 'male', age_band: 'adult', voice_id: 'en-US-RogerNeural' },
  { canonicalName: 'Professor McGonagall', gender: 'female', age_band: 'adult', voice_id: 'en-GB-SoniaNeural' },
  { canonicalName: 'Uncle Vernon', gender: 'male', age_band: 'adult', voice_id: 'en-US-RogerNeural' },
];

async function upsertAuthorUser(client, authorName) {
  const cleanName = String(authorName || 'Classic Author').trim().slice(0, 50);
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'classic_author';
  const email = `${slug}@publicdomain.synctone.internal`;

  const existing = await client.query(
    'SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1',
    [cleanName, email]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO users (username, email, password_hash, role)
    VALUES ($1, $2, NULL, 'writer')
    RETURNING id;
    `,
    [cleanName, email]
  );
  return inserted.rows[0].id;
}

async function ensureValidVoiceRow(client, voiceId, gender = 'other', ageBand = 'adult', isNarrator = false) {
  await client.query(
    `
    INSERT INTO voices (id, label, gender, age_band, language, reserved_narrator)
    VALUES ($1, $2, $3, $4, 'en-gb', $5)
    ON CONFLICT (id) DO NOTHING;
    `,
    [
      voiceId,
      voiceId,
      gender === 'male' || gender === 'female' ? gender : 'other',
      ['child', 'young', 'teen', 'adult', 'elder', 'elderly'].includes(ageBand) ? ageBand : 'adult',
      Boolean(isNarrator),
    ]
  );
}

async function upsertNarratorCharacter(client, novelId, narratorName, voiceId, sampleQuote) {
  await ensureValidVoiceRow(client, voiceId, 'male', 'adult', true);

  const existingNarr = await client.query(
    'SELECT id FROM characters WHERE novel_id = $1 AND is_narrator = true LIMIT 1',
    [novelId]
  );
  if (existingNarr.rows.length > 0) {
    await client.query(
      `
      UPDATE characters
      SET canonical_name = $2,
          voice_id = $3,
          sample_quote = $4,
          gender = 'male',
          source = 'manual',
          updated_at = now()
      WHERE id = $1;
      `,
      [existingNarr.rows[0].id, narratorName || 'Narrator', voiceId, sampleQuote || 'Primary narrative voice.']
    );
    return existingNarr.rows[0].id;
  }

  const inserted = await client.query(
    `
    INSERT INTO characters (novel_id, canonical_name, gender, age_band, temperament, sample_quote, voice_id, speed_multiplier, is_narrator, source)
    VALUES ($1, $2, 'male', 'adult', 'measured', $3, $4, 1.0, true, 'manual')
    ON CONFLICT (novel_id, canonical_name) DO UPDATE SET
      voice_id = EXCLUDED.voice_id,
      is_narrator = true,
      sample_quote = EXCLUDED.sample_quote,
      updated_at = now()
    RETURNING id;
    `,
    [novelId, narratorName || 'Narrator', sampleQuote || 'Primary narrative voice.', voiceId]
  );
  return inserted.rows[0].id;
}

async function repairHarryPotterNovel(client) {
  const hpExists = await client.query('SELECT id, cover_object FROM novels WHERE id = $1', [HP_NOVEL_ID]);
  if (hpExists.rows.length === 0) return;

  // Ensure J.K. Rowling author attribution + valid cover
  const authorId = await upsertAuthorUser(client, 'J.K. Rowling');
  await client.query(
    `
    UPDATE novels
    SET added_by = $2,
        global_tone = COALESCE(NULLIF(global_tone, ''), 'British Fantasy'),
        cover_object = CASE
          WHEN cover_object IS NULL OR cover_object = '' THEN '/static/covers/hp1_cover.jpg'
          ELSE cover_object
        END,
        updated_at = now()
    WHERE id = $1;
    `,
    [HP_NOVEL_ID, authorId]
  );

  // 1. Delete bogus exclamation/contraction/non-character rows
  await client.query(
    `
    DELETE FROM characters
    WHERE novel_id = $1
      AND is_narrator = false
      AND canonical_name = ANY($2::varchar[]);
    `,
    [HP_NOVEL_ID, HP_BOGUS_CHARACTER_NAMES]
  );

  // 2. Collapse duplicate short character names into canonical rows & aliases
  for (const mapping of HP_ALIAS_MERGE_MAP) {
    await ensureValidVoiceRow(client, mapping.voice_id, mapping.gender, mapping.age_band, false);

    // Ensure canonical character exists
    const canonicalRes = await client.query(
      `
      INSERT INTO characters (novel_id, canonical_name, gender, age_band, temperament, voice_id, speed_multiplier, is_narrator, source)
      VALUES ($1, $2, $3, $4, 'balanced', $5, 1.0, false, 'manual')
      ON CONFLICT (novel_id, canonical_name) DO UPDATE SET
        gender = EXCLUDED.gender,
        age_band = EXCLUDED.age_band,
        voice_id = EXCLUDED.voice_id,
        updated_at = now()
      RETURNING id;
      `,
      [HP_NOVEL_ID, mapping.canonicalName, mapping.gender, mapping.age_band, mapping.voice_id]
    );
    const canonicalId = canonicalRes.rows[0].id;

    // Delete separate duplicate short character row if present
    await client.query(
      'DELETE FROM characters WHERE novel_id = $1 AND canonical_name = $2 AND id <> $3',
      [HP_NOVEL_ID, mapping.shortName, canonicalId]
    );

    // Record shortName in 4NF character_aliases (conflict-safe via trigger)
    const aliasCheck = await client.query(
      `
      SELECT ca.id
      FROM character_aliases ca
      JOIN characters c ON c.id = ca.character_id
      WHERE c.novel_id = $1 AND ca.alias = $2
      LIMIT 1;
      `,
      [HP_NOVEL_ID, mapping.shortName]
    );
    if (aliasCheck.rows.length === 0) {
      await client.query(
        'INSERT INTO character_aliases (character_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [canonicalId, mapping.shortName]
      );
    }
  }

  // 3. Enforce faithful voices for key characters
  for (const upd of HP_VOICE_UPDATES) {
    await ensureValidVoiceRow(client, upd.voice_id, upd.gender, upd.age_band, false);
    await client.query(
      `
      UPDATE characters
      SET voice_id = $3,
          gender = $4,
          age_band = $5,
          updated_at = now()
      WHERE novel_id = $1 AND LOWER(canonical_name) = LOWER($2);
      `,
      [HP_NOVEL_ID, upd.canonicalName, upd.voice_id, upd.gender, upd.age_band]
    );
  }

  // Ensure Narrator uses British Narrator en-GB-RyanNeural
  await upsertNarratorCharacter(client, HP_NOVEL_ID, 'Narrator', 'en-GB-RyanNeural', 'Mr. and Mrs. Dursley, of number four, Privet Drive...');
}

async function seedPublicDomainCatalog() {
  await connectPostgres();
  await ensureVoiceCatalog(pool);

  const client = await pool.connect();
  let novelsUpserted = 0;
  let chaptersUpserted = 0;

  try {
    await client.query('BEGIN');

    for (const novel of PUBLIC_DOMAIN_CATALOG) {
      const authorId = await upsertAuthorUser(client, novel.author);

      await client.query(
        `
        INSERT INTO novels (id, added_by, title, synopsis, channel, status, global_tone, portfolio_source, cover_object)
        VALUES ($1, $2, $3, $4, 'verified', 'published', $5, 'manual', $6)
        ON CONFLICT (id) DO UPDATE SET
          added_by = EXCLUDED.added_by,
          title = EXCLUDED.title,
          synopsis = EXCLUDED.synopsis,
          channel = 'verified',
          status = 'published',
          global_tone = EXCLUDED.global_tone,
          cover_object = EXCLUDED.cover_object,
          updated_at = now();
        `,
        [novel.id, authorId, novel.title, novel.synopsis, novel.global_tone, novel.cover_object]
      );
      novelsUpserted += 1;

      const narrQuote = novel.chapters?.[0]?.lines?.find((l) => l.type !== 'dialogue')?.text || 'Primary narrative voice.';
      await upsertNarratorCharacter(client, novel.id, novel.narrator_name, novel.narrator_voice, narrQuote);

      for (const charDef of novel.cast || []) {
        await ensureValidVoiceRow(client, charDef.voice, charDef.gender, charDef.age_band, false);
        const charQuote =
          novel.chapters
            ?.flatMap((c) => c.lines || [])
            .find((l) => l.type === 'dialogue' && l.speaker === charDef.name)?.text || '';

        const charRes = await client.query(
          `
          INSERT INTO characters (novel_id, canonical_name, gender, age_band, temperament, sample_quote, voice_id, speed_multiplier, is_narrator, source)
          VALUES ($1, $2, $3, $4, 'expressive', $5, $6, 1.0, false, 'manual')
          ON CONFLICT (novel_id, canonical_name) DO UPDATE SET
            gender = EXCLUDED.gender,
            age_band = EXCLUDED.age_band,
            sample_quote = CASE WHEN EXCLUDED.sample_quote <> '' THEN EXCLUDED.sample_quote ELSE characters.sample_quote END,
            voice_id = EXCLUDED.voice_id,
            updated_at = now()
          RETURNING id;
          `,
          [novel.id, charDef.name, charDef.gender || 'unknown', charDef.age_band || 'adult', charQuote.slice(0, 220), charDef.voice]
        );
        const charId = charRes.rows[0].id;

        for (const alias of charDef.aliases || []) {
          const aliasCheck = await client.query(
            `
            SELECT ca.id
            FROM character_aliases ca
            JOIN characters c ON c.id = ca.character_id
            WHERE c.novel_id = $1 AND ca.alias = $2
            LIMIT 1;
            `,
            [novel.id, alias]
          );
          if (aliasCheck.rows.length === 0) {
            await client.query(
              'INSERT INTO character_aliases (character_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [charId, alias]
            );
          }
        }
      }

      for (const ch of novel.chapters || []) {
        const chRes = await client.query(
          `
          INSERT INTO chapters (id, novel_id, chapter_number, title, status, audio_version, total_duration_ms)
          VALUES ($1, $2, $3, $4, 'completed', 1, $5)
          ON CONFLICT (novel_id, chapter_number) DO UPDATE SET
            title = EXCLUDED.title,
            status = 'completed',
            total_duration_ms = CASE WHEN chapters.total_duration_ms > 0 THEN chapters.total_duration_ms ELSE EXCLUDED.total_duration_ms END,
            updated_at = now()
          RETURNING id;
          `,
          [ch.id, novel.id, ch.chapter_number, ch.title, ch.total_duration_ms]
        );
        const actualChapterId = chRes.rows[0].id;
        const normalizedSegments = ch.segments.map((s) => ({ ...s }));
        const normalizedManifest = {
          ...ch.manifest,
          audio_url: `/api/stream/${actualChapterId}`,
        };

        await client.query(
          `
          INSERT INTO chapter_documents (pg_chapter_id, novel_id, chapter_number, title, raw_text, segments, manifest)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
          ON CONFLICT (pg_chapter_id) DO UPDATE SET
            title = EXCLUDED.title,
            raw_text = EXCLUDED.raw_text,
            segments = EXCLUDED.segments,
            manifest = EXCLUDED.manifest,
            updated_at = now();
          `,
          [
            actualChapterId,
            novel.id,
            ch.chapter_number,
            ch.title,
            ch.raw_text,
            JSON.stringify(normalizedSegments),
            JSON.stringify(normalizedManifest),
          ]
        );
        chaptersUpserted += 1;
      }
    }

    await repairHarryPotterNovel(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`[SeedPublicDomain20] Upserted ${novelsUpserted} public-domain novels & ${chaptersUpserted} chapter documents, and repaired existing Harry Potter cast.`);
}

if (require.main === module) {
  seedPublicDomainCatalog()
    .then(async () => {
      await pool.end().catch(() => {});
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[SeedPublicDomain20 Error]:', err);
      await pool.end().catch(() => {});
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedPublicDomainCatalog };
