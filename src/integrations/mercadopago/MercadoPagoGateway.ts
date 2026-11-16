/**
 * Puerto de integración con Mercado Pago (RNF9): solo cuotas de socios.
 * NeuroGym no custodia fondos; la confirmación siempre la informa Mercado Pago.
 */

export interface SolicitudPago {
  pagoId: number;
  descripcion: string;
  importe: number;
  emailPagador: string;
}

export interface SolicitudDebito {
  socioId: number;
  descripcion: string;
  importeMensual: number;
  emailPagador: string;
}

/** Resultado normalizado de una notificación (webhook o simulador). */
export type ResultadoOperacion =
  | { tipo: 'PAGO'; pagoId: number; referenciaExterna: string; aprobado: boolean }
  | { tipo: 'ADHESION'; socioId: number; idPreaprobacion: string; autorizada: boolean }
  | { tipo: 'DEBITO'; idPreaprobacion: string; referenciaExterna: string; aprobado: boolean };

export interface NotificacionEntrante {
  encabezados: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  cuerpo: unknown;
}

export interface MercadoPagoGateway {
  readonly simulado: boolean;
  /** Crea la preferencia de pago único y devuelve la URL de pago. */
  crearPago(solicitud: SolicitudPago): Promise<string>;
  /** Crea la preaprobación del débito automático y devuelve la URL de autorización. */
  crearDebito(solicitud: SolicitudDebito): Promise<string>;
  /** Solicita la baja de la preaprobación (CU-001-010). */
  cancelarDebito(idPreaprobacion: string): Promise<void>;
  /** Verifica la firma del webhook (x-signature) para descartar notificaciones falsas. */
  validarWebhook(notificacion: NotificacionEntrante): boolean;
  /** Consulta a Mercado Pago el recurso notificado y normaliza su resultado. */
  interpretarNotificacion(notificacion: NotificacionEntrante): Promise<ResultadoOperacion | null>;
}
