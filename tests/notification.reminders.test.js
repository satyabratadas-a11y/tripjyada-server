const request = require('supertest');
const Task = require('../src/models/Task');
const User = require('../src/models/User');
const { app, createUser, authCookie } = require('./helpers');

// All Tuesday 2026-07-28 IST, chosen and verified to land on a non-Sunday. Freezing only Date
// (via doNotFake) keeps setTimeout/setInterval real so the Mongo driver and supertest's HTTP
// server underneath these requests keep working normally.
const BEFORE_CUTOFF_IST = new Date('2026-07-28T04:00:00.000Z'); // 09:30 IST
const AFTER_CUTOFF_IST = new Date('2026-07-28T07:00:00.000Z'); // 12:30 IST
const SUNDAY_AFTER_CUTOFF_IST = new Date('2026-07-26T07:00:00.000Z'); // Sunday, 12:30 IST
const TODAY_TASK_DATE = new Date('2026-07-28'); // falls inside the IST day for the constants above
const RECENT_TASK_DATE = new Date('2026-07-26'); // within the trailing-3-day window before the 28th
const OLD_ACCOUNT_CREATED_AT = new Date('2026-07-01T00:00:00.000Z'); // well before the 3-day window

function freezeAt(date) {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'hrtime', 'performance'],
  });
  jest.setSystemTime(date);
}

afterEach(() => {
  jest.useRealTimers();
});

describe('task_reminder alert', () => {
  test('does not appear before the 11:30 AM IST cutoff', async () => {
    const employee = await createUser({ role: 'employee' });
    freezeAt(BEFORE_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n) => n.type === 'task_reminder')).toBe(false);
  });

  test('appears after the cutoff when no task was logged for today', async () => {
    const employee = await createUser({ role: 'employee' });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
    const reminder = res.body.notifications.find((n) => n.type === 'task_reminder');
    expect(reminder).toBeDefined();
    expect(reminder.link).toBe('/employee/today');
  });

  test('does not appear once a task has been logged for today', async () => {
    const employee = await createUser({ role: 'employee' });
    await Task.create({
      employee: employee._id, date: TODAY_TASK_DATE, dayType: 'working', createdBy: 'employee', assignedTask: 'Did a thing',
    });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
    expect(res.body.notifications.some((n) => n.type === 'task_reminder')).toBe(false);
  });

  test('is skipped on Sunday even after the cutoff time', async () => {
    const employee = await createUser({ role: 'employee' });
    freezeAt(SUNDAY_AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
    expect(res.body.notifications.some((n) => n.type === 'task_reminder')).toBe(false);
  });

  test('also applies to an admin self-logging their own tasks, with an admin-facing link', async () => {
    const admin = await createUser({ role: 'admin' });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(admin));
    const reminder = res.body.notifications.find((n) => n.type === 'task_reminder');
    expect(reminder).toBeDefined();
    expect(reminder.link).toBe('/admin/my-today');
  });

  test('never appears for a b2b agent, who has no task-logging workflow to remind them about', async () => {
    const agent = await createUser({ role: 'b2b_agent' });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(agent));
    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n) => n.type === 'task_reminder')).toBe(false);
  });
});

describe('task_gap alert', () => {
  test('flags an employee with zero tasks in the last 3 days', async () => {
    const admin = await createUser({ role: 'admin' });
    const employee = await createUser({ role: 'employee', email: 'gap@example.com' });
    await User.updateOne({ _id: employee._id }, { $set: { createdAt: OLD_ACCOUNT_CREATED_AT } }, { overwriteImmutable: true });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(admin));
    const gap = res.body.notifications.find((n) => n.type === 'task_gap');
    expect(gap).toBeDefined();
    expect(gap.message).toContain(employee.name);
  });

  test('does not flag an employee who logged a task within the last 3 days', async () => {
    const admin = await createUser({ role: 'admin' });
    const employee = await createUser({ role: 'employee', email: 'no-gap@example.com' });
    await User.updateOne({ _id: employee._id }, { $set: { createdAt: OLD_ACCOUNT_CREATED_AT } }, { overwriteImmutable: true });
    await Task.create({
      employee: employee._id, date: RECENT_TASK_DATE, dayType: 'working', createdBy: 'employee', assignedTask: 'Logged recently',
    });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(admin));
    expect(res.body.notifications.some((n) => n.type === 'task_gap')).toBe(false);
  });

  test('does not flag an employee whose account is newer than the 3-day window', async () => {
    const admin = await createUser({ role: 'admin' });
    // createUser's createdAt defaults to "now" (frozen below), well inside the window.
    freezeAt(AFTER_CUTOFF_IST);
    const employee = await createUser({ role: 'employee', email: 'brand-new@example.com' });

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(admin));
    expect(res.body.notifications.some((n) => n.type === 'task_gap')).toBe(false);
  });

  test('is not shown to a plain employee (admin-only alert)', async () => {
    const employee = await createUser({ role: 'employee' });
    const otherEmployee = await createUser({ role: 'employee', email: 'other@example.com' });
    await User.updateOne({ _id: otherEmployee._id }, { $set: { createdAt: OLD_ACCOUNT_CREATED_AT } }, { overwriteImmutable: true });
    freezeAt(AFTER_CUTOFF_IST);

    const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
    expect(res.body.notifications.some((n) => n.type === 'task_gap')).toBe(false);
  });
});
