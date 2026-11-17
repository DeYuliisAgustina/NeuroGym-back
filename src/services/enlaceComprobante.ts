import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Enlace firmado y de corta duración para que el proveedor de WhatsApp descargue el
 * PDF de un comprobante. No es un enlace permanente ni público: sin la firma HMAC
 * (derivada del secreto del servidor) o vencido, el backend responde 401/410.
 * Identifica al envío (envio_mensaje), no al pago ni al socio.
 */
export const VIGENCIA_ENLACE_MS = 15 * 60_000;

const clave = () => `${env.jwtSecret}:comprobantes-whatsapp`;
const firma = (envioId: number, vence: number) => crypto.createHmac('sha256', clave()).update(`${envioId}.${vence}`).digest('base64url');

export function enlaceComprobante(base: string, envioId: number, ahora = Date.now()): string {
  const vence = ahora + VIGENCIA_ENLACE_MS;
  return `${base.replace(/\/$/, '')}/api/whatsapp/comprobantes/${envioId}.pdf?vence=${vence}&firma=${firma(envioId, vence)}`;
}

/** 'valido', 'vencido' o 'invalido' (firma ausente o alterada). */
export function verificarEnlace(envioId: number, vence: unknown, recibida: unknown, ahora = Date.now()): 'valido' | 'vencido' | 'invalido' {
  const venceNum = Number(vence);
  if (!Number.isFinite(venceNum) || typeof recibida !== 'string' || !recibida) return 'invalido';
  const esperada = Buffer.from(firma(envioId, venceNum));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !crypto.timingSafeEqual(esperada, dada)) return 'invalido';
  return ahora > venceNum ? 'vencido' : 'valido';
}
