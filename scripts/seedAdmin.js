require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

async function run() {
  const name = process.env.ADMIN_NAME || 'Admin';
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  await connectDB();

  let user = await User.findOne({ email });
  if (user) {
    user.role = 'admin';
    user.status = 'active';
    await user.setPassword(password);
    await user.save();
    console.log(`[seed] existing user promoted to active admin: ${email}`);
  } else {
    user = new User({ name, email, role: 'admin', status: 'active', jobTitle: 'Manager' });
    await user.setPassword(password);
    await user.save();
    console.log(`[seed] created admin account: ${email}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
