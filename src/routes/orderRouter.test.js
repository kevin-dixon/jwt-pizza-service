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

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeGreaterThan(0);
});

test('add menu item as admin', async () => {
  const menuItem = {
    title: randomName(),
    description: 'Test pizza',
    image: 'pizza.png',
    price: 0.001,
  };

  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(menuItem);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some((item) => item.title === menuItem.title)).toBe(true);
});

test('add menu item fails without admin', async () => {
  const menuItem = {
    title: randomName(),
    description: 'Test pizza',
    image: 'pizza.png',
    price: 0.001,
  };

  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(menuItem);

  expect(res.status).toBe(403);
});

test('get orders for authenticated user', async () => {
  const res = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('orders');
  expect(Array.isArray(res.body.orders)).toBe(true);
});

test('create order', async () => {
  const franchise = {
    name: randomName(),
    admins: [{ email: adminUser.email }],
  };

  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(franchise);

  const franchiseId = franchiseRes.body.id;

  const store = { name: 'TestStore' };
  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(store);

  const storeId = storeRes.body.id;

  const menuRes = await request(app).get('/api/order/menu');
  const menuItem = menuRes.body[0];

  const order = {
    franchiseId: franchiseId,
    storeId: storeId,
    items: [
      {
        menuId: menuItem.id,
        description: menuItem.title,
        price: menuItem.price,
      },
    ],
  };

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(order);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('order');
  expect(res.body.order).toHaveProperty('id');
});
