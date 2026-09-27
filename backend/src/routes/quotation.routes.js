const express = require('express');
const { z } = require('zod');
const auth = require('../middleware/auth');
const quotationService = require('../services/quotation.service');
const salesOrderService = require('../services/salesOrder.service');

const router = express.Router();

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.iso.date().transform((text) => new Date(text)); // "2026-10-01" -> Date

// Money and percentages accept at most 2 decimals, which is exactly what the DB columns store.
// line_amount and grand_total are NOT in this schema, so anything the client sends for them is dropped.
const createQuotationSchema = z.object({
  enquiry_id: z.number().int().positive(),
  valid_until: dateSchema,
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive(),
        unit_price: z.number().min(0).multipleOf(0.01).optional(),
        discount_pct: z.number().min(0).max(100).multipleOf(0.01).default(0),
        gst_pct: z.number().min(0).max(100).multipleOf(0.01).default(18),
      })
    )
    .min(1)
    // Rule: a product can appear only once per quotation, so a sales order never has two lines for one product.
    .refine((items) => new Set(items.map((item) => item.product_id)).size === items.length, {
      message: 'Each product can appear only once',
    }),
});

// DRAFT is not allowed as a target: a quotation only moves forward.
const changeStatusSchema = z.object({
  status: z.enum(['SENT', 'ACCEPTED', 'REJECTED']),
});

// Both ADMIN and SALES can use every quotation route, so only auth is needed.
router.get('/', auth, async (req, res) => {
  res.json(await quotationService.listQuotations());
});

router.post('/', auth, async (req, res) => {
  const data = createQuotationSchema.parse(req.body);
  res.status(201).json(await quotationService.createQuotation(data, req.user.id));
});

router.get('/:id', auth, async (req, res) => {
  res.json(await quotationService.getQuotation(idSchema.parse(req.params.id)));
});

router.patch('/:id/status', auth, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const { status } = changeStatusSchema.parse(req.body);
  res.json(await quotationService.changeQuotationStatus(id, status));
});

router.post('/:id/convert', auth, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  res.status(201).json(await salesOrderService.convertQuotationToOrder(id));
});

module.exports = router;
