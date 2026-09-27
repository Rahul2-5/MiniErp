const prisma = require('../db');
const AppError = require('../utils/AppError');
const { formatNo, temporaryNo } = require('../utils/formatNo');
const { getAvailable, lockInventoryRows } = require('./product.service');

// customer -> enquiry -> quotation trace, plus each product's inventory for the availability column.
const salesOrderInclude = {
  customer: true,
  quotation: { include: { enquiry: true } },
  items: { include: { product: { include: { inventory: true } } } },
  dispatch: true,
};

// Adds today's available quantity next to each item, so the UI can show it before the order is confirmed.
function addItemAvailability(order) {
  const items = order.items.map((item) => ({ ...item, available_qty: getAvailable(item.product.inventory) }));
  return { ...order, items };
}

// `db` is the normal client, or `tx` when called inside a transaction (so the reply sees the new data).
async function getSalesOrder(id, db = prisma) {
  const order = await db.salesOrder.findUnique({ where: { id }, include: salesOrderInclude });
  if (!order) {
    throw new AppError(404, 'Sales order not found');
  }
  return addItemAvailability(order);
}

async function listSalesOrders() {
  const orders = await prisma.salesOrder.findMany({ include: salesOrderInclude, orderBy: { id: 'desc' } });
  return orders.map(addItemAvailability);
}

async function findOrderWithItems(tx, id) {
  const order = await tx.salesOrder.findUnique({ where: { id }, include: { items: { include: { product: true } } } });
  if (!order) {
    throw new AppError(404, 'Sales order not found');
  }
  return order;
}

// Rule: an order changes status only if it still has the status we just read.
// The UPDATE locks the order row, so when two requests act on the same order at once the second one
// waits, then matches 0 rows and fails here instead of reserving/dispatching/releasing stock twice.
async function changeOrderStatus(tx, order, newStatus) {
  const { count } = await tx.salesOrder.updateMany({
    where: { id: order.id, status: order.status },
    data: { status: newStatus },
  });
  if (count === 0) {
    throw new AppError(409, 'Order was changed by another request, please reload and try again');
  }
}

async function convertQuotationToOrder(quotationId) {
  try {
    return await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({ where: { id: quotationId }, include: { items: true } });
      if (!quotation) {
        throw new AppError(404, 'Quotation not found');
      }

      // Rule: only ACCEPTED quotations can be converted.
      if (quotation.status !== 'ACCEPTED') {
        throw new AppError(400, 'Only ACCEPTED quotations can be converted');
      }

      // Friendly check first. The UNIQUE(quotation_id) constraint below is the real guarantee.
      const existingOrder = await tx.salesOrder.findUnique({ where: { quotation_id: quotationId } });
      if (existingOrder) {
        throw new AppError(409, 'Sales order already exists for this quotation');
      }

      // Rule: a converted order starts PENDING with the quotation's total and a copy of its items.
      const order = await tx.salesOrder.create({
        data: {
          order_no: temporaryNo(),
          quotation_id: quotation.id,
          customer_id: quotation.customer_id,
          total_amount: quotation.grand_total,
          items: { create: quotation.items.map(({ product_id, quantity }) => ({ product_id, quantity })) },
        },
      });

      await tx.salesOrder.update({ where: { id: order.id }, data: { order_no: formatNo('SO', order.id) } });
      return getSalesOrder(order.id, tx);
    });
  } catch (error) {
    // Rule: two simultaneous converts both pass the check above; the database lets only one INSERT
    // through and the other fails with P2002 (unique violation), which we report as 409.
    if (error.code === 'P2002') {
      throw new AppError(409, 'Sales order already exists for this quotation');
    }
    throw error;
  }
}

