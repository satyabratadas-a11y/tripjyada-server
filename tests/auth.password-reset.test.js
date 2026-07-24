jest.mock('../src/utils/email', () => ({
  ...jest.requireActual('../src/utils/email'),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const request = require('supertest');
const { sendPasswordResetEmail } = require('../src/utils/email');
const { app, createUser } = require('./helpers');

beforeEach(() => {
  sendPasswordResetEmail.mockClear();
});

describe('POST /api/auth/forgot-password + /api/auth/reset-password', () => {
  test('requesting a reset emails a token, and that token can set a new password', async () => {
    await createUser({ email: 'reset-me@example.com' });

    const forgotRes = await request(app).post('/api/auth/forgot-password').send({ email: 'reset-me@example.com' });
    expect(forgotRes.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [, token] = sendPasswordResetEmail.mock.calls[0];
    expect(typeof token).toBe('string');

    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'a-brand-new-password' });
    expect(resetRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset-me@example.com', password: 'a-brand-new-password' });
    expect(loginRes.status).toBe(200);
  });

  test('the same token cannot be used twice', async () => {
    await createUser({ email: 'reset-once@example.com' });

    await request(app).post('/api/auth/forgot-password').send({ email: 'reset-once@example.com' });
    const [, token] = sendPasswordResetEmail.mock.calls[0];

    const first = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'first-new-password' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'second-new-password' });
    expect(second.status).toBe(400);
  });

  test('an invalid token is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', newPassword: 'whatever-password' });
    expect(res.status).toBe(400);
  });

  test('requesting a reset for an unknown email still returns a generic success response', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('excessive requests for the same email get rate-limited', async () => {
    await createUser({ email: 'rate-limited@example.com' });

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/auth/forgot-password').send({ email: 'rate-limited@example.com' });
    }
    sendPasswordResetEmail.mockClear();

    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'rate-limited@example.com' });
    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
