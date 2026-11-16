/**
 * Unified Object Storage Service for SyncTone.
 *
 * Supports 100% free cloud storage providers:
 * - MongoDB Atlas GridFS (`STORAGE_PROVIDER=mongodb|gridfs`, zero extra services needed)
 * - S3-compatible buckets (`s3`, `r2`, `supabase`, `b2`)
 * - Legacy OpenStack Swift and local disk cache
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { config } = require('../config');

const S3_PROVIDERS = new Set(['s3', 'r2', 'supabase', 'b2']);
const MONGO_PROVIDERS = new Set(['mongodb', 'gridfs', 'mongo']);
const GRIDFS_BUCKET_NAME = 'synctone_storage';

let cachedS3Client = null;

function isMongoStorageConfigured() {
  const s = config.storage || {};
  return MONGO_PROVIDERS.has(s.provider);
}

function isStrictS3Configured() {
  const s = config.storage || {};
  return Boolean(
    S3_PROVIDERS.has(s.provider) &&
    s.s3AccessKeyId &&
    s.s3SecretAccessKey
  );
}

/**
 * Returns true when any remote cloud object store (S3-compatible or MongoDB GridFS)
 * is configured as the active backend.
 */
function isS3Configured() {
  return isStrictS3Configured() || isMongoStorageConfigured();
}

function getS3Client() {
  if (!isStrictS3Configured()) return null;
  if (!cachedS3Client) {
    const s = config.storage;
    cachedS3Client = new S3Client({
      region: s.s3Region || 'auto',
      ...(s.s3Endpoint ? { endpoint: s.s3Endpoint } : {}),
      forcePathStyle: s.s3ForcePathStyle !== false,
      credentials: {
        accessKeyId: s.s3AccessKeyId,
        secretAccessKey: s.s3SecretAccessKey,
      },
    });
  }
  return cachedS3Client;
}

function getGridFSBucket() {
  if (!isMongoStorageConfigured()) return null;
  if (!mongoose.connection || mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return null;
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: GRIDFS_BUCKET_NAME,
  });
}

function resolveBucket(bucketType) {
  const s = config.storage || {};
  return bucketType === 'covers'
    ? (s.bucketCovers || 'synctone-covers')
    : (s.bucketAudio || 'synctone-audio');
}

function resolveLocalPaths(bucketType, key) {
  const safeKey = path.basename(String(key || ''));
  if (!safeKey) return [];
  if (bucketType === 'covers') {
    return [
      path.join(config.paths.outputDir, 'covers', safeKey),
      path.resolve(__dirname, '../../output/covers', safeKey),
      path.resolve(__dirname, '../../../output/covers', safeKey),
      path.resolve(__dirname, '../../../frontend/public/covers', safeKey),
    ];
  }
  return [path.join(config.paths.outputDir, safeKey)];
}

function getPublicUrl({ bucketType = 'covers', key }) {
  const safeKey = path.basename(String(key || ''));
  const s = config.storage || {};
  if (bucketType === 'covers') {
    if (s.publicCoversUrl && isStrictS3Configured()) {
      const candidate = `${s.publicCoversUrl}/${encodeURIComponent(safeKey)}`;
      if (candidate.length <= 255) return candidate;
    }
    return `/static/covers/${safeKey}`;
  }
  if (s.publicAudioUrl && isStrictS3Configured()) {
    return `${s.publicAudioUrl}/${encodeURIComponent(safeKey)}`;
  }
  return `/api/stream/${safeKey.replace(/\.(mp3|wav|opus)$/i, '')}`;
}

function toNodeStream(body) {
  if (!body) return null;
  if (typeof body.pipe === 'function') return body;
  if (typeof Readable.fromWeb === 'function') {
    return Readable.fromWeb(body);
  }
  return null;
}

function toBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(body);
}

function parseByteRange(rangeHeader, totalSize) {
  if (!rangeHeader) return null;
  const trimmed = String(rangeHeader).trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
  if (!match || (match[1] === '' && match[2] === '')) {
    return { invalid: true };
  }

  let start;
  let end;
  if (match[1] === '') {
    const suffixLen = parseInt(match[2], 10);
    if (isNaN(suffixLen) || suffixLen <= 0) return { invalid: true };
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  }

  end = Math.min(end, totalSize - 1);
  if (isNaN(start) || isNaN(end) || start < 0 || start >= totalSize || start > end) {
    return { invalid: true };
  }
  return { start, end, invalid: false };
}

async function putGridFSObject({ gridName, body, contentType, cacheControl, bucketType, safeKey }) {
  const bucket = getGridFSBucket();
  if (!bucket) return false;

  const existing = await bucket.find({ filename: gridName }).toArray();
  for (const doc of existing) {
    await bucket.delete(doc._id).catch(() => {});
  }

  const buffer = toBuffer(body);
  const ct = contentType || 'application/octet-stream';
  const cc = cacheControl || 'public, max-age=31536000, immutable';

  await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(gridName, {
      contentType: ct,
      metadata: {
        bucketType,
        key: safeKey,
        contentType: ct,
        cacheControl: cc,
      },
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', resolve);
    uploadStream.end(buffer);
  });

  return true;
}

