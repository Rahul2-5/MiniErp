const prisma = require('../db');
const AppError = require('../utils/AppError');
const { formatNo, temporaryNo } = require('../utils/formatNo');
const { calculateLineAmount, calculateGrandTotal } = require('../utils/calculations');

const quotationInclude = {
  customer: true,
  enquiry: true,
  items: { include: { product: true } },
  sales_order: true, // tells the UI whether the quotation was already converted
};

// Rule: allowed quotation status changes. Anything not listed here is rejected with 400.
const ALLOWED_TRANSITIONS = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
};

// Rule: ACCEPTED quotation -> enquiry WON, REJECTED quotation -> enquiry LOST.
const ENQUIRY_STATUS_AFTER = { ACCEPTED: 'WON', REJECTED: 'LOST' };

async function listQuotations() {
  return prisma.quotation.findMany({ include: quotationInclude, orderBy: { id: 'desc' } });
}

async function getQuotation(id) {
  const quotation = await prisma.quotation.findUnique({ where: { id }, include: quotationInclude });
  if (!quotation) {
    throw new AppError(404, 'Quotation not found');
  }
  return quotation;
}

async function createQuotation(data, userId) {
  const enquiry = await prisma.enquiry.findUnique({ where: { id: data.enquiry_id } });
  if (!enquiry) {
    throw new AppError(404, 'Enquiry not found');
  }

  // Rule: a WON or LOST enquiry is finished; quoting it again would wrongly set it back to QUOTED.
  if (enquiry.status === 'WON' || enquiry.status === 'LOST') {
    throw new AppError(400, `Cannot create a quotation for a ${enquiry.status} enquiry`);
  }

  const productIds = data.items.map((item) => item.product_id);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  if (products.length !== productIds.length) {
    throw new AppError(400, 'One or more products do not exist');
  }

  // Rule: the backend always calculates line_amount and grand_total; the client's values are never read.
  const lines = data.items.map((item) => {
    const product = products.find((p) => p.id === item.product_id);
    const line = {
      product_id: item.product_id,
      quantity: item.quantity,
      // Rule: unit_price defaults to the product's base_price when the client does not send one.
      unit_price: item.unit_price ?? product.base_price,
      discount_pct: item.discount_pct,
      gst_pct: item.gst_pct,
    };
    return { ...line, line_amount: calculateLineAmount(line) };
  });
  const grandTotal = calculateGrandTotal(lines.map((line) => line.line_amount));

  return prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.create({
      data: {
        quotation_no: temporaryNo(),
        enquiry_id: enquiry.id,
        customer_id: enquiry.customer_id,
        valid_until: data.valid_until,
        grand_total: grandTotal,
        created_by: userId,
        items: { create: lines },
      },
    });

    // Rule: creating a quotation makes the enquiry QUOTED.
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { status: 'QUOTED' } });

    return tx.quotation.update({
      where: { id: quotation.id },
      data: { quotation_no: formatNo('QT', quotation.id) },
      include: quotationInclude,
    });
  });
}

async function changeQuotationStatus(id, newStatus) {
  const quotation = await getQuotation(id);

  if (!ALLOWED_TRANSITIONS[quotation.status].includes(newStatus)) {
    throw new AppError(400, `Cannot change quotation from ${quotation.status} to ${newStatus}`);
  }

  // Quotation and enquiry statuses change together or not at all.
  return prisma.$transaction(async (tx) => {
    const enquiryStatus = ENQUIRY_STATUS_AFTER[newStatus];
    if (enquiryStatus) {
      await tx.enquiry.update({ where: { id: quotation.enquiry_id }, data: { status: enquiryStatus } });
    }
    return tx.quotation.update({ where: { id }, data: { status: newStatus }, include: quotationInclude });
  });
}

module.exports = { listQuotations, getQuotation, createQuotation, changeQuotationStatus };
