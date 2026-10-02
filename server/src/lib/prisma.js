// Single shared Prisma client. Import this everywhere — never `new PrismaClient()`.
const { PrismaClient } = require('@prisma/client');

const globalKey = '__keymatchPrisma';
const prisma = global[globalKey] || new PrismaClient({
  log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'],
});
if (process.env.NODE_ENV !== 'production') global[globalKey] = prisma;

module.exports = prisma;
