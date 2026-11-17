import { ErrorApp } from '../../utils/errores';
import type { CobroDeSuscripcion, MercadoPagoGateway, NotificacionEntrante, ResultadoOperacion } from './MercadoPagoGateway';

const sinConfigurar = () =>
  new ErrorApp(503, 'MP_NO_CONFIGURADO', 'Mercado Pago no está configurado: faltan las credenciales de prueba (MP_ACCESS_TOKEN)');

/**
 * Sin credenciales, NeuroGym no simula pagos: informa que la integración no
 * está configurada. Los dobles de prueba existen solo en las pruebas automatizadas.
 */
export class MercadoPagoNoConfigurado implements MercadoPagoGateway {
  readonly modo = 'NO_CONFIGURADO' as const;
  async crearPago(): Promise<string> {
    throw sinConfigurar();
  }
  async crearDebito(): Promise<string> {
    throw sinConfigurar();
  }
  async cancelarDebito(): Promise<void> {
    throw sinConfigurar();
  }
  validarWebhook(_n: NotificacionEntrante): boolean {
    return false;
  }
  async interpretarNotificacion(): Promise<ResultadoOperacion | null> {
    return null;
  }
  async consultarOrden(): Promise<ResultadoOperacion | null> {
    throw sinConfigurar();
  }
  async consultarOrdenDePago(): Promise<ResultadoOperacion | null> {
    throw sinConfigurar();
  }
  async consultarPreaprobacion(): Promise<ResultadoOperacion | null> {
    throw sinConfigurar();
  }
  async consultarCobrosDeAdhesion(): Promise<CobroDeSuscripcion[]> {
    throw sinConfigurar();
  }
}
