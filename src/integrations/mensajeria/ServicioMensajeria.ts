/** Resultado de un envío por mensajería. */
export interface ResultadoEnvio {
  enviado: boolean;
  idMensaje?: string;
  error?: string;
}

/**
 * Puerto del servicio de mensajería compatible con WhatsApp (RNF10).
 * Se usa para comprobantes, vencimientos y avisos de turnos.
 */
export interface ServicioMensajeria {
  readonly simulado: boolean;
  enviar(telefono: string, texto: string): Promise<ResultadoEnvio>;
}
