import type { Request, Response } from 'express';
import { asistenciaService, type PersonalRecepcion } from '../services/asistencia.service';
import { personalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import {
  asistenciaManualSchema,
  autorizacionSchema,
  bloqueoSchema,
  confirmacionAsistenciaSchema,
  filtroAsistenciasSchema,
  reservaVigenteSchema,
  validacionQrSchema,
} from '../validations/operacion.validation';

function recepcion(req: Request): PersonalRecepcion {
  const yo = personalDe(req);
  return { ...yo, puedeGestionar: yo.rol.tienePermiso('RECEPCION', 'GESTION') };
}

/**
 * AsistenciaController: recepción QR del personal autorizado (CU-004, Figuras 99 a 107)
 * y «Mi QR de ingreso» del socio.
 */
export const asistenciaController = {
  async miQr(req: Request, res: Response) {
    res.status(201).json(await asistenciaService.emitirQr(socioDe(req).socioId));
  },
  async misAsistencias(req: Request, res: Response) {
    res.json(await asistenciaService.misAsistencias(socioDe(req).socioId));
  },

  /** POST /api/qr/validacion — CU-004-002. */
  async validarCodigo(req: Request, res: Response) {
    const { codigo } = validar(validacionQrSchema, req.body);
    res.json(await asistenciaService.validarCodigo(recepcion(req), codigo));
  },
  /** GET /api/reservas/vigente?socioId&sedeId — CU-004-003. */
  async verificarReserva(req: Request, res: Response) {
    const { socioId, sedeId } = validar(reservaVigenteSchema, req.query);
    res.json(await asistenciaService.verificarReserva(recepcion(req), socioId, sedeId));
  },
  /** GET /api/cuotas/{socioId}/estado — CU-004-004. */
  async verificarCuota(req: Request, res: Response) {
    res.json(await asistenciaService.verificarCuota(recepcion(req), idParam(req.params.socioId)));
  },
  /** POST /api/asistencias — CU-004-008 y CU-004-009. */
  async confirmarAsistencia(req: Request, res: Response) {
    res.status(201).json(await asistenciaService.confirmarAsistencia(recepcion(req), validar(confirmacionAsistenciaSchema, req.body)));
  },
  /** POST /api/autorizaciones — CU-004-006. */
  async autorizarIngreso(req: Request, res: Response) {
    res.status(201).json(await asistenciaService.autorizarIngreso(recepcion(req), validar(autorizacionSchema, req.body)));
  },
  /** POST /api/rechazos — CU-004-007. */
  async bloquearIngreso(req: Request, res: Response) {
    res.json(await asistenciaService.bloquearIngreso(recepcion(req), validar(bloqueoSchema, req.body)));
  },
  /** POST /api/asistencias/manual — CU-004-010. */
  async registrarManual(req: Request, res: Response) {
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
