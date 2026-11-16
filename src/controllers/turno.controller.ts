import type { Request, Response } from 'express';
import { z } from 'zod';
import { reservaService } from '../services/reserva.service';
import { turnoService } from '../services/turno.service';
import { personalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { actualizarTurnoSchema, filtroTurnosSchema, serieTurnosSchema, turnoSchema } from '../validations/administracion.validation';
import { filtroDisponiblesSchema, reservaSchema } from '../validations/operacion.validation';

/** Configuración de turnos (personal) y reservas (socio). */
export const turnoController = {
  async listar(req: Request, res: Response) {
    res.json(await turnoService.listar(personalDe(req).gimnasioId, validar(filtroTurnosSchema, req.query)));
  },
  async crear(req: Request, res: Response) {
    const yo = personalDe(req);
    res.status(201).json(await turnoService.crear(yo.gimnasioId, yo.usuarioId, validar(turnoSchema, req.body)));
  },
  async crearSerie(req: Request, res: Response) {
    const yo = personalDe(req);
    res.status(201).json(await turnoService.crearSerie(yo.gimnasioId, yo.usuarioId, validar(serieTurnosSchema, req.body)));
  },
  async actualizar(req: Request, res: Response) {
    const yo = personalDe(req);
    res.json(await turnoService.actualizar(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, validar(actualizarTurnoSchema, req.body)));
  },
  async habilitacion(req: Request, res: Response) {
    const yo = personalDe(req);
    const { habilitado } = validar(z.object({ habilitado: z.boolean() }), req.body);
    res.json(await turnoService.cambiarHabilitacion(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, habilitado));
  },
  async reservasDelTurno(req: Request, res: Response) {
    res.json(await turnoService.reservasDelTurno(idParam(req.params.id), personalDe(req).gimnasioId));
  },

  // ---------------- Socio ----------------
  async disponibles(req: Request, res: Response) {
    res.json(await reservaService.disponibles(socioDe(req), validar(filtroDisponiblesSchema, req.query)));
  },
  async reservar(req: Request, res: Response) {
    const { turnoId } = validar(reservaSchema, req.body);
    res.status(201).json(await reservaService.reservar(socioDe(req), turnoId));
  },
  async cancelarReserva(req: Request, res: Response) {
    res.json(await reservaService.cancelar(socioDe(req), idParam(req.params.id)));
  },
  async misReservas(req: Request, res: Response) {
    res.json(await reservaService.misReservas(socioDe(req).socioId));
  },
};
