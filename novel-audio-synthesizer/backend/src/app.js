const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRouter = require('./routes/auth');
const novelsRouter = require('./routes/novels');
const chaptersRouter = require('./routes/chapters');
const voicesRouter = require('./routes/voices');
const statusRouter = require('./routes/status');
const swiftRouter = require('./routes/swift');
const playbackRouter = require('./routes/playback');
const { config } = require('./config');
const { storageService, pipeStreamSafe } = require('./services/storageService');

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (Array.isArray(config.corsOrigins) && config.corsOrigins.includes(origin)) {
    return true;
  }
  if (
    config.allowVercelPreviews &&
    (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
      /^https:\/\/[a-z0-9-]+\.hf\.space$/i.test(origin))
  ) {
    return true;
  }
  return false;
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Middleware
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Range',
        'Cookie',
        'X-Requested-With',
        'Accept',
        'Origin',
      ],
      exposedHeaders: [
        'Content-Range',
        'Accept-Ranges',
        'Content-Length',
        'Content-Type',
      ],
    })
  );
  app.use(express.json({ limit: '250mb' }));
  app.use(express.urlencoded({ extended: true, limit: '250mb' }));
  app.use(cookieParser());

  // Static audio & cover file serving (supports both /static/covers and /covers)
  const coverStaticDirs = [
    path.join(config.paths.outputDir, 'covers'),
    path.resolve(__dirname, '../output/covers'),
    path.resolve(__dirname, '../../frontend/public/covers'),
  ];
  app.use('/static/audio', express.static(config.paths.outputDir));
  for (const dir of coverStaticDirs) {
    app.use('/static/covers', express.static(dir));
    app.use('/covers', express.static(dir));
  }

  const handleCoverFallback = async (req, res, next) => {
    try {
      const safeName = path.basename(req.params.fileName || '');
      if (!safeName) {
        return next();
      }
      if (storageService.isS3Configured()) {
        const s3Obj = await storageService.getObjectStream({ bucketType: 'covers', key: safeName });
        if (s3Obj && s3Obj.stream) {
          res.status(s3Obj.status || 200);
          Object.entries(s3Obj.headers || {}).forEach(([k, v]) => {
            if (v !== undefined) res.setHeader(k, String(v));
          });
          if (!res.getHeader('Content-Type')) {
            const lower = safeName.toLowerCase();
            res.setHeader(
              'Content-Type',
              lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
            );
          }
          return pipeStreamSafe(s3Obj.stream, res);
        }
      }
      if (process.env.VERCEL && req.path.startsWith('/static/covers')) {
        return res.redirect(302, `/covers/${encodeURIComponent(safeName)}`);
      }
      return next();
    } catch (err) {
      console.warn('[StaticCover Fallback Warning]:', err.message);
      return next();
    }
  };
  app.get('/static/covers/:fileName', handleCoverFallback);
  app.get('/covers/:fileName', handleCoverFallback);

  // Health check endpoint (root & /api alias)
  app.get(['/health', '/api/health'], (_req, res) => {
    return res.json({ status: 'healthy', version: '0.1.0' });
  });

  // API Routes
  app.use('/api', authRouter);
  app.use('/api', novelsRouter);
  app.use('/api', chaptersRouter);
  app.use('/api', voicesRouter);
  app.use('/api', statusRouter);
  app.use('/api', swiftRouter);
  app.use('/api', playbackRouter);

  // 404 Handler
  app.use((_req, res) => {
    return res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global Error Handler
  app.use((err, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }
    if (err && err.name === 'MulterError') {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'Invalid file upload request.' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request payload too large.' });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON request body.' });
    }
    console.error('[API Error]:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

module.exports = {
  createApp,
};
