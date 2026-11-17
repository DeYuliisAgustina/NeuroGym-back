import { MercadoPagoConfig, Order, PreApproval, User, WebhookSignatureValidator } from 'mercadopago';
import type { CreateOrderRequest } from 'mercadopago/dist/clients/order/create/types';
import type { OrderResponse } from 'mercadopago/dist/clients/order/commonTypes';
import { env } from '../../config/env';
import { ErrorApp } from '../../utils/errores';
import { ahoraLocal, periodoDe } from '../../utils/fechas';
import type {
  CobroDeSuscripcion,
  MercadoPagoGateway,
  NotificacionEntrante,
  ResultadoOperacion,
  SolicitudDebito,
  SolicitudPago,
} from './MercadoPagoGateway';

const valor = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
const importe = (n: number) => n.toFixed(2);

/**
 * Una cuenta de prueba de Mercado Pago Developers se reconoce por la etiqueta
 * test_user, por el apodo TESTUSER… o por el correo @testuser.com que Mercado
 * Pago les asigna. Cualquier otra cuenta se trata como productiva.
 */
export function esCuentaDePrueba(usuario: { tags?: string[]; nickname?: string; email?: string }): boolean {
  return Boolean(usuario.tags?.includes('test_user') || /^TESTUSER/i.test(usuario.nickname ?? '') || /@testuser\.com$/i.test(usuario.email ?? ''));
}

/**
 * external_reference de la orden de un pago de NeuroGym. La API de Orders solo
 * admite letras, números, guion y guion bajo (rechaza "pago:42" con HTTP 400
 * "does not match pattern"), por eso se usa "pago-42".
 */
export const referenciaDePago = (pagoId: number) => `pago-${pagoId}`;
const REFERENCIA_PAGO = /^pago-(\d+)$/;

/**
 * back_url de la suscripción (débito automático). La API de Suscripciones rechaza
 * el host "localhost" (HTTP 400 "Invalid value for back_url"), pero acepta
 * 127.0.0.1. Sin URL pública, en desarrollo el regreso pasa por el backend
 * (127.0.0.1), que redirige al frontend en el mismo origen donde el socio inició
 * sesión, conservando el preapproval_id.
 */
export function urlRetornoAdhesion(publica = env.mercadoPago.urlRetornoPublica, puerto = env.puerto): string {
  if (publica) return `${publica}/socio/pagos?resultado=adhesion`;
  return `http://127.0.0.1:${puerto}/api/pagos/retorno-adhesion`;
}

/** Destino del regreso local: el frontend, solo con el id de la preaprobación (sin otros parámetros). */
export function destinoRetornoAdhesion(preapprovalId: unknown, frontend = env.frontendUrl.split(',')[0]): string {
  const id = typeof preapprovalId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(preapprovalId) ? preapprovalId : '';
  return `${frontend}/socio/pagos?resultado=adhesion${id ? `&preapproval_id=${id}` : ''}`;
}

/** Detalle seguro de un error de la API de Mercado Pago (sin credenciales). */
function describirErrorMp(error: unknown) {
  const e = error as { status?: number; name?: string; message?: string; causes?: unknown; errors?: unknown };
  return { status: e?.status, tipo: e?.name, mensaje: e?.message, causas: e?.causes ?? e?.errors };
}

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
    external_reference: referenciaDePago(s.pagoId),
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
  const coincidencia = REFERENCIA_PAGO.exec(orden.external_reference ?? '');
  if (!coincidencia) return null;
  const pagoId = Number(coincidencia[1]);
  const pagos = orden.transactions?.payments ?? [];
  // Cada intento de cobro es un pago distinto dentro de la orden; se toma el último.
  const ultimo = pagos.at(-1);
  const aprobada = orden.status === 'processed' && (orden.status_detail ?? 'accredited') === 'accredited';
  // Un intento rechazado no cierra la orden: queda action_required/waiting_retry
  // (verificado en el entorno de prueba con titular OTHE) para que el comprador
  // reintente. Se registra el rechazo; si luego reintenta y paga, se aprueba.
  const rechazoReintentable = orden.status === 'action_required' && orden.status_detail === 'waiting_retry' && ultimo?.status === 'failed';
  const rechazada = orden.status === 'failed' || orden.status === 'canceled' || rechazoReintentable;
  if (!aprobada && !rechazada) return null;
  return { tipo: 'PAGO', pagoId, referenciaExterna: String(ultimo?.id ?? orden.id), aprobado: aprobada };
}

