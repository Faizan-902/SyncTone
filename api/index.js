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
      const results = await Promise.allSettled([
        connectMongo(),
        connectPostgres().then(async () => {
          const { ensureVoiceCatalog } = require('../novel-audio-synthesizer/backend/src/scripts/seedDemos');
          await ensureVoiceCatalog(pool);
        }),
      ]);
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        failures.forEach((f) => console.warn('[Vercel DB] Init warning:', f.reason?.message || f.reason));
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
