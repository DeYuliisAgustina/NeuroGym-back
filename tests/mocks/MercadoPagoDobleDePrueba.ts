import type {
  MercadoPagoGateway,
  NotificacionEntrante,
  ResultadoOperacion,
  SolicitudDebito,
  SolicitudPago,
} from '../../src/integrations/mercadopago';

/**
 * DOBLE DE PRUEBA de Mercado Pago, exclusivo de las pruebas automatizadas
 * (no forma parte de la aplicación). Permite verificar la fachada y las
 * estrategias sin depender de la red ni de credenciales.
 */
export class MercadoPagoDobleDePrueba implements MercadoPagoGateway {
  readonly modo = 'DOBLE_DE_PRUEBA' as const;
  readonly debitosCancelados: string[] = [];
  /** Respuestas que devolverán consultarOrden / consultarPreaprobacion, por id. */
  readonly respuestas = new Map<string, ResultadoOperacion | null>();
  firmaValida = false;

  async crearPago(s: SolicitudPago): Promise<string> {
    return `https://checkout.prueba.local/pago/${s.pagoId}`;
  }

  async crearDebito(s: SolicitudDebito): Promise<string> {
    return `https://checkout.prueba.local/debito/${s.socioId}`;
  }

  async cancelarDebito(idPreaprobacion: string): Promise<void> {
    this.debitosCancelados.push(idPreaprobacion);
  }

  validarWebhook(_n: NotificacionEntrante): boolean {
    return this.firmaValida;
  }

  async interpretarNotificacion(n: NotificacionEntrante): Promise<ResultadoOperacion | null> {
    const id = String((n.cuerpo as { data?: { id?: string } })?.data?.id ?? '');
    return this.respuestas.get(id) ?? null;
  }

  async consultarOrden(ordenId: string): Promise<ResultadoOperacion | null> {
    return this.respuestas.get(ordenId) ?? null;
  }

  /** La orden de un pago se registra en el doble con la clave "pago-{id}", como su external_reference. */
  async consultarOrdenDePago(pagoId: number): Promise<ResultadoOperacion | null> {
    return this.respuestas.get(`pago-${pagoId}`) ?? null;
  }

  async consultarPreaprobacion(id: string): Promise<ResultadoOperacion | null> {
    return this.respuestas.get(id) ?? null;
  }

  /** Cobros de cada suscripción, por id de preaprobación. */
  readonly cobros = new Map<string, ResultadoOperacion[]>();

  async consultarCobrosDeAdhesion(id: string): Promise<ResultadoOperacion[]> {
    return this.cobros.get(id) ?? [];
  }
}
