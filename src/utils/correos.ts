import { env } from '../config/env';

/**
 * RF2: el autorregistro (socios y profesionales) solo acepta correos de proveedores
 * reconocidos, para evitar cuentas con correos inventados (ej. @pepe.com) o temporales.
 * Se pueden sumar dominios propios (empresas, universidades) con CORREOS_DOMINIOS_EXTRA.
 */
export const PROVEEDORES_CORREO = [
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'hotmail.com', 'hotmail.com.ar', 'hotmail.es', 'outlook.com', 'outlook.com.ar', 'outlook.es', 'live.com', 'live.com.ar', 'msn.com',
  // Yahoo
  'yahoo.com', 'yahoo.com.ar', 'yahoo.es', 'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Otros proveedores conocidos
  'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'zoho.com',
  // Proveedores de internet de Argentina
  'fibertel.com.ar', 'arnet.com.ar', 'speedy.com.ar', 'ciudad.com.ar',
] as const;

export const MENSAJE_CORREO_NO_ACEPTADO = 'Usá un correo de un proveedor conocido (Gmail, Hotmail, Outlook, Yahoo, iCloud…)';

export const dominioDe = (email: string) => email.trim().toLowerCase().split('@').pop() ?? '';

export function correoAceptado(email: string): boolean {
  const dominio = dominioDe(email);
  if (!dominio) return false;
  if ((PROVEEDORES_CORREO as readonly string[]).includes(dominio)) return true;
  if (env.correosDominiosExtra.includes(dominio)) return true;
  // «.test» es un dominio reservado (RFC 2606): solo existe en desarrollo y en las pruebas.
  return env.nodeEnv !== 'production' && dominio.endsWith('.test');
}
