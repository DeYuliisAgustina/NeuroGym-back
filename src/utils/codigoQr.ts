import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * RNF7: el QR es temporal y dinámico, sin datos personales legibles.
 * Formato: <aleatorio>.<firma HMAC>. La firma permite descartar códigos
 * falsificados antes de consultar la base.
 */
export function generarCodigoQr(): string {
  const aleatorio = crypto.randomBytes(24).toString('base64url');
  return `${aleatorio}.${firmar(aleatorio)}`;
}

export function firmaValida(codigo: string): boolean {
  const [aleatorio, firma] = codigo.split('.');
  if (!aleatorio || !firma) return false;
  const esperada = firmar(aleatorio);
  return firma.length === esperada.length && crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
}

function firmar(valor: string): string {
  return crypto.createHmac('sha256', env.qrSecret).update(valor).digest('base64url').slice(0, 43);
}
