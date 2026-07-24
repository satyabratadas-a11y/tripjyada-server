const request = require('supertest');
const Task = require('../src/models/Task');
const AuditLog = require('../src/models/AuditLog');
const { app, createUser, authCookie } = require('./helpers');

describe('PATCH /api/tasks/:id/admin — self-review guard', () => {
  test('a super admin cannot review a task they logged for themselves', async () => {
    const superAdmin = await createUser({ role: 'super_admin' });
    const task = await Task.create({
      employee: superAdmin._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Self-logged work',
    });

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/admin`)
      .set('Cookie', authCookie(superAdmin))
      .send({ adminStatus: 'completed' });

    expect(res.status).toBe(403);
    const reloaded = await Task.findById(task._id);
    expect(reloaded.adminStatus).toBe('pending');
  });

  test('a super admin can still review an employee\'s task', async () => {
    const superAdmin = await createUser({ role: 'super_admin' });
    const employee = await createUser({ role: 'employee' });
    const task = await Task.create({
      employee: employee._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Employee work',
    });

    const res = await request(app)
      .patch(`/api/tasks/${task._id}/admin`)
      .set('Cookie', authCookie(superAdmin))
      .send({ adminStatus: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.task.adminStatus).toBe('completed');
  });
});

describe('DELETE /api/tasks/:id — reviewed-task guard and audit trail', () => {
  test('an employee cannot delete their own task once it has been reviewed', async () => {
    const employee = await createUser({ role: 'employee' });
    const task = await Task.create({
      employee: employee._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Reviewed work',
      adminStatus: 'completed',
    });

    const res = await request(app).delete(`/api/tasks/${task._id}`).set('Cookie', authCookie(employee));

    expect(res.status).toBe(403);
    expect(await Task.findById(task._id)).not.toBeNull();
  });

  test('an employee can still delete their own unreviewed task', async () => {
    const employee = await createUser({ role: 'employee' });
    const task = await Task.create({
      employee: employee._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Unreviewed work',
      adminStatus: 'pending',
    });

    const res = await request(app).delete(`/api/tasks/${task._id}`).set('Cookie', authCookie(employee));

    expect(res.status).toBe(204);
    expect(await Task.findById(task._id)).toBeNull();
  });

  test('an employee deleting their own task leaves an audit trail', async () => {
    const employee = await createUser({ role: 'employee' });
    const task = await Task.create({
      employee: employee._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Delete me',
      adminStatus: 'pending',
    });

    await request(app).delete(`/api/tasks/${task._id}`).set('Cookie', authCookie(employee));

    const logs = await AuditLog.find({ action: 'task.deleted', targetId: String(task._id) });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorRole).toBe('employee');
  });
});
