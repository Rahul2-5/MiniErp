const { randomUUID } = require('crypto');

// Rule: document numbers look like ENQ-0001 and are built from the row id.
function formatNo(prefix, id) {
  return `${prefix}-${String(id).padStart(4, '0')}`;
}

// The id is only known after the INSERT, but the number column is NOT NULL and UNIQUE,
// so a new row first gets a throwaway unique number, replaced by formatNo in the same transaction.
function temporaryNo() {
  return `TEMP-${randomUUID()}`;
}

module.exports = { formatNo, temporaryNo };
