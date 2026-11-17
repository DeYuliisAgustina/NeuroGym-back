import type { ServicioMensajeria } from '../../integrations/mensajeria';
import { crearServicioEnvios, type ServicioEnvios } from '../../services/envioMensajes.service';
import { mensajeEvento } from './mensajesTurno';
import type { EventoTurno, ObservadorTurno, TurnoObservado } from './ObservadorTurno';

/**
 * Patrón Observer — observador concreto.
 * Envía el aviso por mensajería compatible con WhatsApp al socio (RF42). El modelo
 * de datos no registra teléfono del profesional, que recibe el aviso en la plataforma.
 * Cada evento genera a lo sumo un mensaje (referencia «turno-evento:{id}»).
 */
export class NotificadorMensajeria implements ObservadorTurno {
  private readonly envios: ServicioEnvios;

  constructor(mensajeria: ServicioMensajeria) {
    this.envios = crearServicioEnvios(mensajeria);
  }

  async actualizar(turno: TurnoObservado, evento: EventoTurno): Promise<void> {
    const texto = `NeuroGym · ${mensajeEvento(turno, evento, 'SOCIO')}`;
    const envio = await this.envios.enviar({
      tipo: 'AVISO',
      referencia: `turno-evento:${evento.id}`,
      usuarioId: turno.socio.usuarioId,
      telefono: turno.socio.telefono,
      texto,
      tipoNotificacion: 'TURNO_PROFESIONAL',
      eventoTurnoId: evento.id,
    });
    if (envio.estado === 'FALLIDO') throw new Error(envio.detalle ?? 'No se pudo enviar el mensaje');
  }
}
