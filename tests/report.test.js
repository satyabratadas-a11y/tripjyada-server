const request = require('supertest');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

describe('GET /api/reports/monthly', () => {
  test("each employee's rollup only counts their own tasks", async () => {
    const viewer = await createUser({ role: 'admin', email: 'report-viewer@example.com' });
    const alice = await createUser({ role: 'employee', name: 'Alice', email: 'alice-r@example.com' });
    const bob = await createUser({ role: 'employee', name: 'Bob', email: 'bob-r@example.com' });

    const now = new Date();
    await Task.create({ employee: alice._id, date: now, dayType: 'working', createdBy: 'admin', adminStatus: 'completed' });
    await Task.create({ employee: bob._id, date: now, dayType: 'working', createdBy: 'admin', adminStatus: 'flagged' });

    const res = await request(app)
      .get(`/api/reports/monthly?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
      .set('Cookie', authCookie(viewer));

    expect(res.status).toBe(200);
    const aliceRow = res.body.rows.find((r) => r.employee.name === 'Alice');
    const bobRow = res.body.rows.find((r) => r.employee.name === 'Bob');
    expect(aliceRow.completed).toBe(1);
    expect(aliceRow.flags).toBe(0);
    expect(bobRow.flags).toBe(1);
    expect(bobRow.completed).toBe(0);
    expect(res.body.team.completed).toBe(1);
    expect(res.body.team.flags).toBe(1);
  });
});
