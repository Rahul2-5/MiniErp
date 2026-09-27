const express = require('express');
const { z } = require('zod');
const auth = require('../middleware/auth');
const enquiryService = require('../services/enquiry.service');

const router = express.Router();

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.iso.date().transform((text) => new Date(text)); // "2026-10-01" -> Date

const createEnquirySchema = z.object({
  customer_id: z.number().int().positive(),
  enquiry_date: dateSchema.optional(),
  required_date: dateSchema.optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1)
    // Rule: a product can appear only once per enquiry (keeps quantities unambiguous downstream).
    .refine((items) => new Set(items.map((item) => item.product_id)).size === items.length, {
      message: 'Each product can appear only once',
    }),
});

// The only manual status change: give up on an enquiry. Everything else is set by quotation events.
const markLostSchema = z.object({
  status: z.literal('LOST'),
});

// Both ADMIN and SALES can use every enquiry route, so only auth is needed.
router.get('/', auth, async (req, res) => {
  res.json(await enquiryService.listEnquiries());
});

router.post('/', auth, async (req, res) => {
  const data = createEnquirySchema.parse(req.body);
  res.status(201).json(await enquiryService.createEnquiry(data, req.user.id));
});

router.get('/:id', auth, async (req, res) => {
  res.json(await enquiryService.getEnquiry(idSchema.parse(req.params.id)));
});

router.patch('/:id/status', auth, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  markLostSchema.parse(req.body);
  res.json(await enquiryService.markEnquiryLost(id));
});

module.exports = router;
