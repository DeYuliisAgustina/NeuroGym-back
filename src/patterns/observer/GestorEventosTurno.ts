import type { EventoTurno, ObservadorTurno, TurnoObservado } from './ObservadorTurno';

/**
 * Patrón Observer — sujeto.
 * Mantiene la lista de observadores y les comunica cada evento de un turno
 * profesional. Una falla de un canal no impide notificar por los demás.
 */
export class GestorEventosTurno {
  private readonly observadores: ObservadorTurno[] = [];

  suscribir(observador: ObservadorTurno): void {
    if (!this.observadores.includes(observador)) this.observadores.push(observador);
  }

  desuscribir(observador: ObservadorTurno): void {
    const indice = this.observadores.indexOf(observador);
    if (indice >= 0) this.observadores.splice(indice, 1);
  }

  cantidadObservadores(): number {
    return this.observadores.length;
  }

  async notificar(turno: TurnoObservado, evento: EventoTurno): Promise<{ fallidos: number }> {
    const resultados = await Promise.allSettled(this.observadores.map((o) => o.actualizar(turno, evento)));
    const fallidos = resultados.filter((r) => r.status === 'rejected').length;
    if (fallidos > 0 && process.env.NODE_ENV !== 'test') {
      console.warn(`[Observer] ${fallidos} observador(es) fallaron al notificar el evento ${evento.id}`);
    }
    return { fallidos };
  }
}
