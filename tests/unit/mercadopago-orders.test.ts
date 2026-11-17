import { Order, User } from 'mercadopago';
import type { OrderResponse } from 'mercadopago/dist/clients/order/commonTypes';
import { armarOrdenCheckoutPro, destinoRetornoAdhesion, esCuentaDePrueba, interpretarCobroRecurrente, interpretarOrden, MercadoPagoApiGateway, referenciaDePago, urlRetornoAdhesion } from '../../src/integrations/mercadopago/MercadoPagoApiGateway';

const solicitud = { pagoId: 42, descripcion: 'Cuota NeuroGym 2026-11', importe: 44000, emailPagador: 'socio@prueba.local' };
const orden = (datos: Partial<OrderResponse>) => ({ id: 'ORD01TEST', external_reference: 'pago-42', ...datos }) as OrderResponse;

describe('Mercado Pago: pago único con la API de Orders (Checkout Pro)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arma la orden con los valores que exige Checkout Pro y el importe sin descuento', () => {
    const body = armarOrdenCheckoutPro(solicitud, 'http://localhost:5173');
    expect(body).toMatchObject({
      type: 'online',
      processing_mode: 'manual',
      total_amount: '44000.00',
      external_reference: 'pago-42',
      items: [{ unit_price: '44000.00', quantity: 1 }],
    });
    // El total coincide con la suma de los ítems (regla de la API de Orders).
    const suma = body.items!.reduce((t, i) => t + Number(i.unit_price) * (i.quantity ?? 0), 0);
    expect(Number(body.total_amount)).toBe(suma);
    expect(body.config?.online?.success_url).toBe('http://localhost:5173/socio/pagos?resultado=aprobado&pago=42');
    expect(body.config?.online?.failure_url).toContain('resultado=rechazado&pago=42');
    // Sin URL pública HTTPS no se pide el regreso automático.
    expect(body.config?.online?.auto_return).toBeUndefined();
    expect(armarOrdenCheckoutPro(solicitud, 'https://neurogym.ejemplo.dev').config?.online?.auto_return).toBe('approved');
  });

  it('interpreta los estados oficiales de la orden', () => {
    const pagos = { payments: [{ id: 'PAY01A', status: 'rejected' }, { id: 'PAY01B', status: 'approved' }] };
    expect(interpretarOrden(orden({ status: 'processed', status_detail: 'accredited', transactions: pagos }))).toEqual({
      tipo: 'PAGO',
      pagoId: 42,
      referenciaExterna: 'PAY01B',
      aprobado: true,
    });
    expect(interpretarOrden(orden({ status: 'failed', status_detail: 'rejected_by_issuer', transactions: { payments: [{ id: 'PAY01C' }] } }))).toMatchObject({
      aprobado: false,
      referenciaExterna: 'PAY01C',
    });
    expect(interpretarOrden(orden({ status: 'canceled', status_detail: 'canceled' }))).toMatchObject({ aprobado: false, referenciaExterna: 'ORD01TEST' });
    // Orden abierta o en revisión: todavía no hay resultado que registrar.
    for (const status of ['created', 'processing', 'action_required']) expect(interpretarOrden(orden({ status }))).toBeNull();
    // Intento rechazado con la orden abierta para reintentar (estado real observado con titular OTHE).
    expect(
      interpretarOrden(orden({ status: 'action_required', status_detail: 'waiting_retry', transactions: { payments: [{ id: 'PAY01F', status: 'failed', status_detail: 'rejected_by_issuer' }] } })),
    ).toEqual({ tipo: 'PAGO', pagoId: 42, referenciaExterna: 'PAY01F', aprobado: false });
    expect(interpretarOrden(orden({ status: 'action_required', status_detail: 'waiting_retry', transactions: { payments: [{ id: 'PAY01G', status: 'action_required' }] } }))).toBeNull();
    // Reembolso parcial y órdenes ajenas a las cuotas no se registran como pagos aprobados.
    expect(interpretarOrden(orden({ status: 'processed', status_detail: 'partially_refunded' }))).toBeNull();
    expect(interpretarOrden(orden({ status: 'processed', external_reference: 'otro:1' }))).toBeNull();
  });

  it('crea la orden con el SDK oficial, con clave de idempotencia, y devuelve checkout_url', async () => {
    const crear = vi.spyOn(Order.prototype, 'create').mockResolvedValue(orden({ checkout_url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD01TEST' }));
    const url = await new MercadoPagoApiGateway('TEST-token-de-prueba').crearPago(solicitud);
    expect(url).toContain('order_id=ORD01TEST');
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ requestOptions: { idempotencyKey: 'orden-pago-42' } }));
  });

  it('el webhook de una orden se resuelve consultando la orden en la API; ignora pagos reales y otros tópicos', async () => {
    const obtener = vi.spyOn(Order.prototype, 'get').mockResolvedValue(orden({ status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAY01D' }] } }));
    const gateway = new MercadoPagoApiGateway('TEST-token-de-prueba');
    const notificacion = (cuerpo: object) => ({ encabezados: {}, query: {}, cuerpo });
    await expect(gateway.interpretarNotificacion(notificacion({ type: 'order', data: { id: 'ORD01TEST' } }))).resolves.toMatchObject({ pagoId: 42, aprobado: true });
    expect(obtener).toHaveBeenCalledWith({ id: 'ORD01TEST' });
    await expect(gateway.interpretarNotificacion(notificacion({ type: 'order', live_mode: true, data: { id: 'ORD01TEST' } }))).resolves.toBeNull();
    await expect(gateway.interpretarNotificacion(notificacion({ type: 'payment', data: { id: '123' } }))).resolves.toBeNull();
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it('el retorno busca la orden del pago por su external_reference y la consulta completa', async () => {
    // La búsqueda real no incluye los pagos de la orden; la consulta por id sí.
    const buscar = vi.spyOn(Order.prototype, 'search').mockResolvedValue({ data: [orden({ status: 'processed', status_detail: 'accredited' })] });
    const obtener = vi.spyOn(Order.prototype, 'get').mockResolvedValue(orden({ status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAY01E' }] } }));
    const r = await new MercadoPagoApiGateway('TEST-token-de-prueba').consultarOrdenDePago(42, new Date('2026-11-17T10:00:00Z'));
    expect(r).toMatchObject({ tipo: 'PAGO', pagoId: 42, aprobado: true, referenciaExterna: 'PAY01E' });
    expect(buscar.mock.calls[0][0]?.options).toMatchObject({ external_reference: 'pago-42', begin_date: '2026-11-16T10:00:00.000Z' });
    expect(obtener).toHaveBeenCalledWith({ id: 'ORD01TEST' });
  });

  it('el retorno no registra nada si la orden todavía no existe', async () => {
    vi.spyOn(Order.prototype, 'search').mockResolvedValue({ data: [] });
    const obtener = vi.spyOn(Order.prototype, 'get');
    await expect(new MercadoPagoApiGateway('TEST-token-de-prueba').consultarOrdenDePago(42, new Date())).resolves.toBeNull();
    expect(obtener).not.toHaveBeenCalled();
  });

  it('con credenciales productivas no crea órdenes', async () => {
    const crear = vi.spyOn(Order.prototype, 'create');
    vi.spyOn(User.prototype, 'get').mockResolvedValue({ id: 1, tags: ['normal'] } as never);
    await expect(new MercadoPagoApiGateway('APP_USR-productiva').crearPago(solicitud)).rejects.toMatchObject({ codigo: 'MP_CREDENCIAL_PRODUCTIVA' });
    expect(crear).not.toHaveBeenCalled();
  });
});

describe('Mercado Pago: credenciales de prueba de la API de Orders (prefijo APP_USR)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reconoce la cuenta de prueba por etiqueta, apodo o correo de prueba', () => {
    expect(esCuentaDePrueba({ tags: ['normal', 'test_user'] })).toBe(true);
    expect(esCuentaDePrueba({ tags: ['normal'], nickname: 'TESTUSER1234567890' })).toBe(true);
    expect(esCuentaDePrueba({ tags: [], email: 'test_user_123@testuser.com' })).toBe(true);
    expect(esCuentaDePrueba({ tags: ['normal'], nickname: 'GIMNASIO_REAL', email: 'cuenta@ejemplo.com' })).toBe(false);
    expect(esCuentaDePrueba({})).toBe(false);
  });

  it('acepta un Access Token APP_USR de una cuenta de prueba y crea la orden', async () => {
    vi.spyOn(User.prototype, 'get').mockResolvedValue({ id: 1, nickname: 'TESTUSER987654321', tags: ['normal'] } as never);
    vi.spyOn(Order.prototype, 'create').mockResolvedValue(orden({ checkout_url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD01TEST' }));
    await expect(new MercadoPagoApiGateway('APP_USR-de-prueba').crearPago(solicitud)).resolves.toContain('order_id=ORD01TEST');
  });
});

describe('Mercado Pago: cobros de una suscripción (authorized_payments)', () => {
  const base = { id: 7034076181, preapproval_id: 'PRE', status: 'processed', transaction_amount: 28800, retry_attempt: 1 };

  it('toma el período del alta del cobro en hora de Argentina y conserva los identificadores', () => {
    const cobro = interpretarCobroRecurrente({ ...base, date_created: '2026-11-17T11:34:32.000-04:00', payment: { id: 190138992156, status: 'approved' } });
    expect(cobro).toEqual({
      tipo: 'DEBITO',
      idPreaprobacion: 'PRE',
      referenciaExterna: 'ap-7034076181',
      aprobado: true,
      periodo: '2026-11',
      importe: 28800,
      pagoMercadoPago: '190138992156',
      fechaDebito: undefined,
      intento: 1,
    });
    // 01:00 UTC del 1/12 todavía es 30/11 en Argentina.
    expect(interpretarCobroRecurrente({ ...base, date_created: '2026-12-01T01:00:00.000Z', payment: { status: 'approved' } })?.periodo).toBe('2026-11');
    // Un reintento reprograma debit_date, pero el período sigue siendo el del ciclo.
    expect(
      interpretarCobroRecurrente({ ...base, date_created: '2026-11-28T10:00:00.000-03:00', debit_date: '2026-12-05T10:00:00.000-03:00', payment: { status: 'approved' } })
        ?.periodo,
    ).toBe('2026-11');
  });

  it('sin fecha de alta el período queda sin identificar; los cobros no resueltos se ignoran', () => {
    expect(interpretarCobroRecurrente({ ...base, payment: { status: 'rejected' } })).toMatchObject({ periodo: null, aprobado: false });
    expect(interpretarCobroRecurrente({ ...base, status: 'scheduled' })).toBeNull();
  });
});

describe('Mercado Pago: regreso de la autorización del débito automático', () => {
  it('sin URL pública usa 127.0.0.1 (Suscripciones rechaza "localhost") y vuelve al frontend con el preapproval_id', () => {
    expect(urlRetornoAdhesion('', 3000)).toBe('http://127.0.0.1:3000/api/pagos/retorno-adhesion');
    expect(urlRetornoAdhesion('https://tunel.ejemplo.dev', 3000)).toBe('https://tunel.ejemplo.dev/socio/pagos?resultado=adhesion');
    expect(destinoRetornoAdhesion('2c93808497', 'http://localhost:5173')).toBe('http://localhost:5173/socio/pagos?resultado=adhesion&preapproval_id=2c93808497');
    // No reenvía valores arbitrarios.
    expect(destinoRetornoAdhesion('x"><script>', 'http://localhost:5173')).toBe('http://localhost:5173/socio/pagos?resultado=adhesion');
    expect(destinoRetornoAdhesion(['a', 'b'], 'http://localhost:5173')).toBe('http://localhost:5173/socio/pagos?resultado=adhesion');
  });
});

describe('Mercado Pago: errores de la API de Orders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('la referencia externa usa solo caracteres que admite Orders (sin ":")', () => {
    const body = armarOrdenCheckoutPro(solicitud, 'http://localhost:5173');
    expect(body.external_reference).toBe('pago-42');
    expect(body.external_reference).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(referenciaDePago(7)).toBe('pago-7');
    // El formato anterior "pago:{id}" ya no se interpreta como un pago de NeuroGym.
    expect(interpretarOrden(orden({ status: 'processed', external_reference: 'pago:42' }))).toBeNull();
  });

  it('si Mercado Pago rechaza la orden, responde 502 con un mensaje claro y sin exponer el token', async () => {
    vi.spyOn(Order.prototype, 'create').mockRejectedValue({ name: 'MPBadRequestError', status: 400, error: '', causes: [] });
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(new MercadoPagoApiGateway('TEST-token-de-prueba').crearPago(solicitud)).rejects.toMatchObject({ status: 502, codigo: 'MP_ORDEN_RECHAZADA' });
    expect(JSON.stringify(consola.mock.calls)).not.toContain('TEST-token-de-prueba');
  });
});
