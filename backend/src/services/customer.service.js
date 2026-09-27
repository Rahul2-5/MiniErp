const prisma = require('../db');

async function listCustomers() {
  return prisma.customer.findMany({ orderBy: { id: 'asc' } });
}

async function createCustomer(data) {
  return prisma.customer.create({ data });
}

module.exports = { listCustomers, createCustomer };
