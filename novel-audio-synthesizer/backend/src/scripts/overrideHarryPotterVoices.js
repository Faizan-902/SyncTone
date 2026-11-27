'use strict';

/**
 * SyncTone — Harry Potter Cast Cleanup & Faithful Voice Override Script
 *
 * 1. Deletes all remaining bogus/OCR non-character rows on Harry Potter & the Philosopher's Stone.
 * 2. Merges duplicate alias rows (Mr/Mrs Dursley, Uncle Vernon, Aunt Petunia, Professor Dumbledore/Snape,
 *    Minerva McGonagall, Neville, Percy, Seamus, Wood) into canonical rows + 4NF character_aliases.
 * 3. Overrides every canonical HP character with gender/age/accent-matched voices (and eliminates
 *    any narrator voice leakage such as Peeves using en-GB-RyanNeural).
 * 4. Syncs updated canonical voices back into HP stored chapters & chapter_documents manifests.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const { pool, connectPostgres } = require('../db');
const { ensureVoiceCatalog } = require('./seedDemos');

const HP_NOVEL_ID = '7f095765-a42a-4065-8510-d805cb56004e';

const BOGUS_CHARACTER_NAMES = [
  'Hope',
  'Ihe',
  "Ihere's",
  'Joe Harry',
  'Make Dudley',
  'Make Harry',
  'P-P-Potter',
  'Protagonist',
  'Slytherin',
  'Some',
  'TIl',
  "That's",
  "We've",
  'Whatever',
  'Whenever Harry',
  'White',
  'Yeah',
  'Years',
  "You've",
];

// Canonical cast definitions with distinct, gender/age/personality-faithful voices
const HP_CANONICAL_CAST = [
  {
    canonicalName: 'Albus Dumbledore',
    aliases: ['Professor Dumbledore', 'Dumbledore'],
    gender: 'male',
    age_band: 'elder',
    voice_id: 'en-IE-ConnorNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Argus Filch',
    aliases: ['Filch'],
    gender: 'male',
    age_band: 'elder',
    voice_id: 'am_george',
    language: 'en-us',
  },
  {
    canonicalName: 'Bane',
    aliases: [],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'en-US-SteffanNeural',
    language: 'en-us',
  },
  {
    canonicalName: 'Dean Thomas',
    aliases: ['Dean'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-US-BrianNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Dedalus Diggle',
    aliases: [],
    gender: 'male',
    age_band: 'elder',
    voice_id: 'bm_george',
    language: 'en-gb',
  },
  {
    canonicalName: 'Draco Malfoy',
    aliases: ['Malfoy', 'Draco'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-AU-WilliamMultilingualNeural',
    language: 'en-au',
  },
  {
    canonicalName: 'Dudley Dursley',
    aliases: ['Dudley'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-US-EricNeural',
    language: 'en-us',
  },
  {
    canonicalName: 'Firenze',
    aliases: [],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'am_michael',
    language: 'en-us',
  },
  {
    canonicalName: 'Fred Weasley',
    aliases: ['Fred'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'am_puck',
    language: 'en-gb',
  },
  {
    canonicalName: 'Garrick Ollivander',
    aliases: ['Ollivander'],
    gender: 'male',
    age_band: 'elder',
    voice_id: 'bm_fable',
    language: 'en-gb',
  },
  {
    canonicalName: 'George Weasley',
    aliases: ['George'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-US-ChristopherNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Ginny Weasley',
    aliases: ['Ginny'],
    gender: 'female',
    age_band: 'young',
    voice_id: 'en-GB-MaisieNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Griphook',
    aliases: [],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'am_onyx',
    language: 'en-us',
  },
  {
    canonicalName: 'Harry Potter',
    aliases: ['Harry'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-GB-ThomasNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Hermione Granger',
    aliases: ['Hermione'],
    gender: 'female',
    age_band: 'young',
    voice_id: 'en-GB-LibbyNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Lee Jordan',
    aliases: [],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-NZ-MitchellNeural',
    language: 'en-nz',
  },
  {
    canonicalName: 'Lord Voldemort',
    aliases: ['Voldemort'],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'am_onyx',
    language: 'en-gb',
  },
  {
    canonicalName: 'Madam Hooch',
    aliases: ['Hooch'],
    gender: 'female',
    age_band: 'adult',
    voice_id: 'en-AU-NatashaNeural',
    language: 'en-au',
  },
  {
    canonicalName: 'Madam Pomfrey',
    aliases: ['Pomfrey'],
    gender: 'female',
    age_band: 'adult',
    voice_id: 'en-US-AvaNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Molly Weasley',
    aliases: ['Mrs. Weasley', 'Mrs Weasley'],
    gender: 'female',
    age_band: 'adult',
    voice_id: 'en-US-EmmaNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Nearly Headless Nick',
    aliases: ['Sir Nicholas'],
    gender: 'male',
    age_band: 'elder',
    voice_id: 'bm_george',
    language: 'en-gb',
  },
  {
    canonicalName: 'Neville Longbottom',
    aliases: ['Neville'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-US-AndrewNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Oliver Wood',
    aliases: ['Wood'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-CA-LiamNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Pansy Parkinson',
    aliases: ['Pansy'],
    gender: 'female',
    age_band: 'young',
    voice_id: 'en-GB-MaisieNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Peeves',
    aliases: [],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'am_puck',
    language: 'en-gb',
  },
  {
    canonicalName: 'Percy Weasley',
    aliases: ['Percy'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'bm_daniel',
    language: 'en-gb',
  },
  {
    canonicalName: 'Petunia Dursley',
    aliases: ['Aunt Petunia', 'Mrs Dursley', 'Mrs. Dursley'],
    gender: 'female',
    age_band: 'adult',
    voice_id: 'en-US-MichelleNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Professor Flitwick',
    aliases: ['Flitwick'],
    gender: 'male',
    age_band: 'elder',
    voice_id: 'en-US-AndrewNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Professor McGonagall',
    aliases: ['Minerva McGonagall', 'McGonagall'],
    gender: 'female',
    age_band: 'adult',
    voice_id: 'en-GB-SoniaNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Professor Quirrell',
    aliases: ['Quirrell'],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'en-CA-LiamNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Ron Weasley',
    aliases: ['Ron'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-NZ-MitchellNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Ronan',
    aliases: [],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'en-US-GuyNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Rubeus Hagrid',
    aliases: ['Hagrid'],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'en-US-SteffanNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Seamus Finnigan',
    aliases: ['Seamus'],
    gender: 'male',
    age_band: 'young',
    voice_id: 'en-US-ChristopherNeural',
    language: 'en-ie',
  },
  {
    canonicalName: 'Severus Snape',
    aliases: ['Professor Snape', 'Snape'],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'en-US-RogerNeural',
    language: 'en-gb',
  },
  {
    canonicalName: 'Vernon Dursley',
    aliases: ['Uncle Vernon', 'Mr Dursley', 'Mr. Dursley', 'Vernon'],
    gender: 'male',
    age_band: 'adult',
    voice_id: 'en-US-GuyNeural',
    language: 'en-gb',
  },
];

async function ensureVoiceRow(client, entry) {
  await client.query(
    `
    INSERT INTO voices (id, label, gender, age_band, language, reserved_narrator)
    VALUES ($1, $2, $3, $4, $5, false)
    ON CONFLICT (id) DO NOTHING;
    `,
    [
      entry.voice_id,
      entry.voice_id,
      entry.gender === 'female' ? 'female' : 'male',
      ['child', 'young', 'teen', 'adult', 'elder', 'elderly'].includes(entry.age_band) ? entry.age_band : 'adult',
      entry.language || 'en-gb',
    ]
  );
}

function buildLookupMap() {
  const map = new Map();
  for (const c of HP_CANONICAL_CAST) {
    const canonLower = c.canonicalName.toLowerCase();
    const canonKey = canonLower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    map.set(canonLower, c);
    map.set(canonKey, c);
    for (const a of c.aliases) {
      const aLower = a.toLowerCase();
      const aKey = aLower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      map.set(aLower, c);
      map.set(aKey, c);
    }
  }
  return map;
}

async function overrideHarryPotterVoices() {
  await connectPostgres();
  await ensureVoiceCatalog(pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const novelRes = await client.query('SELECT id, title FROM novels WHERE id = $1', [HP_NOVEL_ID]);
    if (novelRes.rows.length === 0) {
      throw new Error(`Harry Potter novel ${HP_NOVEL_ID} not found in database`);
    }

    // 1. Delete all bogus OCR / exclamation rows
    const delBogus = await client.query(
      `
      DELETE FROM characters
      WHERE novel_id = $1
        AND is_narrator = false
        AND canonical_name = ANY($2::varchar[]);
      `,
      [HP_NOVEL_ID, BOGUS_CHARACTER_NAMES]
    );

    // 2. Ensure Narrator uses British Narrator en-GB-RyanNeural
    await client.query(
      `
      UPDATE characters
      SET voice_id = 'en-GB-RyanNeural',
          gender = 'male',
          age_band = 'adult',
          updated_at = now()
      WHERE novel_id = $1 AND is_narrator = true;
      `,
      [HP_NOVEL_ID]
    );

    // 3. Upsert canonical rows, delete duplicate alias rows, and populate character_aliases
    let mergedDuplicates = 0;
    for (const entry of HP_CANONICAL_CAST) {
      await ensureVoiceRow(client, entry);

      const canonRes = await client.query(
        `
        INSERT INTO characters (novel_id, canonical_name, gender, age_band, temperament, voice_id, speed_multiplier, is_narrator, source)
        VALUES ($1, $2, $3, $4, 'balanced', $5, 1.0, false, 'manual')
        ON CONFLICT (novel_id, canonical_name) DO UPDATE SET
          gender = EXCLUDED.gender,
          age_band = EXCLUDED.age_band,
          voice_id = EXCLUDED.voice_id,
          source = 'manual',
          updated_at = now()
        RETURNING id;
        `,
        [HP_NOVEL_ID, entry.canonicalName, entry.gender, entry.age_band, entry.voice_id]
      );
      const canonicalId = canonRes.rows[0].id;

      for (const alias of entry.aliases) {
        const delDup = await client.query(
          `
          DELETE FROM characters
          WHERE novel_id = $1
            AND is_narrator = false
            AND LOWER(canonical_name) = LOWER($2)
            AND id <> $3;
          `,
          [HP_NOVEL_ID, alias, canonicalId]
        );
        mergedDuplicates += delDup.rowCount || 0;

        const existingAlias = await client.query(
          `
          SELECT ca.id
          FROM character_aliases ca
          JOIN characters c ON c.id = ca.character_id
          WHERE c.novel_id = $1 AND LOWER(ca.alias) = LOWER($2)
          LIMIT 1;
          `,
          [HP_NOVEL_ID, alias]
        );
        if (existingAlias.rows.length === 0) {
          await client.query(
            'INSERT INTO character_aliases (character_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [canonicalId, alias]
          );
        }
      }
    }

    // 4. Refresh stored chapter segments/manifests in HP chapters & chapter_documents
    const lookup = buildLookupMap();
    const remapSegment = (seg) => {
      if (!seg || typeof seg !== 'object') return seg;
      if (seg.type === 'image' || seg.speaker_id === 'image') return seg;
      if (seg.type === 'narration' || seg.speaker_id === 'narrator') {
        return { ...seg, voice_id: 'en-GB-RyanNeural', assigned_voice_id: 'en-GB-RyanNeural' };
      }
      const spName = String(seg.speaker_name || '').trim().toLowerCase();
      const spId = String(seg.speaker_id || '').trim().toLowerCase();
      const matched = lookup.get(spName) || lookup.get(spId);
      if (matched) {
        return {
          ...seg,
          speaker_name: matched.canonicalName,
          voice_id: matched.voice_id,
          assigned_voice_id: matched.voice_id,
        };
      }
      // Guard against accidental narrator leakage onto non-narrator segments
      if (seg.voice_id === 'en-GB-RyanNeural' || seg.assigned_voice_id === 'en-GB-RyanNeural') {
        return {
          ...seg,
          voice_id: 'en-GB-ThomasNeural',
          assigned_voice_id: 'en-GB-ThomasNeural',
        };
      }
      return seg;
    };

    const chDocsRes = await client.query(
      'SELECT pg_chapter_id, segments, manifest FROM chapter_documents WHERE novel_id = $1',
      [HP_NOVEL_ID]
    );
    let docsUpdated = 0;
    for (const row of chDocsRes.rows) {
      const newSegs = Array.isArray(row.segments) ? row.segments.map(remapSegment) : row.segments;
      const newManifest = row.manifest && typeof row.manifest === 'object'
        ? {
            ...row.manifest,
            segments: Array.isArray(row.manifest.segments) ? row.manifest.segments.map(remapSegment) : row.manifest.segments,
            timeline: Array.isArray(row.manifest.timeline) ? row.manifest.timeline.map(remapSegment) : row.manifest.timeline,
          }
        : row.manifest;
      await client.query(
        `
        UPDATE chapter_documents
        SET segments = $2::jsonb,
            manifest = $3::jsonb,
            updated_at = now()
        WHERE pg_chapter_id = $1;
        `,
        [row.pg_chapter_id, JSON.stringify(newSegs), JSON.stringify(newManifest)]
      );
      docsUpdated += 1;
    }

    await client.query('COMMIT');

    const finalRes = await pool.query(
      'SELECT canonical_name, gender, age_band, voice_id, is_narrator FROM characters WHERE novel_id = $1 ORDER BY is_narrator DESC, canonical_name ASC',
      [HP_NOVEL_ID]
    );
    console.log(JSON.stringify({
      bogusDeleted: delBogus.rowCount || 0,
      mergedDuplicates,
      chapterDocsUpdated: docsUpdated,
      finalCastCount: finalRes.rows.length,
      cast: finalRes.rows,
    }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[overrideHarryPotterVoices] Failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

overrideHarryPotterVoices();
