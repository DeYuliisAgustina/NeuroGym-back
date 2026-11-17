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
  /**
   * Inicio de la suscripción. Sin valor, Mercado Pago cobra el primer mes al
   * autorizar; se indica el mes siguiente cuando la cuota del período ya está pagada.
   */
  fechaInicio?: Date;
}

/** Cobro de una suscripción (authorized_payment) informado por Mercado Pago. */
export interface CobroDeSuscripcion {
  tipo: 'DEBITO';
  idPreaprobacion: string;
  /** "ap-{id del authorized_payment}": el mismo id en cada reintento del cobro. */
  referenciaExterna: string;
  aprobado: boolean;
  /**
   * Período facturado ('AAAA-MM'). Mercado Pago no informa un período: se toma
   * el mes (hora de Argentina) en que generó el cobro del ciclo (date_created),
   * que no cambia con los reintentos. Null si no puede determinarse.
   */
  periodo: string | null;
  /** Importe realmente cobrado por Mercado Pago. */
  importe?: number;
  /** Id del pago de Mercado Pago dentro del cobro (trazabilidad). */
  pagoMercadoPago?: string;
  /** Fecha efectiva del débito (debit_date) y número de intento. */
  fechaDebito?: string;
  intento?: number;
}

/** Resultado normalizado de una notificación o consulta a Mercado Pago. */
export type ResultadoOperacion =
  | { tipo: 'PAGO'; pagoId: number; referenciaExterna: string; aprobado: boolean }
  | {
      tipo: 'ADHESION';
      socioId: number;
      idPreaprobacion: string;
      autorizada: boolean;
      /** Estado de la suscripción en Mercado Pago: pending, authorized, paused o cancelled. */
      estado?: string;
    }
  | CobroDeSuscripcion;

/** Origen del registro de un resultado (trazabilidad de la conciliación). */
export type OrigenResultado = 'WEBHOOK' | 'RETORNO' | 'CONCILIACION';

export interface NotificacionEntrante {
  encabezados: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  cuerpo: unknown;
}

/** Estado de la integración, para mostrarlo al iniciar y en la defensa. */
export type ModoIntegracion = 'PRUEBA' | 'NO_CONFIGURADO' | 'DOBLE_DE_PRUEBA';

export interface MercadoPagoGateway {
  readonly modo: ModoIntegracion;
  /** Crea la orden de Checkout Pro (API de Orders) y devuelve la URL de pago (checkout_url). */
  crearPago(solicitud: SolicitudPago): Promise<string>;
  /** Crea la preaprobación del débito automático y devuelve la URL de autorización. */
  crearDebito(solicitud: SolicitudDebito): Promise<string>;
  /** Solicita la baja de la preaprobación (CU-001-010). */
  cancelarDebito(idPreaprobacion: string): Promise<void>;
  /** Verifica la firma del webhook (x-signature) para descartar notificaciones falsas. */
  validarWebhook(notificacion: NotificacionEntrante): boolean;
  /** Consulta a Mercado Pago el recurso notificado y normaliza su resultado. */
  interpretarNotificacion(notificacion: NotificacionEntrante): Promise<ResultadoOperacion | null>;
  /** Consulta una orden de Checkout Pro por su id (notificación "order"). */
  consultarOrden(ordenId: string): Promise<ResultadoOperacion | null>;
  /**
   * Busca la orden asociada a un pago de NeuroGym (external_reference "pago-{id}").
   * Se usa al regresar del checkout: la URL de retorno solo lleva el id interno del pago.
   */
  consultarOrdenDePago(pagoId: number, desde: Date): Promise<ResultadoOperacion | null>;
  /** Consulta una preaprobación por su id (retorno de la autorización del débito). */
  consultarPreaprobacion(idPreaprobacion: string): Promise<ResultadoOperacion | null>;
  /** Cobros ya resueltos (aprobados o rechazados) de una suscripción, para no depender solo del webhook. */
  consultarCobrosDeAdhesion(idPreaprobacion: string): Promise<CobroDeSuscripcion[]>;
}
