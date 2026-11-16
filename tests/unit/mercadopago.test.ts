import crypto from 'node:crypto';
import { env } from '../../src/config/env';
import { MercadoPagoApiGateway, MercadoPagoNoConfigurado } from '../../src/integrations/mercadopago';

/** Firma una notificación como lo documenta Mercado Pago: HMAC-SHA256 de "id:...;request-id:...;ts:...;". */
function firmar(secret: string, dataId: string, requestId: string, ts: string) {
  const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('Integración Mercado Pago (sin red)', () => {
  const secretoOriginal = env.mercadoPago.webhookSecret;
  beforeAll(() => {
    env.mercadoPago.webhookSecret = 'secreto-de-prueba';
  });
  afterAll(() => {
    env.mercadoPago.webhookSecret = secretoOriginal;
  });

  const gateway = new MercadoPagoApiGateway('TEST-token-de-prueba');
  const notificacion = (firma: string, dataId = '123456789') => ({
    encabezados: { 'x-signature': firma, 'x-request-id': 'req-1' },
    query: { 'data.id': dataId, type: 'payment' },
    cuerpo: { type: 'payment', data: { id: dataId } },
  });

  it('acepta la firma calculada con el secreto de la aplicación (validador oficial del SDK)', () => {
    expect(gateway.validarWebhook(notificacion(firmar('secreto-de-prueba', '123456789', 'req-1', '1742505638')))).toBe(true);
  });

  it('rechaza firmas con otro secreto, otro id o sin encabezado', () => {
    expect(gateway.validarWebhook(notificacion(firmar('otro-secreto', '123456789', 'req-1', '1742505638')))).toBe(false);
    expect(gateway.validarWebhook(notificacion(firmar('secreto-de-prueba', '1', 'req-1', '1742505638')))).toBe(false);
    expect(gateway.validarWebhook({ ...notificacion(''), encabezados: {} })).toBe(false);
  });

  it('un token TEST- se reconoce como credencial de prueba sin consultar la API', async () => {
    await expect(gateway.verificarModoPrueba()).resolves.toBeUndefined();
  });

  it('sin credenciales la integración queda deshabilitada (no simula pagos)', async () => {
    const sinConfigurar = new MercadoPagoNoConfigurado();
    await expect(sinConfigurar.crearPago()).rejects.toMatchObject({ status: 503, codigo: 'MP_NO_CONFIGURADO' });
    expect(sinConfigurar.validarWebhook(notificacion('x'))).toBe(false);
  });
});
