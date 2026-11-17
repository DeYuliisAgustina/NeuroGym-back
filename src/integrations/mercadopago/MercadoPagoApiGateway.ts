import { MercadoPagoConfig, Order, PreApproval, User, WebhookSignatureValidator } from 'mercadopago';
import type { CreateOrderRequest } from 'mercadopago/dist/clients/order/create/types';
import type { OrderResponse } from 'mercadopago/dist/clients/order/commonTypes';
import { env } from '../../config/env';
import { ErrorApp } from '../../utils/errores';
import type {
  MercadoPagoGateway,
  NotificacionEntrante,
  ResultadoOperacion,
  SolicitudDebito,
  SolicitudPago,
} from './MercadoPagoGateway';

const valor = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
const importe = (n: number) => n.toFixed(2);

/**
 * Cuerpo de la orden de Checkout Pro (API de Orders). Para Checkout Pro la
 * documentación oficial exige type "online" y processing_mode "manual"; el
 * total debe coincidir con la suma de los ítems.
 */
export function armarOrdenCheckoutPro(s: SolicitudPago, frontend: string): CreateOrderRequest {
  // El id interno del pago viaja en la URL de retorno para confirmar sin depender de parámetros de Mercado Pago.
  const retorno = (resultado: string) => `${frontend}/socio/pagos?resultado=${resultado}&pago=${s.pagoId}`;
  return {
    type: 'online',
    processing_mode: 'manual',
    total_amount: importe(s.importe),
    // La referencia vincula la orden con el pago PENDIENTE de NeuroGym.
    external_reference: `pago:${s.pagoId}`,
    description: s.descripcion,
    items: [{ title: s.descripcion, unit_price: importe(s.importe), quantity: 1, external_code: `cuota-${s.pagoId}` }],
    config: {
      statement_descriptor: 'NEUROGYM',
      online: {
        success_url: retorno('aprobado'),
        failure_url: retorno('rechazado'),
        pending_url: retorno('pendiente'),
        // Mercado Pago solo acepta el regreso automático hacia URLs públicas (HTTPS).
        ...(frontend.startsWith('https://') ? { auto_return: 'approved' as const } : {}),
      },
    },
  };
}

/**
 * Traduce el estado de una orden de Checkout Pro al resultado de NeuroGym
 * (estados oficiales: processed/accredited = aprobada; failed y canceled =
 * rechazada). Mientras la orden sigue abierta (created, processing,
 * action_required) no se registra nada: el comprador todavía puede reintentar.
 */
export function interpretarOrden(orden: OrderResponse): ResultadoOperacion | null {
  const ref = orden.external_reference ?? '';
  if (!ref.startsWith('pago:')) return null;
  const pagoId = Number(ref.slice(5));
  const pagos = orden.transactions?.payments ?? [];
  // Cada intento de cobro es un pago distinto dentro de la orden; se toma el último.
  const ultimo = pagos.at(-1);
  const aprobada = orden.status === 'processed' && (orden.status_detail ?? 'accredited') === 'accredited';
  const rechazada = orden.status === 'failed' || orden.status === 'canceled';
  if (!aprobada && !rechazada) return null;
  return { tipo: 'PAGO', pagoId, referenciaExterna: String(ultimo?.id ?? orden.id), aprobado: aprobada };
}

/**
 * Integración con la API oficial de Mercado Pago (SDK `mercadopago`) en el
 * ENTORNO DE PRUEBA de Mercado Pago Developers. Antes de operar verifica que
 * las credenciales sean de prueba; con credenciales productivas se niega a
 * crear cobros, y descarta cualquier pago informado con live_mode = true.
 */
export class MercadoPagoApiGateway implements MercadoPagoGateway {
  readonly modo = 'PRUEBA' as const;
  private readonly config: MercadoPagoConfig;
  private verificacion: Promise<void> | null = null;

  constructor(private readonly accessToken = env.mercadoPago.accessToken) {
    this.config = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
  }

  /**
   * Las credenciales de prueba de la aplicación empiezan con TEST-; las de una
   * cuenta de prueba (vendedor de prueba) pertenecen a un usuario con la
   * etiqueta test_user. Cualquier otra credencial se considera productiva.
   */
  verificarModoPrueba(): Promise<void> {
    this.verificacion ??= (async () => {
      if (this.accessToken.startsWith('TEST-')) return;
      const usuario = await new User(this.config).get();
      if (!usuario.tags?.includes('test_user')) {
        this.verificacion = null;
        throw new ErrorApp(503, 'MP_CREDENCIAL_PRODUCTIVA', 'NeuroGym solo opera con credenciales de prueba de Mercado Pago Developers');
      }
    })();
    return this.verificacion;
  }

  /** Pago único: orden de Checkout Pro mediante la API de Orders (POST /v1/orders). */
  async crearPago(s: SolicitudPago): Promise<string> {
    await this.verificarModoPrueba();
    const frontend = env.mercadoPago.urlRetornoPublica || env.frontendUrl.split(',')[0];
    const orden = await new Order(this.config).create({
      body: armarOrdenCheckoutPro(s, frontend),
      // X-Idempotency-Key: un reintento de la misma solicitud no crea otra orden.
      requestOptions: { idempotencyKey: `orden-pago-${s.pagoId}` },
    });
    if (!orden.checkout_url) throw new ErrorApp(502, 'MP_SIN_CHECKOUT', 'Mercado Pago no devolvió la URL de pago de la orden');
    return orden.checkout_url;
  }

