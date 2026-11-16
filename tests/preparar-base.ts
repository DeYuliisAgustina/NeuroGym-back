/**
 * Aplica las migraciones sobre la base de pruebas definida en .env.test.
 * Uso: npm run test:preparar
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

if (!fs.existsSync('.env.test')) {
  console.error('Falta .env.test con DATABASE_URL de la base de pruebas (*_test).');
  process.exit(1);
}
process.loadEnvFile('.env.test');
if (!process.env.DATABASE_URL?.includes('_test')) {
  console.error('Por seguridad, la base de pruebas debe terminar en _test.');
  process.exit(1);
}
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
