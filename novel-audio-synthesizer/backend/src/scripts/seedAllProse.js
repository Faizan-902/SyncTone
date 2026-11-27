const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const { config } = require('../config');
const { ensureVoiceCatalog, ensureChapterAudio } = require('./seedDemos');
const { NOVELS } = require('./seed15RealNovels');

async function seedAllProse({ closeConnections = false, maxSynthesizeCount = 100 } = {}) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ...(config.pgSsl ? { ssl: { rejectUnauthorized: Boolean(config.pgSslRejectUnauthorized) } } : {}),
  });
  await mongoose.connect(config.mongoUri);
  await ensureVoiceCatalog(pool);
  console.log('Connected to PG and MongoDB');

  const ChapterCol = mongoose.connection.collection('chapters');

  // 1. Fetch all chapters from PG
  const chRes = await pool.query(`
    SELECT c.id, c.novel_id, c.chapter_number, c.title, c.swift_audio_object, n.title as novel_title, n.synopsis
    FROM chapters c
    JOIN novels n ON c.novel_id = n.id
    ORDER BY n.title, c.chapter_number
  `);

  console.log(`Found ${chRes.rows.length} chapters to ensure prose for.`);

  // Prose data map (using active, non-legacy voice IDs)
  const proseMap = {
    "Harry Potter and the Philosopher's Stone": {
      2: {
        title: 'The Vanishing Glass',
        segments: [
          { order: 1, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 0, end: 5500, text: 'Nearly ten years had passed since the Dursleys had woken up to find their nephew on the front step, but Privet Drive had hardly changed at all.' },
          { order: 2, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 5800, end: 11000, text: 'Only the photographs on the mantelpiece showed how much time had passed. Ten years ago, there were lots of pictures of what looked like a large pink beach ball.' },
          { order: 3, type: 'dialogue', speaker: 'Aunt Petunia', voice: 'en-GB-SoniaNeural', start: 11300, end: 14200, text: 'Up! Get up! Now!' },
          { order: 4, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 14500, end: 19800, text: 'Harry heard her walking toward the kitchen and then the sound of the frying pan being put on the stove. He rolled onto his back and tried to remember the dream he had been having.' },
          { order: 5, type: 'dialogue', speaker: 'Aunt Petunia', voice: 'en-GB-SoniaNeural', start: 20100, end: 23900, text: 'Are you up yet? Mind the bacon, and do not dare let it burn!' },
          { order: 6, type: 'dialogue', speaker: 'Harry Potter', voice: 'en-GB-ThomasNeural', start: 24200, end: 26500, text: 'Yes, Aunt Petunia.' },
          { order: 7, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 26800, end: 33000, text: 'Harry dressed and went down the hall into the kitchen. The table was almost hidden beneath all Dudley’s birthday presents. It looked as though Dudley had gotten everything he wanted.' },
        ],
      },
      3: {
        title: 'The Letters from No One',
        segments: [
          { order: 1, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 0, end: 6000, text: 'The escape of the Brazilian boa constrictor earned Harry his longest-ever punishment. By the time he was allowed out of his cupboard again, the summer holidays had started.' },
          { order: 2, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 6300, end: 12500, text: 'One morning in July, Uncle Vernon’s mail arrived with a sharp click through the letter slot and a flop on the doormat.' },
          { order: 3, type: 'dialogue', speaker: 'Uncle Vernon', voice: 'en-IE-ConnorNeural', start: 12800, end: 15400, text: 'Get the mail, Dudley.' },
          { order: 4, type: 'dialogue', speaker: 'Dudley Dursley', voice: 'en-NZ-MitchellNeural', start: 15700, end: 17800, text: 'Make Harry get it.' },
          { order: 5, type: 'dialogue', speaker: 'Uncle Vernon', voice: 'en-IE-ConnorNeural', start: 18100, end: 20200, text: 'Poke him with your Smeltings stick, Dudley.' },
          { order: 6, type: 'narration', speaker: 'British Narrator', voice: 'en-GB-RyanNeural', start: 20500, end: 28000, text: 'Harry picked up the letters. There was a postcard from Marge, a brown envelope that looked like a bill, and—a letter for Harry. Harry stared at it, his heart twanging like a giant elastic band.' },
        ],
      },
    },
    "The Adventures of Sherlock Holmes": {
      1: {
        title: 'A Scandal in Bohemia - Part I',
        segments: [
          { order: 1, type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', start: 0, end: 5500, text: 'To Sherlock Holmes she is always THE woman. I have seldom heard him mention her under any other name.' },
          { order: 2, type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', start: 5800, end: 11800, text: 'One night, a visitor of formidable stature strode into our Baker Street rooms, wearing a black vizard mask over his eyes.' },
          { order: 3, type: 'dialogue', speaker: 'King of Bohemia', voice: 'am_michael', start: 12100, end: 17100, text: 'You had my note? Did it tell you that I would call? I am Count von Kramm, a Bohemian nobleman.' },
          { order: 4, type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', start: 17400, end: 22600, text: 'Pray take a seat, Your Majesty. This heavy Bohemian paper could hardly disguise your royal crest.' },
          { order: 5, type: 'dialogue', speaker: 'King of Bohemia', voice: 'am_michael', start: 22900, end: 28700, text: 'You must see that it is of the utmost importance to European politics. The compromising photograph must be recovered!' },
          { order: 6, type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', start: 29000, end: 33800, text: 'It is a capital mistake to theorize before one has data. We must investigate Miss Irene Adler at once.' },
        ],
      },
      2: {
        title: 'A Scandal in Bohemia - Part II',
        segments: [
          { order: 1, type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', start: 0, end: 6000, text: 'I had called upon my friend, Mr. Sherlock Holmes, one day in the autumn of last year and found him in deep conversation with a very stout, florid-faced, elderly gentleman with fiery red hair.' },
          { order: 2, type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', start: 6300, end: 11500, text: 'You could not have come at a better time, my dear Watson. Mr. Jabez Wilson here has been telling us a singular story.' },
          { order: 3, type: 'dialogue', speaker: 'Jabez Wilson', voice: 'am_michael', start: 11800, end: 17000, text: 'All red-headed men who are sound in body and mind and above the age of twenty-one years are eligible for four pounds a week for nominal services.' },
          { order: 4, type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', start: 17300, end: 23000, text: 'Holmes rubbed his hands and his eyes glistened. He leaned forward in his chair with that sharp concentration that always seized him when a strange puzzle presented itself.' },
          { order: 5, type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', start: 23300, end: 27500, text: 'It is quite a three-pipe problem, Watson, and I beg that you won’t speak to me for fifty minutes.' },
        ],
      },
    },
    "The Great Gatsby": {
      1: {
        title: 'Chapter 1: In My Younger and More Vulnerable Years',
        segments: [
          { order: 1, type: 'narration', speaker: 'Nick Carraway', voice: 'am_michael', start: 0, end: 7000, text: 'In my younger and more vulnerable years my father gave me some advice that I have been turning over in my mind ever since.' },
          { order: 2, type: 'dialogue', speaker: "Nick's Father", voice: 'en-US-RogerNeural', start: 7300, end: 14500, text: 'Whenever you feel like criticizing anyone, just remember that all the people in this world haven’t had the advantages that you’ve had.' },
          { order: 3, type: 'narration', speaker: 'Nick Carraway', voice: 'am_michael', start: 14800, end: 22000, text: 'He didn’t say any more, but we’ve always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that.' },
          { order: 4, type: 'narration', speaker: 'Nick Carraway', voice: 'am_michael', start: 22300, end: 30000, text: 'When I came back from the East last autumn I felt that I wanted the world to be in uniform and at a sort of moral attention forever. Only Gatsby was exempt from my reaction.' },
          { order: 5, type: 'dialogue', speaker: 'Daisy Buchanan', voice: 'af_heart', start: 30300, end: 34500, text: "I'm p-paralyzed with happiness!" },
        ],
      },
    },
  };

  // Merge Chapter 1 presets from seed15RealNovels for any novel not already in proseMap
  const FALLBACK_DIALOGUE_VOICES = ['en-GB-ThomasNeural', 'en-GB-LibbyNeural', 'en-NZ-MitchellNeural', 'en-GB-SoniaNeural'];
  for (const novelItem of NOVELS) {
    if (!proseMap[novelItem.title]) {
      proseMap[novelItem.title] = {};
    }
    if (!proseMap[novelItem.title][1] && Array.isArray(novelItem.chapter_text)) {
      let ms = 0;
      let dIdx = 0;
      const speakerVoiceMap = new Map();
      const candidateDialogueVoices = FALLBACK_DIALOGUE_VOICES.filter((v) => v !== novelItem.narrator_voice);
      proseMap[novelItem.title][1] = {
        title: novelItem.chapter_title,
        segments: novelItem.chapter_text.map((t, idx) => {
          const dur = Math.max(4000, t.text.length * 65);
          const start = ms;
          const end = ms + dur;
          ms = end + 500;
          const isNarratorSpeaker = t.type === 'narration' || t.speaker === novelItem.narrator_name || t.speaker === 'Narrator';
          let voice = t.voice_id;
          if (!voice) {
            if (isNarratorSpeaker) {
              voice = novelItem.narrator_voice;
            } else {
              if (!speakerVoiceMap.has(t.speaker)) {
                speakerVoiceMap.set(t.speaker, candidateDialogueVoices[dIdx++ % candidateDialogueVoices.length]);
              }
              voice = speakerVoiceMap.get(t.speaker);
            }
          }
          return {
            order: idx + 1,
            type: t.type,
            speaker: t.speaker,
            voice,
            start,
            end,
            text: t.text,
          };
        }),
      };
    }
  }

  for (const ch of chRes.rows) {
    const existing = await ChapterCol.findOne({ pg_chapter_id: ch.id });
    const mp3OnDisk = path.join(config.paths.outputDir, `${ch.id}.mp3`);
    const wavOnDisk = path.join(config.paths.outputDir, `${ch.id}.wav`);
    const hasRealDiskAudio =
      (fs.existsSync(mp3OnDisk) && fs.statSync(mp3OnDisk).size > 45000) ||
      (fs.existsSync(wavOnDisk) && fs.statSync(wavOnDisk).size > 45000);

    if (existing && Array.isArray(existing.segments) && existing.segments.length > 0) {
      if (!ch.swift_audio_object || !hasRealDiskAudio) {
        const stitched = await ensureChapterAudio(ch.id, existing.segments, { maxSynthesizeCount });
        const totalDuration = stitched?.total_duration_ms || existing.total_duration_ms || existing.segments[existing.segments.length - 1].end_ms || 0;
        const audioFormat = stitched?.audio_format || 'mp3';
        if (stitched?.timeline && stitched.timeline.length > 0) {
          await ChapterCol.updateOne(
            { pg_chapter_id: ch.id },
            {
              $set: {
                'manifest.total_duration_ms': totalDuration,
                'manifest.audio_url': `/api/stream/${ch.id}`,
                'manifest.timeline': stitched.timeline,
              },
            }
          );
        }
        await pool.query(
          'UPDATE chapters SET total_duration_ms = $1, status = $2, swift_audio_object = $3 WHERE id = $4',
          [totalDuration, 'completed', `${ch.id}.${audioFormat}`, ch.id]
        );
        console.log(`✔ Synthesized real studio audio for Chapter ${ch.id} (${ch.novel_title} - ${ch.title}): ${ch.id}.${audioFormat} (${totalDuration}ms)`);
      } else {
        console.log(`✔ Chapter ${ch.id} (${ch.novel_title} - ${ch.title}) already has ${existing.segments.length} segments & audio.`);
      }
      continue;
    }

    const novelProse = proseMap[ch.novel_title];
    const chData = novelProse ? novelProse[ch.chapter_number] : null;

    let rawSegments = chData ? chData.segments : null;
    if (!rawSegments && ch.synopsis) {
      rawSegments = [
        {
          order: 1,
          type: 'narration',
          speaker: 'Narrator',
          voice: 'en-GB-RyanNeural',
          start: 0,
          end: Math.max(4000, ch.synopsis.length * 65),
          text: ch.synopsis,
        },
      ];
    }

    if (rawSegments && rawSegments.length > 0) {
      const segs = rawSegments.map((s) => {
        const charKey = s.type === 'narration' ? 'narrator' : String(s.speaker || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return {
          order: s.order,
          segment_id: s.order,
          type: s.type,
          speaker_id: charKey,
          character_id: charKey,
          speaker_name: s.speaker,
          voice_id: s.voice,
          assigned_voice_id: s.voice,
          text: s.text,
          start_ms: s.start,
          end_ms: s.end,
          confidence: 1.0,
          source: s.type === 'narration' ? 'narrator_default' : 'manual',
          needs_review: false,
        };
      });

      const stitched = await ensureChapterAudio(ch.id, segs, { maxSynthesizeCount });
      const totalDuration = stitched?.total_duration_ms || segs[segs.length - 1].end_ms;
      const audioFormat = stitched?.audio_format || 'mp3';
      const rawText = segs.map((s) => s.text).join('\n\n');

      const manifest = {
        total_duration_ms: totalDuration,
        audio_url: `/api/stream/${ch.id}`,
        timeline: (stitched?.timeline && stitched.timeline.length > 0)
          ? stitched.timeline
          : segs.map((s) => ({
              order: s.order,
              segment_id: s.segment_id,
              start_ms: s.start_ms,
              end_ms: s.end_ms,
              character_id: s.character_id,
              voice_id: s.voice_id,
              text: s.text,
              type: s.type,
            })),
      };

      await ChapterCol.updateOne(
        { pg_chapter_id: ch.id },
        {
          $set: {
            pg_chapter_id: ch.id,
            novel_id: ch.novel_id,
            chapter_number: ch.chapter_number,
            title: ch.title,
            raw_text: rawText,
            audio_version: 1,
            manifest,
            segments: segs,
          },
        },
        { upsert: true }
      );

      // Update total duration and verified audio object in PostgreSQL
      await pool.query(
        'UPDATE chapters SET total_duration_ms = $1, status = $2, swift_audio_object = $3 WHERE id = $4',
        [totalDuration, 'completed', `${ch.id}.${audioFormat}`, ch.id]
      );

      console.log(`✔ Seeded ${segs.length} segments for Chapter ${ch.id} (${ch.novel_title} - ${ch.title})`);
    } else {
      console.warn(`No preset prose found for ${ch.novel_title} Ch ${ch.chapter_number}`);
    }
  }

  if (closeConnections) {
    await pool.end();
    await mongoose.disconnect();
  } else {
    await pool.end();
  }
  console.log('Finished seeding all chapter prose!');
}

module.exports = { seedAllProse };

if (require.main === module) {
  seedAllProse({ closeConnections: true }).catch((e) => {
    console.error('Error in seedAllProse:', e);
    process.exit(1);
  });
}

