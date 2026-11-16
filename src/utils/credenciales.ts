import crypto from 'node:crypto';

/**
 * Contraseña temporal para cuentas creadas por el gimnasio (socios y personal).
 * Se muestra una sola vez a quien da el alta y el titular puede cambiarla.
 */
export function generarPasswordTemporal(): string {
  const base = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
  return `${base}7a`;
}
