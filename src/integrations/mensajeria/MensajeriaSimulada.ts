import type { ResultadoEnvio, ServicioMensajeria } from './ServicioMensajeria';

/**
 * SIMULACIÓN de mensajería para las pruebas automáticas y para cuando no hay
 * proveedor configurado: no envía mensajes a nadie. Sus envíos se registran con
 * estado SIMULADO y nunca se muestran como enviados.
 */
export class MensajeriaSimulada implements ServicioMensajeria {
  readonly proveedor = 'SIMULADO' as const;
  readonly simulado = true;
  readonly enviados: { telefono: string; texto: string; fecha: Date }[] = [];
  /** Permite forzar fallas en pruebas (CU-001-007 curso alternativo 3.1). */
  fallar = false;

  async enviar(telefono: string, texto: string): Promise<ResultadoEnvio> {
    if (this.fallar) return { aceptado: false, error: 'Falla simulada del servicio de mensajería' };
    this.enviados.push({ telefono, texto, fecha: new Date() });
    if (process.env.NODE_ENV === 'development') console.log(`[WhatsApp simulado, no se envía] → ${telefono}: ${texto}`);
    return { aceptado: true, idMensaje: `sim-${Date.now()}-${this.enviados.length}`, destino: telefono };
  }
}
