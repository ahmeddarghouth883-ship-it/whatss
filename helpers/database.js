const mongoose = require('mongoose');

async function startMemoryMongoUri() {
  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = require('mongodb-memory-server'));
  } catch (e) {
    console.error('❌ mongodb-memory-server is missing. Run: npm install');
    console.error('   Or set MONGODB_URI in .env to a real MongoDB.');
    process.exit(1);
  }
  const mem = await MongoMemoryServer.create();
  return mem.getUri();
}

async function cleanupLegacyIndexes() {
  try {
    const indexesToDrop = [
      { collectionName: 'transactions', indexName: 'referenceNumber_1' },
      { collectionName: 'users', indexName: 'username_1' }
    ];

    for (const { collectionName, indexName } of indexesToDrop) {
      const collection = mongoose.connection.db.collection(collectionName);
      const indexes = await collection.indexes();
      const hasLegacyIndex = indexes.some((idx) => idx.name === indexName);

      if (hasLegacyIndex) {
        await collection.dropIndex(indexName);
        console.log(`ℹ️  Dropped legacy index ${collectionName}.${indexName}`);
      }
    }
  } catch (err) {
    if (!['NamespaceNotFound', 'ns not found'].includes(err.codeName) && !String(err.message).includes('ns not found')) {
      console.warn('⚠️  Legacy index cleanup skipped:', err.message);
    }
  }
}

/**
 * Resolves MongoDB URI:
 * - Production: MONGODB_URI is required.
 * - Development: if MONGODB_URI is empty, use mongodb-memory-server so auth works without a local Mongo install.
 * - USE_MEMORY_DB=1 forces in-memory; USE_MEMORY_DB=0 forces real DB (default URI 127.0.0.1:27017).
 */
async function resolveMongoUri() {
  const raw = process.env.MONGODB_URI;
  const hasUri = typeof raw === 'string' && raw.trim().length > 0;
  const isProd = process.env.NODE_ENV === 'production';

  if (process.env.USE_MEMORY_DB === '1') {
    console.log('🧠 USE_MEMORY_DB=1 — in-memory MongoDB (data is lost when the server stops).');
    return startMemoryMongoUri();
  }

  if (process.env.USE_MEMORY_DB === '0') {
    return hasUri ? raw.trim() : 'mongodb://127.0.0.1:27017/whispflow';
  }

  if (isProd) {
    if (!hasUri) {
      console.error('FATAL: MONGODB_URI is required in production.');
      process.exit(1);
    }
    return raw.trim();
  }

  // Development: no URI → in-memory so register/login work without installing MongoDB
  if (!hasUri) {
    console.log('🧠 No MONGODB_URI in .env — using in-memory MongoDB for local dev.');
    console.log('   Add MONGODB_URI (e.g. mongodb://127.0.0.1:27017/whispflow) to persist data, or set USE_MEMORY_DB=0.');
    return startMemoryMongoUri();
  }

  // Prefer 127.0.0.1 over "localhost" to avoid IPv6 (::1) connection issues on Windows
  let uri = raw.trim();
  if (/^mongodb:\/\/localhost(\/|\?|:)/i.test(uri)) {
    uri = uri.replace(/^mongodb:\/\/localhost/i, 'mongodb://127.0.0.1');
  }
  return uri;
}

const CONNECT_OPTS = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000
};

/** True when the configured host is unreachable (dev can fall back to in-memory). */
function canFallbackToMemory(err) {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.USE_MEMORY_DB === '0') return false;
  const m = String(err.message || '');
  const code = err.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    /ECONNREFUSED|querySrv ENOTFOUND|getaddrinfo|Server selection timed out|connect ECONNREFUSED/i.test(m)
  );
}

async function connectDB() {
  // Avoid duplicate connections (nodemon reload, tests, or double require).
  if (mongoose.connection.readyState === 1) {
    console.log('✅ MongoDB already connected — skipping new connection');
    return;
  }

  let uri;
  try {
    uri = await resolveMongoUri();
    await mongoose.connect(uri, CONNECT_OPTS);
  } catch (err) {
    if (!canFallbackToMemory(err)) {
      console.error('❌ MongoDB connection error:', err.message);
      process.exit(1);
    }
    console.warn('⚠️  MongoDB unreachable — using in-memory database for this dev session (data is not persisted).');
    console.warn('   Start MongoDB or fix MONGODB_URI; set USE_MEMORY_DB=0 to disable this fallback.');
    try {
      await mongoose.disconnect();
    } catch (_) {}
    uri = await startMemoryMongoUri();
    try {
      await mongoose.connect(uri, CONNECT_OPTS);
    } catch (err2) {
      console.error('❌ MongoDB connection error:', err2.message);
      process.exit(1);
    }
  }

  try {
    await cleanupLegacyIndexes();
  } catch (e) {
    console.warn('⚠️  Index cleanup:', e.message);
  }
  console.log('✅ MongoDB connected');
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected');
});

module.exports = connectDB;
