import { prisma } from '../../config/prisma';
import type { ServicioMensajeria } from '../../integrations/mensajeria';
import { mensajeEvento } from './mensajesTurno';
import type { EventoTurno, ObservadorTurno, TurnoObservado } from './ObservadorTurno';

/**
 * Patrón Observer — observador concreto.
 * Envía el aviso por mensajería compatible con WhatsApp al socio. El modelo de
 * datos no registra teléfono del profesional, que recibe el aviso en la plataforma.
 */
export class NotificadorMensajeria implements ObservadorTurno {
  constructor(private readonly mensajeria: ServicioMensajeria) {}

  async actualizar(turno: TurnoObservado, evento: EventoTurno): Promise<void> {
    const texto = `NeuroGym · ${mensajeEvento(turno, evento, 'SOCIO')}`;
    const resultado = await this.mensajeria.enviar(turno.socio.telefono, texto);
    if (!resultado.enviado) throw new Error(resultado.error ?? 'No se pudo enviar el mensaje');
    await prisma.notificacion.create({
      data: { usuarioId: turno.socio.usuarioId, eventoTurnoId: evento.id, tipo: 'TURNO_PROFESIONAL', canal: 'MENSAJERIA', mensaje: texto },
    });
  }
}
