const prisma = require('../db');
const AppError = require('../utils/AppError');
const { formatNo, temporaryNo } = require('../utils/formatNo');

const enquiryInclude = { customer: true, items: { include: { product: true } } };

async function listEnquiries() {
  return prisma.enquiry.findMany({ include: enquiryInclude, orderBy: { id: 'desc' } });
}

async function getEnquiry(id) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id },
    include: { ...enquiryInclude, quotations: true },
  });
  if (!enquiry) {
    throw new AppError(404, 'Enquiry not found');
  }
  return enquiry;
}

async function createEnquiry(data, userId) {
  const { items, ...enquiryFields } = data;

  // One transaction: the enquiry, its items and its number are saved together or not at all.
  return prisma.$transaction(async (tx) => {
    const enquiry = await tx.enquiry.create({
      data: { ...enquiryFields, enquiry_no: temporaryNo(), created_by: userId, items: { create: items } },
    });
    return tx.enquiry.update({
      where: { id: enquiry.id },
      data: { enquiry_no: formatNo('ENQ', enquiry.id) },
      include: enquiryInclude,
    });
  });
}

async function markEnquiryLost(id) {
  const enquiry = await getEnquiry(id);

  // Rule: WON and LOST are final; only NEW or QUOTED enquiries can be marked LOST.
  if (enquiry.status === 'WON' || enquiry.status === 'LOST') {
    throw new AppError(400, `Enquiry is already ${enquiry.status}`);
  }

  return prisma.enquiry.update({ where: { id }, data: { status: 'LOST' }, include: enquiryInclude });
}

module.exports = { listEnquiries, getEnquiry, createEnquiry, markEnquiryLost };
