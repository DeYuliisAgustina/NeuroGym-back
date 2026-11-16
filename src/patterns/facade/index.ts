import { crearGatewayMercadoPago } from '../../integrations/mercadopago';
import { servicioMensajeria } from '../../integrations/mensajeria';
import { CuotaService } from './CuotaService';

export { CuotaService };

/** Instancia de la fachada usada por los controladores de cuotas y pagos. */
export const cuotaService = new CuotaService(crearGatewayMercadoPago(), servicioMensajeria);
