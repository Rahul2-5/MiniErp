const { Prisma } = require('@prisma/client');

// Rule: all money maths uses Decimal (exact base-10 numbers), never JS floats.
// A float gives 0.1 + 0.2 = 0.30000000000000004; a Decimal gives exactly 0.3.
// Prisma.Decimal is the same type Prisma uses for the DECIMAL columns, so nothing is converted.
const Decimal = Prisma.Decimal;

function roundMoney(value) {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// base = qty x price, then discount, then GST on the discounted amount.
function calculateLineAmount({ quantity, unit_price, discount_pct, gst_pct }) {
  const base = new Decimal(unit_price).times(quantity);
  const discount = base.times(discount_pct).div(100);
  const taxable = base.minus(discount);
  const gst = taxable.times(gst_pct).div(100);
  return roundMoney(taxable.plus(gst));
}

function calculateGrandTotal(lineAmounts) {
  const sum = lineAmounts.reduce((total, amount) => total.plus(amount), new Decimal(0));
  return roundMoney(sum);
}

module.exports = { calculateLineAmount, calculateGrandTotal };
