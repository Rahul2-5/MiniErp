const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

// Rule: every protected route needs a valid "Authorization: Bearer <token>" header, else 401.
// (Spring: the JWT filter in the Spring Security filter chain.)
function auth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'Missing or malformed Authorization header');
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role };
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }

  next();
}

module.exports = auth;
