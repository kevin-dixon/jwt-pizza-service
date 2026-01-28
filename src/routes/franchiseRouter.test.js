const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

async function createTestUser() {
  const testUser = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(testUser);
  return { user: testUser, token: registerRes.body.token };
}

async function createAuthenticatedAdmin() {
  const adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  return { user: adminUser, token: loginRes.body.token };
}

test('get franchises', async () => {
  const res = await request(app).get('/api/franchise');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('franchises');
  expect(Array.isArray(res.body.franchises)).toBe(true);
});

test('create franchise as admin', async () => {
  const { user, token } = await createAuthenticatedAdmin();
  const franchiseName = randomName();
  const franchise = {
    name: franchiseName,
    admins: [{ email: user.email }],
  };

  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send(franchise);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('name', franchiseName);
  expect(res.body).toHaveProperty('id');
});

test('create franchise fails without admin', async () => {
  const { token } = await createTestUser();
  const franchise = {
    name: randomName(),
    admins: [{ email: `${randomName()}@test.com` }],
  };

  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send(franchise);

  expect(res.status).toBe(403);
});

test('get user franchises', async () => {
  const { user, token } = await createAuthenticatedAdmin();
  const franchiseName = randomName();
  const franchise = {
    name: franchiseName,
    admins: [{ email: user.email }],
  };

  await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send(franchise);

  const res = await request(app)
    .get(`/api/franchise/${user.id}`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some(f => f.name === franchiseName)).toBe(true);
});

test('get user franchises requires authentication', async () => {
  const { user } = await createAuthenticatedAdmin();
  const res = await request(app).get(`/api/franchise/${user.id}`);
  expect(res.status).toBe(401);
});

test('get user franchises returns empty for other user', async () => {
  const admin = await createAuthenticatedAdmin();
  const { token: testToken } = await createTestUser();
  
  const res = await request(app)
    .get(`/api/franchise/${admin.user.id}`)
    .set('Authorization', `Bearer ${testToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('create store as franchise admin', async () => {
  const { user, token } = await createAuthenticatedAdmin();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: randomName(), admins: [{ email: user.email }] });

  const res = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: randomName() });

  expect(res.status).toBe(200);
  expect(res.body.id).toBeDefined();
});

test('create store fails without proper authorization', async () => {
  const admin = await createAuthenticatedAdmin();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: randomName(), admins: [{ email: admin.user.email }] });

  const { token: testToken } = await createTestUser();
  const res = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${testToken}`)
    .send({ name: randomName() });

  expect(res.status).toBe(403);
});

test('delete store', async () => {
  const { user, token } = await createAuthenticatedAdmin();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: randomName(), admins: [{ email: user.email }] });

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: randomName() });

  const res = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}/store/${storeRes.body.id}`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('store deleted');
});

test('delete store fails without proper authorization', async () => {
  const admin = await createAuthenticatedAdmin();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: randomName(), admins: [{ email: admin.user.email }] });

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: randomName() });

  const { token: testToken } = await createTestUser();
  const res = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}/store/${storeRes.body.id}`)
    .set('Authorization', `Bearer ${testToken}`);

  expect(res.status).toBe(403);
});

test('delete franchise as admin', async () => {
  const { user, token } = await createAuthenticatedAdmin();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: randomName(), admins: [{ email: user.email }] });

  const res = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
});

test('delete franchise without authentication', async () => {
  const admin = await createAuthenticatedAdmin();
  
  // Create franchise with admin
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: randomName(), admins: [{ email: admin.user.email }] });

  // Try to delete without any authentication token
  const res = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}`);

  expect(res.status).toBe(200);
});