require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const prisma = require('../src/db');

const users = [
  { name: 'Admin User', email: 'admin@erp.com', password: 'Admin@123', role: 'ADMIN' },
  { name: 'Sales User', email: 'sales@erp.com', password: 'Sales@123', role: 'SALES' },
];

const customers = [
  { company_name: 'ABC Engineering Pvt. Ltd.', contact_person: 'Rajesh Mehta', mobile: '9820012345', email: 'rajesh@abceng.com', city: 'Mumbai' },
  { company_name: 'Shree Fabricators', contact_person: 'Anil Kulkarni', mobile: '9822098765', email: 'anil@shreefab.com', city: 'Pune' },
  { company_name: 'Delta Industries', contact_person: 'Kiran Patel', mobile: '9898011122', email: 'kiran@deltaind.com', city: 'Ahmedabad' },
];

// physical_qty varies on purpose: Hydraulic Pump has only 8 in stock,
// so confirming a bigger order shows the "Insufficient stock" error.
const products = [
  { code: 'MS-SHT-02', name: 'Mild Steel Sheet 2mm', category: 'Raw Material', unit: 'Sheets', base_price: '1850.00', physical_qty: 500 },
  { code: 'HP-200', name: 'Hydraulic Pump HP-200', category: 'Hydraulics', unit: 'Nos', base_price: '24500.00', physical_qty: 8 },
  { code: 'BB-6205', name: 'Ball Bearing 6205', category: 'Bearings', unit: 'Nos', base_price: '185.00', physical_qty: 1200 },
  { code: 'IV-2IN', name: 'Industrial Valve 2"', category: 'Valves', unit: 'Nos', base_price: '3200.00', physical_qty: 60 },
  { code: 'CW-4MM', name: 'Copper Wire 4mm', category: 'Electrical', unit: 'Metres', base_price: '95.00', physical_qty: 2500 },
  { code: 'WR-E6013', name: 'Welding Rod E6013', category: 'Consumables', unit: 'Kg', base_price: '120.00', physical_qty: 300 },
];

async function main() {
  for (const { password, ...user } of users) {
    const password_hash = await bcrypt.hash(password, 10);
    // upsert = insert or do nothing, so the seed can be re-run safely.
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, password_hash },
    });
  }

  if ((await prisma.customer.count()) === 0) {
    await prisma.customer.createMany({ data: customers });
  }

  for (const { physical_qty, ...product } of products) {
    // Product and its inventory row are created together (1:1). update: {} keeps existing stock on re-run.
    await prisma.product.upsert({
      where: { code: product.code },
      update: {},
      create: { ...product, inventory: { create: { physical_qty } } },
    });
  }

  console.log('Seed complete: 2 users, 3 customers, 6 products with inventory');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
