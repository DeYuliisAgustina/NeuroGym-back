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

  // Solo credenciales de PRUEBA de Mercado Pago Developers (la integración rechaza las productivas).
  mercadoPago: {
    accessToken: process.env.MP_ACCESS_TOKEN ?? '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET ?? '',
    // Correo de la cuenta compradora de prueba: pagador obligatorio de las suscripciones en prueba.
    emailPagadorPrueba: process.env.MP_TEST_PAYER_EMAIL ?? '',
    // URL HTTPS pública del frontend (túnel de desarrollo) para los retornos de Mercado Pago.
    urlRetornoPublica: process.env.MP_PUBLIC_FRONTEND_URL ?? '',
    get configurado() {
      return Boolean(this.accessToken);
    },
  },
  mensajeria: {
    whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    // Versión de Graph API (la documentación oficial de Cloud API usa v23.0).
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v23.0',
    // Fuera de producción TODOS los mensajes van solo a este número (habilitado en el
    // número de prueba de Meta). Sin él no se envía nada: nunca a teléfonos de socios.
    destinoPrueba: process.env.WHATSAPP_TEST_RECIPIENT ?? '',
    // Sandbox oficial de 360dialog (gratuito, sin tarjeta): clave obtenida enviando START.
    dialog360ApiKey: process.env.DIALOG360_API_KEY ?? '',
    dialog360Url: process.env.DIALOG360_URL ?? 'https://waba-sandbox.360dialog.io',
    // Fuera de producción, solo los socios de esta lista (correos) generan envíos reales,
    // siempre al número autorizado; el resto queda registrado como OMITIDO.
    sociosPrueba: (process.env.WHATSAPP_SOCIOS_PRUEBA ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    // Webhooks de estado: token de la ruta de 360dialog y, para Meta, clave de la app y token de verificación.
    webhookToken: process.env.WHATSAPP_WEBHOOK_TOKEN ?? '',
    metaAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
    metaVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '',
    /** Proveedor elegido (WHATSAPP_PROVEEDOR) o deducido de las credenciales cargadas. */
    get proveedor(): 'DIALOG360_SANDBOX' | 'META_CLOUD_API' | 'SIMULADO' {
      const elegido = (process.env.WHATSAPP_PROVEEDOR ?? '').toLowerCase();
      if (process.env.NODE_ENV === 'test') return 'SIMULADO';
      if (elegido === '360dialog') return this.dialog360ApiKey ? 'DIALOG360_SANDBOX' : 'SIMULADO';
      if (elegido === 'meta') return this.whatsappToken && this.whatsappPhoneNumberId ? 'META_CLOUD_API' : 'SIMULADO';
      if (elegido === 'simulado') return 'SIMULADO';
      if (this.dialog360ApiKey) return 'DIALOG360_SANDBOX';
      if (this.whatsappToken && this.whatsappPhoneNumberId) return 'META_CLOUD_API';
      return 'SIMULADO';
    },
    get simulado() {
      return this.proveedor === 'SIMULADO';
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
