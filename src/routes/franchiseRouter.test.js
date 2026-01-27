const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

let testUser;
let testUserAuthToken;
let adminUser;
let adminAuthToken;

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

beforeAll(async () => {
  testUser = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;

  adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  adminAuthToken = loginRes.body.token;
});

test('get franchises', async () => {
  const res = await request(app).get('/api/franchise');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('franchises');
  expect(Array.isArray(res.body.franchises)).toBe(true);
});

test('create franchise as admin', async () => {
  const franchiseName = randomName();
  const franchise = {
    name: franchiseName,
    admins: [{ email: adminUser.email }],
  };

  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('name', franchiseName);
  expect(res.body).toHaveProperty('id');
});

test('create franchise fails without admin', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: testUser.email }],
  };

  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(franchise);

  expect(res.status).toBe(403);
});

test('get user franchises', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const res = await request(app)
    .get(`/api/franchise/${adminUser.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('create store as franchise admin', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const franchiseId = createRes.body.id;
  const store = { name: 'SLC' };

  const res = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(store);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('name', 'SLC');
  expect(res.body).toHaveProperty('id');
});

test('create store fails without proper authorization', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const franchiseId = createRes.body.id;
  const store = { name: 'Provo' };

  const res = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(store);

  expect(res.status).toBe(403);
});

test('delete store', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const createFranchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const franchiseId = createFranchiseRes.body.id;
  const store = { name: 'Orem' };

  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(store);

  const storeId = createStoreRes.body.id;

  const res = await request(app)
    .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('message', 'store deleted');
});

test('delete franchise', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const franchiseId = createRes.body.id;

  const res = await request(app).delete(`/api/franchise/${franchiseId}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('message', 'franchise deleted');
});
