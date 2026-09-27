// Loaded by Jest before every test file (see "jest" in package.json) and imported by the tests for its helpers.
const path = require('path');

// Use the TEST database, and let .env.test win even if DATABASE_URL is already set in the terminal.
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), override: true, quiet: true });

// resetDatabase() empties every table, so never allow it to run against the real database.
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('_test')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point to a database whose name ends in _test');
}

const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/db');

// TRUNCATE ... RESTART IDENTITY starts every id at 1 again, so these ids are the same in every test.
const IDS = { admin: 1, sales: 2, customer: 1, widget: 1, gadget: 2 };

const USERS = {
  ADMIN: { email: 'admin@erp.com', password: 'Admin@123' },
  SALES: { email: 'sales@erp.com', password: 'Sales@123' },
};

// Every test starts from the same known data: 2 users, 1 customer, WIDGET (100 in stock, price 100.00)
// and GADGET (10 in stock, price 250.00). Nothing else exists.
async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE dispatches, sales_order_items, sales_orders, quotation_items, quotations, enquiry_items, enquiries, inventory, products, customers, users RESTART IDENTITY CASCADE'
  );
  await prisma.user.createMany({
    data: [
      { name: 'Admin', email: USERS.ADMIN.email, password_hash: await bcrypt.hash(USERS.ADMIN.password, 4), role: 'ADMIN' },
      { name: 'Sales', email: USERS.SALES.email, password_hash: await bcrypt.hash(USERS.SALES.password, 4), role: 'SALES' },
    ],
  });
  await prisma.customer.create({ data: { company_name: 'Test Customer', contact_person: 'Tester', mobile: '9000000000' } });
  await prisma.product.create({
    data: { code: 'WIDGET', name: 'Widget', category: 'Test', unit: 'Nos', base_price: '100.00', inventory: { create: { physical_qty: 100 } } },
  });
  await prisma.product.create({
    data: { code: 'GADGET', name: 'Gadget', category: 'Test', unit: 'Nos', base_price: '250.00', inventory: { create: { physical_qty: 10 } } },
  });
}

function disconnect() {
  return prisma.$disconnect();
}

// Real login through the API, returns a JWT. role is 'ADMIN' or 'SALES'.
async function login(role) {
  const res = await request(app).post('/api/auth/login').send(USERS[role]);
  return res.body.token;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

// items look like [{ product_id, quantity }]. Each helper below builds on the previous one, all through the real API.
async function createQuotation(items) {
  const token = await login('SALES');
  const enquiry = await request(app).post('/api/enquiries').set(bearer(token)).send({ customer_id: IDS.customer, items });
  const quotation = await request(app)
    .post('/api/quotations')
    .set(bearer(token))
    .send({ enquiry_id: enquiry.body.id, valid_until: '2026-12-01', items });
  return quotation.body; // status DRAFT
}

async function changeQuotationStatus(quotationId, status) {
  const token = await login('SALES');
  return request(app).patch(`/api/quotations/${quotationId}/status`).set(bearer(token)).send({ status });
}

async function createAcceptedQuotation(items) {
  const quotation = await createQuotation(items);
  await changeQuotationStatus(quotation.id, 'SENT');
  await changeQuotationStatus(quotation.id, 'ACCEPTED');
  return quotation;
}

async function convertQuotation(quotationId) {
  const token = await login('SALES');
  return request(app).post(`/api/quotations/${quotationId}/convert`).set(bearer(token));
}

async function createOrder(items) {
  const quotation = await createAcceptedQuotation(items);
  const res = await convertQuotation(quotation.id);
  return res.body; // status PENDING
}

// Admin actions on an order: confirm, dispatch, cancel.
async function orderAction(orderId, action, body) {
  const token = await login('ADMIN');
  return request(app).post(`/api/sales-orders/${orderId}/${action}`).set(bearer(token)).send(body);
}

// Reads the stock straight from the database, not through the API.
async function getStock(productId) {
  const { physical_qty, reserved_qty } = await prisma.inventory.findUnique({ where: { product_id: productId } });
  return { physical_qty, reserved_qty };
}

module.exports = {
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
  getStock,
};
