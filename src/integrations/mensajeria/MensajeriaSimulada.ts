import type { ResultadoEnvio, ServicioMensajeria } from './ServicioMensajeria';

/**
 * SIMULACIÓN de mensajería para desarrollo y pruebas: no envía mensajes a
 * personas reales; registra los envíos en memoria y en la consola.
 */
export class MensajeriaSimulada implements ServicioMensajeria {
  readonly simulado = true;
  readonly enviados: { telefono: string; texto: string; fecha: Date }[] = [];
  /** Permite forzar fallas en pruebas (CU-001-007 curso alternativo 3.1). */
  fallar = false;

  async enviar(telefono: string, texto: string): Promise<ResultadoEnvio> {
    if (this.fallar) return { enviado: false, error: 'Falla simulada del servicio de mensajería' };
    this.enviados.push({ telefono, texto, fecha: new Date() });
    if (process.env.NODE_ENV === 'development') console.log(`[WhatsApp simulado] → ${telefono}: ${texto}`);
    return { enviado: true, idMensaje: `sim-${this.enviados.length}` };
  }
}
