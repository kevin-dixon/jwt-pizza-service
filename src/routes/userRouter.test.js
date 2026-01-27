const request = require('supertest');
const app = require('../service');

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
  const registerRes = await request(app).post('/api/auth').send({
    name: 'update test',
    email: randomName() + '@test.com',
    password: 'password',
  });

  const userId = registerRes.body.user.id;
  const authToken = registerRes.body.token;

  const updatedData = {
    name: 'updated name',
    email: registerRes.body.user.email,
    password: 'newpassword',
  };

  const res = await request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${authToken}`)
    .send(updatedData);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('user');
  expect(res.body.user).toHaveProperty('name', updatedData.name);
  expect(res.body).toHaveProperty('token');
});

test('update user fails without authorization', async () => {
  const registerRes = await request(app).post('/api/auth').send({
    name: 'another user',
    email: randomName() + '@test.com',
    password: 'password',
  });

  const userId = registerRes.body.user.id;

  const updatedData = {
    name: 'hacker',
    email: registerRes.body.user.email,
    password: 'hacked',
  };

  const res = await request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(updatedData);

  expect(res.status).toBe(403);
});
