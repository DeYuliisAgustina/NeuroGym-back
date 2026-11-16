import type { Request, Response } from 'express';
import { gimnasioService } from '../services/gimnasio.service';
import { personalService } from '../services/personal.service';
import { planService } from '../services/plan.service';
import { sedeService } from '../services/sede.service';
import { personalDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import {
  actualizarPersonalSchema,
  estadoSchema,
  habilitacionSchema,
  personalSchema,
  politicasSchema,
  precioSchema,
  rolSchema,
  sedeSchema,
} from '../validations/administracion.validation';
import type { CodigoModulo } from '../models/modulos';
import type { TipoPlanSocio } from '@prisma/client';
import { z } from 'zod';

/** Gimnasio, sedes, personal, roles y precios (Panel general del administrador). */
export const administracionController = {
  async gimnasio(req: Request, res: Response) {
    res.json(await gimnasioService.obtener(personalDe(req).gimnasioId));
  },

  async actualizarPoliticas(req: Request, res: Response) {
    const yo = personalDe(req);
    res.json(await gimnasioService.actualizarPoliticas(yo.gimnasioId, yo.usuarioId, validar(politicasSchema, req.body)));
  },

  // ---------------- Sedes ----------------
  async listarSedes(req: Request, res: Response) {
    res.json(await sedeService.listar(personalDe(req).gimnasioId));
  },
  async obtenerSede(req: Request, res: Response) {
    res.json(await sedeService.obtener(idParam(req.params.id), personalDe(req).gimnasioId));
  },
  async crearSede(req: Request, res: Response) {
    const yo = personalDe(req);
    res.status(201).json(await sedeService.crear(yo.gimnasioId, yo.usuarioId, validar(sedeSchema, req.body)));
  },
  async actualizarSede(req: Request, res: Response) {
    const yo = personalDe(req);
    res.json(await sedeService.actualizar(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, validar(sedeSchema.partial(), req.body)));
  },
  async habilitacionSede(req: Request, res: Response) {
    const yo = personalDe(req);
    const { habilitada } = validar(habilitacionSchema, req.body);
    res.json(await sedeService.cambiarHabilitacion(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, habilitada));
  },

  // ---------------- Personal y roles (RF15) ----------------
  async listarPersonal(req: Request, res: Response) {
    res.json(await personalService.listar(personalDe(req).gimnasioId));
  },
  async crearPersonal(req: Request, res: Response) {
    const yo = personalDe(req);
    res.status(201).json(await personalService.crear(yo.gimnasioId, yo.usuarioId, validar(personalSchema, req.body)));
  },
  async actualizarPersonal(req: Request, res: Response) {
    const yo = personalDe(req);
    res.json(await personalService.actualizar(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, validar(actualizarPersonalSchema, req.body)));
  },
  async estadoPersonal(req: Request, res: Response) {
    const yo = personalDe(req);
    const { activo } = validar(estadoSchema, req.body);
    await personalService.cambiarEstado(idParam(req.params.id), yo.gimnasioId, yo, activo);
    res.status(204).end();
  },
  async listarRoles(req: Request, res: Response) {
    res.json(await personalService.listarRoles(personalDe(req).gimnasioId));
  },
  async catalogoModulos(_req: Request, res: Response) {
    res.json(await personalService.catalogoModulos());
  },
  async crearRol(req: Request, res: Response) {
    const yo = personalDe(req);
    const datos = validar(rolSchema, req.body);
    res.status(201).json(
      await personalService.crearRol(yo.gimnasioId, yo.usuarioId, {
        nombre: datos.nombre,
        permisos: datos.permisos.map((p) => ({ modulo: p.modulo as CodigoModulo, acceso: p.acceso })),
      }),
    );
  },
  async actualizarRol(req: Request, res: Response) {
    const yo = personalDe(req);
    const datos = validar(rolSchema.partial(), req.body);
    res.json(
      await personalService.actualizarRol(idParam(req.params.id), yo.gimnasioId, yo.usuarioId, {
        nombre: datos.nombre,
        permisos: datos.permisos?.map((p) => ({ modulo: p.modulo as CodigoModulo, acceso: p.acceso })),
      }),
    );
  },
  async eliminarRol(req: Request, res: Response) {
    const yo = personalDe(req);
    await personalService.eliminarRol(idParam(req.params.id), yo.gimnasioId, yo.usuarioId);
    res.status(204).end();
  },

  // ---------------- Planes y precios (RF16, RF20) ----------------
  async listarPlanes(req: Request, res: Response) {
    res.json(await planService.listar(personalDe(req).gimnasioId));
  },
  async actualizarPrecio(req: Request, res: Response) {
    const yo = personalDe(req);
    const tipo = validar(z.enum(['BASICO', 'PREMIUM']), req.params.tipo) as TipoPlanSocio;
    res.status(201).json(await planService.actualizarPrecio(yo.gimnasioId, tipo, yo, validar(precioSchema, req.body)));
  },
};
