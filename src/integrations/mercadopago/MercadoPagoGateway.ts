/**
 * Puerto de integración con Mercado Pago (RNF9): solo cuotas de socios.
 * NeuroGym no custodia fondos; la confirmación siempre la informa Mercado Pago.
 * En este proyecto la integración opera exclusivamente en el entorno de
 * PRUEBA de Mercado Pago Developers (sin dinero real).
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

/** Resultado normalizado de una notificación o consulta a Mercado Pago. */
export type ResultadoOperacion =
  | { tipo: 'PAGO'; pagoId: number; referenciaExterna: string; aprobado: boolean }
  | { tipo: 'ADHESION'; socioId: number; idPreaprobacion: string; autorizada: boolean }
  | { tipo: 'DEBITO'; idPreaprobacion: string; referenciaExterna: string; aprobado: boolean };

export interface NotificacionEntrante {
  encabezados: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  cuerpo: unknown;
}

/** Estado de la integración, para mostrarlo al iniciar y en la defensa. */
export type ModoIntegracion = 'PRUEBA' | 'NO_CONFIGURADO' | 'DOBLE_DE_PRUEBA';

export interface MercadoPagoGateway {
  readonly modo: ModoIntegracion;
  /** Crea la preferencia de Checkout Pro y devuelve la URL de pago. */
  crearPago(solicitud: SolicitudPago): Promise<string>;
  /** Crea la preaprobación del débito automático y devuelve la URL de autorización. */
  crearDebito(solicitud: SolicitudDebito): Promise<string>;
  /** Solicita la baja de la preaprobación (CU-001-010). */
  cancelarDebito(idPreaprobacion: string): Promise<void>;
  /** Verifica la firma del webhook (x-signature) para descartar notificaciones falsas. */
  validarWebhook(notificacion: NotificacionEntrante): boolean;
  /** Consulta a Mercado Pago el recurso notificado y normaliza su resultado. */
  interpretarNotificacion(notificacion: NotificacionEntrante): Promise<ResultadoOperacion | null>;
  /** Consulta un pago por su id (retorno del checkout o conciliación manual). */
  consultarPago(paymentId: string): Promise<ResultadoOperacion | null>;
  /** Consulta una preaprobación por su id (retorno de la autorización del débito). */
  consultarPreaprobacion(idPreaprobacion: string): Promise<ResultadoOperacion | null>;
}
