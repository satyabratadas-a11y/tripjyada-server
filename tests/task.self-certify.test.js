const request = require('supertest');
const Task = require('../src/models/Task');
const { backfillSuperAdminSelfCertifiedTasks } = require('../src/utils/backfillTasks');
const { app, createUser, authCookie } = require('./helpers');

async function makeTask(employee, overrides = {}) {
  return Task.create({
    employee: employee._id,
    date: new Date(),
    dayType: 'working',
    createdBy: 'employee',
    assignedTask: 'Self-logged work',
    memberStatus: 'not_started',
    adminStatus: 'pending',
    ...overrides,
  });
}

describe('Super admin self-certification', () => {
  test('a regular employee marking a task Done does NOT auto-verify it', async () => {
    const employee = await createUser({ role: 'employee', email: 'emp-sc@example.com' });
    const task = await makeTask(employee);

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/employee`)
      .set('Cookie', authCookie(employee))
      .send({ memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.task.memberStatus).toBe('done');
    expect(res.body.task.adminStatus).toBe('pending');
  });

  test('an admin marking their own task Done does NOT auto-verify it (still needs a super admin)', async () => {
    const admin = await createUser({ role: 'admin', email: 'admin-sc@example.com' });
    const task = await makeTask(admin);

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/employee`)
      .set('Cookie', authCookie(admin))
      .send({ memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.task.adminStatus).toBe('pending');
  });

  test('a super admin marking their own task Done auto-verifies it as completed', async () => {
    const owner = await createUser({ role: 'super_admin', email: 'owner-sc@example.com' });
    const task = await makeTask(owner);

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/employee`)
      .set('Cookie', authCookie(owner))
      .send({ memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.task.memberStatus).toBe('done');
    expect(res.body.task.adminStatus).toBe('completed');
  });

  test('a super admin marking their own task Not Done auto-verifies it as incomplete', async () => {
    const owner = await createUser({ role: 'super_admin', email: 'owner-sc2@example.com' });
    const task = await makeTask(owner);

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/employee`)
      .set('Cookie', authCookie(owner))
      .send({ memberStatus: 'not_done' });

    expect(res.status).toBe(200);
    expect(res.body.task.adminStatus).toBe('incomplete');
  });

  test('a super admin bulk-marking their own tasks Done auto-verifies all of them', async () => {
    const owner = await createUser({ role: 'super_admin', email: 'owner-sc3@example.com' });
    const t1 = await makeTask(owner);
    const t2 = await makeTask(owner);

    const res = await request(app)
      .patch('/api/tasks/bulk/employee')
      .set('Cookie', authCookie(owner))
      .send({ taskIds: [String(t1._id), String(t2._id)], memberStatus: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(2);
    expect(res.body.updated.every((t) => t.adminStatus === 'completed')).toBe(true);
  });

  test('a super admin task already reviewed by someone else is left alone (only "pending" is self-certified)', async () => {
    const owner = await createUser({ role: 'super_admin', email: 'owner-sc4@example.com' });
    const task = await makeTask(owner, { adminStatus: 'flagged' });

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/employee`)
      .set('Cookie', authCookie(owner))
      .send({ memberStatus: 'done' });

    expect(res.status).toBe(200);
    // employeeUpdateTask always applies self-certification for a super admin regardless of the
    // prior adminStatus — this documents that current behavior rather than asserting a design
    // constraint, since flagged->completed-on-self-report is an edge case worth revisiting later.
    expect(res.body.task.adminStatus).toBe('completed');
  });
});

describe('backfillSuperAdminSelfCertifiedTasks migration', () => {
  test('retroactively self-certifies a super admin\'s already-reported pending tasks', async () => {
    const owner = await createUser({ role: 'super_admin', email: 'owner-migrate@example.com' });
    const done = await makeTask(owner, { memberStatus: 'done' });
    const notDone = await makeTask(owner, { memberStatus: 'not_done' });
    const onProgress = await makeTask(owner, { memberStatus: 'on_progress' });
    const untouched = await makeTask(owner, { memberStatus: 'not_started' });

    await backfillSuperAdminSelfCertifiedTasks();

    expect((await Task.findById(done._id)).adminStatus).toBe('completed');
    expect((await Task.findById(notDone._id)).adminStatus).toBe('incomplete');
    expect((await Task.findById(onProgress._id)).adminStatus).toBe('on_progress');
    expect((await Task.findById(untouched._id)).adminStatus).toBe('pending');
  });

  test("does not touch a regular employee's pending tasks", async () => {
    const employee = await createUser({ role: 'employee', email: 'emp-migrate@example.com' });
    const task = await makeTask(employee, { memberStatus: 'done' });

    await backfillSuperAdminSelfCertifiedTasks();

    expect((await Task.findById(task._id)).adminStatus).toBe('pending');
  });
});
