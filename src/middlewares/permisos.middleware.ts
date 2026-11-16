import type { NextFunction, Request, Response } from 'express';
import type { TipoAcceso } from '@prisma/client';
import type { CodigoModulo } from '../models/modulos';
import { prohibido } from '../utils/errores';

/**
 * Autorización por módulo para el personal administrativo (RF14, RF15).
 * Delega la evaluación en el Rol armado con el patrón Composite.
 */
export const requierePermiso =
  (modulo: CodigoModulo, acceso: TipoAcceso) => (req: Request, _res: Response, next: NextFunction) => {
    const usuario = req.usuario;
    if (usuario?.tipo !== 'PERSONAL' || !usuario.rol) return next(prohibido());
    if (!usuario.rol.tienePermiso(modulo, acceso)) {
      return next(prohibido(`Tu rol no tiene permiso de ${acceso.toLowerCase()} sobre ${modulo}`));
    }
    next();
  };

/** Solo el administrador general (rol principal). */
export const soloAdminGeneral = (req: Request, _res: Response, next: NextFunction) => {
  if (req.usuario?.tipo !== 'PERSONAL' || !req.usuario.esAdminGeneral) {
    return next(prohibido('Solo el administrador general puede realizar esta operación'));
  }
  next();
};
