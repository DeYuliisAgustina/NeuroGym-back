import { env } from '../../config/env';
import { MercadoPagoApiGateway } from './MercadoPagoApiGateway';
import type { MercadoPagoGateway } from './MercadoPagoGateway';
import { MercadoPagoSimulado } from './MercadoPagoSimulado';

export type * from './MercadoPagoGateway';
export { MercadoPagoApiGateway, MercadoPagoSimulado };

/** Integración real si hay credenciales; simulación explícita en caso contrario. */
export const crearGatewayMercadoPago = (): MercadoPagoGateway =>
  env.mercadoPago.simulado ? new MercadoPagoSimulado() : new MercadoPagoApiGateway();
