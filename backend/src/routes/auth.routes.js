const express = require('express');
const { z } = require('zod');
const auth = require('../middleware/auth');
const authService = require('../services/auth.service');

const router = express.Router();

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// Public: the only route that needs no token.
router.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await authService.login(email, password));
});

router.get('/me', auth, async (req, res) => {
  res.json(await authService.getCurrentUser(req.user.id));
});

module.exports = router;
