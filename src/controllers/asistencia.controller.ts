import type { Request, Response } from 'express';
import { asistenciaService, type PersonalRecepcion } from '../services/asistencia.service';
import { personalDe, socioDe } from '../utils/contexto';
import { validar } from '../utils/validar';
import {
  asistenciaManualSchema,
  autorizacionSchema,
  bloqueoSchema,
  filtroAsistenciasSchema,
  ingresoQrSchema,
} from '../validations/operacion.validation';

function recepcion(req: Request): PersonalRecepcion {
  const yo = personalDe(req);
  return { ...yo, puedeGestionar: yo.rol.tienePermiso('RECEPCION', 'GESTION') };
}

/** Recepción QR (personal autorizado) y "Mi QR de ingreso" (socio). */
export const asistenciaController = {
  async miQr(req: Request, res: Response) {
    res.status(201).json(await asistenciaService.emitirQr(socioDe(req).socioId));
  },
  async misAsistencias(req: Request, res: Response) {
    res.json(await asistenciaService.misAsistencias(socioDe(req).socioId));
  },

  /** POST /api/asistencias/qr — CU-004 curso básico. */
  async ingresoQr(req: Request, res: Response) {
    res.json(await asistenciaService.procesarIngresoQr(recepcion(req), validar(ingresoQrSchema, req.body)));
  },
  /** POST /api/asistencias/autorizaciones — CU-004-006. */
  async autorizar(req: Request, res: Response) {
    res.status(201).json(await asistenciaService.autorizarExcepcional(recepcion(req), validar(autorizacionSchema, req.body)));
  },
  /** POST /api/rechazos — CU-004-007 (ruta del diagrama de secuencia). */
  async bloquear(req: Request, res: Response) {
    res.json(await asistenciaService.bloquearIngreso(recepcion(req), validar(bloqueoSchema, req.body)));
  },
  /** POST /api/asistencias/manual — CU-004-010. */
  async manual(req: Request, res: Response) {
    res.json(await asistenciaService.registrarManual(recepcion(req), validar(asistenciaManualSchema, req.body)));
  },
  async listar(req: Request, res: Response) {
    res.json(await asistenciaService.listar(personalDe(req).gimnasioId, validar(filtroAsistenciasSchema, req.query)));
  },
  async rechazos(req: Request, res: Response) {
    const { fecha } = validar(filtroAsistenciasSchema, req.query);
    res.json(await asistenciaService.listarRechazos(personalDe(req).gimnasioId, fecha));
  },
};
