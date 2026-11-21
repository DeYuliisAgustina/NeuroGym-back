import type { Request, Response } from 'express';
import { NIVELES, OBJETIVOS, rutinaService } from '../services/rutina.service';
import { socioDe } from '../utils/contexto';
import { idParam, validar } from '../utils/validar';
import { aplicarVarianteSchema, edicionEjercicioSchema, entrenamientoSchema, preferenciasSchema } from '../validations/modulos.validation';

/** RutinaController: Mi rutina con IA, edición, variantes y entrenamientos (CU-003, Figuras 88 a 97). */
export const rutinaController = {
  async opciones(_req: Request, res: Response) {
    res.json({ objetivos: OBJETIVOS, niveles: NIVELES });
  },
  async catalogo(req: Request, res: Response) {
    res.json(await rutinaService.catalogo(socioDe(req).sedeId));
  },
  /** PUT /api/socios/preferencias — CU-003-001. */
  async registrarPreferencias(req: Request, res: Response) {
    res.json(await rutinaService.registrarPreferencias(socioDe(req), validar(preferenciasSchema, req.body)));
  },
  /** POST /api/rutinas — CU-003. */
  async generarRutina(req: Request, res: Response) {
    res.status(201).json(await rutinaService.generarRutina(socioDe(req), validar(preferenciasSchema, req.body)));
  },
  /** GET /api/rutinas/actual — CU-003-002. */
  async obtenerRutina(req: Request, res: Response) {
    res.json(await rutinaService.obtenerRutina(socioDe(req)));
  },
  /** GET /api/equipos/disponibilidad — CU-003-006. */
  async obtenerDisponibilidad(req: Request, res: Response) {
    res.json(await rutinaService.obtenerDisponibilidad(socioDe(req).sedeId));
  },
  /**
   * PUT /api/ejercicios/{id} — CU-003-003/004/005 (edición) o, con { variante },
   * CU-003-008 (aplicar la variante elegida).
   */
  async actualizarEjercicio(req: Request, res: Response) {
    const id = idParam(req.params.id);
    if (req.body && typeof req.body === 'object' && 'variante' in req.body) {
      const { variante } = validar(aplicarVarianteSchema, req.body);
      return res.json(await rutinaService.aplicarVariante(socioDe(req), id, variante));
    }
    res.json(await rutinaService.actualizarEjercicio(socioDe(req), id, validar(edicionEjercicioSchema, req.body)));
  },
  /** GET /api/ejercicios/{id}/variante — CU-003-007. */
  async sugerirVariante(req: Request, res: Response) {
    res.json(await rutinaService.sugerirVariante(socioDe(req), idParam(req.params.id)));
  },
  /** POST /api/entrenamientos — CU-003-009. */
  async registrarEntrenamiento(req: Request, res: Response) {
    res.status(201).json(await rutinaService.registrarEntrenamiento(socioDe(req), validar(entrenamientoSchema, req.body)));
  },
  /** GET /api/entrenamientos — historial de entrenamientos. */
  async historial(req: Request, res: Response) {
    res.json(await rutinaService.historial(socioDe(req).socioId));
  },
};
