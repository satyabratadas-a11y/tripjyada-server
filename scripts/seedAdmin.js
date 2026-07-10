require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const { USER_ROLES } = require('../src/utils/roles');

async function run() {
  const name = process.env.ADMIN_NAME || 'Admin';
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const requestedRole = (process.argv[2] || process.env.ADMIN_ROLE || 'admin').trim();

  if (!USER_ROLES.includes(requestedRole)) {
    throw new Error(`ADMIN_ROLE must be one of: ${USER_ROLES.join(', ')}`);
  }

  await connectDB();

  let user = await User.findOne({ email });
  if (user) {
    user.role = requestedRole;
    user.status = 'active';
    await user.setPassword(password);
    await user.save();
    console.log(`[seed] existing user promoted to active ${requestedRole}: ${email}`);
  } else {
    user = new User({
      name,
      email,
      role: requestedRole,
      status: 'active',
      jobTitle: requestedRole === 'super_admin' ? 'Super Admin' : 'Manager',
    });
    await user.setPassword(password);
    await user.save();
    console.log(`[seed] created ${requestedRole} account: ${email}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
