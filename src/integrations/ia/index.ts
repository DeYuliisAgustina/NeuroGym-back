import { env } from '../../config/env';
import type { ServicioIA } from './ServicioIA';
import { ServicioIAClaude } from './ServicioIAClaude';
import { ServicioIAGemini } from './ServicioIAGemini';
import { ServicioIASimulado } from './ServicioIASimulado';

export * from './ServicioIA';
export { ServicioIAClaude, ServicioIAGemini, ServicioIASimulado };

/** Integración real (Gemini o Claude) según la clave cargada; simulación explícita si no hay ninguna. */
export const servicioIA: ServicioIA = {
  GEMINI: () => new ServicioIAGemini(),
  CLAUDE: () => new ServicioIAClaude(),
  SIMULADO: () => new ServicioIASimulado(),
}[env.ia.proveedor]();
