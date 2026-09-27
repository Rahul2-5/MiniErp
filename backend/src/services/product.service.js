const prisma = require('../db');
const AppError = require('../utils/AppError');

// Rule: available = physical - reserved. This is the ONLY place the formula lives; every
// listing and every stock check calls it. Works for Prisma rows and raw SQL rows alike
// because both use the same snake_case column names.
function getAvailable(inventory) {
  return inventory.physical_qty - inventory.reserved_qty;
}

// Adds the computed available_qty next to the stored numbers (it is never saved in the DB).
function addAvailable(product) {
  return { ...product, inventory: { ...product.inventory, available_qty: getAvailable(product.inventory) } };
}

// Rule: lock inventory rows in product_id order. Every transaction that touches several rows
// must lock them in the same order, otherwise two transactions can wait on each other (deadlock).
// FOR UPDATE keeps the rows locked until the transaction ends. Must be called with a `tx`.
// SELECT * on purpose: when a column is added later (e.g. damaged_qty) getAvailable sees it automatically.
function lockInventoryRows(tx, productIds) {
  return tx.$queryRaw`
    SELECT *
    FROM inventory
    WHERE product_id = ANY(${productIds})
    ORDER BY product_id
    FOR UPDATE`;
}

async function listProducts() {
  const products = await prisma.product.findMany({ include: { inventory: true }, orderBy: { id: 'asc' } });
  return products.map(addAvailable);
}

async function updatePhysicalStock(productId, physicalQty) {
  return prisma.$transaction(async (tx) => {
    const [inventory] = await lockInventoryRows(tx, [productId]);
    if (!inventory) {
      throw new AppError(404, 'Product not found');
    }

    // Rule: physical stock can never be set below what is already reserved for orders.
    if (physicalQty < inventory.reserved_qty) {
      throw new AppError(400, `Physical quantity cannot be less than reserved quantity (${inventory.reserved_qty})`);
    }

    await tx.inventory.update({ where: { product_id: productId }, data: { physical_qty: physicalQty } });

    const product = await tx.product.findUnique({ where: { id: productId }, include: { inventory: true } });
    return addAvailable(product);
  });
}

module.exports = { getAvailable, lockInventoryRows, listProducts, updatePhysicalStock };
