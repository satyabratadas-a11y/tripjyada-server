const Task = require('../models/Task');

async function backfillLegacyTasks() {
  const filter = {
    $or: [{ createdBy: { $exists: false } }, { createdBy: null }, { createdBy: '' }],
  };

  const result = await Task.updateMany(filter, { $set: { createdBy: 'admin' } });
  if (result.modifiedCount > 0) {
    console.log(
      `[migration] backfilled createdBy on ${result.modifiedCount} legacy task(s) with default "admin"`
    );
  }
}

module.exports = backfillLegacyTasks;
