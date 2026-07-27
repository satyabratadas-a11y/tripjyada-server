const request = require('supertest');
const Project = require('../src/models/Project');
const Task = require('../src/models/Task');
const AuditLog = require('../src/models/AuditLog');
const { app, createUser, authCookie } = require('./helpers');

function dateStr(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('Projects', () => {
  describe('creation', () => {
    test('an employee can self-create a project', async () => {
      const employee = await createUser({ role: 'employee' });
      const res = await request(app)
        .post('/api/projects/self')
        .set('Cookie', authCookie(employee))
        .send({ title: 'Website revamp', startDate: dateStr(0), endDate: dateStr(10) });

      expect(res.status).toBe(201);
      expect(res.body.project.createdBy).toBe('employee');
      expect(res.body.project.status).toBe('active');
    });

    test('an admin can assign a project to an employee', async () => {
      const admin = await createUser({ role: 'admin' });
      const employee = await createUser({ role: 'employee', email: 'assignee@example.com' });
      const res = await request(app)
        .post('/api/projects')
        .set('Cookie', authCookie(admin))
        .send({ employeeId: employee._id.toString(), title: 'Ad campaign', startDate: dateStr(0), endDate: dateStr(5) });

      expect(res.status).toBe(201);
      expect(res.body.project.createdBy).toBe('admin');

      const audit = await AuditLog.findOne({ action: 'project.assigned' });
      expect(audit).not.toBeNull();
    });

    test('an admin cannot assign a project to another admin', async () => {
      const admin = await createUser({ role: 'admin' });
      const otherAdmin = await createUser({ role: 'admin', email: 'other-admin@example.com' });
      const res = await request(app)
        .post('/api/projects')
        .set('Cookie', authCookie(admin))
        .send({ employeeId: otherAdmin._id.toString(), title: 'Nope', startDate: dateStr(0), endDate: dateStr(5) });

      expect(res.status).toBe(404);
    });

    test('endDate before startDate is rejected', async () => {
      const employee = await createUser({ role: 'employee' });
      const res = await request(app)
        .post('/api/projects/self')
        .set('Cookie', authCookie(employee))
        .send({ title: 'Backwards', startDate: dateStr(5), endDate: dateStr(0) });

      expect(res.status).toBe(400);
    });
  });

  describe('visibility', () => {
    test('a plain admin cannot see another admin\'s projects in the review list', async () => {
      const viewer = await createUser({ role: 'admin', email: 'viewer@example.com' });
      const otherAdmin = await createUser({ role: 'admin', email: 'hidden-admin@example.com' });
      await Project.create({ employee: otherAdmin._id, title: 'Hidden', startDate: new Date(), endDate: new Date(), createdBy: 'employee' });

      const res = await request(app).get('/api/projects/review').set('Cookie', authCookie(viewer));
      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(0);
    });

    test('a super admin sees admin-owned projects but not other super admins\' in the review list', async () => {
      const superAdmin = await createUser({ role: 'super_admin', email: 'sa@example.com' });
      const admin = await createUser({ role: 'admin', email: 'visible-admin@example.com' });
      const otherSuperAdmin = await createUser({ role: 'super_admin', email: 'other-sa@example.com' });
      await Project.create({ employee: admin._id, title: 'Visible', startDate: new Date(), endDate: new Date(), createdBy: 'employee' });
      await Project.create({ employee: otherSuperAdmin._id, title: 'Not visible', startDate: new Date(), endDate: new Date(), createdBy: 'employee' });

      const res = await request(app).get('/api/projects/review').set('Cookie', authCookie(superAdmin));
      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(1);
      expect(res.body.projects[0].title).toBe('Visible');
    });
  });

  describe('review and rank rules', () => {
    test('an owner cannot set reviewerNotes on their own project (self-review is structurally impossible)', async () => {
      const superAdmin = await createUser({ role: 'super_admin', email: 'sa-self@example.com' });
      const project = await Project.create({
        employee: superAdmin._id, title: 'Self project', startDate: new Date(), endDate: new Date(), createdBy: 'employee',
      });

      const res = await request(app)
        .patch(`/api/projects/${project._id}`)
        .set('Cookie', authCookie(superAdmin))
        .send({ reviewerNotes: 'trying to review myself', status: 'completed' });

      expect(res.status).toBe(200);
      const saved = await Project.findById(project._id);
      expect(saved.reviewerNotes).toBe('');
      expect(saved.status).toBe('completed'); // status IS an owner-editable field for a self-created project
    });

    test('an admin can review an employee\'s project (sets reviewerNotes)', async () => {
      const admin = await createUser({ role: 'admin' });
      const employee = await createUser({ role: 'employee', email: 'reviewed@example.com' });
      const project = await Project.create({
        employee: employee._id, title: 'Reviewed', startDate: new Date(), endDate: new Date(), createdBy: 'employee',
      });

      const res = await request(app)
        .patch(`/api/projects/${project._id}`)
        .set('Cookie', authCookie(admin))
        .send({ reviewerNotes: 'good progress', status: 'completed' });

      expect(res.status).toBe(200);
      expect(res.body.project.reviewerNotes).toBe('good progress');
      expect(res.body.project.status).toBe('completed');
    });

    test('a plain admin cannot update another admin\'s project; a super admin can', async () => {
      const plainAdmin = await createUser({ role: 'admin', email: 'plain@example.com' });
      const superAdmin = await createUser({ role: 'super_admin', email: 'sa-update@example.com' });
      const projectOwner = await createUser({ role: 'admin', email: 'owner-admin@example.com' });
      const project = await Project.create({
        employee: projectOwner._id, title: 'Admin project', startDate: new Date(), endDate: new Date(), createdBy: 'employee',
      });

      const blocked = await request(app)
        .patch(`/api/projects/${project._id}`)
        .set('Cookie', authCookie(plainAdmin))
        .send({ reviewerNotes: 'nope' });
      expect(blocked.status).toBe(403);

      const allowed = await request(app)
        .patch(`/api/projects/${project._id}`)
        .set('Cookie', authCookie(superAdmin))
        .send({ reviewerNotes: 'ok' });
      expect(allowed.status).toBe(200);
    });
  });

  describe('deletion', () => {
    test('an owner cannot delete a project assigned by an admin', async () => {
      const employee = await createUser({ role: 'employee' });
      const project = await Project.create({
        employee: employee._id, title: 'Assigned', startDate: new Date(), endDate: new Date(), createdBy: 'admin',
      });

      const res = await request(app).delete(`/api/projects/${project._id}`).set('Cookie', authCookie(employee));
      expect(res.status).toBe(403);
    });

    test('an owner can delete their own self-created project, and it unlinks (not deletes) its tasks', async () => {
      const employee = await createUser({ role: 'employee' });
      const project = await Project.create({
        employee: employee._id, title: 'Mine', startDate: new Date(), endDate: new Date(), createdBy: 'employee',
      });
      const task = await Task.create({
        employee: employee._id, date: new Date(), dayType: 'working', createdBy: 'employee', assignedTask: 'Did a thing', project: project._id,
      });

      const res = await request(app).delete(`/api/projects/${project._id}`).set('Cookie', authCookie(employee));
      expect(res.status).toBe(204);

      expect(await Project.findById(project._id)).toBeNull();
      const survivingTask = await Task.findById(task._id);
      expect(survivingTask).not.toBeNull();
      expect(survivingTask.project).toBeNull();

      const audit = await AuditLog.findOne({ action: 'project.deleted', targetId: String(project._id) });
      expect(audit).not.toBeNull();
    });
  });

  describe('linking a daily task to a project', () => {
    test('an employee can log a task entry against their own project, visible via getProject', async () => {
      const employee = await createUser({ role: 'employee' });
      const project = await Project.create({
        employee: employee._id, title: 'Tracked', startDate: new Date(), endDate: new Date(), createdBy: 'employee',
      });

      const createRes = await request(app)
        .post('/api/tasks/self')
        .set('Cookie', authCookie(employee))
        .send({ date: dateStr(0), assignedTask: 'Day 1 progress', project: project._id.toString() });
      expect(createRes.status).toBe(201);
      expect(createRes.body.task.project).toBe(String(project._id));

      const getRes = await request(app).get(`/api/projects/${project._id}`).set('Cookie', authCookie(employee));
      expect(getRes.status).toBe(200);
      expect(getRes.body.tasks).toHaveLength(1);
      expect(getRes.body.tasks[0].assignedTask).toBe('Day 1 progress');
    });

    test('an employee cannot link a task to a project they do not own', async () => {
      const employee = await createUser({ role: 'employee' });
      const otherEmployee = await createUser({ role: 'employee', email: 'other-owner@example.com' });
      const project = await Project.create({
        employee: otherEmployee._id, title: 'Not theirs', startDate: new Date(), endDate: new Date(), createdBy: 'employee',
      });

      const res = await request(app)
        .post('/api/tasks/self')
        .set('Cookie', authCookie(employee))
        .send({ date: dateStr(0), assignedTask: 'Sneaky', project: project._id.toString() });

      expect(res.status).toBe(404);
    });

    test('an admin assigning a task must pair the project with the same employee', async () => {
      const admin = await createUser({ role: 'admin' });
      const employee = await createUser({ role: 'employee', email: 'pairing@example.com' });
      const otherEmployee = await createUser({ role: 'employee', email: 'mismatch@example.com' });
      const project = await Project.create({
        employee: otherEmployee._id, title: 'Wrong owner', startDate: new Date(), endDate: new Date(), createdBy: 'admin',
      });

      const res = await request(app)
        .post('/api/tasks')
        .set('Cookie', authCookie(admin))
        .send({ employeeId: employee._id.toString(), date: dateStr(0), assignedTask: 'Mismatched', project: project._id.toString() });

      expect(res.status).toBe(404);
    });
  });

  describe('overdue notifications', () => {
    test('an employee sees a project_overdue alert for their own overdue project, but not a completed one', async () => {
      const employee = await createUser({ role: 'employee' });
      const overdue = await Project.create({
        employee: employee._id, title: 'Late', startDate: dateStr(-10), endDate: dateStr(-2), createdBy: 'employee', status: 'active',
      });
      await Project.create({
        employee: employee._id, title: 'Finished late', startDate: dateStr(-10), endDate: dateStr(-2), createdBy: 'employee', status: 'completed',
      });

      const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
      expect(res.status).toBe(200);
      const projectAlerts = res.body.notifications.filter((n) => n.type === 'project_overdue');
      expect(projectAlerts).toHaveLength(1);
      expect(projectAlerts[0].id).toBe(`project-overdue-${overdue._id}`);
    });

    test('a project due today is not yet overdue', async () => {
      const employee = await createUser({ role: 'employee' });
      await Project.create({
        employee: employee._id, title: 'Due today', startDate: dateStr(-3), endDate: dateStr(0), createdBy: 'employee',
      });

      const res = await request(app).get('/api/notifications').set('Cookie', authCookie(employee));
      expect(res.body.notifications.filter((n) => n.type === 'project_overdue')).toHaveLength(0);
    });

    test('an admin sees an overdue alert for a visible employee\'s project', async () => {
      const admin = await createUser({ role: 'admin' });
      const employee = await createUser({ role: 'employee', email: 'watched@example.com' });
      await Project.create({
        employee: employee._id, title: 'Employee is late', startDate: dateStr(-10), endDate: dateStr(-2), createdBy: 'employee',
      });

      const res = await request(app).get('/api/notifications').set('Cookie', authCookie(admin));
      const projectAlerts = res.body.notifications.filter((n) => n.type === 'project_overdue');
      expect(projectAlerts).toHaveLength(1);
      expect(projectAlerts[0].message).toContain('Employee is late');
    });
  });
});
