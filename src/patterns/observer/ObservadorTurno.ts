import type { TipoEventoTurno } from '@prisma/client';

/** Datos del turno profesional que reciben los observadores. */
export interface TurnoObservado {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  modalidad: string;
  motivo: string | null;
  socio: { usuarioId: number; nombre: string; telefono: string };
  profesional: { usuarioId: number; nombre: string; especialidad: string };
}

/** Evento registrado en evento_turno (RD17: CREADO, CANCELADO o REPROGRAMADO). */
export interface EventoTurno {
  id: number;
  tipo: TipoEventoTurno;
  realizadoPorId: number;
}

/**
 * Patrón Observer (comportamiento) — observador.
 * Cada canal de notificación implementa esta interfaz; agregar un canal no
 * requiere modificar el turno ni el gestor (RNF14).
 */
export interface ObservadorTurno {
  actualizar(turno: TurnoObservado, evento: EventoTurno): Promise<void>;
}
