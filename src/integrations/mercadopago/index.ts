import { env } from '../../config/env';
import { MercadoPagoApiGateway } from './MercadoPagoApiGateway';
import type { MercadoPagoGateway } from './MercadoPagoGateway';
import { MercadoPagoNoConfigurado } from './MercadoPagoNoConfigurado';

export type * from './MercadoPagoGateway';
export { MercadoPagoApiGateway, MercadoPagoNoConfigurado };

/** API oficial (entorno de prueba) si hay credenciales; si no, la integración queda deshabilitada. */
export const crearGatewayMercadoPago = (): MercadoPagoGateway =>
  env.mercadoPago.accessToken ? new MercadoPagoApiGateway() : new MercadoPagoNoConfigurado();
