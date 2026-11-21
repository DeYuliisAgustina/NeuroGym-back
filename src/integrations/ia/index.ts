import { env } from '../../config/env';
import type { ServicioIA } from './ServicioIA';
import { ServicioIAGemini } from './ServicioIAGemini';
import { ServicioIASimulado } from './ServicioIASimulado';

export * from './ServicioIA';
export { ServicioIAGemini, ServicioIASimulado };

/** Integración real con Gemini si hay clave; simulación explícita si no la hay. */
export const servicioIA: ServicioIA = env.ia.proveedor === 'GEMINI' ? new ServicioIAGemini() : new ServicioIASimulado();
