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
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno obligatoria ${nombre}. Creá el archivo .env con «npm run env:crear» (completa JWT_SECRET y QR_SECRET) y revisá DATABASE_URL.`,
    );
  }
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
    // URL HTTPS pública del backend (túnel en desarrollo): WhatsApp descarga de ahí el PDF del comprobante.
    urlPublica: process.env.WHATSAPP_URL_PUBLICA ?? '',
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
    // Gemini (Google AI Studio): clave gratuita, sin tarjeta, con límites del nivel gratuito.
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModelo: process.env.GEMINI_MODELO ?? 'gemini-3.5-flash',
    // Modelos de respaldo si el principal está saturado (503) o agotó su cupo gratuito (429).
    geminiModelosRespaldo: (process.env.GEMINI_MODELOS_RESPALDO ?? 'gemini-3.5-flash-lite,gemini-flash-lite-latest')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    /**
     * Proveedor de IA para rutinas: Gemini si hay clave (y no se pidió la simulación con
     * IA_PROVEEDOR=simulado); si no, la simulación local. En los tests, siempre simulado.
     */
    get proveedor(): 'GEMINI' | 'SIMULADO' {
      if (process.env.NODE_ENV === 'test') return 'SIMULADO';
      if ((process.env.IA_PROVEEDOR ?? '').toLowerCase() === 'simulado') return 'SIMULADO';
      return this.geminiApiKey ? 'GEMINI' : 'SIMULADO';
    },
    get simulado() {
      return this.proveedor === 'SIMULADO';
    },
  },
  correo: {
    // Gmail por SMTP: la cuenta necesita verificación en dos pasos y una «contraseña de aplicación».
    gmailUsuario: process.env.GMAIL_USUARIO ?? '',
    gmailPasswordApp: (process.env.GMAIL_PASSWORD_APP ?? '').replace(/\s+/g, ''),
    nombreRemitente: process.env.CORREO_REMITENTE ?? 'NeuroGym',
    /** Gmail si hay credenciales; si no (y siempre en las pruebas), el código se muestra en la consola. */
    get proveedor(): 'GMAIL' | 'SIMULADO' {
      if (process.env.NODE_ENV === 'test') return 'SIMULADO';
      if ((process.env.CORREO_PROVEEDOR ?? '').toLowerCase() === 'simulado') return 'SIMULADO';
      return this.gmailUsuario && this.gmailPasswordApp ? 'GMAIL' : 'SIMULADO';
    },
  },
  /** Dominios de correo adicionales aceptados en el registro (además de los proveedores conocidos). */
  correosDominiosExtra: (process.env.CORREOS_DOMINIOS_EXTRA ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  almacenamiento: {
    directorioLocal: process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads'),
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024),
    // Vercel Blob: la clave la carga Vercel al conectar el almacenamiento al proyecto.
    blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? '',
    /** Vercel Blob si hay clave (persistente, para la versión publicada); si no, una carpeta local. En las pruebas, siempre local. */
    get proveedor(): 'VERCEL_BLOB' | 'LOCAL' {
      if (process.env.NODE_ENV === 'test') return 'LOCAL';
      return this.blobToken ? 'VERCEL_BLOB' : 'LOCAL';
    },
  },
};
