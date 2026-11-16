import { env } from '../../config/env';
import type { ResultadoEnvio, ServicioMensajeria } from './ServicioMensajeria';

/** Normaliza un teléfono argentino al formato internacional sin '+' que exige la API. */
export function normalizarTelefono(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '');
  return digitos.startsWith('54') ? digitos : `54${digitos.replace(/^0/, '')}`;
}

/**
 * Integración con WhatsApp Business Cloud API (Meta Graph API).
 * Requiere WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID. Fuera de la ventana de
 * 24 h, Meta exige plantillas aprobadas: los textos libres pueden ser rechazados.
 */
export class WhatsAppCloudApi implements ServicioMensajeria {
  readonly simulado = false;

  async enviar(telefono: string, texto: string): Promise<ResultadoEnvio> {
    try {
      const respuesta = await fetch(`https://graph.facebook.com/v21.0/${env.mensajeria.whatsappPhoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.mensajeria.whatsappToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizarTelefono(telefono),
          type: 'text',
          text: { body: texto },
        }),
      });
      const cuerpo = (await respuesta.json()) as { messages?: { id: string }[]; error?: { message: string } };
      if (!respuesta.ok) return { enviado: false, error: cuerpo.error?.message ?? `HTTP ${respuesta.status}` };
      return { enviado: true, idMensaje: cuerpo.messages?.[0]?.id };
    } catch (error) {
      return { enviado: false, error: (error as Error).message };
    }
  }
}
