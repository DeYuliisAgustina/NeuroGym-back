import type { Request, Response } from 'express';
import { entrenamientoService, NIVELES, OBJETIVOS } from '../services/entrenamiento.service';
import { socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { aplicarVarianteSchema, edicionEjercicioSchema, entrenamientoSchema, preferenciasSchema } from '../validations/modulos.validation';

/** Mi rutina: generación con IA, edición, variantes y entrenamientos (CU-003). */
export const entrenamientoController = {
  async opciones(_req: Request, res: Response) {
    res.json({ objetivos: OBJETIVOS, niveles: NIVELES });
  },
  async catalogo(req: Request, res: Response) {
    res.json(await entrenamientoService.catalogo(socioDe(req).sedeId));
  },
  async rutina(req: Request, res: Response) {
    res.json(await entrenamientoService.rutinaActual(socioDe(req)));
  },
  /** POST /api/socio/rutina — CU-003 (incluye CU-003-001). */
  async generar(req: Request, res: Response) {
    res.status(201).json(await entrenamientoService.generarRutina(socioDe(req), validar(preferenciasSchema, req.body)));
  },
  async editarEjercicio(req: Request, res: Response) {
    res.json(await entrenamientoService.editarEjercicio(socioDe(req), idParam(req.params.id), validar(edicionEjercicioSchema, req.body)));
  },
  async variante(req: Request, res: Response) {
    res.json(await entrenamientoService.verVariante(socioDe(req), idParam(req.params.id)));
  },
  async aplicarVariante(req: Request, res: Response) {
    const { ejercicioId } = validar(aplicarVarianteSchema, req.body);
    res.json(await entrenamientoService.aplicarVariante(socioDe(req), idParam(req.params.id), ejercicioId));
  },
  async registrarEntrenamiento(req: Request, res: Response) {
    res.status(201).json(await entrenamientoService.registrarEntrenamiento(socioDe(req), validar(entrenamientoSchema, req.body)));
  },
  async historial(req: Request, res: Response) {
    res.json(await entrenamientoService.historial(socioDe(req).socioId));
  },
};
