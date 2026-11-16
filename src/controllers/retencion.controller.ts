import type { Request, Response } from 'express';
import { z } from 'zod';
import { procesoEtl } from '../jobs/ProcesoETLAsistencia';
import { beneficioService } from '../services/beneficio.service';
import { retencionService } from '../services/retencion.service';
import { personalDe, socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { fechaSchema, idSchema } from '../validations/comunes.validation';
import { beneficioSchema, decisionSchema, filtroRetencionSchema, propuestaSchema } from '../validations/modulos.validation';

const filtroIntelligence = z.object({ sedeId: idSchema.optional(), desde: fechaSchema.optional(), hasta: fechaSchema.optional() });

/** Constancia y regreso (CU-002), NeuroGym Intelligence y beneficios por constancia. */
export const retencionController = {
  async dashboard(req: Request, res: Response) {
    res.json(await retencionService.dashboard(personalDe(req).gimnasioId, validar(filtroRetencionSchema, req.query)));
  },
  async senales(req: Request, res: Response) {
    res.json(await retencionService.senales(personalDe(req).gimnasioId, validar(filtroRetencionSchema, req.query)));
  },
  async detalleSocio(req: Request, res: Response) {
    res.json(await retencionService.detalleSocio(idParam(req.params.id), personalDe(req).gimnasioId));
  },
  async crearPropuesta(req: Request, res: Response) {
    res.status(201).json(await retencionService.crearPropuesta(personalDe(req), validar(propuestaSchema, req.body)));
  },
  async listarPropuestas(req: Request, res: Response) {
    const { estado } = validar(z.object({ estado: z.enum(['PREPARADA', 'PENDIENTE', 'APROBADA']).optional() }), req.query);
    res.json(await retencionService.listarPropuestas(personalDe(req).gimnasioId, estado));
  },
  async aprobarPropuesta(req: Request, res: Response) {
    res.json(await retencionService.aprobarPropuesta(idParam(req.params.id), personalDe(req)));
  },
  async posponerPropuesta(req: Request, res: Response) {
    res.json(await retencionService.posponerPropuesta(idParam(req.params.id), personalDe(req)));
  },
  /** Ejecución manual del ETL para el gimnasio (además de la tarea nocturna). */
  async ejecutarEtl(req: Request, res: Response) {
    res.json(await procesoEtl.ejecutar(personalDe(req).gimnasioId));
  },

  // ---------------- NeuroGym Intelligence ----------------
  async analitica(req: Request, res: Response) {
    res.json(await retencionService.analitica(personalDe(req).gimnasioId, validar(filtroIntelligence, req.query)));
  },
  async riesgos(req: Request, res: Response) {
    const yo = personalDe(req);
    await retencionService.exigirIntelligence(yo.gimnasioId);
    const { sedeId } = validar(filtroIntelligence, req.query);
    res.json(await retencionService.riesgos(yo.gimnasioId, sedeId));
  },
  async decision(req: Request, res: Response) {
    res.status(201).json(await retencionService.registrarDecision(idParam(req.params.id), personalDe(req), validar(decisionSchema, req.body)));
  },
  async exportar(req: Request, res: Response) {
    const archivo = await retencionService.exportar(personalDe(req).gimnasioId, validar(filtroIntelligence, req.query));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-retencion-neurogym.xlsx"');
    res.send(archivo);
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
