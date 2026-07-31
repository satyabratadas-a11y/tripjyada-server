require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Department = require('../src/models/Department');

const DEPARTMENTS = [
  'Team overview sales Report',
  'Leads report',
  'Digital EOD Report',
  'Kolkata Branch Sales',
  'Digital Update',
  'Ad Report',
  'Daily sales Report',
];

async function run() {
  await connectDB();

  let order = 1;
  for (const name of DEPARTMENTS) {
    const existing = await Department.findOne({ name });
    if (existing) {
      console.log(`[seed] department already exists, skipping: ${name}`);
    } else {
      await Department.create({ name, order });
      console.log(`[seed] created department: ${name}`);
    }
    order += 1;
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