async function putObject({ bucketType = 'audio', key, body, contentType, cacheControl }) {
  const safeKey = path.basename(String(key || ''));
  if (!safeKey || !body) {
    throw new Error('Storage putObject requires non-empty key and body.');
  }

  const localTargets = resolveLocalPaths(bucketType, safeKey);
  for (const targetPath of localTargets) {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, body);
      break;
    } catch (_) {}
  }

  const client = getS3Client();
  if (client) {
    await client.send(
      new PutObjectCommand({
        Bucket: resolveBucket(bucketType),
        Key: safeKey,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        CacheControl: cacheControl || 'public, max-age=31536000, immutable',
      })
    );
    return {
      provider: config.storage.provider,
      key: safeKey,
      url: getPublicUrl({ bucketType, key: safeKey }),
    };
  }

  if (isMongoStorageConfigured()) {
    const uploaded = await putGridFSObject({
      gridName: `${bucketType}/${safeKey}`,
      body,
      contentType,
      cacheControl,
      bucketType,
      safeKey,
    });
    if (uploaded) {
      return {
        provider: 'mongodb',
        key: safeKey,
        url: getPublicUrl({ bucketType, key: safeKey }),
      };
    }
  }

  return {
    provider: 'local',
    key: safeKey,
    url: getPublicUrl({ bucketType, key: safeKey }),
  };
}

async function objectExists({ bucketType = 'audio', key }) {
  const safeKey = path.basename(String(key || ''));
  if (!safeKey) return false;

  for (const localPath of resolveLocalPaths(bucketType, safeKey)) {
    try {
      if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
        return true;
      }
    } catch (_) {}
  }

  if (isMongoStorageConfigured()) {
    try {
      const bucket = getGridFSBucket();
      if (!bucket) return false;
      const files = await bucket
        .find({ filename: `${bucketType}/${safeKey}` }, { limit: 1 })
        .toArray();
      return files.length > 0 && Number(files[0].length) > 0;
    } catch (err) {
      console.warn(`[Storage] GridFS exists warning for ${safeKey}:`, err.message);
      return false;
    }
  }

  const client = getS3Client();
  if (!client) return false;

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: resolveBucket(bucketType),
        Key: safeKey,
      })
    );
    return true;
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === 'NotFound') {
      return false;
    }
    console.warn(`[Storage] HeadObject warning for ${safeKey}:`, err.message);
    return false;
  }
}

async function getGridFSObjectStream({ bucketType, safeKey, range }) {
  const bucket = getGridFSBucket();
  if (!bucket) return null;

  const files = await bucket
    .find({ filename: `${bucketType}/${safeKey}` })
    .sort({ uploadDate: -1 })
    .limit(1)
    .toArray();

  if (!files.length || !Number(files[0].length)) {
    return null;
  }

  const file = files[0];
  const totalSize = Number(file.length);
  const ct = file.contentType || file.metadata?.contentType || 'application/octet-stream';
  const cc = file.metadata?.cacheControl || 'public, max-age=31536000, immutable';

  if (range) {
    const parsed = parseByteRange(range, totalSize);
    if (parsed.invalid) {
      return {
        status: 416,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes */${totalSize}`,
        },
        stream: null,
      };
    }

    const { start, end } = parsed;
    const stream = bucket.openDownloadStream(file._id, { start, end: end + 1 });
    return {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Cache-Control': cc,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(end - start + 1),
        'Content-Type': ct,
      },
      stream,
    };
  }

  const stream = bucket.openDownloadStream(file._id);
  return {
    status: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': cc,
      'Content-Length': String(totalSize),
      'Content-Type': ct,
    },
    stream,
  };
}

async function getObjectStream({ bucketType = 'audio', key, range }) {
  const safeKey = path.basename(String(key || ''));
  if (!safeKey) return null;

  if (isMongoStorageConfigured()) {
    try {
      return await getGridFSObjectStream({ bucketType, safeKey, range });
    } catch (err) {
      console.warn(`[Storage] GridFS stream warning for ${safeKey}:`, err.message);
      return null;
    }
  }

  const client = getS3Client();
  if (!client) return null;

  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: resolveBucket(bucketType),
        Key: safeKey,
        ...(range ? { Range: range } : {}),
      })
    );
    const stream = toNodeStream(res.Body);
    if (!stream) return null;

    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (res.ContentRange) headers['Content-Range'] = String(res.ContentRange);
    if (res.ContentLength !== undefined) headers['Content-Length'] = String(res.ContentLength);
    if (res.ContentType) headers['Content-Type'] = String(res.ContentType);

    return {
      status: res.ContentRange ? 206 : 200,
      headers,
      stream,
    };
  } catch (err) {
    const statusCode = err?.$metadata?.httpStatusCode;
    if (statusCode === 416 || err?.name === 'InvalidRange') {
      return {
        status: 416,
        headers: {
          'Accept-Ranges': 'bytes',
        },
        stream: null,
      };
    }
    if (statusCode === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound') {
      return null;
    }
    throw err;
  }
}

const storageService = {
  isMongoStorageConfigured,
  isS3Configured,
  putObject,
  objectExists,
  getObjectStream,
  getPublicUrl,
};

module.exports = {
  storageService,
};
