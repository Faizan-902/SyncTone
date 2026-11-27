'use strict';

/**
 * SyncTone — Full Unabridged Public Domain Classics Seeder (Project Gutenberg Mirrors)
 *
 * Fetches full public-domain texts for all 20 classics in PUBLIC_DOMAIN_CATALOG from
 * Project Gutenberg mirrors (mirror.csclub.uwaterloo.ca + aleph.pglaf.org fallback),
 * splits them into real unabridged chapters, parses narration & multi-voice dialogue segments
 * using textParser + voiceProfiler + curated novel cast maps, and upserts into Neon PostgreSQL
 * (`chapters` and `chapter_documents`).
 *
 * Usage:
 *   node seedFullPublicDomainGutenberg.js --dry-run   # Fetch & verify chapter split counts only
 *   node seedFullPublicDomainGutenberg.js             # Fetch, parse, and upsert into PostgreSQL
 */

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const { pool, connectPostgres } = require('../db');
const { PUBLIC_DOMAIN_CATALOG } = require('../data/publicDomainCatalog');
const { parseChapter } = require('../engine/textParser');
const {
  voiceProfiler,
  MALE_VOICE_POOL,
  FEMALE_VOICE_POOL,
} = require('../engine/voiceProfiler');
const { ensureVoiceCatalog } = require('./seedDemos');

const GUTENBERG_SPECS = {
  '9beedc1b-2c99-4b14-b03b-bd20f911159f': { pgId: 1661, mode: 'sherlock_stories', expectedMin: 12 },
  'a-study-in-scarlet': { pgId: 244, mode: 'study_in_scarlet', expectedMin: 14 },
  'pride-and-prejudice': { pgId: 1342, mode: 'chapter_roman_or_num', expectedMin: 61 },
  'alices-adventures-in-wonderland': { pgId: 11, mode: 'chapter_roman_dot_title', expectedMin: 12 },
  'frankenstein': { pgId: 84, mode: 'frankenstein', expectedMin: 28 },
  'dracula': { pgId: 345, mode: 'chapter_roman_upper', expectedMin: 27 },
  'jane-eyre': { pgId: 1260, mode: 'chapter_roman_upper', expectedMin: 38 },
  'moby-dick': { pgId: 2701, mode: 'moby_dick', expectedMin: 135 },
  'the-picture-of-dorian-gray': { pgId: 174, mode: 'dorian_gray', expectedMin: 20 },
  'the-count-of-monte-cristo': { pgId: 1184, mode: 'chapter_num_dot_title', expectedMin: 117 },
  'the-time-machine': { pgId: 35, mode: 'time_machine', expectedMin: 16 },
  'the-war-of-the-worlds': { pgId: 36, mode: 'war_of_worlds', expectedMin: 27 },
  'jekyll-and-hyde': { pgId: 43, mode: 'jekyll_hyde', expectedMin: 10 },
  'treasure-island': { pgId: 120, mode: 'treasure_island', expectedMin: 34 },
  'the-odyssey': { pgId: 1727, mode: 'book_roman', expectedMin: 24 },
  'the-metamorphosis': { pgId: 5200, mode: 'metamorphosis', expectedMin: 3 },
  'wuthering-heights': { pgId: 768, mode: 'chapter_roman_upper', expectedMin: 34 },
  'great-expectations': { pgId: 1400, mode: 'great_expectations', expectedMin: 59 },
  'a-tale-of-two-cities': { pgId: 98, mode: 'tale_two_cities', expectedMin: 45 },
  'the-call-of-the-wild': { pgId: 215, mode: 'call_of_wild', expectedMin: 7 },
};

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function pgSubpath(id) {
  const s = String(id);
  if (s.length <= 1) return `0/${s}`;
  return `${s.slice(0, -1).split('').join('/')}/${s}`;
}

