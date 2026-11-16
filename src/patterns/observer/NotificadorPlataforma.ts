import { prisma } from '../../config/prisma';
import { mensajeEvento } from './mensajesTurno';
import type { EventoTurno, ObservadorTurno, TurnoObservado } from './ObservadorTurno';

/**
 * Patrón Observer — observador concreto.
 * Registra la notificación interna para el socio y para el profesional,
 * vinculada al evento que la originó (RF42).
 */
export class NotificadorPlataforma implements ObservadorTurno {
  async actualizar(turno: TurnoObservado, evento: EventoTurno): Promise<void> {
    await prisma.notificacion.createMany({
      data: [
        { usuarioId: turno.socio.usuarioId, mensaje: mensajeEvento(turno, evento, 'SOCIO') },
        { usuarioId: turno.profesional.usuarioId, mensaje: mensajeEvento(turno, evento, 'PROFESIONAL') },
      ].map((n) => ({ ...n, eventoTurnoId: evento.id, tipo: 'TURNO_PROFESIONAL' as const, canal: 'PLATAFORMA' as const })),
    });
  }
}
