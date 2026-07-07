require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const Task = require('./models/Task');
const AuditLog = require('./models/AuditLog');
const backfillLegacyTasks = require('./utils/backfillTasks');

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => Promise.all([Task.syncIndexes(), AuditLog.syncIndexes()]))
  .then(() => backfillLegacyTasks())
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
