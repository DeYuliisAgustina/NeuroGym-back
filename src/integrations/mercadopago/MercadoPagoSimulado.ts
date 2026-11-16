import { env } from '../../config/env';
import type {
  MercadoPagoGateway,
  NotificacionEntrante,
  ResultadoOperacion,
  SolicitudDebito,
  SolicitudPago,
} from './MercadoPagoGateway';

/**
 * SIMULACIÓN de Mercado Pago para desarrollo y pruebas (sin MP_ACCESS_TOKEN).
 * No mueve dinero: redirige a una pantalla del frontend donde se elige el
 * resultado, que vuelve por el mismo flujo de la fachada que un webhook real.
 */
export class MercadoPagoSimulado implements MercadoPagoGateway {
  readonly simulado = true;
  readonly debitosCancelados: string[] = [];

  async crearPago(s: SolicitudPago): Promise<string> {
    return `${env.frontendUrl}/simulador-pago?tipo=PAGO&pagoId=${s.pagoId}&importe=${s.importe}`;
  }

  async crearDebito(s: SolicitudDebito): Promise<string> {
    return `${env.frontendUrl}/simulador-pago?tipo=ADHESION&socioId=${s.socioId}&importe=${s.importeMensual}`;
  }

  async cancelarDebito(idPreaprobacion: string): Promise<void> {
    this.debitosCancelados.push(idPreaprobacion);
  }

  // Sin credenciales no hay firma que validar: los webhooks reales se rechazan.
  validarWebhook(_notificacion: NotificacionEntrante): boolean {
    return false;
  }

  async interpretarNotificacion(_notificacion: NotificacionEntrante): Promise<ResultadoOperacion | null> {
    return null;
  }
}
