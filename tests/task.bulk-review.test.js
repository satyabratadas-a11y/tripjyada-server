const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

async function makeTask(employee, overrides = {}) {
  return Task.create({
    employee: employee._id,
    date: new Date(),
    dayType: 'working',
    createdBy: 'admin',
    assignedTask: 'Bulk-reviewable work',
    adminStatus: 'pending',
    ...overrides,
  });
}

describe('PATCH /api/tasks/bulk/admin', () => {
  test('reviews every task in the batch and returns them updated', async () => {
    const admin = await createUser({ role: 'admin' });
    const alice = await createUser({ role: 'employee', name: 'Alice', email: 'alice-b@example.com' });
    const bob = await createUser({ role: 'employee', name: 'Bob', email: 'bob-b@example.com' });
    const t1 = await makeTask(alice);
    const t2 = await makeTask(bob);

    const res = await request(app)
      .patch('/api/tasks/bulk/admin')
      .set('Cookie', authCookie(admin))
      .send({ taskIds: [String(t1._id), String(t2._id)], adminStatus: 'completed', reviewerNotes: 'Looks good' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(2);
    expect(res.body.skipped).toHaveLength(0);
    expect(res.body.updated.every((t) => t.adminStatus === 'completed')).toBe(true);

    const reloaded = await Task.findById(t1._id);
    expect(reloaded.adminStatus).toBe('completed');
    expect(reloaded.reviewerNotes).toBe('Looks good');
  });

  test("skips (but doesn't fail) a task the caller isn't allowed to review, like their own", async () => {
    const admin = await createUser({ role: 'admin' });
    const employeeTask = await makeTask(await createUser({ role: 'employee', name: 'Carl', email: 'carl-b@example.com' }));
    const ownTask = await makeTask(admin, { createdBy: 'employee' });

    const res = await request(app)
      .patch('/api/tasks/bulk/admin')
      .set('Cookie', authCookie(admin))
      .send({ taskIds: [String(employeeTask._id), String(ownTask._id)], adminStatus: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(1);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].id).toBe(String(ownTask._id));

    const reloadedOwn = await Task.findById(ownTask._id);
    expect(reloadedOwn.adminStatus).toBe('pending');
  });

  test('rejects an invalid adminStatus value', async () => {
    const admin = await createUser({ role: 'admin' });
    const employee = await createUser({ role: 'employee', email: 'dana-b@example.com' });
    const task = await makeTask(employee);

    const res = await request(app)
      .patch('/api/tasks/bulk/admin')
      .set('Cookie', authCookie(admin))
      .send({ taskIds: [String(task._id)], adminStatus: 'not-a-real-status' });

    expect(res.status).toBe(400);
  });
});
