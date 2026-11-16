import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuración común de las pruebas. Las pruebas de integración usan la base
 * indicada en .env.test (por ejemplo, neurogym_test), nunca la de desarrollo.
 */
process.env.NODE_ENV = 'test';
const archivo = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(archivo)) process.loadEnvFile(archivo);

process.env.JWT_SECRET ??= 'secreto-de-pruebas-no-usar-en-produccion';
process.env.QR_SECRET ??= 'secreto-qr-de-pruebas';
process.env.DATABASE_URL ??= 'postgresql://sin-base@localhost:5432/sin_base_test';
// Las integraciones externas siempre se simulan en las pruebas automatizadas.
process.env.MP_ACCESS_TOKEN = '';
process.env.WHATSAPP_TOKEN = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.UPLOADS_DIR = path.resolve(process.cwd(), 'coverage', 'uploads-test');
