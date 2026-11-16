import type { EventoTurno, TurnoObservado } from './ObservadorTurno';

const ACCION: Record<EventoTurno['tipo'], string> = {
  CREADO: 'Nueva solicitud de turno',
  CANCELADO: 'Turno cancelado',
  REPROGRAMADO: 'Turno reprogramado',
};

/** Texto del aviso según el evento y el destinatario. */
export function mensajeEvento(turno: TurnoObservado, evento: EventoTurno, destinatario: 'SOCIO' | 'PROFESIONAL'): string {
  const contraparte = destinatario === 'SOCIO' ? turno.profesional.nombre : turno.socio.nombre;
  const base = `${ACCION[evento.tipo]}: ${contraparte}, ${turno.fecha} de ${turno.horaInicio} a ${turno.horaFin} (${turno.modalidad.toLowerCase()}).`;
  return turno.motivo && evento.tipo === 'CANCELADO' ? `${base} Motivo: ${turno.motivo}` : base;
}
