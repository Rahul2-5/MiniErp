const AppError = require('../utils/AppError');

// Rule: only the listed roles may pass, else 403. Always used AFTER auth (it needs req.user).
// Usage: router.post('/x', auth, requireRole('ADMIN'), handler)
// (Spring: @PreAuthorize("hasRole('ADMIN')"))
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(403, 'You do not have permission to do this');
    }
    next();
  };
}

module.exports = requireRole;
