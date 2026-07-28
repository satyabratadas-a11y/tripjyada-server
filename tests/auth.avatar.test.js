const request = require('supertest');
const User = require('../src/models/User');
const { app, createUser, authCookie } = require('./helpers');

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

async function uploadAvatar(user, bytes = JPEG_BYTES, options = {}) {
  return request(app)
    .post('/api/auth/me/avatar')
    .set('Cookie', authCookie(user))
    .attach('avatar', bytes, {
      filename: options.filename || 'avatar.jpg',
      contentType: options.contentType || 'image/jpeg',
    });
}

describe('database-backed profile avatars', () => {
  test('stores binary data in MongoDB and returns a versioned endpoint URL', async () => {
    const user = await createUser({ email: 'avatar@example.com' });

    const res = await uploadAvatar(user);

    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).toMatch(
      new RegExp(`^/api/auth/users/${user._id}/avatar\\?v=\\d+$`)
    );
    expect(res.body.user.avatarUrl).not.toContain('base64');

    const ordinaryUser = await User.findById(user._id).lean();
    expect(ordinaryUser.avatarData).toBeUndefined();
    expect(ordinaryUser.avatarMimeType).toBeUndefined();
    expect(ordinaryUser.avatarUpdatedAt).toBeInstanceOf(Date);

    const storedUser = await User.findById(user._id)
      .select('+avatarData +avatarMimeType');
    expect(Buffer.from(storedUser.avatarData)).toEqual(JPEG_BYTES);
    expect(storedUser.avatarMimeType).toBe('image/jpeg');
    expect(storedUser.avatarUrl).toBe('');
  });

  test('serves the stored bytes only to an authenticated user', async () => {
    const owner = await createUser({ email: 'avatar-owner@example.com' });
    const viewer = await createUser({ email: 'avatar-viewer@example.com' });
    const upload = await uploadAvatar(owner, PNG_BYTES, {
      filename: 'avatar.png',
      contentType: 'image/png',
    });

    const imagePath = upload.body.user.avatarUrl;
    const unauthenticated = await request(app).get(imagePath);
    expect(unauthenticated.status).toBe(401);

    const image = await request(app)
      .get(imagePath)
      .set('Cookie', authCookie(viewer));
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toMatch(/^image\/png/);
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cache-control']).toContain('immutable');
    expect(image.body).toEqual(PNG_BYTES);
  });

  test('replacing an avatar advances its cache version and replaces the bytes', async () => {
    const user = await createUser({ email: 'avatar-replace@example.com' });
    const first = await uploadAvatar(user, JPEG_BYTES);
    const second = await uploadAvatar(user, PNG_BYTES, {
      filename: 'replacement.png',
      contentType: 'image/png',
    });

    expect(second.status).toBe(200);
    expect(second.body.user.avatarUrl).not.toBe(first.body.user.avatarUrl);

    const storedUser = await User.findById(user._id)
      .select('+avatarData +avatarMimeType');
    expect(Buffer.from(storedUser.avatarData)).toEqual(PNG_BYTES);
    expect(storedUser.avatarMimeType).toBe('image/png');
  });

  test('deleting an avatar removes its data and reverts to initials', async () => {
    const user = await createUser({ email: 'avatar-delete@example.com' });
    const upload = await uploadAvatar(user);

    const removed = await request(app)
      .delete('/api/auth/me/avatar')
      .set('Cookie', authCookie(user));
    expect(removed.status).toBe(200);
    expect(removed.body.user.avatarUrl).toBe('');

    const storedUser = await User.findById(user._id)
      .select('+avatarData +avatarMimeType');
    expect(storedUser.avatarData).toBeUndefined();
    expect(storedUser.avatarMimeType).toBeUndefined();
    expect(storedUser.avatarUpdatedAt).toBeNull();

    const oldImage = await request(app)
      .get(upload.body.user.avatarUrl)
      .set('Cookie', authCookie(user));
    expect(oldImage.status).toBe(404);
  });

  test('rejects missing, forged, and oversized files with useful errors', async () => {
    const user = await createUser({ email: 'avatar-invalid@example.com' });

    const missing = await request(app)
      .post('/api/auth/me/avatar')
      .set('Cookie', authCookie(user));
    expect(missing.status).toBe(400);

    const forged = await uploadAvatar(user, Buffer.from('not really a png'), {
      filename: 'fake.png',
      contentType: 'image/png',
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error).toMatch(/valid JPG and PNG/i);

    const oversized = await uploadAvatar(user, Buffer.alloc(5 * 1024 * 1024 + 1, 0xff));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toMatch(/5MB or smaller/i);
  });

  test('a database upload takes precedence over an existing hosted avatar URL', async () => {
    const user = await createUser({ email: 'avatar-priority@example.com' });
    user.avatarUrl = 'https://example.com/google-avatar.jpg';
    await user.save();

    const res = await uploadAvatar(user);

    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).toMatch(/^\/api\/auth\/users\//);
    const stored = await User.findById(user._id);
    expect(stored.avatarUrl).toBe('');
  });
});
