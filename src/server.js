require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const Task = require('./models/Task');
const AuditLog = require('./models/AuditLog');
const backfillLegacyTasks = require('./utils/backfillTasks');
const { isSheetsEnabled, missingSheetsEnvVars } = require('./utils/googleSheets');

const PORT = process.env.PORT || 4000;

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
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
