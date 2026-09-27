const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const AppError = require('../utils/AppError');

async function login(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Rule: same message for unknown email and wrong password, so nobody can probe which emails exist.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'Invalid email or password');
  }

  // Payload is only { id, role }: enough for auth and requireRole without a DB call on every request.
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

  return { token, user: { id: user.id, name: user.name, role: user.role } };
}

async function getCurrentUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true }, // never return password_hash
  });
  if (!user) {
    throw new AppError(404, 'User not found');
  }
  return user;
}

module.exports = { login, getCurrentUser };
