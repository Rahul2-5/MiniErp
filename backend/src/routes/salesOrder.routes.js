const express = require('express');
const { z } = require('zod');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const salesOrderService = require('../services/salesOrder.service');

const router = express.Router();

const idSchema = z.coerce.number().int().positive();
const dispatchSchema = z.object({
  vehicle_no: z.string().min(1),
  driver_name: z.string().min(1),
  dispatch_date: z.iso.date().transform((text) => new Date(text)).optional(),
});

// Everyone can view orders.
router.get('/', auth, async (req, res) => {
  res.json(await salesOrderService.listSalesOrders());
});

router.get('/:id', auth, async (req, res) => {
  res.json(await salesOrderService.getSalesOrder(idSchema.parse(req.params.id)));
});

// Rule: only ADMIN may confirm (reserve stock), dispatch or cancel an order.
router.post('/:id/confirm', auth, requireRole('ADMIN'), async (req, res) => {
  res.json(await salesOrderService.confirmSalesOrder(idSchema.parse(req.params.id)));
});

router.post('/:id/dispatch', auth, requireRole('ADMIN'), async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const details = dispatchSchema.parse(req.body);
  res.json(await salesOrderService.dispatchSalesOrder(id, details));
});

router.post('/:id/cancel', auth, requireRole('ADMIN'), async (req, res) => {
  res.json(await salesOrderService.cancelSalesOrder(idSchema.parse(req.params.id)));
});

module.exports = router;
