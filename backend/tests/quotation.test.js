const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');
const { calculateLineAmount, calculateGrandTotal } = require('../src/utils/calculations');
const { IDS, resetDatabase, disconnect, login, bearer, createQuotation, changeQuotationStatus } = require('./setup');

beforeEach(resetDatabase);
afterAll(disconnect);

describe('calculations.js (pure functions, no database)', () => {
  const line = (quantity, unit_price, discount_pct, gst_pct) =>
    calculateLineAmount({ quantity, unit_price, discount_pct, gst_pct }).toFixed(2);

  test('100 x 50, 10% discount, 18% GST = 5310.00', () => {
    // base 5000 - discount 500 = taxable 4500, + GST 810 = 5310
    expect(line(100, 50, 10, 18)).toBe('5310.00');
  });

  test('uses exact decimals, not floats: 3 x 0.10 is 0.30 (a float gives 0.30000000000000004)', () => {
    expect(line(3, 0.1, 0, 0)).toBe('0.30');
  });

  test('rounds half up to 2 decimals', () => {
    expect(line(1, 0.01, 0, 50)).toBe('0.02'); // 0.015 -> 0.02
    expect(line(1, 10.05, 0, 5)).toBe('10.55'); // 10.5525 -> 10.55
  });

  test('a 100% discount gives 0.00', () => {
    expect(line(2, 99.99, 100, 18)).toBe('0.00');
  });

  test('grand total is the sum of the line amounts', () => {
    const first = calculateLineAmount({ quantity: 100, unit_price: 50, discount_pct: 10, gst_pct: 18 });
    const second = calculateLineAmount({ quantity: 3, unit_price: 0.1, discount_pct: 0, gst_pct: 0 });

    expect(calculateGrandTotal([first, second]).toFixed(2)).toBe('5310.30');
  });
});

describe('POST /api/quotations: the backend does the maths', () => {
  test('total is calculated by the backend; a fake grand_total and line_amount from the client are ignored', async () => {
    const sales = bearer(await login('SALES'));
    const enquiry = await request(app).post('/api/enquiries').set(sales).send({ customer_id: IDS.customer, items: [{ product_id: IDS.widget, quantity: 100 }] });

    const res = await request(app).post('/api/quotations').set(sales).send({
      enquiry_id: enquiry.body.id,
      valid_until: '2026-12-01',
      grand_total: 1,
      items: [{ product_id: IDS.widget, quantity: 100, unit_price: 50, discount_pct: 10, gst_pct: 18, line_amount: 1 }],
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.grand_total)).toBe(5310);
    expect(Number(res.body.items[0].line_amount)).toBe(5310);
    const stored = await prisma.quotation.findUnique({ where: { id: res.body.id } });
    expect(stored.grand_total.toFixed(2)).toBe('5310.00');
  });

  test('unit_price defaults to the product base_price, discount to 0 and GST to 18', async () => {
    const quotation = await createQuotation([{ product_id: IDS.gadget, quantity: 2 }]);

    const item = quotation.items[0];
    expect([Number(item.unit_price), Number(item.discount_pct), Number(item.gst_pct)]).toEqual([250, 0, 18]);
    expect(Number(quotation.grand_total)).toBe(590); // 2 x 250 = 500, + 18% GST
  });

  test('more than 2 decimals, discount above 100 and duplicate products are rejected with 400', async () => {
    const sales = bearer(await login('SALES'));
    const enquiry = await request(app).post('/api/enquiries').set(sales).send({ customer_id: IDS.customer, items: [{ product_id: IDS.widget, quantity: 1 }] });
    const post = (items) => request(app).post('/api/quotations').set(sales).send({ enquiry_id: enquiry.body.id, valid_until: '2026-12-01', items });

    expect((await post([{ product_id: IDS.widget, quantity: 1, unit_price: 1.005 }])).status).toBe(400);
    expect((await post([{ product_id: IDS.widget, quantity: 1, discount_pct: 101 }])).status).toBe(400);
    expect((await post([{ product_id: IDS.widget, quantity: 1 }, { product_id: IDS.widget, quantity: 2 }])).status).toBe(400);
  });
});

describe('quotation status transitions and enquiry status', () => {
  const enquiryStatus = async (quotation) => (await prisma.enquiry.findUnique({ where: { id: quotation.enquiry_id } })).status;

  test('creating a quotation makes the enquiry QUOTED', async () => {
    const quotation = await createQuotation([{ product_id: IDS.widget, quantity: 1 }]);

    expect(quotation.status).toBe('DRAFT');
    expect(await enquiryStatus(quotation)).toBe('QUOTED');
  });

  test('DRAFT can only go to SENT: ACCEPTED, REJECTED and DRAFT are refused with 400', async () => {
    const quotation = await createQuotation([{ product_id: IDS.widget, quantity: 1 }]);

    for (const status of ['ACCEPTED', 'REJECTED', 'DRAFT']) {
      const res = await changeQuotationStatus(quotation.id, status);
      expect([status, res.status]).toEqual([status, 400]);
    }
    expect((await changeQuotationStatus(quotation.id, 'SENT')).body.status).toBe('SENT');
  });

  test('SENT -> ACCEPTED makes the enquiry WON', async () => {
    const quotation = await createQuotation([{ product_id: IDS.widget, quantity: 1 }]);
    await changeQuotationStatus(quotation.id, 'SENT');

    const res = await changeQuotationStatus(quotation.id, 'ACCEPTED');

    expect(res.body.status).toBe('ACCEPTED');
    expect(await enquiryStatus(quotation)).toBe('WON');
  });

  test('SENT -> REJECTED makes the enquiry LOST', async () => {
    const quotation = await createQuotation([{ product_id: IDS.widget, quantity: 1 }]);
    await changeQuotationStatus(quotation.id, 'SENT');

    const res = await changeQuotationStatus(quotation.id, 'REJECTED');

    expect(res.body.status).toBe('REJECTED');
    expect(await enquiryStatus(quotation)).toBe('LOST');
  });

  test('ACCEPTED and REJECTED are final: they cannot change again', async () => {
    const accepted = await createQuotation([{ product_id: IDS.widget, quantity: 1 }]);
    await changeQuotationStatus(accepted.id, 'SENT');
    await changeQuotationStatus(accepted.id, 'ACCEPTED');
    const rejected = await createQuotation([{ product_id: IDS.widget, quantity: 1 }]);
    await changeQuotationStatus(rejected.id, 'SENT');
    await changeQuotationStatus(rejected.id, 'REJECTED');

    expect((await changeQuotationStatus(accepted.id, 'REJECTED')).status).toBe(400);
    expect((await changeQuotationStatus(rejected.id, 'ACCEPTED')).status).toBe(400);
  });
});
