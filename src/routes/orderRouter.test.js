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

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('add menu item as admin', async () => {
  const { token } = await createAuthenticatedAdmin();
  const menuItem = { title: randomName(), description: 'Test pizza', image: 'pizza.png', price: 0.001 };

  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${token}`)
    .send(menuItem);

  expect(res.status).toBe(200);
  expect(res.body.some((item) => item.title === menuItem.title)).toBe(true);
});

test('add menu item fails without admin', async () => {
  const { token } = await createTestUser();
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: randomName(), description: 'Test pizza', image: 'pizza.png', price: 0.001 });

  expect(res.status).toBe(403);
});

test('get orders for authenticated user', async () => {
  const { token } = await createTestUser();
  const res = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body.orders).toBeDefined();
});

test('get orders requires authentication', async () => {
  const res = await request(app).get('/api/order');
  expect(res.status).toBe(401);
});

test('create order', async () => {
  const admin = await createAuthenticatedAdmin();
  const testUser = await createTestUser();

  // Create menu item
  const menuItem = { title: randomName(), description: 'Test pizza', image: 'pizza.png', price: 0.001 };
  await request(app).put('/api/order/menu').set('Authorization', `Bearer ${admin.token}`).send(menuItem);
  const menuRes = await request(app).get('/api/order/menu');
  const createdMenuItem = menuRes.body.find(item => item.title === menuItem.title);

  // Create franchise and store
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: randomName(), admins: [{ email: admin.user.email }] });

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseRes.body.id}/store`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: randomName() });

  // Create order
  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${testUser.token}`)
    .send({
      franchiseId: franchiseRes.body.id,
      storeId: storeRes.body.id,
      items: [{ menuId: createdMenuItem.id, description: createdMenuItem.title, price: createdMenuItem.price }],
    });

  expect(res.status).toBe(200);
  expect(res.body.order).toBeDefined();
  expect(res.body.order.id).toBeDefined();
});
