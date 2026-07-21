const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const taskRoutes = require('./routes/task.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const reportRoutes = require('./routes/report.routes');
const clientRoutes = require('./routes/client.routes');
const notificationRoutes = require('./routes/notification.routes');
const contactRoutes = require('./routes/contact.routes');

const app = express();

// CLIENT_ORIGIN may be a comma-separated list (e.g. "http://localhost:3000,http://192.168.1.6:3000")
// so the same dev server accepts requests from both a desktop browser and a phone on the LAN
// (needed to test camera-based features, which desktops often can't).
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000').split(',').map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Every response here is per-user and session-dependent, so nothing under /api should ever be
// cached — a CDN, corporate proxy, or the browser itself caching a stale response (an old 404
// from mid-deploy, or worse, one user's task data) is a correctness bug, not a performance win.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/content/clients', clientRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/contacts', contactRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