async function fetchGutenbergText(pgId) {
  const sub = pgSubpath(pgId);
  const candidates = [
    `https://mirror.csclub.uwaterloo.ca/gutenberg/${sub}/${pgId}-0.txt`,
    `https://mirror.csclub.uwaterloo.ca/gutenberg/${sub}/${pgId}.txt`,
    `https://aleph.pglaf.org/${sub}/${pgId}-0.txt`,
    `https://aleph.pglaf.org/${sub}/${pgId}.txt`,
  ];

  let lastErr = null;
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      const text = await res.text();
      if (text && text.length > 5000) {
        return text;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Failed to fetch Project Gutenberg text ${pgId}`);
}

function stripGutenbergBoilerplate(raw) {
  const normalized = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const startMatch = normalized.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  const startIdx = startMatch ? normalized.indexOf('\n', startMatch.index) + 1 : 0;
  const endMatch = normalized.slice(startIdx).match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  const endIdx = endMatch ? startIdx + endMatch.index : normalized.length;
  return normalized.slice(startIdx, endIdx).trim();
}

function unwrapGutenbergParagraphs(bodyText) {
  const blocks = bodyText
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n\n+/)
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
  return blocks.join('\n\n');
}

function wordCount(str) {
  return String(str || '').trim().split(/\s+/).filter(Boolean).length;
}

const JEKYLL_TITLES = [
  'STORY OF THE DOOR',
  'SEARCH FOR MR. HYDE',
  'DR. JEKYLL WAS QUITE AT EASE',
  'THE CAREW MURDER CASE',
  'INCIDENT OF THE LETTER',
  'INCIDENT OF DR. LANYON',
  'INCIDENT AT THE WINDOW',
  'THE LAST NIGHT',
  "DR. LANYON'S NARRATIVE",
  'DR. LANYON’S NARRATIVE',
  "HENRY JEKYLL'S FULL STATEMENT OF THE CASE",
  'HENRY JEKYLL’S FULL STATEMENT OF THE CASE',
];

function splitIntoChapters(body, mode) {
  let effectiveBody = body;
  if (mode === 'moby_dick') {
    const ishmaelIdx = body.indexOf('Call me Ishmael');
    if (ishmaelIdx > 0) {
      const ch1Start = body.lastIndexOf('CHAPTER 1.', ishmaelIdx);
      if (ch1Start >= 0) effectiveBody = body.slice(ch1Start);
    }
  }
  const lines = effectiveBody.split('\n');
  const rawSections = [];

  let curTitle = null;
  let curLines = [];
  let seenChapter = false;

  const pushSection = () => {
    if (!curTitle) return;
    const rawBody = curLines.join('\n').trim();
    const cleaned = unwrapGutenbergParagraphs(rawBody);
    rawSections.push({ title: curTitle.trim(), rawBody: cleaned });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let matchedTitle = null;
    let skipLines = 0;

    if (mode === 'sherlock_stories') {
      const m = line.match(/^([IVXLC]+)\.\s+(.+?)\s*$/);
      if (m) matchedTitle = m[2].trim();
    } else if (mode === 'study_in_scarlet') {
      const m = trimmed.match(/^CHAPTER\s+([IVXLC]+)\.?$/i);
      if (m) {
        const nextLine = (lines[i + 1] || '').trim();
        const nextLine2 = (lines[i + 2] || '').trim();
        const subtitle = nextLine && nextLine.length < 70 && !/[a-z]{4,}/.test(nextLine)
          ? nextLine
          : (!nextLine && nextLine2 && nextLine2.length < 70 && !/[a-z]{4,}/.test(nextLine2) ? nextLine2 : '');
        const chPrefix = `Chapter ${m[1].toUpperCase()}`;
        if (subtitle) {
          skipLines = nextLine ? 1 : 2;
          const prettySub = subtitle
            .replace(/\.$/, '')
            .toLowerCase()
            .replace(/(^|[\s—-])([a-z])/g, (_, sep, chChar) => `${sep}${chChar.toUpperCase()}`);
          matchedTitle = `${chPrefix}: ${prettySub}`;
        } else {
          matchedTitle = chPrefix;
        }
      }
    } else if (mode === 'chapter_roman_or_num') {
      const m = trimmed.match(/^(?:CHAPTER|Chapter)\s+([IVXLCD]+|\d+)\.?\]?$/);
      if (m) matchedTitle = `Chapter ${m[1]}`;
    } else if (mode === 'chapter_roman_dot_title') {
      const m = trimmed.match(/^CHAPTER\s+([IVXLC]+)\.\s*(.*)$/);
      if (m) {
        let titlePart = (m[2] || '').trim();
        if (!titlePart) {
          const nextLine = (lines[i + 1] || '').trim();
          if (nextLine && nextLine.length < 80 && !/^CHAPTER\s+/i.test(nextLine)) {
            titlePart = nextLine;
            skipLines = 1;
          }
        }
        matchedTitle = titlePart || `Chapter ${m[1]}`;
      }
    } else if (mode === 'frankenstein') {
      const m = trimmed.match(/^(Letter\s+\d+|Chapter\s+\d+)\s*$/i);
      if (m) matchedTitle = m[1].trim();
    } else if (mode === 'chapter_roman_upper') {
      const m = trimmed.match(/^CHAPTER\s+([IVXLCD]+)(?:—.*)?\.?$/);
      if (m) matchedTitle = `Chapter ${m[1]}`;
    } else if (mode === 'moby_dick') {
      const chMatch = trimmed.match(/^CHAPTER\s+(\d+)\.\s*(.+)$/i);
      if (chMatch) {
        matchedTitle = chMatch[2].replace(/\.$/, '').trim();
      } else if (/^EPILOGUE\.?$/i.test(trimmed)) {
        const substantiveCount = rawSections.filter((s) => wordCount(s.rawBody) >= 80).length;
        if (substantiveCount >= 100) {
          matchedTitle = 'Epilogue';
        }
      }
    } else if (mode === 'dorian_gray') {
      if (trimmed === 'THE PREFACE') matchedTitle = 'The Preface';
      else {
        const m = trimmed.match(/^CHAPTER\s+([IVXLCD]+)\.?$/);
        if (m) matchedTitle = `Chapter ${m[1]}`;
      }
    } else if (mode === 'chapter_num_dot_title') {
      const m = trimmed.match(/^Chapter\s+\d+\.\s+(.+)$/);
      if (m) matchedTitle = m[1].trim();
    } else if (mode === 'time_machine') {
      if (/^[IVXLC]+\.$/.test(trimmed)) {
        const nextLine = (lines[i + 1] || '').trim();
        const nextLine2 = (lines[i + 2] || '').trim();
        const subtitle = nextLine || nextLine2;
        if (subtitle && subtitle.length < 60) {
          skipLines = nextLine ? 1 : 2;
          matchedTitle = subtitle;
        } else {
          matchedTitle = `Chapter ${trimmed.replace(/\.$/, '')}`;
        }
      } else if (/^Epilogue$/i.test(trimmed)) {
        matchedTitle = 'Epilogue';
      }
    } else if (mode === 'war_of_worlds') {
      if (/^[IVXLC]+\.$/.test(trimmed)) {
        const nextLine = (lines[i + 1] || '').trim();
        if (nextLine && nextLine.length < 90) {
          matchedTitle = nextLine.replace(/\.$/, '').trim();
          skipLines = 1;
        }
      }
    } else if (mode === 'jekyll_hyde') {
      if (JEKYLL_TITLES.includes(trimmed)) {
        matchedTitle = trimmed;
      }
    } else if (mode === 'treasure_island') {
      const prevBlank = i === 0 || !lines[i - 1].trim();
      const nextLine = (lines[i + 1] || '').trim();
      const nextNextBlank = !(lines[i + 2] || '').trim();
      if (prevBlank && /^[IVXLCD]+$/.test(trimmed) && nextLine && nextLine.length < 75 && nextNextBlank) {
        matchedTitle = nextLine;
        skipLines = 1;
      }
    } else if (mode === 'book_roman') {
      const m = trimmed.match(/^BOOK\s+([IVXLCD]+)$/);
      if (m) matchedTitle = `Book ${m[1]}`;
    } else if (mode === 'metamorphosis') {
      const prevBlank = i === 0 || !lines[i - 1].trim();
      const nextBlank = !(lines[i + 1] || '').trim();
      if (prevBlank && nextBlank && /^(?:I|II|III)$/.test(trimmed)) {
        matchedTitle = `Part ${trimmed}`;
      }
    } else if (mode === 'great_expectations') {
      const m = trimmed.match(/^Chapter\s+([IVXLCD]+)\.$/);
      if (m) matchedTitle = `Chapter ${m[1]}`;
    } else if (mode === 'tale_two_cities') {
      const m = trimmed.match(/^CHAPTER\s+([IVXLCD]+)\.\s*$/);
      if (m) {
        const nextLine = (lines[i + 1] || '').trim();
        if (nextLine && nextLine.length < 70) {
          matchedTitle = nextLine;
          skipLines = 1;
        } else {
          matchedTitle = `Chapter ${m[1]}`;
        }
      }
    } else if (mode === 'call_of_wild') {
      const m = trimmed.match(/^Chapter\s+[IVXLC]+\.\s+(.+)$/);
      if (m) matchedTitle = m[1].trim();
    }

    if (matchedTitle) {
      pushSection();
      curTitle = matchedTitle;
      curLines = [];
      i += skipLines;
    } else if (curTitle) {
      curLines.push(line);
    }
  }
  pushSection();

  // Filter out TOC entries and tiny structural artifacts (< 80 words)
  const substantive = rawSections.filter((s) => wordCount(s.rawBody) >= 80);

  // Format all-caps titles into crisp Title Case without uppercasing 'S after apostrophe
  return substantive.map((ch, idx) => {
    let title = ch.title.replace(/\s+/g, ' ').trim();
    if (title === title.toUpperCase() && /[A-Z]{3,}/.test(title)) {
      title = title
        .toLowerCase()
        .replace(/(^|[\s—-])([a-z])/g, (_, sep, chChar) => `${sep}${chChar.toUpperCase()}`);
    }
    return {
      chapter_number: idx + 1,
      title: title.slice(0, 180),
      raw_text: ch.rawBody,
    };
  });
}

function buildVoiceMap(novel) {
  const map = new Map();
  for (const c of novel.cast || []) {
    if (!c?.name || !c?.voice) continue;
    const canonLower = c.name.toLowerCase();
    const canonKey = canonLower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    map.set(canonLower, { name: c.name, voice: c.voice });
    map.set(canonKey, { name: c.name, voice: c.voice });
    for (const a of c.aliases || []) {
      const aLower = String(a).toLowerCase();
      const aKey = aLower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      map.set(aLower, { name: c.name, voice: c.voice });
      map.set(aKey, { name: c.name, voice: c.voice });
    }
  }
  return map;
}

function parseAndVoiceChapter(rawText, title, chapterId, novel, voiceMap) {
  const parsed = parseChapter(rawText, title, chapterId);
  const origSave = voiceProfiler.save;
  voiceProfiler.save = () => {};
  let voiced;
  try {
    voiced = voiceProfiler.applyVoicesToSegments(parsed.segments || []);
  } finally {
    voiceProfiler.save = origSave;
  }

  const narratorVoice = novel.narrator_voice || 'en-GB-RyanNeural';
  const narratorName = novel.narrator_name || 'Narrator';
  const dialogueFallbackPoolMale = MALE_VOICE_POOL.filter((v) => v !== narratorVoice && v !== 'en-GB-RyanNeural');
  const dialogueFallbackPoolFemale = FEMALE_VOICE_POOL.filter((v) => v !== narratorVoice && v !== 'en-GB-RyanNeural');

  let cursorMs = 0;
  const segments = voiced.map((seg, idx) => {
    const text = String(seg.text || '').trim();
    const words = wordCount(text);
    const durationMs = Math.max(900, Math.round((words / 2.75) * 1000));
    const start_ms = cursorMs;
    const end_ms = start_ms + durationMs;
    cursorMs = end_ms + 250;

    const isNarr = seg.type === 'narration' || seg.speaker_id === 'narrator';
    if (isNarr) {
      return {
        order: idx + 1,
        segment_id: idx + 1,
        type: 'narration',
        text,
        character_id: 'narrator',
        speaker_id: 'narrator',
        speaker_name: narratorName,
        voice_id: narratorVoice,
        assigned_voice_id: narratorVoice,
        start_ms,
        end_ms,
        confidence: 1.0,
        source: 'narrator_default',
      };
    }

    const spNameRaw = String(seg.speaker_name || 'Character').trim();
    const spKey = String(seg.speaker_id || '').toLowerCase();
    const castHit = voiceMap.get(spNameRaw.toLowerCase()) || voiceMap.get(spKey);

    let chosenVoice = castHit ? castHit.voice : (seg.assigned_voice_id || seg.voice_id || 'en-GB-ThomasNeural');
    if (chosenVoice === narratorVoice || chosenVoice === 'en-GB-RyanNeural') {
      const poolChoice = seg.speaker_gender === 'female' ? dialogueFallbackPoolFemale : dialogueFallbackPoolMale;
      chosenVoice = poolChoice[idx % poolChoice.length] || 'en-GB-ThomasNeural';
    }

    const speakerName = castHit ? castHit.name : spNameRaw;
    const speakerId = speakerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'character';

    return {
      order: idx + 1,
      segment_id: idx + 1,
      type: 'dialogue',
      text,
      character_id: speakerId,
      speaker_id: speakerId,
      speaker_name: speakerName,
      voice_id: chosenVoice,
      assigned_voice_id: chosenVoice,
      start_ms,
      end_ms,
      confidence: typeof seg.attribution_confidence === 'number' ? seg.attribution_confidence : 0.9,
      source: castHit ? 'manual' : (seg.attribution_source || 'heuristic'),
    };
  });

  const totalDurationMs = segments.length > 0 ? segments[segments.length - 1].end_ms : 0;
  const timeline = segments.map((s) => ({
    order: s.order,
    segment_id: s.segment_id,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    character_id: s.character_id,
    voice_id: s.voice_id,
    text: s.text,
    type: s.type,
  }));

  return {
    segments,
    totalDurationMs,
    manifest: {
      total_duration_ms: totalDurationMs,
      audio_url: `/api/stream/${chapterId}`,
      timeline,
    },
  };
}

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlyFilter = onlyArg ? onlyArg.slice('--only='.length).trim().toLowerCase() : null;
  if (!isDryRun) {
    await connectPostgres();
    await ensureVoiceCatalog(pool);
  }

  const summary = [];
  const targets = onlyFilter
    ? PUBLIC_DOMAIN_CATALOG.filter((n) => (n.slug || '').toLowerCase() === onlyFilter || n.id.toLowerCase() === onlyFilter)
    : PUBLIC_DOMAIN_CATALOG;

  for (const novel of targets) {
    const specKey = GUTENBERG_SPECS[novel.id] ? novel.id : novel.slug;
    const spec = GUTENBERG_SPECS[specKey];
    if (!spec) {
      throw new Error(`Missing Gutenberg spec for ${novel.title} (${novel.id} / ${novel.slug})`);
    }

    const rawGutenberg = await fetchGutenbergText(spec.pgId);
    const body = stripGutenbergBoilerplate(rawGutenberg);
    const chapters = splitIntoChapters(body, spec.mode);

    if (chapters.length < spec.expectedMin) {
      console.warn(
        `[WARN] ${novel.title} (PG #${spec.pgId}) extracted ${chapters.length} chapters (expected >= ${spec.expectedMin})`
      );
    }

    const voiceMap = buildVoiceMap(novel);
    const parsedChapters = chapters.map((ch) => {
      const chId = deterministicUuid(`synctone-pd-ch:${novel.id}:${ch.chapter_number}`);
      const built = parseAndVoiceChapter(ch.raw_text, ch.title, chId, novel, voiceMap);
      return {
        id: chId,
        novel_id: novel.id,
        chapter_number: ch.chapter_number,
        title: ch.title,
        raw_text: ch.raw_text,
        segments: built.segments,
        total_duration_ms: built.totalDurationMs,
        manifest: built.manifest,
      };
    });

    if (!isDryRun) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const CHUNK_SIZE = 20;
        for (let offset = 0; offset < parsedChapters.length; offset += CHUNK_SIZE) {
          const chunk = parsedChapters.slice(offset, offset + CHUNK_SIZE);
          const chRes = await client.query(
            `
            INSERT INTO chapters (id, novel_id, chapter_number, title, status, audio_version, total_duration_ms)
            SELECT u.id, u.novel_id, u.chapter_number, u.title, 'completed', 1, u.total_duration_ms
            FROM UNNEST(
              $1::uuid[],
              $2::uuid[],
              $3::int[],
              $4::varchar[],
              $5::int[]
            ) AS u(id, novel_id, chapter_number, title, total_duration_ms)
            ON CONFLICT (novel_id, chapter_number) DO UPDATE SET
              title = EXCLUDED.title,
              status = 'completed',
              total_duration_ms = EXCLUDED.total_duration_ms,
              updated_at = now()
            RETURNING id, chapter_number;
            `,
            [
              chunk.map((c) => c.id),
              chunk.map((c) => c.novel_id),
              chunk.map((c) => c.chapter_number),
              chunk.map((c) => c.title),
              chunk.map((c) => c.total_duration_ms),
            ]
          );

          const idByNum = new Map(chRes.rows.map((r) => [Number(r.chapter_number), r.id]));
          const docPgIds = [];
          const docNovelIds = [];
          const docNums = [];
          const docTitles = [];
          const docRawTexts = [];
          const docSegments = [];
          const docManifests = [];

          for (const ch of chunk) {
            const actualId = idByNum.get(ch.chapter_number) || ch.id;
            docPgIds.push(actualId);
            docNovelIds.push(novel.id);
            docNums.push(ch.chapter_number);
            docTitles.push(ch.title);
            docRawTexts.push(ch.raw_text);
            docSegments.push(JSON.stringify(ch.segments));
            docManifests.push(JSON.stringify({ ...ch.manifest, audio_url: `/api/stream/${actualId}` }));
          }

          await client.query(
            `
            INSERT INTO chapter_documents (pg_chapter_id, novel_id, chapter_number, title, raw_text, segments, manifest)
            SELECT u.pg_chapter_id, u.novel_id, u.chapter_number, u.title, u.raw_text, u.segments, u.manifest
            FROM UNNEST(
              $1::uuid[],
              $2::uuid[],
              $3::int[],
              $4::varchar[],
              $5::text[],
              $6::jsonb[],
              $7::jsonb[]
            ) AS u(pg_chapter_id, novel_id, chapter_number, title, raw_text, segments, manifest)
            ON CONFLICT (pg_chapter_id) DO UPDATE SET
              title = EXCLUDED.title,
              raw_text = EXCLUDED.raw_text,
              segments = EXCLUDED.segments,
              manifest = EXCLUDED.manifest,
              updated_at = now();
            `,
            [docPgIds, docNovelIds, docNums, docTitles, docRawTexts, docSegments, docManifests]
          );
        }

        // Remove any stale overflow chapters beyond parsedChapters.length
        await client.query(
          'DELETE FROM chapters WHERE novel_id = $1 AND chapter_number > $2',
          [novel.id, parsedChapters.length]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    const totalSegs = parsedChapters.reduce((acc, c) => acc + c.segments.length, 0);
    const item = {
      title: novel.title,
      pgId: spec.pgId,
      chapters: parsedChapters.length,
      totalSegments: totalSegs,
      sampleFirst: parsedChapters[0]?.title,
      sampleLast: parsedChapters[parsedChapters.length - 1]?.title,
    };
    summary.push(item);
    console.log(`[OK] ${item.title} (PG #${item.pgId}): ${item.chapters} chapters, ${item.totalSegments} segments (${item.sampleFirst} -> ${item.sampleLast})`);
  }

  console.log(`\nDONE (${isDryRun ? 'DRY RUN' : 'DB UPDATED'}): ${summary.length} books processed, ${summary.reduce((a, b) => a + b.chapters, 0)} total chapters.`);
  if (!isDryRun) {
    await pool.end();
  }
}

run().catch(async (err) => {
  console.error('[SeedFullPublicDomainGutenberg Error]:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
