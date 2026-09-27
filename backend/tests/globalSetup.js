const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), override: true, quiet: true });

// Runs once before all test files: makes sure the test database has the latest tables and CHECK constraints.
// (migrate deploy only applies existing migrations; it never drops anything.)
module.exports = async () => {
  execSync('npx prisma migrate deploy', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
};
