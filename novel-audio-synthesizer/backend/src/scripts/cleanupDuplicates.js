/**
 * Cleanup duplicate novel entries (missing or legacy placeholder covers) in PostgreSQL
 * and purge any orphaned chapter documents in MongoDB.
 */
const { Pool } = require('pg');
const mongoose = require('mongoose');
const { config } = require('../config');
const ChapterModel = require('../models/Chapter');

async function cleanupDuplicates({ closeConnections = true } = {}) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ...(config.pgSsl ? { ssl: { rejectUnauthorized: Boolean(config.pgSslRejectUnauthorized) } } : {}),
  });
  await mongoose.connect(config.mongoUri);

  try {
    // 1. Find duplicate titles in PostgreSQL
    const dupRes = await pool.query(
      `SELECT LOWER(title) AS norm_title, COUNT(*) AS cnt
       FROM novels
       GROUP BY LOWER(title)
       HAVING COUNT(*) > 1`
    );
    console.log('Duplicate titles:', dupRes.rows);

    for (const { norm_title } of dupRes.rows) {
      const entries = await pool.query(
        `SELECT id, title, cover_object, created_at
         FROM novels
         WHERE LOWER(title) = $1
         ORDER BY
           CASE
             WHEN cover_object IS NULL THEN 0
             WHEN cover_object LIKE '%hp1_cover.jpg' THEN 1
             ELSE 2
           END DESC,
           created_at ASC`,
        [norm_title]
      );

      const keep = entries.rows[0];
      const toDelete = entries.rows.slice(1);
      for (const del of toDelete) {
        console.log(`Deleting duplicate novel id=${del.id} title="${del.title}" cover=${del.cover_object}`);
        await ChapterModel.deleteMany({ novel_id: del.id });
        await pool.query('DELETE FROM novels WHERE id = $1', [del.id]);
      }
      if (keep) {
        console.log(`Kept novel id=${keep.id} title="${keep.title}" cover=${keep.cover_object}`);
      }
    }

    // 2. Purge any orphaned MongoDB chapter documents whose pg_chapter_id no longer exists in PostgreSQL
    const pgChaps = await pool.query('SELECT id FROM chapters');
    const validChapterIds = pgChaps.rows.map((r) => r.id);
    const orphanRes = await ChapterModel.deleteMany({
      pg_chapter_id: { $nin: validChapterIds },
    });
    if (orphanRes.deletedCount > 0) {
      console.log(`Purged ${orphanRes.deletedCount} orphaned MongoDB chapter document(s).`);
    }

    console.log('Cleanup complete');
  } finally {
    if (closeConnections) {
      await pool.end();
      await mongoose.disconnect();
    } else {
      await pool.end();
    }
  }
}

module.exports = { cleanupDuplicates };

if (require.main === module) {
  cleanupDuplicates({ closeConnections: true }).catch((e) => {
    console.error('Error during cleanup:', e);
    process.exit(1);
  });
}
