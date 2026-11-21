import type { Request, Response } from 'express';
import { z } from 'zod';
import { analiticaService } from '../services/analitica.service';
import { personalDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { fechaSchema, idSchema } from '../validations/comunes.validation';
import { decisionSchema } from '../validations/modulos.validation';

const filtroAnalitica = z.object({ sedeId: idSchema.optional(), desde: fechaSchema.optional(), hasta: fechaSchema.optional() });

/** IntelligenceController: NeuroGym Intelligence, como en los diagramas de secuencia de CU-002-006 a 009 (Figuras 83 a 86). */
export const intelligenceController = {
  /** GET /api/analitica?sede&periodo — CU-002-006 y CU-002-008. */
  async obtenerAnalitica(req: Request, res: Response) {
    res.json(await analiticaService.obtenerAnalitica(personalDe(req).gimnasioId, validar(filtroAnalitica, req.query)));
  },
  /** GET /api/analitica/socios/{id} — CU-002-007. */
  async analizarSocio(req: Request, res: Response) {
    res.json(await analiticaService.analizarSocio(idParam(req.params.id), personalDe(req).gimnasioId));
  },
  /** POST /api/decisiones — CU-002-008. */
  async registrarDecision(req: Request, res: Response) {
    res.status(201).json(await analiticaService.registrarDecision(personalDe(req), validar(decisionSchema, req.body)));
  },
  /** GET /api/analitica/reporte — CU-002-009 (archivo .xlsx). */
  async generarReporte(req: Request, res: Response) {
    const archivo = await analiticaService.generarReporte(personalDe(req).gimnasioId, validar(filtroAnalitica, req.query));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-retencion-neurogym.xlsx"');
    res.send(archivo);
  },
};
