/**
 * Reglas de retención usadas por el proceso ETL. Son funciones puras (sin acceso
 * a datos) para poder probarlas de forma aislada.
 *
 * Ventanas: "reciente" = últimos 14 días; "habitual" = promedio quincenal de las
 * 8 semanas anteriores (días 15 a 70). Solo se cuentan asistencias confirmadas (RF35).
 */

export interface HistorialAsistencia {
  /** Asistencias confirmadas en los últimos 14 días. */
  recientes: number;
  /** Asistencias confirmadas entre los días 15 y 70 hacia atrás. */
  previas: number;
  /** Días desde la última asistencia confirmada (null si nunca asistió). */
  diasDesdeUltima: number | null;
}

export type NivelSenal = 'ALTO' | 'MEDIO' | 'BAJO';

export interface Senal {
  tipo: 'Ausencia prolongada' | 'Frecuencia en descenso';
  nivel: NivelSenal;
  detalle: string;
}

/** Promedio de asistencias cada 14 días en las 8 semanas previas. */
export const frecuenciaHabitual = (h: HistorialAsistencia) => h.previas / 4;

/**
 * Detecta señales de posible abandono (CU-002-003). La señal orienta la revisión
 * del administrador: no anticipa que el socio vaya a abandonar.
 */
export function detectarSenal(h: HistorialAsistencia): Senal | null {
  const habitual = frecuenciaHabitual(h);
  // Sin historial previo no hay referencia para comparar.
  if (h.previas === 0 && h.recientes === 0) return null;
  if (h.recientes === 0 && h.previas > 0) {
    const dias = h.diasDesdeUltima ?? 14;
    return {
      tipo: 'Ausencia prolongada',
      nivel: dias >= 21 ? 'ALTO' : 'MEDIO',
      detalle: `Sin asistencias en ${dias} días; frecuencia habitual ${habitual.toFixed(1)} cada 14 días.`,
    };
  }
  if (habitual >= 2 && h.recientes <= habitual * 0.5) {
    return {
      tipo: 'Frecuencia en descenso',
      nivel: h.recientes <= habitual * 0.25 ? 'ALTO' : 'MEDIO',
      detalle: `${h.recientes} asistencias en 14 días contra ${habitual.toFixed(1)} habituales.`,
    };
  }
  if (habitual >= 2 && h.recientes <= habitual * 0.7) {
    return { tipo: 'Frecuencia en descenso', nivel: 'BAJO', detalle: `${h.recientes} asistencias en 14 días contra ${habitual.toFixed(1)} habituales.` };
  }
  return null;
}

export interface Estimacion {
  nivel: NivelSenal;
  puntaje: number;
  fundamento: string;
  recomendacion: string;
}

/**
 * Estimación orientativa del riesgo (NeuroGym Intelligence, CU-002-007).
 * Puntaje de 0 a 100 a partir de la caída de frecuencia, los días sin asistir
 * y la cuota impaga. No determina que el socio vaya a abandonar (RD10).
 */
export function estimarRiesgo(h: HistorialAsistencia, cuotaImpaga: boolean): Estimacion | null {
  const habitual = frecuenciaHabitual(h);
  if (h.previas + h.recientes < 2) return null; // historial insuficiente (CU-002-007 3.1)
  const caida = habitual > 0 ? Math.max(0, 1 - h.recientes / habitual) : 0;
  const ausencia = Math.min(1, (h.diasDesdeUltima ?? 30) / 30);
  const puntaje = Math.round(Math.min(100, caida * 50 + ausencia * 35 + (cuotaImpaga ? 15 : 0)));
  const nivel: NivelSenal = puntaje >= 60 ? 'ALTO' : puntaje >= 35 ? 'MEDIO' : 'BAJO';
  const fundamento =
    `Frecuencia habitual ${habitual.toFixed(1)} cada 14 días; reciente ${h.recientes}. ` +
    `Última asistencia hace ${h.diasDesdeUltima ?? 'más de 70'} días.${cuotaImpaga ? ' Cuota impaga.' : ''}`;
  const recomendacion =
    nivel === 'ALTO'
      ? 'Contactar al socio y proponer un incentivo de regreso (por ejemplo, 7 días de Premium bonificado).'
      : nivel === 'MEDIO'
        ? 'Enviar un recordatorio y destacar los beneficios por constancia disponibles.'
        : 'Mantener en observación.';
  return { nivel, puntaje, fundamento, recomendacion };
}
