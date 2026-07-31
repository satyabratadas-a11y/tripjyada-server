const request = require('supertest');
const Department = require('../src/models/Department');
const { app, createUser, authCookie } = require('./helpers');

describe('Departments', () => {
  test('requires authentication to list', async () => {
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(401);
  });

  test('any authenticated role can list departments', async () => {
    await Department.create({ name: 'Leads report', order: 1 });
    const employee = await createUser({ role: 'employee' });
    const res = await request(app).get('/api/departments').set('Cookie', authCookie(employee));

    expect(res.status).toBe(200);
    expect(res.body.departments).toHaveLength(1);
    expect(res.body.departments[0].name).toBe('Leads report');
    expect(res.body.departments[0].document).toBeNull();
  });

  test('an employee cannot create a department', async () => {
    const employee = await createUser({ role: 'employee' });
    const res = await request(app)
      .post('/api/departments')
      .set('Cookie', authCookie(employee))
      .send({ name: 'Ad Report' });

    expect(res.status).toBe(403);
  });

  test('an admin can create, update and delete a department', async () => {
    const admin = await createUser({ role: 'admin' });

    const created = await request(app).post('/api/departments').set('Cookie', authCookie(admin)).send({ name: 'Ad Report' });
    expect(created.status).toBe(201);
    const id = created.body.department.id;

    const updated = await request(app)
      .patch(`/api/departments/${id}`)
      .set('Cookie', authCookie(admin))
      .send({ description: 'Weekly ad spend summary' });
    expect(updated.status).toBe(200);
    expect(updated.body.department.description).toBe('Weekly ad spend summary');

    const deleted = await request(app).delete(`/api/departments/${id}`).set('Cookie', authCookie(admin));
    expect(deleted.status).toBe(204);
    expect(await Department.findById(id)).toBeNull();
  });

  test('creating a department requires a name', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await request(app).post('/api/departments').set('Cookie', authCookie(admin)).send({});
    expect(res.status).toBe(400);
  });

  test('an admin can share a department document by link', async () => {
    const admin = await createUser({ role: 'admin' });
    const dept = await Department.create({ name: 'Digital EOD Report', order: 1 });

    const res = await request(app)
      .post(`/api/departments/${dept._id}/document/link`)
      .set('Cookie', authCookie(admin))
      .send({ url: 'https://docs.google.com/spreadsheets/d/example', name: 'Digital EOD Report — May 2026' });

    expect(res.status).toBe(200);
    expect(res.body.department.document).toMatchObject({
      type: 'link',
      url: 'https://docs.google.com/spreadsheets/d/example',
      name: 'Digital EOD Report — May 2026',
    });
  });

  test('setting a document link rejects a non-http(s) value', async () => {
    const admin = await createUser({ role: 'admin' });
    const dept = await Department.create({ name: 'Digital EOD Report', order: 1 });

    const res = await request(app)
      .post(`/api/departments/${dept._id}/document/link`)
      .set('Cookie', authCookie(admin))
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  test('an employee cannot set a document link', async () => {
    const employee = await createUser({ role: 'employee' });
    const dept = await Department.create({ name: 'Digital EOD Report', order: 1 });

    const res = await request(app)
      .post(`/api/departments/${dept._id}/document/link`)
      .set('Cookie', authCookie(employee))
      .send({ url: 'https://docs.google.com/spreadsheets/d/example' });

    expect(res.status).toBe(403);
  });

  test('uploading a file without Cloudinary configured returns 503', async () => {
    const admin = await createUser({ role: 'admin' });
    const dept = await Department.create({ name: 'Ad Report', order: 1 });

    const res = await request(app)
      .post(`/api/departments/${dept._id}/document/upload`)
      .set('Cookie', authCookie(admin))
      .attach('file', Buffer.from('col1,col2\n1,2'), 'report.csv');

    expect(res.status).toBe(503);
  });

  test('an admin can remove a department document', async () => {
    const admin = await createUser({ role: 'admin' });
    const dept = await Department.create({
      name: 'Ad Report',
      order: 1,
      document: { type: 'link', url: 'https://example.com/sheet', name: 'Ad Report' },
    });

    const res = await request(app).delete(`/api/departments/${dept._id}/document`).set('Cookie', authCookie(admin));
    expect(res.status).toBe(200);
    expect(res.body.department.document).toBeNull();
  });
});
