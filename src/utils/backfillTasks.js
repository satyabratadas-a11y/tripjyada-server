const Task = require('../models/Task');
const User = require('../models/User');

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

// A super admin's own tasks used to sit at adminStatus "pending" forever — nobody outranks them
// to review it (see the self-review guard in task.controller.js's adminUpdateTask), so any
// already-reported memberStatus never made it into adminStatus, the field every dashboard/report
// actually rolls up. Now that a super admin's own report doubles as the verified status going
// forward (task.controller.js's selfCertifiedAdminStatus), this one-time pass applies the same
// mapping to what they'd already logged before that changed. Idempotent: once applied, a task no
// longer matches adminStatus:'pending' and is never touched again.
async function backfillSuperAdminSelfCertifiedTasks() {
  const superAdmins = await User.find({ role: 'super_admin' }).select('_id');
  if (superAdmins.length === 0) return;
  const employeeIds = superAdmins.map((u) => u._id);

  const mappings = [
    { memberStatus: 'done', adminStatus: 'completed' },
    { memberStatus: 'not_done', adminStatus: 'incomplete' },
    { memberStatus: 'on_progress', adminStatus: 'on_progress' },
  ];

  for (const { memberStatus, adminStatus } of mappings) {
    const result = await Task.updateMany(
      { employee: { $in: employeeIds }, adminStatus: 'pending', memberStatus },
      { $set: { adminStatus } }
    );
    if (result.modifiedCount > 0) {
      console.log(
        `[migration] self-certified ${result.modifiedCount} super admin task(s) reported "${memberStatus}" as adminStatus "${adminStatus}"`
      );
    }
  }
}

module.exports = backfillLegacyTasks;
module.exports.backfillSuperAdminSelfCertifiedTasks = backfillSuperAdminSelfCertifiedTasks;
