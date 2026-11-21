import type { Request, Response } from 'express';
import { equipamientoService } from '../services/equipamiento.service';
import { personalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import {
  actualizarEquipoSchema,
  agruparSchema,
  bajaEquipoSchema,
  disponibilidadEquipoSchema,
  ejerciciosEquipoSchema,
  equipoSchema,
  filtroEquiposSchema,
  filtroIncidenciasSchema,
  gestionIncidenciaSchema,
  incidenciaSchema,
  mantenimientoRealizadoSchema,
  mantenimientoSchema,
} from '../validations/modulos.validation';
import { z } from 'zod';

/** Equipamiento, incidencias y mantenimientos. */
export const equipamientoController = {
  async listar(req: Request, res: Response) {
    res.json(await equipamientoService.listar(personalDe(req).gimnasioId, validar(filtroEquiposSchema, req.query)));
  },
  async crear(req: Request, res: Response) {
    res.status(201).json(await equipamientoService.crear(personalDe(req), validar(equipoSchema, req.body)));
  },
  async actualizar(req: Request, res: Response) {
    res.json(await equipamientoService.actualizar(idParam(req.params.id), personalDe(req), validar(actualizarEquipoSchema, req.body)));
  },
  async disponibilidad(req: Request, res: Response) {
    const { estado } = validar(disponibilidadEquipoSchema, req.body);
    res.json(await equipamientoService.cambiarDisponibilidad(idParam(req.params.id), personalDe(req), estado));
  },
  async baja(req: Request, res: Response) {
    res.json(await equipamientoService.darDeBaja(idParam(req.params.id), personalDe(req), validar(bajaEquipoSchema, req.body)));
  },
  async ejercicios(req: Request, res: Response) {
    const { ejercicioIds } = validar(ejerciciosEquipoSchema, req.body);
    res.json(await equipamientoService.asignarEjercicios(idParam(req.params.id), personalDe(req).gimnasioId, ejercicioIds));
  },
  async historial(req: Request, res: Response) {
    res.json(await equipamientoService.historial(idParam(req.params.id), personalDe(req).gimnasioId));
  },
  async alertas(req: Request, res: Response) {
    res.json(await equipamientoService.alertas(personalDe(req).gimnasioId));
  },

  async listarIncidencias(req: Request, res: Response) {
    res.json(await equipamientoService.listarIncidencias(personalDe(req).gimnasioId, validar(filtroIncidenciasSchema, req.query)));
  },
  async gestionarIncidencia(req: Request, res: Response) {
    res.json(await equipamientoService.gestionarIncidencia(idParam(req.params.id), personalDe(req), validar(gestionIncidenciaSchema, req.body)));
  },
  async agrupar(req: Request, res: Response) {
    const { principalId } = validar(agruparSchema, req.body);
    res.json(await equipamientoService.agruparIncidencia(idParam(req.params.id), principalId, personalDe(req)));
  },

  async listarMantenimientos(req: Request, res: Response) {
    const filtros = validar(z.object({ sedeId: z.coerce.number().int().positive().optional(), estado: z.enum(['PROGRAMADO', 'REALIZADO']).optional() }), req.query);
    res.json(await equipamientoService.listarMantenimientos(personalDe(req).gimnasioId, filtros));
  },
  async programarMantenimiento(req: Request, res: Response) {
    res.status(201).json(await equipamientoService.programarMantenimiento(personalDe(req), validar(mantenimientoSchema, req.body)));
  },
  async mantenimientoRealizado(req: Request, res: Response) {
    res.json(await equipamientoService.registrarRealizado(idParam(req.params.id), personalDe(req), validar(mantenimientoRealizadoSchema, req.body)));
  },

  // ---------------- Socio (RF8) ----------------
  async reportar(req: Request, res: Response) {
    // multipart/form-data: campos de texto + archivos "archivos" (fotos o videos).
    const datos = validar(incidenciaSchema, { equipoId: Number(req.body.equipoId), descripcion: req.body.descripcion });
    const archivos = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
      buffer: f.buffer,
      nombreOriginal: f.originalname,
      mime: f.mimetype,
    }));
    res.status(201).json(await equipamientoService.reportarIncidencia(socioDe(req), datos, archivos));
  },
  async misIncidencias(req: Request, res: Response) {
    res.json(await equipamientoService.misIncidencias(socioDe(req).socioId));
  },
};
