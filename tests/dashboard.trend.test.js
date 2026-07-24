const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

describe('GET /api/dashboard/trend', () => {
  test('returns one point per month, most recent last, with correct rollups', async () => {
    const viewer = await createUser({ role: 'admin' });
    const employee = await createUser({ role: 'employee', email: 'trend-emp@example.com' });

    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    await Task.create({
      employee: employee._id,
      date: lastMonth,
      dayType: 'working',
      createdBy: 'admin',
      adminStatus: 'completed',
    });
    await Task.create({
      employee: employee._id,
      date: now,
      dayType: 'working',
      createdBy: 'admin',
      adminStatus: 'flagged',
    });

    const res = await request(app)
      .get(`/api/dashboard/trend?employeeId=${employee._id}&months=3`)
      .set('Cookie', authCookie(viewer));

    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(3);
    expect(res.body.points[2].completed + res.body.points[2].flags).toBeGreaterThanOrEqual(0);
    const thisMonthPoint = res.body.points[res.body.points.length - 1];
    expect(thisMonthPoint.year).toBe(now.getUTCFullYear());
    expect(thisMonthPoint.month).toBe(now.getUTCMonth() + 1);
    expect(thisMonthPoint.flags).toBe(1);
    const lastMonthPoint = res.body.points[res.body.points.length - 2];
    expect(lastMonthPoint.completed).toBe(1);
  });

  test('an employee can view their own trend', async () => {
    const employee = await createUser({ role: 'employee', email: 'trend-self@example.com' });

    const res = await request(app)
      .get(`/api/dashboard/trend?employeeId=${employee._id}&months=2`)
      .set('Cookie', authCookie(employee));

    expect(res.status).toBe(200);
  });

  test("an employee cannot view a coworker's trend", async () => {
    const employee = await createUser({ role: 'employee', email: 'trend-a@example.com' });
    const coworker = await createUser({ role: 'employee', email: 'trend-b@example.com' });

    const res = await request(app)
      .get(`/api/dashboard/trend?employeeId=${coworker._id}`)
      .set('Cookie', authCookie(employee));

    expect(res.status).toBe(403);
  });

  test("a plain admin cannot view another admin's trend", async () => {
    const admin = await createUser({ role: 'admin', email: 'trend-admin-viewer@example.com' });
    const otherAdmin = await createUser({ role: 'admin', email: 'trend-admin-target@example.com' });

    const res = await request(app)
      .get(`/api/dashboard/trend?employeeId=${otherAdmin._id}`)
      .set('Cookie', authCookie(admin));

    expect(res.status).toBe(403);
  });

  test("a super admin can view an admin's trend", async () => {
    const superAdmin = await createUser({ role: 'super_admin', email: 'trend-sa@example.com' });
    const admin = await createUser({ role: 'admin', email: 'trend-admin-target2@example.com' });

    const res = await request(app)
      .get(`/api/dashboard/trend?employeeId=${admin._id}`)
      .set('Cookie', authCookie(superAdmin));

    expect(res.status).toBe(200);
  });
});
