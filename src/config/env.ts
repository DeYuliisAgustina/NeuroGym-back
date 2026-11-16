/**
 * Configuración centralizada de variables de entorno.
 * Se cargan desde .env con el soporte nativo de Node (process.loadEnvFile).
 */
import fs from 'node:fs';
import path from 'node:path';

const archivoEnv = path.resolve(process.cwd(), process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
if (fs.existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno obligatoria ${nombre}`);
  return valor;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  puerto: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  jwtSecret: requerida('JWT_SECRET'),
  jwtExpiracion: process.env.JWT_EXPIRES_IN ?? '8h',
  // Clave HMAC para firmar los códigos QR (RNF7); distinta del secreto JWT.
  qrSecret: requerida('QR_SECRET'),
  qrVigenciaSeg: Number(process.env.QR_TTL_SECONDS ?? 120),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  backendUrlPublica: process.env.PUBLIC_BACKEND_URL ?? 'http://localhost:3000',
  zonaHoraria: process.env.TZ_GIMNASIOS ?? 'America/Argentina/Buenos_Aires',
  puntosPorDia: Number(process.env.PUNTOS_POR_DIA ?? 10),
  cronHabilitado: process.env.CRON_ENABLED === 'true',

  mercadoPago: {
    accessToken: process.env.MP_ACCESS_TOKEN ?? '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET ?? '',
    // Sin token de acceso se usa el simulador local (nunca cobra dinero real).
    get simulado() {
      return !this.accessToken;
    },
  },
  mensajeria: {
    whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    get simulado() {
      return !this.whatsappToken || !this.whatsappPhoneNumberId;
    },
  },
  ia: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    modelo: process.env.IA_MODELO ?? 'claude-opus-5-5',
    get simulado() {
      return !this.anthropicApiKey;
    },
  },
  almacenamiento: {
    directorioLocal: process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024),
  },
};
