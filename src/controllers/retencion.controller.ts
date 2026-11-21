import type { Request, Response } from 'express';
import { z } from 'zod';
import { procesoEtl } from '../jobs/ProcesoETLAsistencia';
import { beneficioService } from '../services/beneficio.service';
import { retencionService } from '../services/retencion.service';
import { personalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { beneficioSchema, filtroRetencionSchema, propuestaSchema } from '../validations/modulos.validation';

/**
 * RetencionController: constancia y regreso (CU-002), como en los diagramas de
 * secuencia (Figuras 78 a 82 y 87), y beneficios por constancia.
 */
export const retencionController = {
  /** GET /api/indicadores?filtros — CU-002-001 y CU-002-002. */
  async obtenerIndicadores(req: Request, res: Response) {
    res.json(await retencionService.obtenerIndicadores(personalDe(req).gimnasioId, validar(filtroRetencionSchema, req.query)));
  },
  /** GET /api/senales — CU-002-003. */
  async obtenerSenales(req: Request, res: Response) {
    res.json(await retencionService.obtenerSenales(personalDe(req).gimnasioId, validar(filtroRetencionSchema, req.query)));
  },
  /** GET /api/socios/{id}/asistencia — CU-002-003. */
  async obtenerAsistenciaReciente(req: Request, res: Response) {
    res.json(await retencionService.obtenerAsistenciaReciente(idParam(req.params.id), personalDe(req).gimnasioId));
  },
  /** POST /api/propuestas — CU-002-004 y CU-002-010. */
  async registrarPropuesta(req: Request, res: Response) {
    res.status(201).json(await retencionService.registrarPropuesta(personalDe(req), validar(propuestaSchema, req.body)));
  },
  /** GET /api/propuestas — «Propuestas de incentivo». */
  async listarPropuestas(req: Request, res: Response) {
    const { estado } = validar(z.object({ estado: z.enum(['PREPARADA', 'PENDIENTE', 'APROBADA']).optional() }), req.query);
    res.json(await retencionService.listarPropuestas(personalDe(req).gimnasioId, estado));
  },
  /** POST /api/propuestas/{id}/aprobacion — CU-002-005 y CU-002-010. */
  async aprobarPropuesta(req: Request, res: Response) {
    res.json(await retencionService.aprobarPropuesta(idParam(req.params.id), personalDe(req)));
  },
  /** PATCH /api/propuestas/{id}/pendiente — CU-002-004 5.1. */
  async posponerPropuesta(req: Request, res: Response) {
    res.json(await retencionService.posponerPropuesta(idParam(req.params.id), personalDe(req)));
  },
  /** Ejecución manual del ETL para el gimnasio (además de la tarea nocturna). */
  async ejecutarEtl(req: Request, res: Response) {
    res.json(await procesoEtl.ejecutar(personalDe(req).gimnasioId));
  },

  // ---------------- Beneficios ----------------
  async listarBeneficios(req: Request, res: Response) {
    res.json(await beneficioService.listar(personalDe(req).gimnasioId));
  },
  async crearBeneficio(req: Request, res: Response) {
    res.status(201).json(await beneficioService.crear(personalDe(req).gimnasioId, validar(beneficioSchema, req.body)));
  },
  async actualizarBeneficio(req: Request, res: Response) {
    res.json(await beneficioService.actualizar(idParam(req.params.id), personalDe(req).gimnasioId, validar(beneficioSchema.partial(), req.body)));
  },
  async misBeneficios(req: Request, res: Response) {
    res.json(await beneficioService.resumenSocio(socioDe(req)));
  },
  async canjear(req: Request, res: Response) {
    res.status(201).json(await beneficioService.canjear(socioDe(req), idParam(req.params.id)));
  },
};
