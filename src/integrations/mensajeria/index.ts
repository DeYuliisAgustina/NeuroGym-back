import { env } from '../../config/env';
import { Dialog360Sandbox } from './Dialog360Sandbox';
import { MensajeriaSimulada } from './MensajeriaSimulada';
import type { ServicioMensajeria } from './ServicioMensajeria';
import { WhatsAppCloudApi } from './WhatsAppCloudApi';

export type * from './ServicioMensajeria';
export * from './estadosWhatsapp';
export { Dialog360Sandbox, MensajeriaSimulada, WhatsAppCloudApi };

/** Proveedor elegido por configuración (WHATSAPP_PROVEEDOR o credenciales cargadas). */
function crearServicioMensajeria(): ServicioMensajeria {
  switch (env.mensajeria.proveedor) {
    case 'DIALOG360_SANDBOX':
      return new Dialog360Sandbox();
    case 'META_CLOUD_API':
      return new WhatsAppCloudApi();
    default:
      return new MensajeriaSimulada();
  }
}

/** Instancia única compartida por comprobantes, vencimientos, avisos y el Observer. */
export const servicioMensajeria: ServicioMensajeria = crearServicioMensajeria();
