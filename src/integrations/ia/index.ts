import { env } from '../../config/env';
import type { ServicioIA } from './ServicioIA';
import { ServicioIAClaude } from './ServicioIAClaude';
import { ServicioIASimulado } from './ServicioIASimulado';

export * from './ServicioIA';
export { ServicioIAClaude, ServicioIASimulado };

/** Integración real con Claude si hay credencial; simulación explícita en caso contrario. */
export const servicioIA: ServicioIA = env.ia.simulado ? new ServicioIASimulado() : new ServicioIAClaude();