  async crearDebito(s: SolicitudDebito): Promise<string> {
    await this.verificarModoPrueba();
    // En prueba, el pagador de la suscripción debe ser la cuenta de comprador de prueba.
    const pagador = env.mercadoPago.emailPagadorPrueba;
    if (!pagador) {
      throw new ErrorApp(503, 'MP_FALTA_COMPRADOR_PRUEBA', 'Falta MP_TEST_PAYER_EMAIL (correo de la cuenta compradora de prueba)');
    }
    const preaprobacion = await new PreApproval(this.config).create({
      body: {
        reason: s.descripcion,
        external_reference: `socio:${s.socioId}`,
        payer_email: pagador,
        back_url: `${env.mercadoPago.urlRetornoPublica || env.frontendUrl.split(',')[0]}/socio/pagos?resultado=adhesion`,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: s.importeMensual, currency_id: 'ARS' },
        status: 'pending',
      },
    });
    return preaprobacion.init_point!;
  }

  async cancelarDebito(idPreaprobacion: string): Promise<void> {
    await this.verificarModoPrueba();
    await new PreApproval(this.config).update({ id: idPreaprobacion, body: { status: 'cancelled' } });
  }

  /** Validador oficial del SDK: HMAC-SHA256 de "id:...;request-id:...;ts:...;". */
  validarWebhook({ encabezados, query, cuerpo }: NotificacionEntrante): boolean {
    if (!env.mercadoPago.webhookSecret) return false;
    try {
      WebhookSignatureValidator.validate({
        xSignature: valor(encabezados['x-signature']),
        xRequestId: valor(encabezados['x-request-id']),
        dataId: valor(query['data.id']) ?? (cuerpo as { data?: { id?: string } })?.data?.id,
        secret: env.mercadoPago.webhookSecret,
      });
      return true;
    } catch (error) {
      if (env.nodeEnv !== 'test') console.warn('[Mercado Pago] Firma de webhook rechazada:', (error as { reason?: string }).reason);
      return false;
    }
  }

  async interpretarNotificacion({ query, cuerpo }: NotificacionEntrante): Promise<ResultadoOperacion | null> {
    const body = (cuerpo ?? {}) as { type?: string; live_mode?: boolean; data?: { id?: string } };
    // Defensa adicional: nunca se procesa una notificación de un pago real.
    if (body.live_mode === true) return null;
    const tipo = body.type ?? String(query.type ?? query.topic ?? '');
    const id = String(body.data?.id ?? query['data.id'] ?? query.id ?? '');
    if (!id) return null;
    // Pago único: evento "Order (Mercado Pago)". Débito automático: eventos de Suscripciones.
    if (tipo === 'order') return this.consultarOrden(id);
    if (tipo === 'subscription_preapproval') return this.consultarPreaprobacion(id);
    if (tipo === 'subscription_authorized_payment') return this.consultarCobroRecurrente(id);
    return null;
  }

  /** GET /v1/orders/{id}: el resultado se toma siempre de la API oficial, no de la notificación. */
  async consultarOrden(ordenId: string): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    return interpretarOrden(await new Order(this.config).get({ id: ordenId }));
  }

  /** Busca la orden más reciente del pago de NeuroGym por su referencia externa. */
  async consultarOrdenDePago(pagoId: number, desde: Date): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    const dia = 86_400_000;
    const resultado = await new Order(this.config).search({
      options: {
        external_reference: `pago:${pagoId}`,
        begin_date: new Date(desde.getTime() - dia).toISOString(),
        end_date: new Date(Date.now() + dia).toISOString(),
        sort_by: 'created_date',
        sort_order: 'desc',
      },
    });
    const orden = resultado.data?.find((o) => o.external_reference === `pago:${pagoId}`);
    return orden ? interpretarOrden(orden) : null;
  }

  async consultarPreaprobacion(idPreaprobacion: string): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    const pre = await new PreApproval(this.config).get({ id: idPreaprobacion });
    const ref = pre.external_reference ?? '';
    if (!ref.startsWith('socio:')) return null;
    return { tipo: 'ADHESION', socioId: Number(ref.slice(6)), idPreaprobacion: pre.id!, autorizada: pre.status === 'authorized' };
  }

  /** Cobro mensual de una suscripción. El SDK no expone este recurso: se usa la API REST oficial. */
  private async consultarCobroRecurrente(id: string): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    const respuesta = await fetch(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!respuesta.ok) return null;
    const cobro = (await respuesta.json()) as { id: number; preapproval_id: string; status: string; payment?: { status?: string } };
    const estado = cobro.payment?.status ?? cobro.status;
    if (estado !== 'approved' && estado !== 'rejected') return null;
    return { tipo: 'DEBITO', idPreaprobacion: cobro.preapproval_id, referenciaExterna: `ap-${cobro.id}`, aprobado: estado === 'approved' };
  }
}
