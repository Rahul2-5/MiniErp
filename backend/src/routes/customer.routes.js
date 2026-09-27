const express = require('express');
const { z } = require('zod');
const auth = require('../middleware/auth');
const customerService = require('../services/customer.service');

const router = express.Router();

// zod drops any field not listed here, so a client cannot inject e.g. an "id".
const createCustomerSchema = z.object({
  company_name: z.string().min(1),
  contact_person: z.string().min(1),
  mobile: z.string().min(1),
  email: z.email().optional(),
  city: z.string().min(1).optional(),
});

// Both ADMIN and SALES may view and create customers, so only auth is needed.
router.get('/', auth, async (req, res) => {
  res.json(await customerService.listCustomers());
});

router.post('/', auth, async (req, res) => {
  const data = createCustomerSchema.parse(req.body);
  res.status(201).json(await customerService.createCustomer(data));
});

module.exports = router;