async function confirmSalesOrder(orderId) {
  return prisma.$transaction(async (tx) => {
    const order = await findOrderWithItems(tx, orderId);

    // Rule: only PENDING orders can be confirmed.
    if (order.status !== 'PENDING') {
      throw new AppError(400, 'Only PENDING orders can be confirmed');
    }
    await changeOrderStatus(tx, order, 'CONFIRMED');

    // Rule: lock the stock rows before reading them. A concurrent confirm for the same products
    // waits here, then reads the numbers AFTER our commit, so two orders can never both take the last units.
    const stockRows = await lockInventoryRows(tx, order.items.map((item) => item.product_id));

    // Rule: never reserve more than what is available (physical - reserved).
    const shortages = [];
    for (const item of order.items) {
      const available = getAvailable(stockRows.find((row) => row.product_id === item.product_id));
      if (item.quantity > available) {
        shortages.push(`${item.product.code}: required ${item.quantity}, available ${available}`);
      }
    }
    // Throwing rolls back the whole transaction, including the status change above.
    if (shortages.length > 0) {
      throw new AppError(400, `Insufficient stock for ${shortages.join('; ')}`);
    }

    // Rule: confirming reserves stock; physical stock does not change until dispatch.
    for (const item of order.items) {
      await tx.inventory.update({
        where: { product_id: item.product_id },
        data: { reserved_qty: { increment: item.quantity } },
      });
    }

    return getSalesOrder(orderId, tx);
  });
}

async function dispatchSalesOrder(orderId, { vehicle_no, driver_name, dispatch_date }) {
  return prisma.$transaction(async (tx) => {
    const order = await findOrderWithItems(tx, orderId);

    // Rule: cancelled orders can never be dispatched, and only CONFIRMED (stock reserved) orders can.
    if (order.status === 'CANCELLED') {
      throw new AppError(400, 'Cancelled orders cannot be dispatched');
    }
    if (order.status !== 'CONFIRMED') {
      throw new AppError(400, 'Only CONFIRMED orders can be dispatched');
    }
    await changeOrderStatus(tx, order, 'DISPATCHED');

    const stockRows = await lockInventoryRows(tx, order.items.map((item) => item.product_id));

    for (const item of order.items) {
      const reservedQty = stockRows.find((row) => row.product_id === item.product_id).reserved_qty;

      // Rule: dispatch never exceeds what is reserved.
      if (item.quantity > reservedQty) {
        throw new AppError(400, `Cannot dispatch ${item.product.code}: required ${item.quantity}, reserved ${reservedQty}`);
      }

      // Rule: dispatched goods leave the warehouse, so BOTH physical and reserved go down.
      await tx.inventory.update({
        where: { product_id: item.product_id },
        data: { physical_qty: { decrement: item.quantity }, reserved_qty: { decrement: item.quantity } },
      });
    }

    // Rule: UNIQUE(sales_order_id) means an order can only ever have one dispatch record.
    const dispatch = await tx.dispatch.create({
      data: { dispatch_no: temporaryNo(), sales_order_id: order.id, vehicle_no, driver_name, dispatch_date },
    });
    await tx.dispatch.update({ where: { id: dispatch.id }, data: { dispatch_no: formatNo('DSP', dispatch.id) } });

    return getSalesOrder(orderId, tx);
  });
}

async function cancelSalesOrder(orderId) {
  return prisma.$transaction(async (tx) => {
    const order = await findOrderWithItems(tx, orderId);

    // Rule: only PENDING or CONFIRMED orders can be cancelled.
    if (order.status === 'DISPATCHED' || order.status === 'CANCELLED') {
      throw new AppError(400, `Cannot cancel an order that is already ${order.status}`);
    }
    await changeOrderStatus(tx, order, 'CANCELLED');

    // Rule: a CONFIRMED order holds reserved stock, so cancelling releases it. A PENDING order holds none.
    if (order.status === 'CONFIRMED') {
      await lockInventoryRows(tx, order.items.map((item) => item.product_id));
      for (const item of order.items) {
        await tx.inventory.update({
          where: { product_id: item.product_id },
          data: { reserved_qty: { decrement: item.quantity } },
        });
      }
    }

    return getSalesOrder(orderId, tx);
  });
}

module.exports = {
  listSalesOrders,
  getSalesOrder,
  convertQuotationToOrder,
  confirmSalesOrder,
  dispatchSalesOrder,
  cancelSalesOrder,
};
