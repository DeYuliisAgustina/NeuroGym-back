import type { Request, Response } from 'express';
import { z } from 'zod';
import { profesionalService } from '../services/profesional.service';
import { turnoProfesionalService } from '../services/turnoProfesional.service';
import { profesionalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { fechaSchema } from '../validations/comunes.validation';
import {
  completarSchema,
  disponibilidadSchema,
  filtroProfesionalesSchema,
  metodoPagoSchema,
  motivoSchema,
  perfilProfesionalSchema,
  registroProfesionalSchema,
  reprogramacionSchema,
  servicioSchema,
  solicitudTurnoSchema,
} from '../validations/modulos.validation';

/** Socio o profesional que opera un turno profesional. */
function actor(req: Request) {
  const u = req.usuario!;
  return { usuarioId: u.usuarioId, socioId: u.socioId, profesionalId: u.profesionalId };
}

/** Marketplace de profesionales (perfil profesional y vista del socio Premium). */
export const marketplaceController = {
  async planes(_req: Request, res: Response) {
    res.json(await profesionalService.planes());
  },
  async registrar(req: Request, res: Response) {
    res.status(201).json(await profesionalService.registrar(validar(registroProfesionalSchema, req.body)));
  },

  // ---------------- Profesional ----------------
  async perfil(req: Request, res: Response) {
    res.json(await profesionalService.perfil(profesionalDe(req).profesionalId));
  },
  async actualizarPerfil(req: Request, res: Response) {
    res.json(await profesionalService.actualizarPerfil(profesionalDe(req).profesionalId, validar(perfilProfesionalSchema, req.body)));
  },
  async cambiarPlan(req: Request, res: Response) {
    const { plan } = validar(z.object({ plan: z.enum(['BASICO', 'PROFESIONAL']) }), req.body);
    res.json(await profesionalService.cambiarPlan(profesionalDe(req).profesionalId, plan));
  },
  async crearServicio(req: Request, res: Response) {
    res.status(201).json(await profesionalService.crearServicio(profesionalDe(req).profesionalId, validar(servicioSchema, req.body)));
  },
  async actualizarServicio(req: Request, res: Response) {
    res.json(await profesionalService.actualizarServicio(profesionalDe(req).profesionalId, idParam(req.params.id), validar(servicioSchema.partial(), req.body)));
  },
  async eliminarServicio(req: Request, res: Response) {
    await profesionalService.eliminarServicio(profesionalDe(req).profesionalId, idParam(req.params.id));
    res.status(204).end();
  },
  async crearDisponibilidad(req: Request, res: Response) {
    res.status(201).json(await profesionalService.crearDisponibilidad(profesionalDe(req).profesionalId, validar(disponibilidadSchema, req.body)));
  },
  async eliminarDisponibilidad(req: Request, res: Response) {
    await profesionalService.eliminarDisponibilidad(profesionalDe(req).profesionalId, idParam(req.params.id));
    res.status(204).end();
  },
  async crearMetodoPago(req: Request, res: Response) {
    res.status(201).json(await profesionalService.crearMetodoPago(profesionalDe(req).profesionalId, validar(metodoPagoSchema, req.body)));
  },
  async eliminarMetodoPago(req: Request, res: Response) {
    await profesionalService.eliminarMetodoPago(profesionalDe(req).profesionalId, idParam(req.params.id));
    res.status(204).end();
  },
  async agenda(req: Request, res: Response) {
    const filtros = validar(
      z.object({ estado: z.enum(['SOLICITADO', 'CONFIRMADO', 'RECHAZADO', 'CANCELADO', 'REPROGRAMADO', 'COMPLETADO']).optional(), desde: fechaSchema.optional() }),
      req.query,
    );
    res.json(await turnoProfesionalService.agendaProfesional(profesionalDe(req).profesionalId, filtros));
  },
  async misHorarios(req: Request, res: Response) {
    const { fecha } = validar(z.object({ fecha: fechaSchema }), req.query);
    res.json(await turnoProfesionalService.horariosLibres(profesionalDe(req).profesionalId, fecha));
  },
  async comisiones(req: Request, res: Response) {
    res.json(await profesionalService.comisiones(profesionalDe(req).profesionalId));
  },
  async confirmar(req: Request, res: Response) {
    res.json(await turnoProfesionalService.confirmar(profesionalDe(req), idParam(req.params.id)));
  },
  async rechazar(req: Request, res: Response) {
    const { motivo } = validar(motivoSchema, req.body);
    res.json(await turnoProfesionalService.rechazar(profesionalDe(req), idParam(req.params.id), motivo));
  },
  async completar(req: Request, res: Response) {
    const { importeDeclarado } = validar(completarSchema, req.body);
    res.json(await turnoProfesionalService.completar(profesionalDe(req), idParam(req.params.id), importeDeclarado));
  },

  // ---------------- Socio Premium ----------------
  async listarProfesionales(req: Request, res: Response) {
    res.json(await profesionalService.listarParaSocios(validar(filtroProfesionalesSchema, req.query)));
  },
  async perfilPublico(req: Request, res: Response) {
    res.json(await profesionalService.perfilPublico(idParam(req.params.id)));
  },
  async horarios(req: Request, res: Response) {
    const { fecha } = validar(z.object({ fecha: fechaSchema }), req.query);
    res.json(await turnoProfesionalService.horariosLibres(idParam(req.params.id), fecha));
  },
  async solicitar(req: Request, res: Response) {
    res.status(201).json(await turnoProfesionalService.solicitar(socioDe(req), validar(solicitudTurnoSchema, req.body)));
  },
  async misTurnos(req: Request, res: Response) {
    res.json(await turnoProfesionalService.listarDelSocio(socioDe(req).socioId));
  },

  // ---------------- Comunes a socio y profesional ----------------
  async cancelar(req: Request, res: Response) {
    const { motivo } = validar(motivoSchema, req.body);
    res.json(await turnoProfesionalService.cancelar(actor(req), idParam(req.params.id), motivo));
  },
  async reprogramar(req: Request, res: Response) {
    res.json(await turnoProfesionalService.reprogramar(actor(req), idParam(req.params.id), validar(reprogramacionSchema, req.body)));
  },
  async eventos(req: Request, res: Response) {
    res.json(await turnoProfesionalService.eventos(idParam(req.params.id), actor(req)));
  },
  async calendario(req: Request, res: Response) {
    const evento = await turnoProfesionalService.calendario(idParam(req.params.id), actor(req));
    if (req.query.formato === 'ics') {
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="consulta-neurogym-${req.params.id}.ics"`);
      return res.send(evento.ics);
    }
    res.json(evento);
  },
};
