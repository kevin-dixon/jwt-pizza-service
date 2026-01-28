const request = require('supertest');
const app = require('../service');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

let testUser;
let testUserAuthToken;

beforeAll(async () => {
  testUser = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
});

test('get current user', async () => {
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('name', testUser.name);
  expect(res.body).toHaveProperty('email', testUser.email);
  expect(res.body).toHaveProperty('roles');
});

test('update user', async () => {
  const newUser = { name: 'update test', email: randomName() + '@test.com', password: 'password' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  const userId = registerRes.body.user.id;
  const authToken = registerRes.body.token;

  const res = await request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${authToken}`)
    .send({ email: newUser.email, name: 'updated name', password: 'newpassword' });

  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe('updated name');
  expect(res.body.token).toBeDefined();

  // Verify can login with new password
  const loginRes = await request(app).put('/api/auth').send({ email: newUser.email, password: 'newpassword' });
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.user.name).toBe('updated name');
});

test('get current user requires authentication', async () => {
  const res = await request(app).get('/api/user/me');
  expect(res.status).toBe(401);
});

test('update user fails without authorization', async () => {
  const otherUser = await request(app).post('/api/auth').send({
    name: 'another user',
    email: randomName() + '@test.com',
    password: 'password',
  });

  const res = await request(app)
    .put(`/api/user/${otherUser.body.user.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ email: otherUser.body.user.email, name: 'hacker', password: 'hacked' });

  expect(res.status).toBe(403);
});

test('update user requires authentication', async () => {
  const res = await request(app)
    .put('/api/user/999')
    .send({ email: 'test@test.com', name: 'test', password: 'test' });
  expect(res.status).toBe(401);
});
