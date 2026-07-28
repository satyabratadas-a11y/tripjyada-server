const request = require('supertest');
const Notification = require('../src/models/Notification');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const { app, createUser, authCookie } = require('./helpers');

function dateStr(daysFromNow) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

describe('notification actors', () => {
  test('hydrates a persisted actor and preserves it when marking the notification read', async () => {
    const recipient = await createUser({ email: 'notification-recipient@example.com' });
    const actor = await createUser({ email: 'notification-actor@example.com', name: 'Profile Person' });
    actor.avatarData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    actor.avatarMimeType = 'image/jpeg';
    actor.avatarUpdatedAt = new Date('2026-07-28T10:00:00.000Z');
    await actor.save();
    const expectedAvatarUrl = `/api/auth/users/${actor._id}/avatar?v=${actor.avatarUpdatedAt.getTime()}`;

    const notification = await Notification.create({
      user: recipient._id,
      actor: actor._id,
      type: 'comment',
      message: `${actor.name} commented on your content`,
      link: '/content',
    });

    const list = await request(app)
      .get('/api/notifications')
      .set('Cookie', authCookie(recipient));
    expect(list.status).toBe(200);
    const item = list.body.notifications.find((n) => n.id === String(notification._id));
    expect(item.actor).toEqual({
      id: String(actor._id),
      name: actor.name,
      avatarUrl: expectedAvatarUrl,
    });

    const marked = await request(app)
      .patch(`/api/notifications/${notification._id}/read`)
      .set('Cookie', authCookie(recipient));
    expect(marked.status).toBe(200);
    expect(marked.body.notification.read).toBe(true);
    expect(marked.body.notification.actor).toEqual(item.actor);
  });

  test('returns null for an old notification without an actor', async () => {
    const recipient = await createUser({ email: 'legacy-notification@example.com' });
    const notification = await Notification.create({
      user: recipient._id,
      type: 'due_soon',
      message: 'Legacy notification',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', authCookie(recipient));
    const item = res.body.notifications.find((n) => n.id === String(notification._id));
    expect(item.actor).toBeNull();
  });

  test('uses the employee profile for admin task and overdue project alerts', async () => {
    const admin = await createUser({ role: 'admin', email: 'notification-admin@example.com' });
    const employee = await createUser({
      role: 'employee',
      email: 'notification-employee@example.com',
      name: 'Visible Employee',
    });
    employee.avatarUrl = 'https://example.com/employee.jpg';
    await employee.save();

    const task = await Task.create({
      employee: employee._id,
      date: dateStr(-1),
      dayType: 'working',
      createdBy: 'employee',
      assignedTask: 'Needs review',
      adminStatus: 'pending',
    });
    const project = await Project.create({
      employee: employee._id,
      title: 'Overdue work',
      startDate: dateStr(-10),
      endDate: dateStr(-2),
      createdBy: 'employee',
      status: 'active',
    });

    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', authCookie(admin));
    expect(res.status).toBe(200);

    const taskAlert = res.body.notifications.find((n) => n.id === `task-pending-${task._id}`);
    const projectAlert = res.body.notifications.find((n) => n.id === `project-overdue-${project._id}`);
    expect(taskAlert.actor).toEqual({
      id: String(employee._id),
      name: employee.name,
      avatarUrl: employee.avatarUrl,
    });
    expect(projectAlert.actor).toEqual(taskAlert.actor);
  });

  test('records the assigning admin as the actor of a project notification', async () => {
    const admin = await createUser({ role: 'admin', email: 'assigning-admin@example.com' });
    const employee = await createUser({ role: 'employee', email: 'assigned-employee@example.com' });

    const created = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie(admin))
      .send({
        employeeId: String(employee._id),
        title: 'Actor-aware assignment',
        startDate: dateStr(0),
        endDate: dateStr(5),
      });
    expect(created.status).toBe(201);

    const stored = await Notification.findOne({ user: employee._id, type: 'assigned' });
    expect(String(stored.actor)).toBe(String(admin._id));

    const list = await request(app)
      .get('/api/notifications')
      .set('Cookie', authCookie(employee));
    const item = list.body.notifications.find((n) => n.id === String(stored._id));
    expect(item.actor.id).toBe(String(admin._id));
    expect(item.actor.name).toBe(admin.name);
  });
});