/**
 * Factura de una suscripción (authorized_payment) según la API REST de Mercado Pago.
 * Documentado: status scheduled | processed | recycling | canceled; date_created es
 * el alta de la factura y debit_date, la fecha del intento (cambia en cada reintento).
 * No hay campo de período ni de número de ciclo.
 */
export interface CobroRecurrente {
  id: number;
  preapproval_id: string;
  status: string;
  date_created?: string;
  debit_date?: string;
  transaction_amount?: number | string;
  retry_attempt?: number;
  payment?: { id?: number | string; status?: string; status_detail?: string };
}

/** Calendario de la suscripción (preapproval.auto_recurring). */
export interface CalendarioSuscripcion {
  start_date?: string;
  frequency?: number;
  frequency_type?: string;
  billing_day?: number;
}

/** Margen máximo (días) entre el alta de una factura y su ciclo: a mitad de camino entre dos ciclos es ambiguo. */
const MARGEN_CICLO_DIAS = 12;
const DIA_MS = 86_400_000;

/**
 * Período facturado ('AAAA-MM') de una factura: se reconstruye el calendario de la
 * suscripción (start_date + frecuencia mensual, o billing_day) y se elige el ciclo
 * más cercano al alta de la factura. No depende de la hora exacta del alta (una
 * factura generada horas antes del cambio de mes queda en su ciclo) ni de los
 * reintentos (debit_date). Devuelve null si no hay calendario o si la factura no
 * cae cerca de ningún ciclo: el cobro queda pendiente de conciliación.
 */
export function periodoDelCiclo(altaFactura: string | undefined, calendario: CalendarioSuscripcion | undefined): string | null {
  if (!altaFactura || !calendario?.start_date) return null;
  const frecuencia = calendario.frequency ?? 1;
  if ((calendario.frequency_type ?? 'months') !== 'months' || frecuencia < 1) return null;
  const inicio = new Date(calendario.start_date);
  const alta = new Date(altaFactura);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(alta.getTime())) return null;
  const [ai, mi, di] = ahoraLocal(inicio).fecha.split('-').map(Number);
  const [aa, ma] = ahoraLocal(alta).fecha.split('-').map(Number);
  const altaDia = new Date(`${ahoraLocal(alta).fecha}T00:00:00Z`).getTime();
  const dia = calendario.billing_day ?? di;
  const desfase = aa * 12 + ma - (ai * 12 + mi);
  let mejor: { fecha: Date; distancia: number } | null = null;
  for (let k = desfase - 1; k <= desfase + 1; k++) {
    if (k < 0 || k % frecuencia !== 0) continue;
    const ultimoDia = new Date(Date.UTC(ai, mi - 1 + k + 1, 0)).getUTCDate();
    const ciclo = new Date(Date.UTC(ai, mi - 1 + k, Math.min(dia, ultimoDia)));
    const distancia = Math.abs(altaDia - ciclo.getTime()) / DIA_MS;
    if (!mejor || distancia < mejor.distancia) mejor = { fecha: ciclo, distancia };
  }
  if (!mejor || mejor.distancia > MARGEN_CICLO_DIAS) return null;
  return mejor.fecha.toISOString().slice(0, 7);
}

