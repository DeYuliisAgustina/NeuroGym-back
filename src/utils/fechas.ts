import { env } from '../config/env';

/**
 * Utilidades de fecha. Los turnos se guardan como fecha (DATE) y hora (TIME)
 * "de pared" de la sede; la asistencia guarda el instante real (TIMESTAMP).
 * Prisma representa DATE y TIME como Date en UTC, por eso se normalizan aquí.
 */

/** Fecha y minutos del día en la zona horaria de los gimnasios. */
export function ahoraLocal(instante = new Date()): { fecha: string; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  return { fecha: `${v('year')}-${v('month')}-${v('day')}`, minutos: Number(v('hour')) * 60 + Number(v('minute')) };
}

/** 'AAAA-MM-DD' -> Date UTC a medianoche (formato que Prisma usa para DATE). */
export const aFechaDb = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);

/** Date de una columna DATE -> 'AAAA-MM-DD'. */
export const fechaIso = (fecha: Date) => fecha.toISOString().slice(0, 10);

/** 'HH:MM' -> Date de una columna TIME. */
export const aHoraDb = (hora: string) => new Date(`1970-01-01T${hora.length === 5 ? `${hora}:00` : hora}.000Z`);

/** Date de una columna TIME -> 'HH:MM'. */
export const horaTexto = (hora: Date) => hora.toISOString().slice(11, 16);

/** Date de una columna TIME -> minutos desde la medianoche. */
export const minutosDeHora = (hora: Date) => hora.getUTCHours() * 60 + hora.getUTCMinutes();

export function sumarDias(fecha: string, dias: number): string {
  const d = aFechaDb(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return fechaIso(d);
}

/** Período 'AAAA-MM' de una fecha local. */
export const periodoDe = (fecha: string) => fecha.slice(0, 7);

/** Día de la semana (1 = lunes ... 7 = domingo) de una fecha 'AAAA-MM-DD'. */
export function diaSemanaIso(fecha: string): number {
  const d = aFechaDb(fecha).getUTCDay();
  return d === 0 ? 7 : d;
}

export const DIAS_SEMANA = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'] as const;
