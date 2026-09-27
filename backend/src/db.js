const { PrismaClient } = require('@prisma/client');

// One shared PrismaClient for the whole app (like a single DataSource bean in Spring).
const prisma = new PrismaClient();

module.exports = prisma;
