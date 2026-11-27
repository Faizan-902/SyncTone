'use strict';

const crypto = require('crypto');

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

function buildSegmentsFromLines(lines = [], defaultNarratorVoice = 'en-GB-RyanNeural') {
  let cursorMs = 0;
  const segments = lines.map((line, idx) => {
    const text = String(line.text || '').trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1200, Math.round((words / 2.7) * 1000));
    const start_ms = cursorMs;
    const end_ms = start_ms + durationMs;
    cursorMs = end_ms + 250;

    const isNarr = line.type !== 'dialogue';
    const speakerName = isNarr ? (line.speaker || 'Narrator') : (line.speaker || 'Character');
    const speakerId = isNarr
      ? 'narrator'
      : speakerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const voiceId = line.voice || (isNarr ? defaultNarratorVoice : 'en-GB-ThomasNeural');

    return {
      order: idx + 1,
      segment_id: idx + 1,
      type: isNarr ? 'narration' : 'dialogue',
      text,
      character_id: speakerId,
      speaker_id: speakerId,
      speaker_name: speakerName,
      speaker_gender: line.gender || 'unknown',
      voice_id: voiceId,
      assigned_voice_id: voiceId,
      start_ms,
      end_ms,
      confidence: 1.0,
      source: isNarr ? 'narrator_default' : 'manual',
    };
  });

  const totalDurationMs = segments.length ? segments[segments.length - 1].end_ms : 0;
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

  return { segments, timeline, totalDurationMs };
}

