const express = require('express');
const { z } = require('zod');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const productService = require('../services/product.service');

// Mounted at /api because it serves two URL families: /products and /inventory/:productId.
const router = express.Router();

const productIdSchema = z.coerce.number().int().positive();
const updateStockSchema = z.object({
  physical_qty: z.number().int().min(0),
});

router.get('/products', auth, async (req, res) => {
  res.json(await productService.listProducts());
});

// Rule: only ADMIN may change stock (SALES can view but not update).
router.patch('/inventory/:productId', auth, requireRole('ADMIN'), async (req, res) => {
  const productId = productIdSchema.parse(req.params.productId);
  const { physical_qty } = updateStockSchema.parse(req.body);
  res.json(await productService.updatePhysicalStock(productId, physical_qty));
});

module.exports = router;
