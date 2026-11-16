import { env } from '../../config/env';
import { MensajeriaSimulada } from './MensajeriaSimulada';
import type { ServicioMensajeria } from './ServicioMensajeria';
import { WhatsAppCloudApi } from './WhatsAppCloudApi';

export type * from './ServicioMensajeria';
export { MensajeriaSimulada, WhatsAppCloudApi };

/** Instancia única compartida por notificaciones, comprobantes y el Observer. */
export const servicioMensajeria: ServicioMensajeria = env.mensajeria.simulado ? new MensajeriaSimulada() : new WhatsAppCloudApi();
