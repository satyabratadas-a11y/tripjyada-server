const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

async function makeTask(employee, overrides = {}) {
  return Task.create({
    employee: employee._id,
    date: overrides.date || new Date(),
    dayType: 'working',
    createdBy: 'employee',
    assignedTask: overrides.assignedTask || 'Do the thing',
    memberStatus: overrides.memberStatus || 'not_started',
    adminStatus: overrides.adminStatus || 'pending',
  });
}

describe("GET /api/tasks/today/mine — own live Today's Tasks", () => {
  test('a task marked done stays listed while adminStatus is still pending', async () => {
    const employee = await createUser({ role: 'employee' });
    await makeTask(employee, { memberStatus: 'done', adminStatus: 'pending' });

    const res = await request(app).get('/api/tasks/today/mine').set('Cookie', authCookie(employee));

    expect(res.status).toBe(200);
    const own = res.body.rows.find((r) => String(r.employee.id) === String(employee._id));
    expect(own.tasks).toHaveLength(1);
    expect(own.tasks[0].memberStatus).toBe('done');
  });

  test("a task dated today stays listed even once reviewed — it's still today's work", async () => {
    const employee = await createUser({ role: 'employee' });
    await makeTask(employee, { memberStatus: 'done', adminStatus: 'completed' });

    const res = await request(app).get('/api/tasks/today/mine').set('Cookie', authCookie(employee));

    const own = res.body.rows.find((r) => String(r.employee.id) === String(employee._id));
    expect(own.tasks).toHaveLength(1);
  });

  test('a task marked not_done also stays listed until reviewed', async () => {
    const employee = await createUser({ role: 'employee' });
    await makeTask(employee, { memberStatus: 'not_done', adminStatus: 'pending' });

    const res = await request(app).get('/api/tasks/today/mine').set('Cookie', authCookie(employee));

    const own = res.body.rows.find((r) => String(r.employee.id) === String(employee._id));
    expect(own.tasks).toHaveLength(1);
  });

  test('an on_progress task from an earlier day is still carried forward', async () => {
    const employee = await createUser({ role: 'employee' });
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    await makeTask(employee, { date: lastWeek, memberStatus: 'on_progress', adminStatus: 'pending' });

    const res = await request(app).get('/api/tasks/today/mine').set('Cookie', authCookie(employee));

    const own = res.body.rows.find((r) => String(r.employee.id) === String(employee._id));
    expect(own.tasks).toHaveLength(1);
  });

  test('a reviewed done task from an earlier day does not carry forward', async () => {
    const employee = await createUser({ role: 'employee' });
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    await makeTask(employee, { date: lastWeek, memberStatus: 'done', adminStatus: 'flagged' });

    const res = await request(app).get('/api/tasks/today/mine').set('Cookie', authCookie(employee));

    const own = res.body.rows.find((r) => String(r.employee.id) === String(employee._id));
    expect(own.tasks).toHaveLength(0);
  });
});
