import { MercadoPagoConfig, Payment, PreApproval, Preference, User, WebhookSignatureValidator } from 'mercadopago';
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

  async crearPago(s: SolicitudPago): Promise<string> {
    await this.verificarModoPrueba();
    const frontend = env.mercadoPago.urlRetornoPublica || env.frontendUrl.split(',')[0];
    const preferencia = await new Preference(this.config).create({
      body: {
        items: [{ id: `cuota-${s.pagoId}`, title: s.descripcion, quantity: 1, unit_price: s.importe, currency_id: 'ARS' }],
        // La referencia vincula el pago de Mercado Pago con el pago PENDIENTE de NeuroGym.
        external_reference: `pago:${s.pagoId}`,
        back_urls: {
          success: `${frontend}/socio/cuotas?resultado=aprobado`,
          failure: `${frontend}/socio/cuotas?resultado=rechazado`,
          pending: `${frontend}/socio/cuotas?resultado=pendiente`,
        },
        // Mercado Pago solo acepta el regreso automático hacia URLs públicas (HTTPS).
        ...(frontend.startsWith('https://') ? { auto_return: 'approved' } : {}),
        statement_descriptor: 'NEUROGYM',
      },
      requestOptions: { idempotencyKey: `preferencia-pago-${s.pagoId}` },
    });
    // En el entorno de prueba se usa la URL de sandbox cuando la API la informa.
    return preferencia.sandbox_init_point ?? preferencia.init_point!;
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
        back_url: `${env.mercadoPago.urlRetornoPublica || env.frontendUrl.split(',')[0]}/socio/cuotas?resultado=adhesion`,
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
    const body = (cuerpo ?? {}) as { type?: string; data?: { id?: string } };
    const tipo = body.type ?? String(query.type ?? query.topic ?? '');
    const id = String(body.data?.id ?? query['data.id'] ?? query.id ?? '');
    if (!id) return null;
    if (tipo === 'payment') return this.consultarPago(id);
    if (tipo === 'subscription_preapproval') return this.consultarPreaprobacion(id);
    if (tipo === 'subscription_authorized_payment') return this.consultarCobroRecurrente(id);
    return null;
  }

  async consultarPago(paymentId: string): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    const pago = await new Payment(this.config).get({ id: paymentId });
    // Defensa adicional: nunca se procesa un pago real.
    if (pago.live_mode) return null;
    const ref = pago.external_reference ?? '';
    if (!ref.startsWith('pago:')) return null;
    if (!['approved', 'rejected', 'cancelled'].includes(pago.status ?? '')) return null;
    return { tipo: 'PAGO', pagoId: Number(ref.slice(5)), referenciaExterna: String(pago.id), aprobado: pago.status === 'approved' };
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
