const request = require('supertest');
const Attendance = require('../src/models/Attendance');
const { startOfDayIST } = require('../src/utils/istTime');
const { app, createUser, authCookie } = require('./helpers');

describe('POST /api/attendance/checkin', () => {
  test('records loginAt on first check-in of the day', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(employee)).send({});

    expect(res.status).toBe(200);
    expect(res.body.attendance.employee).toBe(String(employee._id));
    expect(res.body.attendance.loginAt).toBeTruthy();
    expect(new Date(res.body.attendance.date).getTime()).toBe(startOfDayIST().getTime());
    expect(res.body.attendance.locationStatus).toBe('unavailable');
  });

  test('stores a captured location when coordinates are provided', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app)
      .post('/api/attendance/checkin')
      .set('Cookie', authCookie(employee))
      .send({ lat: 12.34, lng: 56.78, accuracy: 25 });

    expect(res.status).toBe(200);
    expect(res.body.attendance.lat).toBe(12.34);
    expect(res.body.attendance.lng).toBe(56.78);
    expect(res.body.attendance.accuracy).toBe(25);
    expect(res.body.attendance.locationStatus).toBe('captured');
  });

  test('records a denied/unsupported status when no coordinates are given', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(employee)).send({ status: 'denied' });

    expect(res.status).toBe(200);
    expect(res.body.attendance.locationStatus).toBe('denied');
  });

  test('rejects an unrecognized status value', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(employee)).send({ status: 'somewhere' });
    expect(res.status).toBe(400);
  });

  test('a second check-in the same day keeps the original loginAt but can still add location', async () => {
    const employee = await createUser({ role: 'employee' });
    const first = await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(employee)).send({ status: 'unavailable' });
    const second = await request(app)
      .post('/api/attendance/checkin')
      .set('Cookie', authCookie(employee))
      .send({ lat: 1, lng: 2 });

    expect(second.body.attendance.loginAt).toBe(first.body.attendance.loginAt);
    expect(second.body.attendance.locationStatus).toBe('captured');

    const count = await Attendance.countDocuments({ employee: employee._id });
    expect(count).toBe(1);
  });
});

describe('automatic attendance during authentication', () => {
  test('records attendance during a successful password login', async () => {
    const employee = await createUser({ email: 'login-attendance@example.com' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'password123' });

    expect(res.status).toBe(200);
    const attendance = await Attendance.findOne({ employee: employee._id, date: startOfDayIST() });
    expect(attendance).not.toBeNull();
    expect(attendance.loginAt).toBeTruthy();
  });

  test('records attendance when an existing session is restored', async () => {
    const employee = await createUser({ email: 'session-attendance@example.com' });

    const res = await request(app).get('/api/auth/me').set('Cookie', authCookie(employee));

    expect(res.status).toBe(200);
    const attendance = await Attendance.findOne({ employee: employee._id, date: startOfDayIST() });
    expect(attendance).not.toBeNull();
    expect(attendance.loginAt).toBeTruthy();
  });
});

describe('GET /api/attendance/today', () => {
  test('is forbidden for a plain employee', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app).get('/api/attendance/today').set('Cookie', authCookie(employee));
    expect(res.status).toBe(403);
  });

  test('lists every visible employee, including one who has not checked in today', async () => {
    const admin = await createUser({ role: 'admin' });
    const checkedIn = await createUser({ role: 'employee', email: 'checked-in@example.com' });
    const notCheckedIn = await createUser({ role: 'employee', email: 'not-checked-in@example.com' });
    await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(checkedIn)).send({ lat: 10, lng: 20 });

    const res = await request(app).get('/api/attendance/today').set('Cookie', authCookie(admin));
    expect(res.status).toBe(200);

    const rowFor = (id) => res.body.rows.find((r) => r.employee.id === String(id));
    expect(rowFor(checkedIn._id).checkedIn).toBe(true);
    expect(rowFor(checkedIn._id).lat).toBe(10);
    expect(rowFor(notCheckedIn._id).checkedIn).toBe(false);
    expect(rowFor(notCheckedIn._id).loginAt).toBeNull();
  });

  test('admins see their own attendance without gaining access to peer admins', async () => {
    const plainAdmin = await createUser({ role: 'admin' });
    const superAdmin = await createUser({ role: 'super_admin', email: 'sa@example.com' });
    const otherAdmin = await createUser({ role: 'admin', email: 'other-admin@example.com' });
    await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(plainAdmin)).send({});
    await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(superAdmin)).send({});
    await request(app).post('/api/attendance/checkin').set('Cookie', authCookie(otherAdmin)).send({});

    const asPlainAdmin = await request(app).get('/api/attendance/today').set('Cookie', authCookie(plainAdmin));
    expect(asPlainAdmin.body.rows.some((r) => r.employee.id === String(plainAdmin._id))).toBe(true);
    expect(asPlainAdmin.body.rows.some((r) => r.employee.id === String(otherAdmin._id))).toBe(false);

    const asSuperAdmin = await request(app).get('/api/attendance/today').set('Cookie', authCookie(superAdmin));
    expect(asSuperAdmin.body.rows.some((r) => r.employee.id === String(superAdmin._id))).toBe(true);
    expect(asSuperAdmin.body.rows.some((r) => r.employee.id === String(otherAdmin._id))).toBe(true);
  });
});