const RAW_PUBLIC_DOMAIN_NOVELS = [
  {
    id: '9beedc1b-2c99-4b14-b03b-bd20f911159f',
    preserveExistingChapters: false,
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    year: 1892,
    global_tone: 'Victorian Mystery',
    cover_object: '/static/covers/adventures-of-sherlock-holmes-cover.webp',
    synopsis:
      'Consulting detective Sherlock Holmes and Dr. John Watson investigate twelve intricate cases across Victorian London, beginning with a royal blackmail plot involving the brilliant Irene Adler.',
    narrator_name: 'Dr. John Watson',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', age_band: 'adult', aliases: ['Holmes', 'Mr. Holmes'] },
      { name: 'King of Bohemia', voice: 'am_michael', gender: 'male', age_band: 'adult', aliases: ['Count von Kramm', 'Your Majesty'] },
      { name: 'Irene Adler', voice: 'bf_emma', gender: 'female', age_band: 'adult', aliases: ['Miss Adler', 'Irene'] },
      { name: 'Jabez Wilson', voice: 'am_george', gender: 'male', age_band: 'elder', aliases: ['Mr. Wilson'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'A Scandal in Bohemia',
        lines: [
          { type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'To Sherlock Holmes she always remained the woman of sharpest intellect in Europe. When a masked nobleman swept into Baker Street through the autumn fog, even Holmes leaned forward beside the fire.' },
          { type: 'dialogue', speaker: 'King of Bohemia', voice: 'am_michael', gender: 'male', text: 'Did my note warn you that I would arrive incognito? Address me as Count von Kramm, though the fate of an entire kingdom hangs upon a single photograph.' },
          { type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', text: 'Pray take a chair, Your Majesty. Your Bohemian stationery and carriage horses spoke plainly before you lifted your mask.' },
          { type: 'dialogue', speaker: 'Irene Adler', voice: 'bf_emma', gender: 'female', text: 'Good evening, Mister Sherlock Holmes. You may assure your royal client that the photograph remains safe solely as my shield.' },
          { type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'Before dawn, Irene Adler vanished from London with her prize, leaving Holmes with a photograph and lasting admiration.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Red-Headed League',
        lines: [
          { type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'On an October afternoon I discovered Holmes in deep conversation with Jabez Wilson, a stout pawnbroker with hair of fiery crimson.' },
          { type: 'dialogue', speaker: 'Jabez Wilson', voice: 'am_george', gender: 'male', text: 'Four pounds a week merely to copy out the Encyclopaedia Britannica from ten until two, Mister Holmes! Then this morning the office door bore a card saying the League is dissolved.' },
          { type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', text: 'A singular narrative, Mister Wilson. Tell me about your assistant who offered to work for half wages—why did he take such interest in your cellar?' },
          { type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'Holmes tapped his walking stick sharply upon the pavement outside the pawnshop, listening for the hollow echo of a tunnel beneath the city bank.' },
        ],
      },
    ],
  },
  {
    slug: 'a-study-in-scarlet',
    title: 'A Study in Scarlet',
    author: 'Arthur Conan Doyle',
    year: 1887,
    global_tone: 'Victorian Mystery',
    cover_object: '/static/covers/a-study-in-scarlet-cover.webp',
    synopsis:
      'Dr. John Watson returns from Afghanistan and takes lodgings at 221B Baker Street with an eccentric chemical investigator named Sherlock Holmes, just as a cryptic crime stuns Scotland Yard.',
    narrator_name: 'Dr. John Watson',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', age_band: 'adult', aliases: ['Holmes'] },
      { name: 'Inspector Lestrade', voice: 'en-US-RogerNeural', gender: 'male', age_band: 'adult', aliases: ['Lestrade'] },
      { name: 'Tobias Gregson', voice: 'en-CA-LiamNeural', gender: 'male', age_band: 'adult', aliases: ['Gregson'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Mr. Sherlock Holmes',
        lines: [
          { type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'Invalided home from the Afghan campaign, I sought affordable rooms in London and was led into the laboratory of St. Bartholomew Hospital.' },
          { type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', text: 'I have found it! I have found a reagent which is precipitated by haemoglobin and nothing else. You have been in Afghanistan, I perceive.' },
          { type: 'dialogue', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'How on earth could you know that? Nobody in London has heard me speak a single word of my service.' },
          { type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', text: 'Here is a gentleman of a medical type with the air of a military man and a darkened wrist beneath a pale brow. Shall we inspect rooms in Baker Street?' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Lauriston Garden Mystery',
        lines: [
          { type: 'narration', speaker: 'Dr. John Watson', voice: 'bm_george', gender: 'male', text: 'A morning dispatch from Tobias Gregson summoned us to an empty house on Brixton Road, where detectives paced helplessly around a locked parlor.' },
          { type: 'dialogue', speaker: 'Inspector Lestrade', voice: 'en-US-RogerNeural', gender: 'male', text: 'Look at the red lettering scratched high on the plaster wall, Holmes. No wound, no robbery, only a German word waiting for our magnifying glasses.' },
          { type: 'dialogue', speaker: 'Sherlock Holmes', voice: 'bm_daniel', gender: 'male', text: 'Murder by poison, Lestrade, committed by a tall man smoking a Trichinopoly cigar who wore square-toed boots. Come, Watson, the trail is still warm.' },
        ],
      },
    ],
  },
  {
    slug: 'pride-and-prejudice',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    year: 1813,
    global_tone: 'Regency Romance',
    cover_object: '/static/covers/pride-and-prejudice-cover.webp',
    synopsis:
      'In Georgian Hertfordshire, spirited Elizabeth Bennet spars with proud Fitzwilliam Darcy while navigating family upheaval, courtship, and society expectations.',
    narrator_name: 'Regency Narrator',
    narrator_voice: 'en-GB-RyanNeural',
    cast: [
      { name: 'Elizabeth Bennet', voice: 'en-GB-SoniaNeural', gender: 'female', age_band: 'young', aliases: ['Lizzy', 'Elizabeth'] },
      { name: 'Mrs. Bennet', voice: 'en-GB-LibbyNeural', gender: 'female', age_band: 'adult' },
      { name: 'Mr. Bennet', voice: 'en-IE-ConnorNeural', gender: 'male', age_band: 'elder' },
      { name: 'Mr. Darcy', voice: 'en-CA-LiamNeural', gender: 'male', age_band: 'adult', aliases: ['Fitzwilliam Darcy', 'Darcy'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Netherfield Park Is Let at Last',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Across the parlor of Longbourn, rumors of a wealthy young bachelor arriving in Hertfordshire stirred immediate excitement.' },
          { type: 'dialogue', speaker: 'Mrs. Bennet', voice: 'en-GB-LibbyNeural', gender: 'female', text: 'My dear Mister Bennet, have you heard that Netherfield Park is let at last? A single man of large fortune, five thousand a year! What a fine thing for our girls!' },
          { type: 'dialogue', speaker: 'Mr. Bennet', voice: 'en-IE-ConnorNeural', gender: 'male', text: 'I see no occasion for us to visit him, my dear. You and the girls may go alone—or send him a few lines to declare my hearty consent.' },
          { type: 'dialogue', speaker: 'Elizabeth Bennet', voice: 'en-GB-SoniaNeural', gender: 'female', text: 'Father teases only to keep the household lively, Mother, though half the county will be at the assembly ball to meet Mister Bingley.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Meryton Assembly',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Candlelight glittered over the Meryton assembly hall as the gentlemen from Netherfield entered the room.' },
          { type: 'dialogue', speaker: 'Mr. Darcy', voice: 'en-CA-LiamNeural', gender: 'male', text: 'She is tolerable, I suppose, but not handsome enough to tempt me; I am in no humor to give consequence to young ladies slighted by other men.' },
          { type: 'dialogue', speaker: 'Elizabeth Bennet', voice: 'en-GB-SoniaNeural', gender: 'female', text: 'I could easily forgive his pride, if he had not mortified mine! Let Mister Darcy keep his distance while I enjoy the dance.' },
        ],
      },
    ],
  },
  {
    slug: 'alices-adventures-in-wonderland',
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    year: 1865,
    global_tone: 'Literary Fantasy',
    cover_object: '/static/covers/alices-adventures-in-wonderland-cover.webp',
    synopsis:
      'Young Alice tumbles down a rabbit hole into a topsy-turvy realm of talking animals, tea parties frozen in time, and the quick-tempered Queen of Hearts.',
    narrator_name: 'Storyteller',
    narrator_voice: 'en-GB-RyanNeural',
    cast: [
      { name: 'Alice', voice: 'en-GB-MaisieNeural', gender: 'female', age_band: 'child' },
      { name: 'White Rabbit', voice: 'en-NZ-MitchellNeural', gender: 'male', age_band: 'adult' },
      { name: 'Mad Hatter', voice: 'am_puck', gender: 'male', age_band: 'adult', aliases: ['Hatter'] },
      { name: 'Queen of Hearts', voice: 'en-AU-NatashaNeural', gender: 'female', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Down the Rabbit-Hole',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Sitting beside her sister on a sleepy riverbank, Alice blinked in astonishment as a white rabbit with pink eyes raced past, checking a pocket watch.' },
          { type: 'dialogue', speaker: 'White Rabbit', voice: 'en-NZ-MitchellNeural', gender: 'male', text: 'Oh dear! Oh dear! I shall be too late for the Duchess and her gloves!' },
          { type: 'dialogue', speaker: 'Alice', voice: 'en-GB-MaisieNeural', gender: 'female', text: 'How curious! After such a long tumble down this well, falling downstairs at home will seem quite ordinary.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'A Mad Tea-Party',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Under the shade of a broad tree stood a long table set for tea, crowded with cups even though only three seats were taken.' },
          { type: 'dialogue', speaker: 'Mad Hatter', voice: 'am_puck', gender: 'male', text: 'Your hair wants cutting! Now tell me, why is a raven like a writing desk? We have been stuck at six o clock since March.' },
          { type: 'dialogue', speaker: 'Alice', voice: 'en-GB-MaisieNeural', gender: 'female', text: 'I believe I can guess that riddle—no, wait, asking riddles with no answers is an extraordinary waste of time!' },
          { type: 'dialogue', speaker: 'Queen of Hearts', voice: 'en-AU-NatashaNeural', gender: 'female', text: 'Silence in the rose garden! Whoever painted these white blooms red shall answer to the court immediately!' },
        ],
      },
    ],
  },
  {
    slug: 'frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    year: 1818,
    global_tone: 'Gothic Science Fiction',
    cover_object: '/static/covers/frankenstein-mary-shelley-cover.webp',
    synopsis:
      'Obsessed with unlocking the secret of life, scientist Victor Frankenstein assembles a sentient being in secret, triggering a tragic pursuit from Geneva to the Arctic ice.',
    narrator_name: 'Robert Walton',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Victor Frankenstein', voice: 'en-US-ChristopherNeural', gender: 'male', age_band: 'adult', aliases: ['Victor', 'Frankenstein'] },
      { name: 'The Creature', voice: 'en-US-SteffanNeural', gender: 'male', age_band: 'adult', aliases: ['Creature'] },
      { name: 'Elizabeth Lavenza', voice: 'bf_alice', gender: 'female', age_band: 'young' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Letters from the Arctic Ice',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Locked within fields of drifting Arctic ice, Captain Walton rescued a gaunt stranger from a sled and listened by lantern light to his confession.' },
          { type: 'dialogue', speaker: 'Victor Frankenstein', voice: 'en-US-ChristopherNeural', gender: 'male', text: 'You seek for knowledge and wisdom, Walton, as I once did. Pray hear my story before ambition fastens its serpent upon your own heart.' },
          { type: 'dialogue', speaker: 'Elizabeth Lavenza', voice: 'bf_alice', gender: 'female', text: 'Return home to Geneva, Victor; winter storms gather over the lake and our house waits anxiously for word of your health.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'Confrontation on the Glacier',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'High amid the frozen ridges of Montanvert, a towering silhouette crossed the mist toward Victor with swift, superhuman grace.' },
          { type: 'dialogue', speaker: 'The Creature', voice: 'en-US-SteffanNeural', gender: 'male', text: 'I expected this reception. All men hate the wretched, yet you, my creator, owe me a hearing before you raise your hand against me.' },
          { type: 'dialogue', speaker: 'Victor Frankenstein', voice: 'en-US-ChristopherNeural', gender: 'male', text: 'Speak, then, and prove why the author of my misery should not perish upon this ice.' },
        ],
      },
    ],
  },
  {
    slug: 'dracula',
    title: 'Dracula',
    author: 'Bram Stoker',
    year: 1897,
    global_tone: 'Gothic Horror',
    cover_object: '/static/covers/dracula-bram-stoker-cover.webp',
    synopsis:
      'Solicitor Jonathan Harker travels to Count Dracula castle in the Carpathians, sparking a desperate struggle led by Mina Harker and Professor Van Helsing to save London.',
    narrator_name: 'Chronicle Narrator',
    narrator_voice: 'en-GB-RyanNeural',
    cast: [
      { name: 'Jonathan Harker', voice: 'en-GB-ThomasNeural', gender: 'male', age_band: 'young' },
      { name: 'Count Dracula', voice: 'en-US-RogerNeural', gender: 'male', age_band: 'elder', aliases: ['Dracula', 'Count'] },
      { name: 'Mina Harker', voice: 'en-GB-LibbyNeural', gender: 'female', age_band: 'young', aliases: ['Mina'] },
      { name: 'Abraham Van Helsing', voice: 'en-IE-ConnorNeural', gender: 'male', age_band: 'elder', aliases: ['Van Helsing', 'Professor Van Helsing'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Jonathan Harker Journal',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'At midnight in the Borgo Pass, wolves howled around the dark carriage that carried Jonathan Harker toward Castle Dracula.' },
          { type: 'dialogue', speaker: 'Count Dracula', voice: 'en-US-RogerNeural', gender: 'male', text: 'Welcome to my house! Enter freely, go safely, and leave something of the happiness you bring. Come, supper awaits.' },
          { type: 'dialogue', speaker: 'Jonathan Harker', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'Why are there no mirrors in these chambers, Count, and why did my shaving glass cast no shadow behind my shoulder?' },
        ],
      },
      {
        chapter_number: 2,
        title: 'Van Helsing and the Hunt',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Back in London, telegrams and wax-cylinder diaries brought Doctor Van Helsing and Mina Harker together before dawn.' },
          { type: 'dialogue', speaker: 'Abraham Van Helsing', voice: 'en-IE-ConnorNeural', gender: 'male', text: 'We are dealing with an enemy old as centuries, my friends. Fear nothing, keep the garlic blossoms fast at every window, and track his crates of earth.' },
          { type: 'dialogue', speaker: 'Mina Harker', voice: 'en-GB-LibbyNeural', gender: 'female', text: 'Every shipping ledger and train timetable is typed cleanly, Professor. Before sunset we will corner him on the road to Transylvania.' },
        ],
      },
    ],
  },
  {
    slug: 'jane-eyre',
    title: 'Jane Eyre',
    author: 'Charlotte Bronte',
    year: 1847,
    global_tone: 'Victorian Gothic Romance',
    cover_object: '/static/covers/jane-eyre-cover.webp',
    synopsis:
      'Orphaned Jane Eyre grows from Lowood School into an independent governess at Thornfield Hall, where brooding Edward Rochester guards an explosive secret.',
    narrator_name: 'Jane Eyre',
    narrator_voice: 'bf_emma',
    cast: [
      { name: 'Jane Eyre', voice: 'bf_emma', gender: 'female', age_band: 'young' },
      { name: 'Edward Rochester', voice: 'en-US-AndrewNeural', gender: 'male', age_band: 'adult', aliases: ['Mr. Rochester', 'Rochester'] },
      { name: 'Mrs. Fairfax', voice: 'en-GB-SoniaNeural', gender: 'female', age_band: 'elder' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Thornfield Hall',
        lines: [
          { type: 'narration', speaker: 'Jane Eyre', voice: 'bf_emma', gender: 'female', text: 'Walks along the silent battlements of Thornfield offered peace, yet strange laughter sometimes echoed from the locked third-story corridor.' },
          { type: 'dialogue', speaker: 'Mrs. Fairfax', voice: 'en-GB-SoniaNeural', gender: 'female', text: 'Do not alarm yourself, Miss Eyre. Master Rochester travels far and wide, though his return always wakes the whole manor.' },
          { type: 'dialogue', speaker: 'Edward Rochester', voice: 'en-US-AndrewNeural', gender: 'male', text: 'Do you think me handsome, Miss Eyre? Answer plainly—I value candor above polished compliments.' },
          { type: 'dialogue', speaker: 'Jane Eyre', voice: 'bf_emma', gender: 'female', text: 'No, sir. Yet an honest spirit speaks more clearly than outward fairness ever could.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Orchard Confession',
        lines: [
          { type: 'narration', speaker: 'Jane Eyre', voice: 'bf_emma', gender: 'female', text: 'A warm June twilight settled over the chestnut orchard as lightning flickered along the distant hills.' },
          { type: 'dialogue', speaker: 'Jane Eyre', voice: 'bf_emma', gender: 'female', text: 'Do you think I am an automaton without feelings? Poverty and obscurity cannot make me soulless—my spirit addresses yours as equals!' },
          { type: 'dialogue', speaker: 'Edward Rochester', voice: 'en-US-AndrewNeural', gender: 'male', text: 'Equal we are, Jane! Stay at my side in defiance of every worldly custom.' },
        ],
      },
    ],
  },
  {
    slug: 'moby-dick',
    title: 'Moby-Dick',
    author: 'Herman Melville',
    year: 1851,
    global_tone: 'Epic Maritime Fiction',
    cover_object: '/static/covers/moby-dick-cover.webp',
    synopsis:
      'Sailor Ishmael signs aboard the whaling vessel Pequod alongside harpooner Queequeg, only to discover Captain Ahab monomaniacal hunt for the white whale Moby Dick.',
    narrator_name: 'Ishmael',
    narrator_voice: 'am_michael',
    cast: [
      { name: 'Captain Ahab', voice: 'en-US-RogerNeural', gender: 'male', age_band: 'elder', aliases: ['Ahab'] },
      { name: 'Starbuck', voice: 'en-US-BrianNeural', gender: 'male', age_band: 'adult' },
      { name: 'Queequeg', voice: 'am_onyx', gender: 'male', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Loomings & The Spouter-Inn',
        lines: [
          { type: 'narration', speaker: 'Ishmael', voice: 'am_michael', gender: 'male', text: 'Whenever sea fever gripped my soul, I packed a simple carpetbag for New Bedford and sought passage aboard a Nantucket whaler.' },
          { type: 'dialogue', speaker: 'Queequeg', voice: 'am_onyx', gender: 'male', text: 'We are fast bosom friends from tonight onward, brother. Together we sign the ship articles before the morning tide.' },
          { type: 'dialogue', speaker: 'Starbuck', voice: 'en-US-BrianNeural', gender: 'male', text: 'Steady on deck, lads! We sail for oil and honest profit across the wide Pacific, not foolhardy chases.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Quarter-Deck',
        lines: [
          { type: 'narration', speaker: 'Ishmael', voice: 'am_michael', gender: 'male', text: 'Days out into the Atlantic, Captain Ahab emerged at last onto the quarter-deck, ivory leg ringing sharply against the planks as he nailed a Spanish doubloon to the mast.' },
          { type: 'dialogue', speaker: 'Captain Ahab', voice: 'en-US-RogerNeural', gender: 'male', text: 'Whosoever raises me that white-headed whale with a wrinkled brow shall win this gold! Death to Moby Dick!' },
          { type: 'dialogue', speaker: 'Starbuck', voice: 'en-US-BrianNeural', gender: 'male', text: 'Vengeance on a dumb brute, Captain? Heaven guard the Pequod from madness upon open waters!' },
        ],
      },
    ],
  },
  {
    slug: 'the-picture-of-dorian-gray',
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    year: 1890,
    global_tone: 'Philosophical Gothic',
    cover_object: '/static/covers/picture-of-dorian-gray-cover.webp',
    synopsis:
      'Handsome young Dorian Gray wishes that his painted portrait would bear every mark of age and sin in his stead—a wish that traps his soul in London society.',
    narrator_name: 'London Narrator',
    narrator_voice: 'en-GB-RyanNeural',
    cast: [
      { name: 'Dorian Gray', voice: 'en-GB-ThomasNeural', gender: 'male', age_band: 'young', aliases: ['Dorian'] },
      { name: 'Lord Henry Wotton', voice: 'en-AU-WilliamMultilingualNeural', gender: 'male', age_band: 'adult', aliases: ['Lord Henry', 'Harry'] },
      { name: 'Basil Hallward', voice: 'en-CA-LiamNeural', gender: 'male', age_band: 'adult', aliases: ['Basil'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'The Studio',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Sunlight filtered through silk curtains into Basil Hallward studio, where the scent of roses mingled with linseed oil.' },
          { type: 'dialogue', speaker: 'Lord Henry Wotton', voice: 'en-AU-WilliamMultilingualNeural', gender: 'male', text: 'It is your finest work, Basil. You must send this portrait to the Grosvenor Gallery at once.' },
          { type: 'dialogue', speaker: 'Basil Hallward', voice: 'en-CA-LiamNeural', gender: 'male', text: 'I cannot exhibit it, Henry; I have put too much of my own soul into the canvas.' },
          { type: 'dialogue', speaker: 'Dorian Gray', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'If only I could stay young forever while this picture grows old and hideous instead of me!' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Locked Attic',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'Years later, Dorian climbed the dusty stairs to his childhood schoolroom, unlocking the canvas draped in purple velvet.' },
          { type: 'dialogue', speaker: 'Basil Hallward', voice: 'en-CA-LiamNeural', gender: 'male', text: 'Good heavens, Dorian! Those cruel lines around the mouth—what have you done to my painting?' },
          { type: 'dialogue', speaker: 'Dorian Gray', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'It is the face of my own conscience, Basil, and no living witness may carry its secret out into London.' },
        ],
      },
    ],
  },
  {
    slug: 'the-count-of-monte-cristo',
    title: 'The Count of Monte Cristo',
    author: 'Alexandre Dumas',
    year: 1844,
    global_tone: 'Historical Adventure',
    cover_object: '/static/covers/count-of-monte-cristo-cover.webp',
    synopsis:
      'Wrongfully imprisoned in the Chateau d If, young sailor Edmond Dantes escapes after fourteen years with the secret of a vast treasure and returns as the Count of Monte Cristo.',
    narrator_name: 'Mediterranean Narrator',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Edmond Dantes', voice: 'en-US-ChristopherNeural', gender: 'male', age_band: 'adult', aliases: ['Count of Monte Cristo', 'Monte Cristo', 'Dantes'] },
      { name: 'Abbe Faria', voice: 'en-IE-ConnorNeural', gender: 'male', age_band: 'elder', aliases: ['Faria'] },
      { name: 'Mercedes', voice: 'en-US-AvaNeural', gender: 'female', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Chateau d If',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Deep beneath the stone vaults of the island fortress, a faint scraping sound echoed behind Edmond Dantes damp cell wall.' },
          { type: 'dialogue', speaker: 'Abbe Faria', voice: 'en-IE-ConnorNeural', gender: 'male', text: 'Courage, my son! Four years of digging miscalculated my direction, yet providence has brought me an ally and heir.' },
          { type: 'dialogue', speaker: 'Edmond Dantes', voice: 'en-US-ChristopherNeural', gender: 'male', text: 'Teach me everything you know, Father—languages, mathematics, and the true names of the men who buried me alive.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Treasure of Monte Cristo',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Beneath the barren cliffs of Monte Cristo island, torchlight sparked off gold ingots, rubies, and ancient Roman coin.' },
          { type: 'dialogue', speaker: 'Edmond Dantes', voice: 'en-US-ChristopherNeural', gender: 'male', text: 'Wait and hope! Paris shall soon learn how patiently the Count of Monte Cristo balances every debt.' },
          { type: 'dialogue', speaker: 'Mercedes', voice: 'en-US-AvaNeural', gender: 'female', text: 'That voice across the ballroom—though years and grief have altered every feature, Edmond, my heart recognized you at once.' },
        ],
      },
    ],
  },
  {
    slug: 'the-time-machine',
    title: 'The Time Machine',
    author: 'H.G. Wells',
    year: 1895,
    global_tone: 'Victorian Science Fiction',
    cover_object: '/static/covers/the-time-machine-cover.svg',
    synopsis:
      'A London inventor unveils a glittering brass contraption capable of sailing through the Fourth Dimension, carrying him eight hundred millennia into a haunting future.',
    narrator_name: 'Dinner Guest',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Time Traveller', voice: 'en-GB-ThomasNeural', gender: 'male', age_band: 'adult' },
      { name: 'Filby', voice: 'en-NZ-MitchellNeural', gender: 'male', age_band: 'adult' },
      { name: 'Weena', voice: 'en-GB-MaisieNeural', gender: 'female', age_band: 'young' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'The Fourth Dimension',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'After dinner in Richmond, firelight gleamed off a miniature clockwork frame of ivory and crystal upon the smoking-room table.' },
          { type: 'dialogue', speaker: 'Time Traveller', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'Time is simply a fourth dimension along which our consciousness moves! Press this tiny lever, and watch the model vanish into tomorrow.' },
          { type: 'dialogue', speaker: 'Filby', voice: 'en-NZ-MitchellNeural', gender: 'male', text: 'Wait a moment—some sleight of hand! Or did the brass machine truly slip right out of sight?' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Year 802,701',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Suns flickered into streaks of gold as millennia spun past, halting beside a colossal white sphinx in a garden world.' },
          { type: 'dialogue', speaker: 'Weena', voice: 'en-GB-MaisieNeural', gender: 'female', text: 'Do not stay outside when the moonless dark falls, or the Morlocks will climb from the iron shafts below.' },
          { type: 'dialogue', speaker: 'Time Traveller', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'With matches in pocket and levers recovered, we shall climb back through the centuries before dusk settles!' },
        ],
      },
    ],
  },
  {
    slug: 'the-war-of-the-worlds',
    title: 'The War of the Worlds',
    author: 'H.G. Wells',
    year: 1898,
    global_tone: 'Invasion Science Fiction',
    cover_object: '/static/covers/the-war-of-the-worlds-cover.svg',
    synopsis:
      'Green flares erupt from Mars and steel cylinders crash into Surrey commons, unleashing towering tripod fighting-machines across Victorian England.',
    narrator_name: 'Woking Chronicler',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Ogilvy', voice: 'en-IE-ConnorNeural', gender: 'male', age_band: 'elder' },
      { name: 'Artilleryman', voice: 'en-US-EricNeural', gender: 'male', age_band: 'adult' },
      { name: 'Curate', voice: 'en-NZ-MitchellNeural', gender: 'male', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'The Cylinder Opens on Horsell Common',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'At dawn on Horsell Common, a curious crowd gathered around a smoking thirty-yard cylinder buried deep in the heather.' },
          { type: 'dialogue', speaker: 'Ogilvy', voice: 'en-IE-ConnorNeural', gender: 'male', text: 'Stand back from the pit! The screw-lid is turning by itself from inside—there are living creatures within that shell!' },
          { type: 'dialogue', speaker: 'Artilleryman', voice: 'en-US-EricNeural', gender: 'male', text: 'Hold the ridge and train every field gun! Great three-legged towers of steel are striding out across the Thames valley!' },
        ],
      },
      {
        chapter_number: 2,
        title: 'Dead London',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Weeks later, beneath a silent crimson sky choked with red weed, the great city stood utterly deserted.' },
          { type: 'dialogue', speaker: 'Curate', voice: 'en-NZ-MitchellNeural', gender: 'male', text: 'Why are the streets so still? Have they swept all of humanity away overnight?' },
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Upon Primrose Hill the metallic tripods leaned motionless—slain not by artillery, but by the humblest earthly microbes.' },
        ],
      },
    ],
  },
  {
    slug: 'jekyll-and-hyde',
    title: 'Strange Case of Dr Jekyll and Mr Hyde',
    author: 'Robert Louis Stevenson',
    year: 1886,
    global_tone: 'Victorian Psychological Thriller',
    cover_object: '/static/covers/jekyll-and-hyde-cover.svg',
    synopsis:
      'London lawyer Gabriel Utterson investigates the sinister tie linking respected physician Henry Jekyll to the violent Edward Hyde.',
    narrator_name: 'London Narrator',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Gabriel Utterson', voice: 'en-CA-LiamNeural', gender: 'male', age_band: 'adult', aliases: ['Utterson', 'Mr. Utterson'] },
      { name: 'Dr. Henry Jekyll', voice: 'en-US-ChristopherNeural', gender: 'male', age_band: 'adult', aliases: ['Jekyll', 'Dr. Jekyll'] },
      { name: 'Edward Hyde', voice: 'en-US-RogerNeural', gender: 'male', age_band: 'adult', aliases: ['Hyde', 'Mr. Hyde'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Search for Mr. Hyde',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'In mist-wrapped Soho squares, Lawyer Utterson waited nightly beside a blistered side door until a brisk, light footstep echoed down the alley.' },
          { type: 'dialogue', speaker: 'Gabriel Utterson', voice: 'en-CA-LiamNeural', gender: 'male', text: 'Pray let me look upon your face, Mister Hyde. Common friends—Doctor Henry Jekyll, for instance—have spoken your name.' },
          { type: 'dialogue', speaker: 'Edward Hyde', voice: 'en-US-RogerNeural', gender: 'male', text: 'Jekyll never told you where to find me! If you want my address, look it up in Soho—though no man calls there twice.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Cabinet Door',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Behind locked oak in the laboratory cabinet, shattered phials and a sealed confession awaited Utterson.' },
          { type: 'dialogue', speaker: 'Dr. Henry Jekyll', voice: 'en-US-ChristopherNeural', gender: 'male', text: 'Man is not truly one, but truly two. When I drank the foaming compound, I severed the angel from the fiend—only to lose the key to returning.' },
        ],
      },
    ],
  },
  {
    slug: 'treasure-island',
    title: 'Treasure Island',
    author: 'Robert Louis Stevenson',
    year: 1883,
    global_tone: 'Maritime Adventure',
    cover_object: '/static/covers/treasure-island-cover.svg',
    synopsis:
      'Young Jim Hawkins discovers Captain Flint treasure map at the Admiral Benbow Inn and sails aboard the Hispaniola with the cunning one-legged quartermaster Long John Silver.',
    narrator_name: 'Jim Hawkins',
    narrator_voice: 'en-GB-ThomasNeural',
    cast: [
      { name: 'Long John Silver', voice: 'en-US-SteffanNeural', gender: 'male', age_band: 'elder', aliases: ['Silver'] },
      { name: 'Dr. Livesey', voice: 'bm_george', gender: 'male', age_band: 'adult' },
      { name: 'Squire Trelawney', voice: 'en-IE-ConnorNeural', gender: 'male', age_band: 'elder' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'The Sea-Chest & The Map',
        lines: [
          { type: 'narration', speaker: 'Jim Hawkins', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'Inside the old captain oilskin packet lay an inked parchment chart marked with three crimson crosses and latitude coordinates.' },
          { type: 'dialogue', speaker: 'Squire Trelawney', voice: 'en-IE-ConnorNeural', gender: 'male', text: 'Tomorrow I ride for Bristol! Within three weeks we shall fit the finest schooner afloat and weigh anchor for Flint gold!' },
          { type: 'dialogue', speaker: 'Dr. Livesey', voice: 'bm_george', gender: 'male', text: 'Guard your tongue in Bristol, Squire—half the taverns along the quay have sharper ears than honest sailors.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'What I Heard in the Apple Barrel',
        lines: [
          { type: 'narration', speaker: 'Jim Hawkins', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'Curled inside the empty apple barrel on deck under moonlight, I froze as Long John Silver leaned right beside me.' },
          { type: 'dialogue', speaker: 'Long John Silver', voice: 'en-US-SteffanNeural', gender: 'male', text: 'Wait till we get the map and the treasure aboard, matey! Then we strike, when the Hispaniola points homeward!' },
        ],
      },
    ],
  },
  {
    slug: 'the-odyssey',
    title: 'The Odyssey',
    author: 'Homer',
    year: 1900,
    global_tone: 'Classical Epic',
    cover_object: '/static/covers/the-odyssey-cover.svg',
    synopsis:
      'After the fall of Troy, resourceful King Odysseus braves Cyclops, Sirens, and Poseidon wrath across ten tempestuous years to reclaim Ithaca and Queen Penelope.',
    narrator_name: 'Epic Rhapsode',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Odysseus', voice: 'en-US-AndrewNeural', gender: 'male', age_band: 'adult' },
      { name: 'Athena', voice: 'en-GB-SoniaNeural', gender: 'female', age_band: 'adult' },
      { name: 'Penelope', voice: 'bf_alice', gender: 'female', age_band: 'adult' },
      { name: 'Telemachus', voice: 'en-GB-ThomasNeural', gender: 'male', age_band: 'young' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Counsel of Athena',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Sing, Muse, of the man of many turns who wandered far after sacking sacred Troy and yearned for his rocky island home.' },
          { type: 'dialogue', speaker: 'Athena', voice: 'en-GB-SoniaNeural', gender: 'female', text: 'Brave Telemachus, equip a swift black ship and seek news of your father across Pylos and Sparta while I guard your hall.' },
          { type: 'dialogue', speaker: 'Telemachus', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'Though insolent suitors feast in our courtyard, I will set sail tonight for truth of Odysseus.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The Bow of Ithaca',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Disguised in beggar rags inside his own palace, Odysseus tested the great horned bow nobody else could string.' },
          { type: 'dialogue', speaker: 'Penelope', voice: 'bf_alice', gender: 'female', text: 'Only the man who carved our olive-tree marriage bed could know its secret roots. Welcome home, my husband.' },
          { type: 'dialogue', speaker: 'Odysseus', voice: 'en-US-AndrewNeural', gender: 'male', text: 'Long storms parted us, Penelope, yet every wave led back to Ithaca at last.' },
        ],
      },
    ],
  },
  {
    slug: 'the-metamorphosis',
    title: 'The Metamorphosis',
    author: 'Franz Kafka',
    year: 1915,
    global_tone: 'Modernist Absurdist Fiction',
    cover_object: '/static/covers/the-metamorphosis-cover.svg',
    synopsis:
      'Traveling salesman Gregor Samsa wakes one morning transformed into a gigantic insect, forcing him and his bewildered family to confront isolation inside their Prague apartment.',
    narrator_name: 'Prague Narrator',
    narrator_voice: 'en-US-BrianNeural',
    cast: [
      { name: 'Gregor Samsa', voice: 'en-NZ-MitchellNeural', gender: 'male', age_band: 'adult', aliases: ['Gregor'] },
      { name: 'Grete Samsa', voice: 'en-GB-LibbyNeural', gender: 'female', age_band: 'young', aliases: ['Grete'] },
      { name: 'Chief Clerk', voice: 'en-US-RogerNeural', gender: 'male', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Awakening',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-US-BrianNeural', gender: 'male', text: 'As morning rain tapped against the windowpane, Gregor Samsa discovered an armor-hard shell upon his back and countless thin legs waving helplessly.' },
          { type: 'dialogue', speaker: 'Chief Clerk', voice: 'en-US-RogerNeural', gender: 'male', text: 'Mister Samsa! You missed the five o clock train and locked every door—the firm demands an explanation this instant!' },
          { type: 'dialogue', speaker: 'Gregor Samsa', voice: 'en-NZ-MitchellNeural', gender: 'male', text: 'I am opening right away, sir—a slight dizziness kept me in bed, yet I shall catch the eight o clock express!' },
        ],
      },
      {
        chapter_number: 2,
        title: 'Violin by Night',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-US-BrianNeural', gender: 'male', text: 'Quiet weeks passed behind the bedroom door until notes from Grete violin drifted through the parlor crack.' },
          { type: 'dialogue', speaker: 'Grete Samsa', voice: 'en-GB-LibbyNeural', gender: 'female', text: 'Notice how calm he grows whenever music fills the hall, though we must carry on with courage somehow.' },
        ],
      },
    ],
  },
  {
    slug: 'wuthering-heights',
    title: 'Wuthering Heights',
    author: 'Emily Bronte',
    year: 1847,
    global_tone: 'Yorkshire Gothic Drama',
    cover_object: '/static/covers/wuthering-heights-cover.svg',
    synopsis:
      'On the windswept Yorkshire moors, the tempestuous bond between foundling Heathcliff and Catherine Earnshaw echoes through two generations of Thrushcross Grange and Wuthering Heights.',
    narrator_name: 'Nelly Dean',
    narrator_voice: 'en-GB-SoniaNeural',
    cast: [
      { name: 'Heathcliff', voice: 'en-US-RogerNeural', gender: 'male', age_band: 'adult' },
      { name: 'Catherine Earnshaw', voice: 'bf_emma', gender: 'female', age_band: 'young', aliases: ['Catherine', 'Cathy'] },
      { name: 'Lockwood', voice: 'bm_george', gender: 'male', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Snowstorm on the Moors',
        lines: [
          { type: 'narration', speaker: 'Nelly Dean', voice: 'en-GB-SoniaNeural', gender: 'female', text: 'North wind howled across the bleak heather ridge as Mister Lockwood knocked upon the iron-studded oak door of Wuthering Heights.' },
          { type: 'dialogue', speaker: 'Lockwood', voice: 'bm_george', gender: 'male', text: 'A fierce night upon these moors, Missis Dean. Why does Mister Heathcliff guard his threshold like a winter storm?' },
          { type: 'dialogue', speaker: 'Heathcliff', voice: 'en-US-RogerNeural', gender: 'male', text: 'Come in, Catherine, at last! Twenty years have I listened to the gale calling your name at the casement!' },
        ],
      },
      {
        chapter_number: 2,
        title: 'Whatever Our Souls Are Made Of',
        lines: [
          { type: 'narration', speaker: 'Nelly Dean', voice: 'en-GB-SoniaNeural', gender: 'female', text: 'By the kitchen hearth years earlier, Catherine whispered her secret confession while rain hammered the mullioned panes.' },
          { type: 'dialogue', speaker: 'Catherine Earnshaw', voice: 'bf_emma', gender: 'female', text: 'Nelly, I am Heathcliff! Whatever our souls are made of, his and mine are wholly the same.' },
        ],
      },
    ],
  },
  {
    slug: 'great-expectations',
    title: 'Great Expectations',
    author: 'Charles Dickens',
    year: 1861,
    global_tone: 'Victorian Bildungsroman',
    cover_object: '/static/covers/great-expectations-cover.svg',
    synopsis:
      'Orphaned Pip meets a desperate convict on the Kent marshes and the eccentric Miss Havisham before an anonymous fortune catapults him into London gentleman society.',
    narrator_name: 'Pip (Adult)',
    narrator_voice: 'bm_george',
    cast: [
      { name: 'Pip', voice: 'en-GB-ThomasNeural', gender: 'male', age_band: 'young' },
      { name: 'Abel Magwitch', voice: 'en-US-SteffanNeural', gender: 'male', age_band: 'elder', aliases: ['Magwitch'] },
      { name: 'Miss Havisham', voice: 'en-IE-EmilyNeural', gender: 'female', age_band: 'elder' },
      { name: 'Estella', voice: 'bf_emma', gender: 'female', age_band: 'young' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'The Marshes & Satis House',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'Out of the shivering mist among the Thames marsh tombstones stepped a ragged man bound in heavy iron.' },
          { type: 'dialogue', speaker: 'Abel Magwitch', voice: 'en-US-SteffanNeural', gender: 'male', text: 'Keep still, young fellow! Bring me a file and wittles early tomorrow morning at the old battery, and I will remember you!' },
          { type: 'dialogue', speaker: 'Miss Havisham', voice: 'en-IE-EmilyNeural', gender: 'female', text: 'All the clocks stopped at twenty minutes to nine inside Satis House, boy. Play cards with Estella!' },
          { type: 'dialogue', speaker: 'Estella', voice: 'bf_emma', gender: 'female', text: 'What coarse hands this boy has! Come along, then, and prove yourself better than the forge.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'The True Benefactor',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'bm_george', gender: 'male', text: 'On a stormy night in Temple chambers, footsteps climbed the stairwell to reveal who had truly financed Pip London fortune.' },
          { type: 'dialogue', speaker: 'Pip', voice: 'en-GB-ThomasNeural', gender: 'male', text: 'You were my benefactor all along—every sovereign came not from Satis House, but from kindness returned!' },
        ],
      },
    ],
  },
  {
    slug: 'a-tale-of-two-cities',
    title: 'A Tale of Two Cities',
    author: 'Charles Dickens',
    year: 1859,
    global_tone: 'Historical Drama',
    cover_object: '/static/covers/a-tale-of-two-cities-cover.svg',
    synopsis:
      'Set between London and revolutionary Paris, Doctor Alexandre Manette, Lucie Manette, Charles Darnay, and cynical barrister Sydney Carton are swept into the storm of 1789.',
    narrator_name: 'Historical Chronicler',
    narrator_voice: 'en-GB-RyanNeural',
    cast: [
      { name: 'Sydney Carton', voice: 'en-US-BrianNeural', gender: 'male', age_band: 'adult', aliases: ['Carton'] },
      { name: 'Lucie Manette', voice: 'en-GB-LibbyNeural', gender: 'female', age_band: 'young', aliases: ['Lucie'] },
      { name: 'Charles Darnay', voice: 'en-CA-LiamNeural', gender: 'male', age_band: 'adult', aliases: ['Darnay'] },
      { name: 'Dr. Alexandre Manette', voice: 'en-IE-ConnorNeural', gender: 'male', age_band: 'elder', aliases: ['Dr. Manette'] },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Recalled to Life',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'It was the best of times, it was the worst of times—an age of wisdom and folly linking Soho squares to the streets of Saint Antoine.' },
          { type: 'dialogue', speaker: 'Lucie Manette', voice: 'en-GB-LibbyNeural', gender: 'female', text: 'Father, look upon my face—the long darkness of the Bastille has ended, and we travel safely home to England.' },
          { type: 'dialogue', speaker: 'Dr. Alexandre Manette', voice: 'en-IE-ConnorNeural', gender: 'male', text: 'Golden hair like my wife long ago... am I truly recalled to life?' },
        ],
      },
      {
        chapter_number: 2,
        title: 'A Far, Far Better Thing',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'en-GB-RyanNeural', gender: 'male', text: 'In the dim stone cell of La Force, Sydney Carton clasped Charles Darnay hand with quiet resolve.' },
          { type: 'dialogue', speaker: 'Charles Darnay', voice: 'en-CA-LiamNeural', gender: 'male', text: 'Carton! You cannot take my coat and place—think of your own life!' },
          { type: 'dialogue', speaker: 'Sydney Carton', voice: 'en-US-BrianNeural', gender: 'male', text: 'Take this pen, escape with Lucie to Dover, and remember a far better rest I go to than I have ever known.' },
        ],
      },
    ],
  },
  {
    slug: 'the-call-of-the-wild',
    title: 'The Call of the Wild',
    author: 'Jack London',
    year: 1903,
    global_tone: 'Wilderness Adventure',
    cover_object: '/static/covers/the-call-of-the-wild-cover.svg',
    synopsis:
      'Stolen from a sun-drenched California estate during the Klondike Gold Rush, courageous sled dog Buck adapts to frozen Yukon trails and finds fierce loyalty beside John Thornton.',
    narrator_name: 'Yukon Narrator',
    narrator_voice: 'am_michael',
    cast: [
      { name: 'John Thornton', voice: 'en-US-ChristopherNeural', gender: 'male', age_band: 'adult', aliases: ['Thornton'] },
      { name: 'Francois', voice: 'en-CA-LiamNeural', gender: 'male', age_band: 'adult' },
      { name: 'Perrault', voice: 'en-US-GuyNeural', gender: 'male', age_band: 'adult' },
    ],
    chapters: [
      {
        chapter_number: 1,
        title: 'Into the Primitive',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'am_michael', gender: 'male', text: 'Cold white silence fell over Dyea Beach when Buck felt soft snow beneath his paws for the very first time and stepped into sled harness.' },
          { type: 'dialogue', speaker: 'Perrault', voice: 'en-US-GuyNeural', gender: 'male', text: 'Look at that big fellow pull the trace! Two dogs strength in one chest—that Buck will carry government dispatches clear to Dawson!' },
          { type: 'dialogue', speaker: 'Francois', voice: 'en-CA-LiamNeural', gender: 'male', text: 'Aye, Perrault! He learns the law of club and fang faster than any wolf in the Yukon.' },
        ],
      },
      {
        chapter_number: 2,
        title: 'For the Love of a Man',
        lines: [
          { type: 'narration', speaker: 'Narrator', voice: 'am_michael', gender: 'male', text: 'At Circle City, wounded Buck found shelter by John Thornton campfire and answered a bond deeper than hardship.' },
          { type: 'dialogue', speaker: 'John Thornton', voice: 'en-US-ChristopherNeural', gender: 'male', text: 'Steady, Buck, old partner! You are worth more than all the gold along the Yukon River.' },
        ],
      },
    ],
  },
];

