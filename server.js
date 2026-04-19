/**
 * server.js — minimal Express + Socket.IO backend wired for the Google Places
 * scrape flow. Boots env, Mongo, auth + scrape routes, and exposes the Maps
 * JS API key to the authenticated frontend.
 *
 * QR scan / messaging logic (helpers/whatsappManager.js, helpers/email.js) is
 * intentionally NOT required here — it stays untouched per the user request.
 */

const { loadEnvLogs } = require('./helpers/envLoader');
loadEnvLogs();

const http    = require('http');
const path    = require('path');
const express = require('express');
const cors    = require('cors');
const mongoose = require('mongoose');
const { Server: IOServer } = require('socket.io');
const jwt     = require('jsonwebtoken');

const connectDB       = require('./helpers/database');
const { resetDatabase } = require('./helpers/resetDatabase');
const { seedAdminUser } = require('./helpers/seedAdmin');
const { seedPlans }     = require('./helpers/seedPlans');
const { startScheduler } = require('./helpers/scheduler');
const { startDirectSendWorker } = require('./helpers/directSendWorker');

// Required defaults so development works without a .env file.
process.env.JWT_SECRET     = process.env.JWT_SECRET     || 'dev-secret-change-me';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
process.env.PORT           = process.env.PORT           || '5000';

const app = express();
const server = http.createServer(app);

const io = new IOServer(server, {
  path: '/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
});
app.set('io', io);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const st = mongoose.connection.readyState;
  const stateNames = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    ok: true,
    mongo: {
      state: stateNames[st] ?? st,
      connected: st === 1,
      db: mongoose.connection.db?.databaseName ?? null,
    },
    hasMongoUri: !!(process.env.MONGODB_URI && String(process.env.MONGODB_URI).trim()),
    placesKey: !!process.env.GOOGLE_PLACES_API_KEY,
    time: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/config',   require('./routes/config'));
app.use('/api/me',       require('./routes/me'));
app.use('/api/plans',    require('./routes/plans'));      // public
app.use('/api/orders',   require('./routes/orders'));     // auth
app.use('/api/scrape',     require('./routes/scrape'));
app.use('/api/leads',      require('./routes/leads'));
app.use('/api/campaigns',  require('./routes/campaigns'));
app.use('/api/messages',   require('./routes/messages'));
app.use('/api/inbox',      require('./routes/inbox'));    // conversation threads
app.use('/api/upload',     require('./routes/upload'));   // file uploads
app.use('/api/presets',  require('./routes/presets'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/admin',    require('./routes/admin'));

// Serve uploaded files
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Serve the built frontend when present (vite build outputs to ../public
// relative to frontend/, which resolves to ./public at the repo root).
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res, next) => {
  const indexPath = path.join(publicDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) next();
  });
});

// ── Socket.IO ────────────────────────────────────────────────────────────────
// Two ways to join the per-user room:
//   1. Optional JWT in handshake.auth.token -> we auto-join `user:<id>`
//   2. Legacy `socket.emit('join', userId)` from the frontend (still supported)
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
      const decoded = jwt.verify(String(token), process.env.JWT_SECRET);
      socket.data.userId = String(decoded.userId || decoded._id || '');
    }
  } catch (_) { /* ignore bad tokens — fall back to `join` event */ }
  next();
});

async function maybeJoinAdminRoom(socket) {
  if (!socket.data.userId) return;
  try {
    const User = require('./models/User');
    const u = await User.findById(socket.data.userId).select('role');
    if (u?.role === 'admin') socket.join('admins');
  } catch (_) { /* ignore */ }
}

io.on('connection', (socket) => {
  if (socket.data.userId) {
    // Join BOTH room shapes:
    //   user:<id>  → used by routes/scrape, routes/admin (order:* events)
    //   <id>       → used by helpers/whatsappManager (wa:qr / wa:ready / wa:reply)
    socket.join(`user:${socket.data.userId}`);
    socket.join(socket.data.userId);
    maybeJoinAdminRoom(socket);
  }

  socket.on('join', async (userId) => {
    if (!userId) return;
    const id = String(userId);
    socket.data.userId = id;
    socket.join(`user:${id}`);
    socket.join(id);
    await maybeJoinAdminRoom(socket);
  });
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server] unhandled:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await connectDB();
    if (process.env.RESET_DB_ON_START === '1') {
      const allowProd =
        process.env.NODE_ENV !== 'production' ||
        process.env.ALLOW_RESET_DB_IN_PRODUCTION === '1';
      if (!allowProd) {
        console.warn(
          '⚠️  RESET_DB_ON_START=1 ignored in production (set ALLOW_RESET_DB_IN_PRODUCTION=1 to enable).'
        );
      } else {
        await resetDatabase();
        console.warn(
          '⚠️  Database was wiped. Remove RESET_DB_ON_START from env so the next restart does not clear data again.'
        );
      }
    }
    await seedAdminUser();
    await seedPlans();
    startScheduler(io);
    startDirectSendWorker(io);
    const port = Number(process.env.PORT);
    server.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
      if (!process.env.GOOGLE_PLACES_API_KEY) {
        console.warn('GOOGLE_PLACES_API_KEY is not set — scraping will fail until env/logs is populated.');
      }
    });
  } catch (err) {
    console.error('Fatal boot error:', err);
    process.exit(1);
  }
})();

module.exports = { app, server, io };
