import cron from 'node-cron';
import { env } from '../config/env';
import { avisarProximosVencimientos, generarCuotasPeriodo, marcarCuotasVencidas } from '../services/cuotaGeneracion.service';
import { equipamientoService } from '../services/equipamiento.service';
import { planService } from '../services/plan.service';
import { ejecutarEtlTodos } from './ProcesoETLAsistencia';

type Tarea = { nombre: string; expresion: string; ejecutar: () => Promise<unknown> };

/** Tareas programadas de NeuroGym (zona horaria de los gimnasios). */
export const tareas: Tarea[] = [
  { nombre: 'ETL de asistencia', expresion: '30 2 * * *', ejecutar: () => ejecutarEtlTodos() },
  { nombre: 'Alertas de equipamiento', expresion: '0 8 * * *', ejecutar: () => equipamientoService.notificarAlertas() },
  { nombre: 'Generar cuotas del período', expresion: '5 0 1 * *', ejecutar: () => generarCuotasPeriodo() },
  { nombre: 'Marcar cuotas vencidas', expresion: '15 0 * * *', ejecutar: () => marcarCuotasVencidas() },
  { nombre: 'Avisos de vencimiento', expresion: '0 10 * * *', ejecutar: () => avisarProximosVencimientos() },
  { nombre: 'Sincronizar precios vigentes', expresion: '0 0 * * *', ejecutar: () => planService.sincronizarPreciosVigentes() },
];

/**
 * Puesta al día al iniciar: si el servidor estuvo apagado a la hora de una
 * tarea diaria, se ejecutan las tareas idempotentes (cuotas del período,
 * cuotas vencidas y precios vigentes) para no dejar estados atrasados.
 */
export async function ponerAlDia() {
  const resultado = {
    cuotas: await generarCuotasPeriodo(),
    vencidas: await marcarCuotasVencidas(),
    precios: await planService.sincronizarPreciosVigentes(),
  };
  console.log('[tarea] Puesta al día:', resultado.cuotas, resultado.vencidas);
  return resultado;
}

export function programarTareas() {
  void ponerAlDia().catch((error) => console.error('[tarea] Puesta al día falló', error));
  for (const tarea of tareas) {
    cron.schedule(
      tarea.expresion,
      async () => {
        try {
          console.log(`[tarea] ${tarea.nombre}:`, await tarea.ejecutar());
        } catch (error) {
          console.error(`[tarea] ${tarea.nombre} falló`, error);
        }
      },
      { timezone: env.zonaHoraria },
    );
  }
  console.log(`Tareas programadas: ${tareas.map((t) => t.nombre).join(', ')}`);
}