const PUBLIC_DOMAIN_CATALOG = RAW_PUBLIC_DOMAIN_NOVELS.map((entry) => {
  const novelId = entry.id || deterministicUuid(`synctone-pd-novel:${entry.slug || entry.title}`);
  const chapters = (entry.chapters || []).map((ch) => {
    const chapterId = deterministicUuid(`synctone-pd-ch:${novelId}:${ch.chapter_number}`);
    const built = buildSegmentsFromLines(ch.lines, entry.narrator_voice);
    const rawText = ch.lines
      .map((l) => (l.type === 'dialogue' ? `"${l.text}" said ${l.speaker}.` : l.text))
      .join('\n\n');
    return {
      id: chapterId,
      novel_id: novelId,
      chapter_number: ch.chapter_number,
      title: ch.title,
      raw_text: rawText,
      segments: built.segments,
      total_duration_ms: built.totalDurationMs,
      manifest: {
        total_duration_ms: built.totalDurationMs,
        audio_url: `/api/stream/${chapterId}`,
        timeline: built.timeline,
      },
    };
  });
  return {
    ...entry,
    id: novelId,
    chapters,
  };
});

function findPublicDomainChapterById(chapterId) {
  for (const novel of PUBLIC_DOMAIN_CATALOG) {
    const ch = novel.chapters.find((c) => c.id === chapterId);
    if (ch) {
      return {
        pg_chapter_id: ch.id,
        novel_id: novel.id,
        chapter_number: ch.chapter_number,
        title: ch.title,
        raw_text: ch.raw_text,
        segments: ch.segments,
        manifest: ch.manifest,
      };
    }
  }
  return null;
}

module.exports = {
  PUBLIC_DOMAIN_CATALOG,
  findPublicDomainChapterById,
};
