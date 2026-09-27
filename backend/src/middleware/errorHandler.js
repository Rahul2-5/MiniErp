const { ZodError } = require('zod');
const AppError = require('../utils/AppError');

// Every error in the app ends up here and leaves as { "error": "message" } with the right status.
// The 4th parameter (next) must stay: Express recognises an error handler by its 4 arguments.
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }

  // Rule: invalid request body/params -> 400 with the field names that failed.
  if (err instanceof ZodError) {
    const message = err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    return res.status(400).json({ error: message });
  }

  // Rule: a UNIQUE constraint violation in PostgreSQL -> 409 conflict.
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Record already exists' });
  }

  // Rule: a FOREIGN KEY points at a row that does not exist (e.g. unknown customer_id) -> 400.
  if (err.code === 'P2003') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }

  // Rule: Prisma could not find the row it was asked to update/delete -> 404.
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }

  // Rule: malformed JSON in the request body is the client's mistake, not a server error.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;
