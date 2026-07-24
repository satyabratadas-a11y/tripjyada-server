const app = require('../src/app');
const User = require('../src/models/User');
const { signToken, COOKIE_NAME } = require('../src/utils/token');

let employeeCounter = 0;

async function createUser(overrides = {}) {
  const n = ++employeeCounter;
  const user = new User({
    name: overrides.name || `User ${n}`,
    email: overrides.email || `user${n}@example.com`,
    employeeCode: overrides.employeeCode || `T${n}`,
    role: overrides.role || 'employee',
    jobTitle: overrides.jobTitle || 'Tester',
    status: overrides.status || 'active',
  });
  await user.setPassword('password123');
  await user.save();
  return user;
}

function authCookie(user) {
  return `${COOKIE_NAME}=${signToken(user)}`;
}

module.exports = { app, createUser, authCookie };
