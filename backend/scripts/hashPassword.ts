/**
 * Generates the bcrypt hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run hash-admin-password -- 'my-super-secret'
 */
import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash-admin-password -- 'your-password'");
  process.exit(1);
}
if (password.length < 10) {
  console.error('Choose a password of at least 10 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
console.log('Paste that line into your .env (and Render env vars). Keep the plain password out of the repo.');
