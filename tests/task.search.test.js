const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

describe('GET /api/tasks/search', () => {
  test('finds a task by keyword across employees, case-insensitively', async () => {
    const admin = await createUser({ role: 'admin' });
    const alice = await createUser({ role: 'employee', name: 'Alice', email: 'alice-s@example.com' });
    await Task.create({
      employee: alice._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'admin',
      assignedTask: 'Publish the Chauhan Marble GMB post',
    });
    await Task.create({
      employee: alice._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'admin',
      assignedTask: 'Unrelated task',
    });

    const res = await request(app).get('/api/tasks/search?q=chauhan').set('Cookie', authCookie(admin));

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].employee.name).toBe('Alice');
  });

  test('a plain admin cannot see other admins\' tasks in search results', async () => {
    const viewer = await createUser({ role: 'admin', email: 'search-viewer@example.com' });
    const otherAdmin = await createUser({ role: 'admin', name: 'Other Admin', email: 'other-admin-s@example.com' });
    await Task.create({
      employee: otherAdmin._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Admin-only searchable task',
    });

    const res = await request(app).get('/api/tasks/search?q=searchable').set('Cookie', authCookie(viewer));

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(0);
  });

  test('a super admin sees admin tasks but not other super admins\' tasks', async () => {
    const superAdmin = await createUser({ role: 'super_admin', email: 'search-sa@example.com' });
    const admin = await createUser({ role: 'admin', name: 'Reviewed Admin', email: 'reviewed-admin-s@example.com' });
    const otherSuperAdmin = await createUser({ role: 'super_admin', name: 'Other SA', email: 'other-sa-s@example.com' });
    await Task.create({
      employee: admin._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Findable admin task',
    });
    await Task.create({
      employee: otherSuperAdmin._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Findable super admin task',
    });

    const res = await request(app).get('/api/tasks/search?q=findable').set('Cookie', authCookie(superAdmin));

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].employee.name).toBe('Reviewed Admin');
  });

  test('filters by adminStatus', async () => {
    const admin = await createUser({ role: 'admin' });
    const bob = await createUser({ role: 'employee', name: 'Bob', email: 'bob-s@example.com' });
    await Task.create({
      employee: bob._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'admin',
      assignedTask: 'Flagged one',
      adminStatus: 'flagged',
    });
    await Task.create({
      employee: bob._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'admin',
      assignedTask: 'Pending one',
      adminStatus: 'pending',
    });

    const res = await request(app).get('/api/tasks/search?adminStatus=flagged').set('Cookie', authCookie(admin));

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].assignedTask).toBe('Flagged one');
  });

  test('a search string with regex special characters is treated literally, not as a pattern', async () => {
    const admin = await createUser({ role: 'admin' });
    const bob = await createUser({ role: 'employee', name: 'Bob', email: 'bob-s2@example.com' });
    await Task.create({
      employee: bob._id,
      date: new Date(),
      dayType: 'working',
      createdBy: 'admin',
      assignedTask: 'Fix the a.b(c) config',
    });

    const res = await request(app).get('/api/tasks/search?q=a.b(c)').set('Cookie', authCookie(admin));

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
  });

  test('a non-admin employee cannot use search', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app).get('/api/tasks/search?q=anything').set('Cookie', authCookie(employee));
    expect(res.status).toBe(403);
  });
});
