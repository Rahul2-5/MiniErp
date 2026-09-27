const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');
const {
  IDS,
  resetDatabase,
  disconnect,
  login,
  bearer,
  createQuotation,
  changeQuotationStatus,
  createAcceptedQuotation,
  convertQuotation,
  createOrder,
  orderAction,
} = require('./setup');

beforeEach(resetDatabase);
afterAll(disconnect);

const widgets = (quantity) => [{ product_id: IDS.widget, quantity }];

describe('convert quotation to sales order', () => {
  test('a DRAFT quotation cannot be converted', async () => {
    const quotation = await createQuotation(widgets(5));

    const res = await convertQuotation(quotation.id);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only ACCEPTED quotations can be converted');
    expect(await prisma.salesOrder.count()).toBe(0);
  });

  test('a SENT quotation cannot be converted', async () => {
    const quotation = await createQuotation(widgets(5));
    await changeQuotationStatus(quotation.id, 'SENT');

    expect((await convertQuotation(quotation.id)).status).toBe(400);
  });

  test('a REJECTED quotation cannot be converted', async () => {
    const quotation = await createQuotation(widgets(5));
    await changeQuotationStatus(quotation.id, 'SENT');
    await changeQuotationStatus(quotation.id, 'REJECTED');

    const res = await convertQuotation(quotation.id);

    expect(res.status).toBe(400);
    expect(await prisma.salesOrder.count()).toBe(0);
  });

  test('an unknown quotation gives 404', async () => {
    expect((await convertQuotation(9999)).status).toBe(404);
  });

  test('an ACCEPTED quotation becomes a PENDING order with the same total and items, and reserves no stock', async () => {
    const quotation = await createAcceptedQuotation([{ product_id: IDS.widget, quantity: 4 }, { product_id: IDS.gadget, quantity: 2 }]);

    const res = await convertQuotation(quotation.id);

    expect(res.status).toBe(201);
    expect(res.body.order_no).toBe('SO-0001');
    expect(res.body.status).toBe('PENDING');
    expect(Number(res.body.total_amount)).toBe(Number(quotation.grand_total));
    expect(res.body.items.map((item) => [item.product_id, item.quantity])).toEqual([[IDS.widget, 4], [IDS.gadget, 2]]);
    expect((await prisma.inventory.findMany()).every((row) => row.reserved_qty === 0)).toBe(true);
  });
});

