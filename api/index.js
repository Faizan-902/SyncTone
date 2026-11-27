const { createApp } = require('../novel-audio-synthesizer/backend/src/app');
const { connectMongo, connectPostgres, pool } = require('../novel-audio-synthesizer/backend/src/db');

let appInstance = null;
let initPromise = null;

async function ensureInitialized() {
  if (!appInstance) {
    appInstance = createApp();
  }
  if (!initPromise) {
    initPromise = (async () => {
      const [mongoRes, pgRes] = await Promise.allSettled([
        connectMongo(),
        connectPostgres().then(async () => {
          const { ensureVoiceCatalog } = require('../novel-audio-synthesizer/backend/src/scripts/seedDemos');
          await ensureVoiceCatalog(pool);
        }),
      ]);
      if (mongoRes.status === 'rejected') {
        console.warn('[Vercel DB] MongoDB unavailable (using PostgreSQL fallback):', mongoRes.reason?.message || mongoRes.reason);
      }
      if (pgRes.status === 'rejected') {
        console.warn('[Vercel DB] Postgres init warning:', pgRes.reason?.message || pgRes.reason);
        initPromise = null;
      }
    })();
  }
  await initPromise;
  return appInstance;
}

module.exports = async (req, res) => {
  try {
    const app = await ensureInitialized();
    return app(req, res);
  } catch (err) {
    console.error('[Vercel Handler Error]:', err);
    if (!res.headersSent) {
      return res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
  }
};
