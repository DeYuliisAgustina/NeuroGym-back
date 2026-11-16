import type { NextFunction, Request, Response } from 'express';
import type { TipoUsuario } from '@prisma/client';
import { obtenerContexto, verificarToken } from '../services/auth.service';
import { noAutenticado, prohibido } from '../utils/errores';

/** Verifica el JWT (RNF3) y carga el contexto del usuario desde la base. */
export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  const encabezado = req.headers.authorization;
  if (!encabezado?.startsWith('Bearer ')) return next(noAutenticado('Falta el token de acceso'));
  const payload = verificarToken(encabezado.slice(7));
  req.usuario = await obtenerContexto(payload.sub);
  next();
}

/** Restringe la ruta a uno o más perfiles de usuario. */
export const soloPerfiles =
  (...tipos: TipoUsuario[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario || !tipos.includes(req.usuario.tipo)) return next(prohibido());
    next();
  };
