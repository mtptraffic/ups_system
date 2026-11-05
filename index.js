'use strict';
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = Number(process.env.PORT || 3000);
const MAX_UPS = 10;
const OFFLINE_MS = 60000;
const apiKey = process.env.DEVICE_API_KEY;
const dashboardUser = process.env.DASHBOARD_USER;
const dashboardPassword = process.env.DASHBOARD_PASSWORD;
const mongoUri = process.env.MONGODB_URI;

if (!apiKey || !dashboardUser || !dashboardPassword || !mongoUri) {
  console.error('Missing required environment variables: DEVICE_API_KEY, DASHBOARD_USER, DASHBOARD_PASSWORD, MONGODB_URI');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

const latestSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  battery: Number,
  load: Number,
  tem: Number,
  lastSeen: Date
}, { versionKey: false });
const Latest = mongoose.model('Latest', latestSchema);

const devices = Array.from({ length: MAX_UPS }, (_, i) => ({
  id: i + 1, battery: null, load: null, tem: null, lastSeen: null, status: 'Offline'
}));
function snapshot() {
  const now = Date.now();
  return devices.map(d => ({ ...d, status: d.lastSeen && now - new Date(d.lastSeen).getTime() < OFFLINE_MS ? 'Online' : 'Offline' }));
}
function equalSafe(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function requireDashboard(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); } catch (_) {}
    const colon = decoded.indexOf(':');
    if (colon >= 0 && equalSafe(decoded.slice(0, colon), dashboardUser) && equalSafe(decoded.slice(colon + 1), dashboardPassword)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="UPS Dashboard"');
  return res.status(401).send('Authentication required');
}
app.post('/data', async (req, res) => {
  if (!equalSafe(req.get('x-api-key'), apiKey)) return res.status(401).json({ error: 'Unauthorized' });
  const { id, battery, load, tem } = req.body || {};
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1 || numericId > MAX_UPS ||
      typeof battery !== 'number' || !Number.isFinite(battery) ||
      typeof load !== 'number' || !Number.isFinite(load) ||
      (tem !== undefined && tem !== null && (typeof tem !== 'number' || !Number.isFinite(tem)))) {
    return res.status(400).json({ error: 'Expected id 1-10, numeric battery and load, optional numeric tem' });
  }
  const updated = { id: numericId, battery, load, tem: tem ?? null, lastSeen: new Date() };
  try {
    await Latest.updateOne({ id: numericId }, { $set: updated }, { upsert: true });
    Object.assign(devices[numericId - 1], updated);
    io.to('dashboard').emit('updateData', snapshot());
    return res.json({ ok: true });
  } catch (error) {
    console.error('Database write failed:', error.message);
    return res.status(503).json({ error: 'Database unavailable' });
  }
});
app.get('/', requireDashboard, (_req, res) => res.render('index'));
app.get('/api/devices', requireDashboard, (_req, res) => res.json(snapshot()));
app.get('/health', (_req, res) => res.json({ ok: mongoose.connection.readyState === 1 }));

// Socket.IO connections are authenticated using the same browser Basic auth header.
io.engine.use((req, res, next) => requireDashboard(req, res, next));
io.on('connection', socket => {
  socket.join('dashboard');
  socket.emit('updateData', snapshot());
});
setInterval(() => io.to('dashboard').emit('updateData', snapshot()), 10000);

async function start() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  const records = await Latest.find().lean();
  for (const item of records) {
    if (Number.isInteger(item.id) && item.id >= 1 && item.id <= MAX_UPS) {
      Object.assign(devices[item.id - 1], {
        id: item.id, battery: item.battery ?? null, load: item.load ?? null,
        tem: item.tem ?? null, lastSeen: item.lastSeen ?? null
      });
    }
  }
  server.listen(port, '0.0.0.0', () => console.log(`UPS server listening on port ${port}`));
}
start().catch(error => { console.error('Server startup failed:', error.message); process.exit(1); });
