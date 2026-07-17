const mongoose = require('mongoose');

// Never log the raw URI — it carries the DB password in plaintext, and this line was found doing
// exactly that in Hostinger's stored logs.
function redactUri(uri) {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
}

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/task_tracker';
  await mongoose.connect(uri);
  console.log(`[db] connected: ${redactUri(uri)}`);
}

module.exports = connectDB;
