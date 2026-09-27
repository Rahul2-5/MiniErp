const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');
const { getAvailable } = require('../src/services/product.service');
const { IDS, resetDatabase, disconnect, login, bearer, createOrder, orderAction, getStock } = require('./setup');

beforeEach(resetDatabase);
afterAll(disconnect);

const widgets = (quantity) => [{ product_id: IDS.widget, quantity }];
const truck = { vehicle_no: 'MH12AB1234', driver_name: 'Ramesh' };

describe('available quantity', () => {
  test('getAvailable is physical minus reserved', () => {
    expect(getAvailable({ physical_qty: 100, reserved_qty: 30 })).toBe(70);
  });

  test('GET /api/products shows available_qty computed from the stored numbers', async () => {
    const order = await createOrder(widgets(30));
    await orderAction(order.id, 'confirm');

    const res = await request(app).get('/api/products').set(bearer(await login('SALES')));

    const widget = res.body.find((product) => product.code === 'WIDGET');
    expect(widget.inventory).toMatchObject({ physical_qty: 100, reserved_qty: 30, available_qty: 70 });
    const stored = await prisma.inventory.findUnique({ where: { product_id: IDS.widget } });
    expect(stored).not.toHaveProperty('available_qty');
  });
});

describe('confirm reserves stock', () => {
  test('reserved goes up, physical does not change', async () => {
    const order = await createOrder(widgets(30));

    const res = await orderAction(order.id, 'confirm');

    expect(res.status).toBe(200);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 30 });
  });

  test('cannot reserve more than available: 400 with a clear message, inventory and order unchanged', async () => {
    const order = await createOrder([{ product_id: IDS.gadget, quantity: 11 }]); // only 10 in stock

    const res = await orderAction(order.id, 'confirm');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient stock for GADGET: required 11, available 10');
    expect(await getStock(IDS.gadget)).toEqual({ physical_qty: 10, reserved_qty: 0 });
    expect((await prisma.salesOrder.findUnique({ where: { id: order.id } })).status).toBe('PENDING');
  });

  test('available already reserved by another order counts: 100 in stock, 80 reserved, 30 more is refused', async () => {
    const first = await createOrder(widgets(80));
    const second = await createOrder(widgets(30));
    await orderAction(first.id, 'confirm');

    const res = await orderAction(second.id, 'confirm');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient stock for WIDGET: required 30, available 20');
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 80 });
  });

  test('reserving exactly what is available works', async () => {
    const order = await createOrder(widgets(100));

    expect((await orderAction(order.id, 'confirm')).status).toBe(200);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 100 });
  });

  test('if one line is short nothing is reserved for the other lines either (rollback)', async () => {
    const order = await createOrder([{ product_id: IDS.widget, quantity: 10 }, { product_id: IDS.gadget, quantity: 11 }]);

    const res = await orderAction(order.id, 'confirm');

    expect(res.status).toBe(400);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 0 });
    expect((await prisma.salesOrder.findUnique({ where: { id: order.id } })).status).toBe('PENDING');
  });
});

describe('dispatch and cancel change stock', () => {
  test('dispatch lowers BOTH physical and reserved', async () => {
    const order = await createOrder(widgets(30));
    await orderAction(order.id, 'confirm');

    const res = await orderAction(order.id, 'dispatch', truck);

    expect(res.status).toBe(200);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 70, reserved_qty: 0 });
  });

  test('cancelling a CONFIRMED order releases exactly its reserved quantity', async () => {
    const first = await createOrder(widgets(30));
    const second = await createOrder(widgets(20));
    await orderAction(first.id, 'confirm');
    await orderAction(second.id, 'confirm');

    await orderAction(first.id, 'cancel');

    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 20 });
  });

  test('cancelling a PENDING order does not touch stock', async () => {
    const order = await createOrder(widgets(30));

    await orderAction(order.id, 'cancel');

    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 0 });
  });
});

describe('PATCH /api/inventory/:productId', () => {
  const setPhysical = async (physical_qty) =>
    request(app).patch(`/api/inventory/${IDS.widget}`).set(bearer(await login('ADMIN'))).send({ physical_qty });

  test('ADMIN can set physical stock', async () => {
    const res = await setPhysical(250);

    expect(res.status).toBe(200);
    expect(res.body.inventory).toMatchObject({ physical_qty: 250, available_qty: 250 });
  });

  test('negative or non-whole numbers are refused', async () => {
    expect((await setPhysical(-1)).status).toBe(400);
    expect((await setPhysical(1.5)).status).toBe(400);
  });

  test('physical cannot be set below what is already reserved', async () => {
    const order = await createOrder(widgets(30));
    await orderAction(order.id, 'confirm');

    const tooLow = await setPhysical(29);
    const exactlyReserved = await setPhysical(30);

    expect(tooLow.status).toBe(400);
    expect(exactlyReserved.status).toBe(200);
  });
});

