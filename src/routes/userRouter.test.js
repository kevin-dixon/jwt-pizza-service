const request = require('supertest');
const app = require('../service');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createTestUser() {
  const testUser = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(testUser);
  return { user: testUser, token: registerRes.body.token, id: registerRes.body.user.id };
}

test('get current user', async () => {
  const { user, token } = await createTestUser();
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('name', user.name);
  expect(res.body).toHaveProperty('email', user.email);
  expect(res.body).toHaveProperty('roles');
});

test('update user', async () => {
  const newUser = { name: 'update test', email: randomName() + '@test.com', password: 'password' };
  const registerRes = await request(app).post('/api/auth').send(newUser);

  const res = await request(app)
    .put(`/api/user/${registerRes.body.user.id}`)
    .set('Authorization', `Bearer ${registerRes.body.token}`)
    .send({ email: newUser.email, name: 'updated name', password: 'newpassword' });

  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe('updated name');
  expect(res.body.token).toBeDefined();
});

test('get current user requires authentication', async () => {
  const res = await request(app).get('/api/user/me');
  expect(res.status).toBe(401);
});

test('update user fails without authorization', async () => {
  const otherUser = await createTestUser();
  const currentUser = await createTestUser();

  const res = await request(app)
    .put(`/api/user/${otherUser.id}`)
    .set('Authorization', `Bearer ${currentUser.token}`)
    .send({ email: otherUser.user.email, name: 'hacker', password: 'hacked' });

  expect(res.status).toBe(403);
});

test('update user requires authentication', async () => {
  const res = await request(app)
    .put('/api/user/999')
    .send({ email: 'test@test.com', name: 'test', password: 'test' });
  expect(res.status).toBe(401);
});

test('list users requires authentication', async () => {
  const res = await request(app).get('/api/user');
  expect(res.status).toBe(401);
});

test('list users requires admin role', async () => {
  const diner = await createTestUser();
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${diner.token}`);

  expect(res.status).toBe(403);
});

test('list users returns paged, filtered users for admin', async () => {
  const suffix = randomName();
  await request(app).post('/api/auth').send({ name: `filter-${suffix}`, email: `${suffix}@test.com`, password: 'a' });
  await request(app).post('/api/auth').send({ name: `other-${suffix}`, email: `other-${suffix}@test.com`, password: 'a' });

  const adminLogin = await request(app).put('/api/auth').send({ email: 'a@jwt.com', password: 'admin' });
  const res = await request(app)
    .get(`/api/user?page=0&limit=10&name=*${suffix}*`)
    .set('Authorization', `Bearer ${adminLogin.body.token}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(typeof res.body.more).toBe('boolean');
  expect(res.body.users.length).toBeGreaterThanOrEqual(1);
  expect(res.body.users.some((u) => (u.name || '').includes(suffix))).toBe(true);
  expect(Array.isArray(res.body.users[0].roles)).toBe(true);
});

test('delete user requires authentication', async () => {
  const target = await createTestUser();
  const res = await request(app).delete(`/api/user/${target.id}`);
  expect(res.status).toBe(401);
});

test('delete user requires admin role', async () => {
  const target = await createTestUser();
  const diner = await createTestUser();

  const res = await request(app)
    .delete(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${diner.token}`);

  expect(res.status).toBe(403);
});

test('admin can delete user', async () => {
  const target = await createTestUser();
  const adminLogin = await request(app).put('/api/auth').send({ email: 'a@jwt.com', password: 'admin' });

  const deleteRes = await request(app)
    .delete(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${adminLogin.body.token}`);

  expect(deleteRes.status).toBe(200);

  const loginRes = await request(app).put('/api/auth').send({ email: target.user.email, password: target.user.password });
  expect(loginRes.status).toBe(404);
});