describe('the same quotation cannot create two orders', () => {
  test('a second convert gives 409 and there is still only one order', async () => {
    const quotation = await createAcceptedQuotation(widgets(5));
    await convertQuotation(quotation.id);

    const second = await convertQuotation(quotation.id);

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('Sales order already exists for this quotation');
    expect(await prisma.salesOrder.count({ where: { quotation_id: quotation.id } })).toBe(1);
  });

  test('two converts at the same moment: exactly one succeeds', async () => {
    const quotation = await createAcceptedQuotation(widgets(5));

    const results = await Promise.all([convertQuotation(quotation.id), convertQuotation(quotation.id)]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.salesOrder.count({ where: { quotation_id: quotation.id } })).toBe(1);
  });

  test('the database itself refuses a second order, even if the code were bypassed (UNIQUE quotation_id)', async () => {
    const order = await createOrder(widgets(5));

    const insertDuplicate = prisma.salesOrder.create({
      data: { order_no: 'SO-MANUAL', quotation_id: order.quotation_id, customer_id: IDS.customer, total_amount: 1 },
    });

    await expect(insertDuplicate).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('order lifecycle: confirm, dispatch, cancel', () => {
  test('confirm moves PENDING to CONFIRMED, and only a PENDING order can be confirmed', async () => {
    const order = await createOrder(widgets(5));

    const first = await orderAction(order.id, 'confirm');
    const second = await orderAction(order.id, 'confirm');

    expect([first.status, first.body.status]).toEqual([200, 'CONFIRMED']);
    expect([second.status, second.body.error]).toEqual([400, 'Only PENDING orders can be confirmed']);
  });

  test('dispatch moves CONFIRMED to DISPATCHED and creates one numbered dispatch record', async () => {
    const order = await createOrder(widgets(5));
    await orderAction(order.id, 'confirm');

    const res = await orderAction(order.id, 'dispatch', { vehicle_no: 'MH12AB1234', driver_name: 'Ramesh' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISPATCHED');
    expect(res.body.dispatch).toMatchObject({ dispatch_no: 'DSP-0001', vehicle_no: 'MH12AB1234', driver_name: 'Ramesh' });
  });

  test('a PENDING order cannot be dispatched', async () => {
    const order = await createOrder(widgets(5));

    const res = await orderAction(order.id, 'dispatch', { vehicle_no: 'MH12', driver_name: 'Ravi' });

    expect([res.status, res.body.error]).toEqual([400, 'Only CONFIRMED orders can be dispatched']);
  });

  test('an order cannot be dispatched twice', async () => {
    const order = await createOrder(widgets(5));
    await orderAction(order.id, 'confirm');
    await orderAction(order.id, 'dispatch', { vehicle_no: 'MH12', driver_name: 'Ravi' });

    const again = await orderAction(order.id, 'dispatch', { vehicle_no: 'MH99', driver_name: 'Other' });

    expect(again.status).toBe(400);
    expect(await prisma.dispatch.count({ where: { sales_order_id: order.id } })).toBe(1);
  });

  test('the database itself refuses a second dispatch record (UNIQUE sales_order_id)', async () => {
    const order = await createOrder(widgets(5));
    await orderAction(order.id, 'confirm');
    await orderAction(order.id, 'dispatch', { vehicle_no: 'MH12', driver_name: 'Ravi' });

    const insertDuplicate = prisma.dispatch.create({
      data: { dispatch_no: 'DSP-MANUAL', sales_order_id: order.id, vehicle_no: 'x', driver_name: 'y' },
    });

    await expect(insertDuplicate).rejects.toMatchObject({ code: 'P2002' });
  });

  test('dispatch needs vehicle_no and driver_name', async () => {
    const order = await createOrder(widgets(5));
    await orderAction(order.id, 'confirm');

    expect((await orderAction(order.id, 'dispatch', { driver_name: 'Ravi' })).status).toBe(400);
    expect((await orderAction(order.id, 'dispatch', { vehicle_no: 'MH12', driver_name: '' })).status).toBe(400);
  });

  test('a cancelled order cannot be dispatched or confirmed', async () => {
    const order = await createOrder(widgets(5));
    await orderAction(order.id, 'cancel');

    const dispatch = await orderAction(order.id, 'dispatch', { vehicle_no: 'MH12', driver_name: 'Ravi' });
    const confirm = await orderAction(order.id, 'confirm');

    expect([dispatch.status, dispatch.body.error]).toEqual([400, 'Cancelled orders cannot be dispatched']);
    expect(confirm.status).toBe(400);
  });

  test('PENDING and CONFIRMED orders can be cancelled; DISPATCHED and CANCELLED cannot', async () => {
    const pending = await createOrder(widgets(1));
    const confirmed = await createOrder(widgets(1));
    await orderAction(confirmed.id, 'confirm');
    const dispatched = await createOrder(widgets(1));
    await orderAction(dispatched.id, 'confirm');
    await orderAction(dispatched.id, 'dispatch', { vehicle_no: 'MH12', driver_name: 'Ravi' });

    expect((await orderAction(pending.id, 'cancel')).body.status).toBe('CANCELLED');
    expect((await orderAction(confirmed.id, 'cancel')).body.status).toBe('CANCELLED');
    expect((await orderAction(dispatched.id, 'cancel')).status).toBe(400);
    expect((await orderAction(pending.id, 'cancel')).status).toBe(400);
  });

  test('anyone logged in can view orders; each order shows its customer, quotation and enquiry', async () => {
    const order = await createOrder(widgets(5));

    const res = await request(app).get(`/api/sales-orders/${order.id}`).set(bearer(await login('SALES')));

    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(IDS.customer);
    expect(res.body.quotation.quotation_no).toBe('QT-0001');
    expect(res.body.quotation.enquiry.enquiry_no).toBe('ENQ-0001');
  });
});
