import { GestorEventosTurno, type EventoTurno, type ObservadorTurno, type TurnoObservado } from '../../src/patterns/observer';
import { mensajeEvento } from '../../src/patterns/observer/mensajesTurno';

const turno: TurnoObservado = {
  id: 1,
  fecha: '2026-12-01',
  horaInicio: '09:00',
  horaFin: '09:45',
  modalidad: 'ONLINE',
  motivo: null,
  socio: { usuarioId: 10, nombre: 'Socio Demo', telefono: '341 555-0000' },
  profesional: { usuarioId: 20, nombre: 'Profesional Demo', especialidad: 'NUTRICION' },
};
const evento: EventoTurno = { id: 99, tipo: 'CREADO', realizadoPorId: 10 };

class ObservadorEspia implements ObservadorTurno {
  recibidos: [TurnoObservado, EventoTurno][] = [];
  async actualizar(t: TurnoObservado, e: EventoTurno) {
    this.recibidos.push([t, e]);
  }
}

describe('Patrón Observer: notificaciones de turnos profesionales', () => {
  it('notifica a todos los observadores suscriptos', async () => {
    const gestor = new GestorEventosTurno();
    const a = new ObservadorEspia();
    const b = new ObservadorEspia();
    gestor.suscribir(a);
    gestor.suscribir(b);
    await gestor.notificar(turno, evento);
    expect(a.recibidos).toEqual([[turno, evento]]);
    expect(b.recibidos).toHaveLength(1);
  });

  it('no suscribe dos veces al mismo observador', () => {
    const gestor = new GestorEventosTurno();
    const a = new ObservadorEspia();
    gestor.suscribir(a);
    gestor.suscribir(a);
    expect(gestor.cantidadObservadores()).toBe(1);
  });

  it('un observador desuscripto deja de recibir eventos', async () => {
    const gestor = new GestorEventosTurno();
    const a = new ObservadorEspia();
    gestor.suscribir(a);
    gestor.desuscribir(a);
    await gestor.notificar(turno, evento);
    expect(a.recibidos).toHaveLength(0);
  });

  it('la falla de un canal no impide notificar por los demás', async () => {
    const gestor = new GestorEventosTurno();
    const falla: ObservadorTurno = { actualizar: async () => Promise.reject(new Error('canal caído')) };
    const ok = new ObservadorEspia();
    gestor.suscribir(falla);
    gestor.suscribir(ok);
    const resultado = await gestor.notificar(turno, evento);
    expect(resultado.fallidos).toBe(1);
    expect(ok.recibidos).toHaveLength(1);
  });

  it('el mensaje incluye la contraparte y el motivo de cancelación', () => {
    const cancelado = mensajeEvento({ ...turno, motivo: 'Viaje' }, { ...evento, tipo: 'CANCELADO' }, 'SOCIO');
    expect(cancelado).toContain('Turno cancelado: Profesional Demo');
    expect(cancelado).toContain('Motivo: Viaje');
    expect(mensajeEvento(turno, evento, 'PROFESIONAL')).toContain('Nueva solicitud de turno: Socio Demo');
  });
});
