const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

async function makeTask(employee, overrides = {}) {
  return Task.create({
    employee: employee._id,
    date: new Date(),
    dayType: 'working',
    createdBy: 'employee',
    assignedTask: 'Self-added work',
    memberStatus: 'on_progress',
    ...overrides,
  });
}

describe('PATCH /api/tasks/bulk/employee', () => {
  test('marks every task in the batch with the given memberStatus', async () => {
    const alice = await createUser({ role: 'employee', name: 'Alice', email: 'alice-be@example.com' });
    const t1 = await makeTask(alice);
    const t2 = await makeTask(alice);

    const res = await request(app)
      .patch('/api/tasks/bulk/employee')
      .set('Cookie', authCookie(alice))
      .send({ taskIds: [String(t1._id), String(t2._id)], memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(2);
    expect(res.body.skipped).toHaveLength(0);
    expect(res.body.updated.every((t) => t.memberStatus === 'done')).toBe(true);

    const reloaded = await Task.findById(t1._id);
    expect(reloaded.memberStatus).toBe('done');
  });

  test('works on an admin-assigned task too, since memberStatus is always the owner\'s to set', async () => {
    const bob = await createUser({ role: 'employee', name: 'Bob', email: 'bob-be@example.com' });
    const assigned = await makeTask(bob, { createdBy: 'admin', memberStatus: 'not_started' });

    const res = await request(app)
      .patch('/api/tasks/bulk/employee')
      .set('Cookie', authCookie(bob))
      .send({ taskIds: [String(assigned._id)], memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(1);
  });

  test("skips (but doesn't fail) a task belonging to someone else", async () => {
    const alice = await createUser({ role: 'employee', name: 'Alice2', email: 'alice2-be@example.com' });
    const carl = await createUser({ role: 'employee', name: 'Carl', email: 'carl-be@example.com' });
    const ownTask = await makeTask(alice);
    const othersTask = await makeTask(carl);

    const res = await request(app)
      .patch('/api/tasks/bulk/employee')
      .set('Cookie', authCookie(alice))
      .send({ taskIds: [String(ownTask._id), String(othersTask._id)], memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(1);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].id).toBe(String(othersTask._id));

    const reloadedOthers = await Task.findById(othersTask._id);
    expect(reloadedOthers.memberStatus).toBe('on_progress');
  });

  test('rejects an invalid memberStatus value', async () => {
    const alice = await createUser({ role: 'employee', email: 'dana-be@example.com' });
    const task = await makeTask(alice);

    const res = await request(app)
      .patch('/api/tasks/bulk/employee')
      .set('Cookie', authCookie(alice))
      .send({ taskIds: [String(task._id)], memberStatus: 'not-a-real-status' });

    expect(res.status).toBe(400);
  });

  test('rejects an empty taskIds array', async () => {
    const alice = await createUser({ role: 'employee', email: 'erin-be@example.com' });

    const res = await request(app)
      .patch('/api/tasks/bulk/employee')
      .set('Cookie', authCookie(alice))
      .send({ taskIds: [], memberStatus: 'done' });

    expect(res.status).toBe(400);
  });
});
