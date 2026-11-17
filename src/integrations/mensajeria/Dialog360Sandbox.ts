import { env } from '../../config/env';
import type { DocumentoAdjunto, ResultadoEnvio, ServicioMensajeria } from './ServicioMensajeria';

export interface OpcionesDialog360 {
  apiKey: string;
  url: string;
  /** Número asociado a la clave del sandbox (el que envió START): único destinatario posible. */
  destino: string;
}

/**
 * Sandbox oficial de 360dialog (proveedor de soluciones de WhatsApp Business de Meta).
 * Gratuito y sin método de pago: la clave se obtiene enviando START desde el
 * WhatsApp propio. Límites documentados: un solo destinatario (ese número), 25
 * mensajes por clave (luego responde 429), texto libre y solo plantillas
 * predefinidas. Los estados sent/delivered/read llegan por webhook (HTTPS).
 * Documentación: https://docs.360dialog.com/docs/get-started/sandbox
 */
export class Dialog360Sandbox implements ServicioMensajeria {
  readonly proveedor = 'DIALOG360_SANDBOX' as const;
  readonly simulado = false;

  constructor(
    private readonly opciones: OpcionesDialog360 = {
      apiKey: env.mensajeria.dialog360ApiKey,
      url: env.mensajeria.dialog360Url,
      destino: env.mensajeria.destinoPrueba,
    },
  ) {}

  /** El sandbox solo puede escribirle al número de la clave: el teléfono del socio nunca se usa. */
  async enviar(_telefono: string, texto: string): Promise<ResultadoEnvio> {
    return this.solicitar({ type: 'text', text: { body: texto } });
  }

  /**
   * Documento por enlace HTTPS (el sandbox no permite subir archivos por media ID):
   * WhatsApp lo descarga de la URL y lo entrega como archivo adjunto, con el texto como caption.
   */
  async enviarDocumento(_telefono: string, documento: DocumentoAdjunto): Promise<ResultadoEnvio> {
    return this.solicitar({ type: 'document', document: { link: documento.url, filename: documento.nombreArchivo, caption: documento.texto } });
  }

  private async solicitar(mensaje: Record<string, unknown>): Promise<ResultadoEnvio> {
    const destino = this.opciones.destino.replace(/\D/g, '');
    if (!destino) return { aceptado: false, error: 'Falta WHATSAPP_TEST_RECIPIENT (el número que envió START al sandbox)' };
    try {
      const respuesta = await fetch(`${this.opciones.url}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'D360-API-KEY': this.opciones.apiKey },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: destino, ...mensaje }),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: unknown; meta?: { developer_message?: string } };
      if (!respuesta.ok) {
        const motivo =
          respuesta.status === 429
            ? 'se agotaron los 25 mensajes de la clave del sandbox (enviá START de nuevo para obtener otra)'
            : respuesta.status === 403
              ? 'el destinatario no coincide con el número de la clave del sandbox'
              : respuesta.status === 401
                ? 'clave del sandbox inválida o revocada'
                : (cuerpo.meta?.developer_message ?? JSON.stringify(cuerpo.error ?? cuerpo).slice(0, 200));
        return { aceptado: false, error: `360dialog HTTP ${respuesta.status}: ${motivo}` };
      }
      const id = cuerpo.messages?.[0]?.id;
      if (!id) return { aceptado: false, error: '360dialog respondió sin id de mensaje' };
      return { aceptado: true, idMensaje: id, destino };
    } catch (error) {
      return { aceptado: false, error: (error as Error).message };
    }
  }

  /** Registra la URL HTTPS a la que el sandbox enviará los estados de los mensajes. */
  async configurarWebhook(url: string): Promise<{ ok: boolean; estado: number; detalle: string }> {
    const respuesta = await fetch(`${this.opciones.url}/v1/configs/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'D360-API-KEY': this.opciones.apiKey },
      body: JSON.stringify({ url }),
    });
    return { ok: respuesta.ok, estado: respuesta.status, detalle: (await respuesta.text()).slice(0, 200) };
  }
}
