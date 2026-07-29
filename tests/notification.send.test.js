const request = require('supertest');
const Notification = require('../src/models/Notification');
const { app, createUser, authCookie } = require('./helpers');

describe('GET /api/notifications/recipients', () => {
  test('lists every active user of any role except the caller', async () => {
    const employee = await createUser({ role: 'employee', email: 'recipients-employee@example.com' });
    const admin = await createUser({ role: 'admin', email: 'recipients-admin@example.com' });
    const superAdmin = await createUser({ role: 'super_admin', email: 'recipients-super@example.com' });
    const agent = await createUser({ role: 'b2b_agent', email: 'recipients-agent@example.com' });
    const pending = await createUser({ role: 'employee', email: 'recipients-pending@example.com', status: 'pending' });

    const res = await request(app).get('/api/notifications/recipients').set('Cookie', authCookie(employee));

    expect(res.status).toBe(200);
    const ids = res.body.users.map((u) => u.id);
    expect(ids).not.toContain(String(employee._id));
    expect(ids).toContain(String(admin._id));
    expect(ids).toContain(String(superAdmin._id));
    expect(ids).toContain(String(agent._id));
    expect(ids).not.toContain(String(pending._id));
  });
});

describe('POST /api/notifications/send', () => {
  test('lets a plain employee push a notification to an admin, unrestricted by role', async () => {
    const employee = await createUser({ role: 'employee', email: 'sender-employee@example.com', name: 'Sender Employee' });
    const admin = await createUser({ role: 'admin', email: 'recipient-admin@example.com' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(employee))
      .send({ message: 'Heads up, admin!', userIds: [String(admin._id)] });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);

    const stored = await Notification.findOne({ user: admin._id, type: 'direct' });
    expect(stored).not.toBeNull();
    expect(stored.message).toBe('Heads up, admin!');
    expect(String(stored.actor)).toBe(String(employee._id));

    const inbox = await request(app).get('/api/notifications').set('Cookie', authCookie(admin));
    const item = inbox.body.notifications.find((n) => n.id === String(stored._id));
    expect(item.actor).toEqual({ id: String(employee._id), name: employee.name, avatarUrl: '' });
  });

  test('lets a b2b agent notify multiple recipients across roles in one call', async () => {
    const agent = await createUser({ role: 'b2b_agent', email: 'sender-agent@example.com' });
    const employee = await createUser({ role: 'employee', email: 'bulk-employee@example.com' });
    const superAdmin = await createUser({ role: 'super_admin', email: 'bulk-super@example.com' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(agent))
      .send({ message: 'Broadcast to a few people', userIds: [String(employee._id), String(superAdmin._id)] });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);

    const count = await Notification.countDocuments({ type: 'direct', actor: agent._id });
    expect(count).toBe(2);
  });

  test('rejects an empty message', async () => {
    const sender = await createUser({ email: 'empty-message-sender@example.com' });
    const recipient = await createUser({ email: 'empty-message-recipient@example.com' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(sender))
      .send({ message: '   ', userIds: [String(recipient._id)] });

    expect(res.status).toBe(400);
  });

  test('rejects a message over the length limit', async () => {
    const sender = await createUser({ email: 'long-message-sender@example.com' });
    const recipient = await createUser({ email: 'long-message-recipient@example.com' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(sender))
      .send({ message: 'x'.repeat(501), userIds: [String(recipient._id)] });

    expect(res.status).toBe(400);
  });

  test('rejects a request with no recipients', async () => {
    const sender = await createUser({ email: 'no-recipients-sender@example.com' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(sender))
      .send({ message: 'Anyone there?', userIds: [] });

    expect(res.status).toBe(400);
  });

  test('cannot target yourself, and a self-only request is rejected', async () => {
    const sender = await createUser({ email: 'self-send@example.com' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(sender))
      .send({ message: 'Note to self', userIds: [String(sender._id)] });

    expect(res.status).toBe(400);
  });

  test('ignores a pending (not yet approved) recipient', async () => {
    const sender = await createUser({ email: 'pending-target-sender@example.com' });
    const pending = await createUser({ email: 'pending-target@example.com', status: 'pending' });

    const res = await request(app)
      .post('/api/notifications/send')
      .set('Cookie', authCookie(sender))
      .send({ message: 'Are you there?', userIds: [String(pending._id)] });

    expect(res.status).toBe(400);
  });
});
