// Crea el archivo .env a partir de .env.example, con JWT_SECRET y QR_SECRET aleatorios.
// No pisa un .env existente. Las credenciales de las integraciones quedan vacías
// (Mercado Pago, WhatsApp y Gemini funcionan simulados hasta que se completen).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const destino = path.join(raiz, '.env');
const plantilla = path.join(raiz, '.env.example');

if (existsSync(destino)) {
  console.log('Ya existe un archivo .env: no se modifica.');
  process.exit(0);
}

const secreto = () => randomBytes(48).toString('base64url');
const contenido = readFileSync(plantilla, 'utf8')
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secreto()}`)
  .replace(/^QR_SECRET=.*$/m, `QR_SECRET=${secreto()}`);
writeFileSync(destino, contenido);

console.log('Se creó .env con JWT_SECRET y QR_SECRET aleatorios.');
console.log('Falta completar DATABASE_URL con el usuario, la clave y la base de tu PostgreSQL. Después:');
console.log('  npx prisma migrate deploy');
console.log('  npm run db:seed');
console.log('  npm run dev');
