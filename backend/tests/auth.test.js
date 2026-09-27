const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { IDS, resetDatabase, disconnect, login, bearer, createOrder, orderAction, getStock } = require('./setup');

beforeEach(resetDatabase);
afterAll(disconnect);

describe('login', () => {
  test('correct credentials return a token and the user (never the password hash)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@erp.com', password: 'Admin@123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({ id: IDS.admin, name: 'Admin', role: 'ADMIN' });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  test('wrong password and unknown email both give 401 with the same message', async () => {
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'admin@erp.com', password: 'nope' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'ghost@erp.com', password: 'nope' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
  });

  test('a missing password is rejected by validation with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@erp.com' });

    expect(res.status).toBe(400);
  });
});

describe('401: no valid token', () => {
  test('protected routes reject a request without a token', async () => {
    for (const url of ['/api/auth/me', '/api/products', '/api/customers', '/api/enquiries', '/api/quotations', '/api/sales-orders']) {
      const res = await request(app).get(url);
      expect([url, res.status]).toEqual([url, 401]);
    }
  });

  test('a garbage token, a token signed with another secret and an expired token are all rejected', async () => {
    const wrongSecret = jwt.sign({ id: IDS.admin, role: 'ADMIN' }, 'some-other-secret');
    const expired = jwt.sign({ id: IDS.admin, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: -10 });

    for (const token of ['garbage', wrongSecret, expired]) {
      const res = await request(app).get('/api/auth/me').set(bearer(token));
      expect(res.status).toBe(401);
    }
  });

  test('a valid token opens /api/auth/me', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(await login('SALES')));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: IDS.sales, name: 'Sales', email: 'sales@erp.com', role: 'SALES' });
  });
});

describe('403: SALES cannot do ADMIN actions', () => {
  test('SALES cannot confirm, dispatch or cancel an order, and the order is not touched', async () => {
    const order = await createOrder([{ product_id: IDS.widget, quantity: 10 }]);
    const sales = bearer(await login('SALES'));

    const confirm = await request(app).post(`/api/sales-orders/${order.id}/confirm`).set(sales);
    const dispatch = await request(app).post(`/api/sales-orders/${order.id}/dispatch`).set(sales).send({ vehicle_no: 'MH12', driver_name: 'Ravi' });
    const cancel = await request(app).post(`/api/sales-orders/${order.id}/cancel`).set(sales);

    expect([confirm.status, dispatch.status, cancel.status]).toEqual([403, 403, 403]);
    const after = await request(app).get(`/api/sales-orders/${order.id}`).set(sales);
    expect(after.body.status).toBe('PENDING');
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 0 });
  });

  test('SALES cannot change stock, ADMIN can', async () => {
    const asSales = await request(app).patch(`/api/inventory/${IDS.widget}`).set(bearer(await login('SALES'))).send({ physical_qty: 500 });
    const asAdmin = await request(app).patch(`/api/inventory/${IDS.widget}`).set(bearer(await login('ADMIN'))).send({ physical_qty: 500 });

    expect(asSales.status).toBe(403);
    expect(asAdmin.status).toBe(200);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 500, reserved_qty: 0 });
  });

  test('ADMIN can confirm the same kind of order that SALES was refused', async () => {
    const order = await createOrder([{ product_id: IDS.widget, quantity: 10 }]);

    const res = await orderAction(order.id, 'confirm');

    expect(res.status).toBe(200);
  });
});
