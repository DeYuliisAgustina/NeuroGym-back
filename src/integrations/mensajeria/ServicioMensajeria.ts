/** Proveedor de mensajería compatible con WhatsApp (RNF10). */
export type ProveedorMensajeria = 'DIALOG360_SANDBOX' | 'META_CLOUD_API' | 'SIMULADO';

/**
 * Respuesta inmediata del proveedor a una solicitud de envío. «aceptado» significa
 * que el proveedor recibió la solicitud (HTTP 2xx con id de mensaje), NO que el
 * mensaje se haya enviado o entregado: eso lo informan después sus webhooks.
 */
export interface ResultadoEnvio {
  aceptado: boolean;
  idMensaje?: string;
  /** Número al que se dirigió la solicitud (en prueba, siempre el número autorizado). */
  destino?: string;
  error?: string;
}

/**
 * Puerto del servicio de mensajería compatible con WhatsApp (RNF10).
 * Se usa para comprobantes, vencimientos y avisos; el proveedor se cambia sin tocar la lógica de negocio.
 */
export interface ServicioMensajeria {
  readonly proveedor: ProveedorMensajeria;
  readonly simulado: boolean;
  enviar(telefono: string, texto: string): Promise<ResultadoEnvio>;
}
