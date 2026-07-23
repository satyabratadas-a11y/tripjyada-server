require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const Task = require('./models/Task');
const AuditLog = require('./models/AuditLog');
const backfillLegacyTasks = require('./utils/backfillTasks');
const { isSheetsEnabled, missingSheetsEnvVars } = require('./utils/googleSheets');

const PORT = process.env.PORT || 4000;

// Hostinger's Node.js hosting kills and restarts the process if it doesn't call listen() within
// a few seconds of boot. This chain used to run before listen() — connecting to Atlas, syncing
// indexes, and backfilling legacy tasks — and on Hostinger's network that occasionally crossed
// the healthcheck window, so the deploy got marked failed even though the app was fine a moment
// later. Mongoose queues queries until the connection is ready (bufferCommands, on by default),
// so it's safe to start accepting HTTP traffic immediately and finish connecting in the background.
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));

connectDB()
  .then(() => Promise.all([Task.syncIndexes(), AuditLog.syncIndexes()]))
  .then(() => backfillLegacyTasks())
  .then(() => {
    // The B2B contact -> Sheets sync fails silently per-request (a save must never break because
    // Sheets is unreachable), so this is the one place that's actually visible in server logs —
    // otherwise a missing/renamed env var on the host looks identical to "everything is fine".
    if (isSheetsEnabled()) {
      console.log('[sheets] Google Sheets contact sync is enabled');
    } else {
      console.log(`[sheets] Google Sheets contact sync is disabled — missing env var(s): ${missingSheetsEnvVars().join(', ')}`);
    }
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
