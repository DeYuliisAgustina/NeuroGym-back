import type { Request, Response } from 'express';
import { z } from 'zod';
import { sedeService } from '../services/sede.service';
import { socioService } from '../services/socio.service';
import { personalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { actualizarSocioSchema, altaSocioSchema, estadoSchema, filtroSociosSchema, socioSchema } from '../validations/administracion.validation';
import { registroSocioSchema } from '../validations/auth.validation';
import { telefonoSchema } from '../validations/comunes.validation';

/** Gestión de socios (personal) y autogestión del socio. */
export const socioController = {
  async listar(req: Request, res: Response) {
    res.json(await socioService.listar(personalDe(req).gimnasioId, validar(filtroSociosSchema, req.query)));
  },
  async obtener(req: Request, res: Response) {
    res.json(await socioService.obtener(idParam(req.params.id), personalDe(req).gimnasioId));
  },
  async crear(req: Request, res: Response) {
    const yo = personalDe(req);
    res.status(201).json(await socioService.crear(yo.gimnasioId, yo.usuarioId, validar(socioSchema, req.body)));
  },
  async actualizar(req: Request, res: Response) {
    const yo = personalDe(req);
    res.json(await socioService.actualizar(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, validar(actualizarSocioSchema, req.body)));
  },
  async cambiarEstado(req: Request, res: Response) {
    const yo = personalDe(req);
    const { activo } = validar(estadoSchema, req.body);
    await socioService.cambiarEstado(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, activo);
    res.status(204).end();
  },

  /** RF2: el personal confirma o rechaza el pre-registro del socio. */
  async resolverAlta(req: Request, res: Response) {
    const yo = personalDe(req);
    const { aprobar } = validar(altaSocioSchema, req.body);
    await socioService.resolverAlta(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, aprobar);
    res.status(204).end();
  },

  // ---------------- Autorregistro (ingreso público) ----------------
  async opcionesRegistro(_req: Request, res: Response) {
    res.json(await socioService.opcionesRegistro());
  },
  async preRegistrar(req: Request, res: Response) {
    res.status(201).json(await socioService.preRegistrar(validar(registroSocioSchema, req.body)));
  },

  // ---------------- Autogestión ----------------
  async perfil(req: Request, res: Response) {
    res.json(await socioService.perfil(socioDe(req).socioId));
  },
  async actualizarPerfil(req: Request, res: Response) {
    const datos = validar(z.object({ telefono: telefonoSchema }), req.body);
    res.json(await socioService.actualizarPerfil(socioDe(req).socioId, datos));
  },
  async cambiarPlan(req: Request, res: Response) {
    const yo = socioDe(req);
    const { plan } = validar(z.object({ plan: z.enum(['BASICO', 'PREMIUM']) }), req.body);
    res.json(await socioService.cambiarPlan(yo.socioId, yo.gimnasioId, yo.usuarioId, plan));
  },
  async sedes(req: Request, res: Response) {
    res.json(await sedeService.listar(socioDe(req).gimnasioId, true));
  },
};
