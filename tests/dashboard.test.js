const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

describe('GET /api/dashboard', () => {
  test('a super admin viewer sees employees and admins, but not other super admins', async () => {
    const viewer = await createUser({ role: 'super_admin', email: 'viewer@example.com' });
    await createUser({ role: 'employee', name: 'Riya', email: 'riya@example.com' });
    await createUser({ role: 'admin', name: 'Aditi', email: 'aditi@example.com' });
    await createUser({ role: 'super_admin', name: 'Other Super Admin', email: 'other-sa@example.com' });

    const now = new Date();
    const res = await request(app)
      .get(`/api/dashboard?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
      .set('Cookie', authCookie(viewer));

    expect(res.status).toBe(200);
    const roles = res.body.rows.map((r) => r.employee.role);
    expect(roles).toContain('employee');
    expect(roles).toContain('admin');
    expect(roles).not.toContain('super_admin');
  });

  test('a plain admin viewer only sees employees', async () => {
    const viewer = await createUser({ role: 'admin', email: 'admin-viewer@example.com' });
    await createUser({ role: 'employee', name: 'Riya', email: 'riya2@example.com' });
    await createUser({ role: 'admin', name: 'Aditi', email: 'aditi2@example.com' });

    const now = new Date();
    const res = await request(app)
      .get(`/api/dashboard?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
      .set('Cookie', authCookie(viewer));

    expect(res.status).toBe(200);
    const roles = res.body.rows.map((r) => r.employee.role);
    expect(roles).toEqual(['employee']);
  });

  test("each member's rollup only counts their own tasks, not a teammate's", async () => {
    const viewer = await createUser({ role: 'admin', email: 'rollup-viewer@example.com' });
    const alice = await createUser({ role: 'employee', name: 'Alice', email: 'alice@example.com' });
    const bob = await createUser({ role: 'employee', name: 'Bob', email: 'bob@example.com' });

    const now = new Date();
    await Task.create({
      employee: alice._id,
      date: now,
      dayType: 'working',
      createdBy: 'admin',
      adminStatus: 'completed',
    });
    await Task.create({
      employee: bob._id,
      date: now,
      dayType: 'working',
      createdBy: 'admin',
      adminStatus: 'flagged',
    });

    const res = await request(app)
      .get(`/api/dashboard?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
      .set('Cookie', authCookie(viewer));

    const aliceRow = res.body.rows.find((r) => r.employee.id === String(alice._id));
    const bobRow = res.body.rows.find((r) => r.employee.id === String(bob._id));
    expect(aliceRow.completed).toBe(1);
    expect(aliceRow.flags).toBe(0);
    expect(bobRow.flags).toBe(1);
    expect(bobRow.completed).toBe(0);
  });
});
