import crypto from 'node:crypto';
import { MercadoPagoConfig, Payment, PreApproval, Preference } from 'mercadopago';
import { env } from '../../config/env';
import type {
  MercadoPagoGateway,
  NotificacionEntrante,
  ResultadoOperacion,
  SolicitudDebito,
  SolicitudPago,
} from './MercadoPagoGateway';

const valor = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Integración real con la API de Mercado Pago (SDK oficial).
 * Requiere MP_ACCESS_TOKEN (credenciales de prueba en desarrollo) y MP_WEBHOOK_SECRET.
 */
export class MercadoPagoApiGateway implements MercadoPagoGateway {
  readonly simulado = false;
  private readonly config: MercadoPagoConfig;

  constructor(private readonly accessToken = env.mercadoPago.accessToken) {
    this.config = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
  }

  private get urlNotificaciones() {
    return `${env.backendUrlPublica}/api/pagos/webhook`;
  }

  async crearPago(s: SolicitudPago): Promise<string> {
    const preferencia = await new Preference(this.config).create({
      body: {
        items: [{ id: `cuota-${s.pagoId}`, title: s.descripcion, quantity: 1, unit_price: s.importe, currency_id: 'ARS' }],
        payer: { email: s.emailPagador },
        // La referencia vincula el pago de Mercado Pago con el pago PENDIENTE de NeuroGym.
        external_reference: `pago:${s.pagoId}`,
        notification_url: this.urlNotificaciones,
        back_urls: {
          success: `${env.frontendUrl}/socio/cuotas?resultado=aprobado`,
          failure: `${env.frontendUrl}/socio/cuotas?resultado=rechazado`,
          pending: `${env.frontendUrl}/socio/cuotas?resultado=pendiente`,
        },
      },
      requestOptions: { idempotencyKey: `pago-${s.pagoId}` },
    });
    return preferencia.init_point!;
  }

  async crearDebito(s: SolicitudDebito): Promise<string> {
    const preaprobacion = await new PreApproval(this.config).create({
      body: {
        reason: s.descripcion,
        external_reference: `socio:${s.socioId}`,
        payer_email: s.emailPagador,
        back_url: `${env.frontendUrl}/socio/cuotas?resultado=adhesion`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: s.importeMensual,
          currency_id: 'ARS',
        },
        status: 'pending',
      },
    });
    return preaprobacion.init_point!;
  }

  async cancelarDebito(idPreaprobacion: string): Promise<void> {
    await new PreApproval(this.config).update({ id: idPreaprobacion, body: { status: 'cancelled' } });
  }

  /**
   * Firma de Mercado Pago: x-signature = "ts=...,v1=HMAC_SHA256(secret, manifest)"
   * con manifest "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
   */
  validarWebhook({ encabezados, query, cuerpo }: NotificacionEntrante): boolean {
    if (!env.mercadoPago.webhookSecret) return false;
    const firma = valor(encabezados['x-signature']);
    const requestId = valor(encabezados['x-request-id']);
    if (!firma || !requestId) return false;
    const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=') as [string, string]));
    const dataId = String(query['data.id'] ?? (cuerpo as { data?: { id?: string } })?.data?.id ?? '').toLowerCase();
    const manifiesto = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;
    const esperado = crypto.createHmac('sha256', env.mercadoPago.webhookSecret).update(manifiesto).digest('hex');
    return (
      typeof partes.v1 === 'string' &&
      partes.v1.length === esperado.length &&
      crypto.timingSafeEqual(Buffer.from(partes.v1), Buffer.from(esperado))
    );
  }

  async interpretarNotificacion({ query, cuerpo }: NotificacionEntrante): Promise<ResultadoOperacion | null> {
    const body = (cuerpo ?? {}) as { type?: string; data?: { id?: string } };
    const tipo = body.type ?? String(query.type ?? query.topic ?? '');
    const id = String(body.data?.id ?? query['data.id'] ?? query.id ?? '');
    if (!id) return null;

    if (tipo === 'payment') {
      const pago = await new Payment(this.config).get({ id });
      const ref = pago.external_reference ?? '';
      if (!ref.startsWith('pago:')) return null;
      if (pago.status !== 'approved' && pago.status !== 'rejected' && pago.status !== 'cancelled') return null;
      return { tipo: 'PAGO', pagoId: Number(ref.slice(5)), referenciaExterna: String(pago.id), aprobado: pago.status === 'approved' };
    }
    if (tipo === 'subscription_preapproval') {
      const pre = await new PreApproval(this.config).get({ id });
      const ref = pre.external_reference ?? '';
      if (!ref.startsWith('socio:')) return null;
      return { tipo: 'ADHESION', socioId: Number(ref.slice(6)), idPreaprobacion: pre.id!, autorizada: pre.status === 'authorized' };
    }
    if (tipo === 'subscription_authorized_payment') {
      // El SDK no expone este recurso: se consulta la API REST con el mismo token.
      const respuesta = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!respuesta.ok) return null;
      const cobro = (await respuesta.json()) as { id: number; preapproval_id: string; status: string; payment?: { status?: string } };
      const estado = cobro.payment?.status ?? cobro.status;
      if (estado !== 'approved' && estado !== 'rejected') return null;
      return { tipo: 'DEBITO', idPreaprobacion: cobro.preapproval_id, referenciaExterna: `ap-${cobro.id}`, aprobado: estado === 'approved' };
    }
    return null;
  }
}
