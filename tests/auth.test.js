const request = require('supertest');
const { app, createUser } = require('./helpers');

describe('POST /api/auth/signup', () => {
  test('creates a pending account and does not log the user in', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: 'New Hire',
      email: 'newhire@example.com',
      password: 'password123',
      employeeCode: 'T999',
      phone: '1234567890',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('pending');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('rejects a duplicate email', async () => {
    await createUser({ email: 'dupe@example.com' });

    const res = await request(app).post('/api/auth/signup').send({
      name: 'Dupe',
      email: 'dupe@example.com',
      password: 'password123',
      employeeCode: 'T998',
      phone: '1234567890',
    });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  test('logs an active user in and sets the auth cookie', async () => {
    await createUser({ email: 'active@example.com', status: 'active' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'active@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^token=/);
  });

  test('rejects a pending account even with the right password', async () => {
    await createUser({ email: 'pending@example.com', status: 'pending' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pending@example.com', password: 'password123' });

    expect(res.status).toBe(403);
  });

  test('rejects the wrong password with a generic error', async () => {
    await createUser({ email: 'wrongpw@example.com', status: 'active' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpw@example.com', password: 'nope-not-it' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});
