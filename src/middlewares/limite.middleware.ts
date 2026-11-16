import type { NextFunction, Request, Response } from 'express';
import { ErrorApp } from '../utils/errores';

const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 20;
const intentos = new Map<string, { cantidad: number; desde: number }>();

/**
 * Limita los intentos de inicio de sesión por IP para mitigar ataques de fuerza bruta.
 * Implementación en memoria, suficiente para una instancia; en producción
 * con varias instancias debería compartirse el contador.
 */
export function limitarIntentos(req: Request, _res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'test') return next();
  const clave = req.ip ?? 'desconocida';
  const ahora = Date.now();
  const registro = intentos.get(clave);
  if (!registro || ahora - registro.desde > VENTANA_MS) {
    intentos.set(clave, { cantidad: 1, desde: ahora });
    return next();
  }
  registro.cantidad += 1;
  if (registro.cantidad > MAX_INTENTOS) {
    return next(new ErrorApp(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos. Probá nuevamente en unos minutos.'));
  }
  next();
}
