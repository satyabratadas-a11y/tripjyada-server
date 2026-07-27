const request = require('supertest');
const { app, createUser } = require('./helpers');

describe('POST /api/auth/forgot-password', () => {
  test('a matching email and phone resets the password immediately', async () => {
    await createUser({ email: 'reset-me@example.com', phone: '5551234567' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'reset-me@example.com', phone: '5551234567', newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset-me@example.com', password: 'a-brand-new-password' });
    expect(loginRes.status).toBe(200);
  });

  test('a phone number that does not match the account is rejected', async () => {
    await createUser({ email: 'wrong-phone@example.com', phone: '5551234567' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'wrong-phone@example.com', phone: '5559999999', newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(401);
  });

  test('an unknown email is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com', phone: '5551234567', newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(401);
  });

  test('an account with no phone on file cannot be reset this way', async () => {
    await createUser({ email: 'no-phone@example.com' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'no-phone@example.com', phone: '5551234567', newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(401);
  });

  test('missing fields are rejected', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'reset-me@example.com' });
    expect(res.status).toBe(400);
  });

  test('a short new password is rejected', async () => {
    await createUser({ email: 'short-pw@example.com', phone: '5551234567' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'short-pw@example.com', phone: '5551234567', newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});