/**
 * Solo las facturas resueltas generan un resultado; las programadas o en cobro, no.
 * Aprobada: pago approved. No concretada: pago rechazado o cancelado, o factura
 * cancelada sin pago (la cuota deja de figurar como débito programado).
 */
export function interpretarCobroRecurrente(cobro: CobroRecurrente, calendario?: CalendarioSuscripcion): CobroDeSuscripcion | null {
  const pago = cobro.payment?.status;
  const aprobado = pago === 'approved';
  const noConcretado = pago === 'rejected' || pago === 'cancelled' || pago === 'canceled' || (!pago && cobro.status === 'canceled');
  if (!aprobado && !noConcretado) return null;
  return {
    tipo: 'DEBITO',
    idPreaprobacion: cobro.preapproval_id,
    referenciaExterna: `ap-${cobro.id}`,
    aprobado,
    periodo: periodoDelCiclo(cobro.date_created, calendario),
    importe: cobro.transaction_amount !== undefined ? Number(cobro.transaction_amount) : undefined,
    pagoMercadoPago: cobro.payment?.id !== undefined ? String(cobro.payment.id) : undefined,
    fechaDebito: cobro.debit_date,
    intento: cobro.retry_attempt,
  };
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
   * Con la API de Orders, el Access Token de prueba empieza con APP_USR (igual
   * que el productivo): por eso se consulta a qué cuenta pertenece.
   */
  verificarModoPrueba(): Promise<void> {
    this.verificacion ??= (async () => {
      if (this.accessToken.startsWith('TEST-')) return;
      const usuario = await new User(this.config).get();
      if (!esCuentaDePrueba(usuario)) {
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
    let orden;
    try {
      orden = await new Order(this.config).create({
        body: armarOrdenCheckoutPro(s, frontend),
        // X-Idempotency-Key: un reintento de la misma solicitud no crea otra orden.
        requestOptions: { idempotencyKey: `orden-pago-${s.pagoId}` },
      });
    } catch (error) {
      // Se registra el detalle de la API (código y causas) para diagnosticar, nunca las credenciales.
      if (env.nodeEnv !== 'test') console.error('[Mercado Pago] No se pudo crear la orden:', JSON.stringify(describirErrorMp(error)));
      throw new ErrorApp(502, 'MP_ORDEN_RECHAZADA', 'Mercado Pago no pudo crear la orden de pago. Intentá nuevamente en unos minutos.');
    }
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
        back_url: urlRetornoAdhesion(),
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: s.importeMensual,
          currency_id: 'ARS',
          // Cuota del período ya pagada: la suscripción empieza el mes siguiente (sin cobro inmediato).
          ...(s.fechaInicio ? { start_date: s.fechaInicio.toISOString() } : {}),
        },
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
    const idQuery = valor(query['data.id']);
    const idCuerpo = (cuerpo as { data?: { id?: string } })?.data?.id;
    const dataId = idQuery ?? idCuerpo;
    // Primero el id tal como llega; luego en minúsculas (ids alfanuméricos de Orders).
    const candidatos = [...new Set([dataId, dataId?.toLowerCase()])];
    let motivo: string | undefined;
    for (const [i, candidato] of candidatos.entries()) {
      try {
        WebhookSignatureValidator.validate({
          xSignature: valor(encabezados['x-signature']),
          xRequestId: valor(encabezados['x-request-id']),
          dataId: candidato,
          secret: env.mercadoPago.webhookSecret,
        });
        if (i > 0 && env.nodeEnv !== 'test') console.log('[Mercado Pago] Firma válida con data.id en minúsculas');
        return true;
      } catch (error) {
        motivo = (error as { reason?: string }).reason;
      }
    }
    if (env.nodeEnv !== 'test') {
      // Diagnóstico sin secretos: forma de la notificación, nunca la firma ni la clave.
      console.warn('[Mercado Pago] Firma de webhook rechazada:', motivo, JSON.stringify({
        origenId: idQuery ? 'query' : idCuerpo ? 'cuerpo' : 'ninguno',
        mayusculas: /[A-Z]/.test(dataId ?? ''),
        queryIgualCuerpo: idQuery !== undefined && idCuerpo !== undefined ? idQuery === idCuerpo : null,
        parametros: Object.keys(query),
        requestId: Boolean(valor(encabezados['x-request-id'])),
        tipo: (cuerpo as { type?: string })?.type ?? query.type ?? query.topic,
      }));
    }
    return false;
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
        external_reference: referenciaDePago(pagoId),
        begin_date: new Date(desde.getTime() - dia).toISOString(),
        end_date: new Date(Date.now() + dia).toISOString(),
        sort_by: 'created_date',
        sort_order: 'desc',
      },
    });
    const orden = resultado.data?.find((o) => o.external_reference === referenciaDePago(pagoId));
    if (!orden?.id) return null;
    // La búsqueda no trae los pagos de la orden: se consulta completa (GET /v1/orders/{id}).
    return this.consultarOrden(orden.id);
  }

  async consultarPreaprobacion(idPreaprobacion: string): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    const pre = await new PreApproval(this.config).get({ id: idPreaprobacion });
    const ref = pre.external_reference ?? '';
    if (!ref.startsWith('socio:')) return null;
    return { tipo: 'ADHESION', socioId: Number(ref.slice(6)), idPreaprobacion: pre.id!, autorizada: pre.status === 'authorized', estado: pre.status };
  }

  /** Cobro mensual de una suscripción. El SDK no expone este recurso: se usa la API REST oficial. */
  private async consultarCobroRecurrente(id: string): Promise<ResultadoOperacion | null> {
    await this.verificarModoPrueba();
    const respuesta = await fetch(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!respuesta.ok) return null;
    const cobro = (await respuesta.json()) as CobroRecurrente;
    return interpretarCobroRecurrente(cobro, await this.calendario(cobro.preapproval_id));
  }

  /**
   * Cobros de una suscripción (GET /authorized_payments/search). Verificado en el
   * entorno de prueba: al autorizar, Mercado Pago cobra el primer mes en el acto
   * y el webhook de ese cobro puede no llegar; así no queda un cobro sin registrar.
   */
  async consultarCobrosDeAdhesion(idPreaprobacion: string): Promise<CobroDeSuscripcion[]> {
    await this.verificarModoPrueba();
    const cobros: CobroRecurrente[] = [];
    const limite = 12; // máximo que admite la API (verificado: un valor mayor responde «Invalid value for limit»)
    // Paginado: una suscripción larga puede superar una página de resultados.
    for (let desde = 0, pagina = 0; pagina < 40; pagina++, desde += limite) {
      const url = `https://api.mercadopago.com/authorized_payments/search?preapproval_id=${encodeURIComponent(idPreaprobacion)}&offset=${desde}&limit=${limite}`;
      const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
      if (!respuesta.ok) throw new ErrorApp(502, 'MP_COBROS_NO_DISPONIBLES', `Mercado Pago no informó los cobros de la suscripción (HTTP ${respuesta.status})`);
      const { results = [], paging } = (await respuesta.json()) as { results?: CobroRecurrente[]; paging?: { total?: number } };
      cobros.push(...results);
      if (results.length < limite || cobros.length >= (paging?.total ?? 0)) break;
    }
    const calendario = await this.calendario(idPreaprobacion);
    return cobros.map((c) => interpretarCobroRecurrente(c, calendario)).filter((r): r is CobroDeSuscripcion => r !== null);
  }

  /** Calendario de cobro de la suscripción (start_date, frecuencia y billing_day). */
  private async calendario(idPreaprobacion: string): Promise<CalendarioSuscripcion | undefined> {
    const pre = await new PreApproval(this.config).get({ id: idPreaprobacion });
    return pre.auto_recurring as CalendarioSuscripcion | undefined;
  }
}
