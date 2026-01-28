const request = require('supertest');
const app = require('../service');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('register fails with missing fields', async () => {
  const res = await request(app).post('/api/auth').send({ name: 'test', email: 'test@test.com' });
  expect(res.status).toBe(400);
});

test('login fails with invalid credentials', async () => {
  const res = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrongpassword' });
  expect(res.status).toBe(404);
});

test('login fails with unknown email', async () => {
  const res = await request(app).put('/api/auth').send({ email: 'unknown@test.com', password: 'password' });
  expect(res.status).toBe(404);
});

test('logout', async () => {
  const res = await request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('logout successful');
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}