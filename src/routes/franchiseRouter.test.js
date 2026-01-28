const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

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
  const franchiseName = randomName();
  const franchise = {
    name: franchiseName,
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
  expect(res.body.some(f => f.name === franchiseName)).toBe(true);
});

test('create store as franchise admin', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const res = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: 'SLC' });

  expect(res.status).toBe(200);
  expect(res.body.name).toBe('SLC');
  expect(res.body.id).toBeDefined();
});

test('create store fails without proper authorization', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const res = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: 'Provo' });

  expect(res.status).toBe(403);
});

test('delete store', async () => {
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName(), admins: [{ email: adminUser.email }] });

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: 'Orem' });

  const res = await request(app)
    .delete(`/api/franchise/${franchiseRes.body.id}/store/${storeRes.body.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('store deleted');
});

test('delete franchise', async () => {
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName(), admins: [{ email: adminUser.email }] });

  const res = await request(app).delete(`/api/franchise/${franchiseRes.body.id}`);

  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
});
