import type { Correo, ServicioCorreo } from './ServicioCorreo';

/**
 * SIMULACIÓN de correo para las pruebas automáticas y para cuando no hay Gmail
 * configurado: no envía nada; fuera de las pruebas muestra el correo en la consola
 * del backend para poder copiar el código.
 */
export class CorreoSimulado implements ServicioCorreo {
  readonly proveedor = 'SIMULADO' as const;
  readonly enviados: Correo[] = [];
  /** Permite forzar fallas en las pruebas. */
  fallar = false;

  async enviar(correo: Correo): Promise<void> {
    if (this.fallar) throw new Error('Falla simulada del servicio de correo');
    this.enviados.push(correo);
    if (process.env.NODE_ENV !== 'test') console.log(`[Correo simulado, no se envía] → ${correo.para} | ${correo.asunto}\n${correo.texto}`);
  }
}
