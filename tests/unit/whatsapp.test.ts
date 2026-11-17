import { enmascararTelefono, normalizarTelefono, WhatsAppCloudApi, type OpcionesWhatsApp } from '../../src/integrations/mensajeria/WhatsAppCloudApi';

const base: OpcionesWhatsApp = { token: 'token-de-prueba', phoneNumberId: '1234567890', apiVersion: 'v23.0', destinoPrueba: '', produccion: false };
const respuesta = (ok: boolean, cuerpo: object) => ({ ok, status: ok ? 200 : 400, json: async () => cuerpo }) as Response;

describe('WhatsApp Cloud API: modo de prueba con el número gratuito de Meta', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sin destinatario de prueba no envía nada (nunca escribe a teléfonos de socios)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const r = await new WhatsAppCloudApi(base).enviar('11 5555-0001', 'Comprobante');
    expect(r).toMatchObject({ enviado: false, error: expect.stringContaining('WHATSAPP_TEST_RECIPIENT') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('en prueba redirige el mensaje al número habilitado, con Graph API v23.0', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(true, { messages: [{ id: 'wamid.PRUEBA' }] }));
    const r = await new WhatsAppCloudApi({ ...base, destinoPrueba: '+54 9 11 0000-0000' }).enviar('11 5555-0001', 'Comprobante NG-1');
    expect(r).toEqual({ enviado: true, idMensaje: 'wamid.PRUEBA' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo).toMatchObject({ messaging_product: 'whatsapp', to: '5491100000000', type: 'text', text: { body: 'Comprobante NG-1' } });
  });

  it('en producción usa el teléfono del socio normalizado', () => {
    const api = new WhatsAppCloudApi({ ...base, produccion: true, destinoPrueba: '5491100000000' });
    expect(api.destinoDe('011 5555-0001')).toBe('541155550001');
    expect(normalizarTelefono('+54 11 5555-0001')).toBe('541155550001');
  });

  it('explica los errores habituales del número de prueba sin exponer el token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(false, { error: { code: 131030, message: 'Recipient phone number not in allowed list' } }));
    const r = await new WhatsAppCloudApi({ ...base, destinoPrueba: '5491100000000' }).enviar('', 'x');
    expect(r.enviado).toBe(false);
    expect(r.error).toContain('131030');
    expect(r.error).toContain('habilitados');
    expect(r.error).not.toContain('token-de-prueba');
  });

  it('enmascara el número en los registros', () => {
    expect(enmascararTelefono('+54 9 11 1234-5678')).toBe('••••••••••678');
  });
});