describe('the database refuses impossible stock even if the code had a bug (CHECK constraints)', () => {
  test('reserved > physical, negative physical and negative reserved are all rejected by PostgreSQL', async () => {
    const update = (data) => prisma.inventory.update({ where: { product_id: IDS.widget }, data });

    await expect(update({ reserved_qty: 101 })).rejects.toThrow(/chk_reserved_le_physical/);
    await expect(update({ physical_qty: -1 })).rejects.toThrow(/chk_physical_non_negative/);
    await expect(update({ reserved_qty: -1 })).rejects.toThrow(/chk_reserved_non_negative/);
  });
});

describe('concurrent reservation (row locking with FOR UPDATE)', () => {
  // 100 available; one order wants 80, the other 50. Both arrive at the same moment.
  // Whoever gets the row lock first wins; the other must wait, then see the smaller number and fail.
  test.each([1, 2, 3, 4, 5])('round %i: exactly one confirm succeeds and reserved is never 130', async () => {
    const eighty = await createOrder(widgets(80));
    const fifty = await createOrder(widgets(50));

    const results = await Promise.all([orderAction(eighty.id, 'confirm'), orderAction(fifty.id, 'confirm')]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    expect(results.find((res) => res.status === 400).body.error).toMatch(/^Insufficient stock for WIDGET/);
    const { physical_qty, reserved_qty } = await getStock(IDS.widget);
    expect(physical_qty).toBe(100);
    expect([80, 50]).toContain(reserved_qty);
  });

  test('the order that lost stays PENDING', async () => {
    const eighty = await createOrder(widgets(80));
    const fifty = await createOrder(widgets(50));

    const [r80, r50] = await Promise.all([orderAction(eighty.id, 'confirm'), orderAction(fifty.id, 'confirm')]);

    const loser = r80.status === 400 ? eighty : fifty;
    expect((await prisma.salesOrder.findUnique({ where: { id: loser.id } })).status).toBe('PENDING');
    expect([r80.status, r50.status]).toContain(200);
  });

  test('8 orders of 30 racing for 100 units: exactly 3 win and 90 is reserved', async () => {
    const orders = await Promise.all(Array.from({ length: 8 }, () => createOrder(widgets(30))));

    const results = await Promise.all(orders.map((order) => orderAction(order.id, 'confirm')));

    expect(results.filter((res) => res.status === 200)).toHaveLength(3);
    expect(results.filter((res) => res.status === 400)).toHaveLength(5);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 90 });
  });

  test('the same order confirmed 5 times at once (double click) reserves only once', async () => {
    const order = await createOrder(widgets(10));

    const results = await Promise.all(Array.from({ length: 5 }, () => orderAction(order.id, 'confirm')));

    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(results.some((res) => res.status >= 500)).toBe(false);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 10 });
  });

  test('the same order dispatched 4 times at once takes stock out only once', async () => {
    const order = await createOrder(widgets(20));
    await orderAction(order.id, 'confirm');

    const results = await Promise.all(Array.from({ length: 4 }, () => orderAction(order.id, 'dispatch', truck)));

    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(results.some((res) => res.status >= 500)).toBe(false);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 80, reserved_qty: 0 });
    expect(await prisma.dispatch.count()).toBe(1);
  });

  test('the same order cancelled 3 times at once releases stock only once', async () => {
    const other = await createOrder(widgets(10));
    const order = await createOrder(widgets(25));
    await orderAction(other.id, 'confirm');
    await orderAction(order.id, 'confirm');

    const results = await Promise.all(Array.from({ length: 3 }, () => orderAction(order.id, 'cancel')));

    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    expect(await getStock(IDS.widget)).toEqual({ physical_qty: 100, reserved_qty: 10 }); // the other order still holds its 10
  });

  test('orders that list the same products in opposite order do not deadlock', async () => {
    for (let round = 0; round < 5; round++) {
      const forward = await createOrder([{ product_id: IDS.widget, quantity: 1 }, { product_id: IDS.gadget, quantity: 1 }]);
      const backward = await createOrder([{ product_id: IDS.gadget, quantity: 1 }, { product_id: IDS.widget, quantity: 1 }]);

      const results = await Promise.all([orderAction(forward.id, 'confirm'), orderAction(backward.id, 'confirm')]);

      expect(results.map((res) => res.status)).toEqual([200, 200]);
      await orderAction(forward.id, 'cancel');
      await orderAction(backward.id, 'cancel');
    }
  });
});
