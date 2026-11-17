import crypto from 'node:crypto';
import { Dialog360Sandbox, firmaMetaValida, interpretarEstadosWhatsapp, tokenValido } from '../../src/integrations/mensajeria';

const respuesta = (status: number, cuerpo: object) => ({ ok: status < 300, status, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) }) as Response;
const sandbox = (destino = '+54 9 341 000-0000') => new Dialog360Sandbox({ apiKey: 'clave-de-prueba', url: 'https://waba-sandbox.360dialog.io', destino });

describe('Proveedor 360dialog (sandbox oficial, gratuito)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('envía texto al único número de la clave, con el encabezado D360-API-KEY, y devuelve el id', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(201, { messages: [{ id: 'wamid.SANDBOX1' }], meta: { api_status: 'stable' } }));
    const r = await sandbox().enviar('341 555-1003', 'Comprobante NG-1');
    expect(r).toEqual({ aceptado: true, idMensaje: 'wamid.SANDBOX1', destino: '5493410000000' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://waba-sandbox.360dialog.io/v1/messages');
    expect((init?.headers as Record<string, string>)['D360-API-KEY']).toBe('clave-de-prueba');
    // El teléfono del socio nunca se usa: el sandbox solo puede escribirle al número de la clave.
    expect(JSON.parse(String(init?.body))).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '5493410000000', type: 'text', text: { body: 'Comprobante NG-1' } });
  });

  it('informa los límites del sandbox sin exponer la clave', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(429, {}));
    const agotado = await sandbox().enviar('', 'x');
    expect(agotado).toMatchObject({ aceptado: false, error: expect.stringContaining('25 mensajes') });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(403, {}));
    expect((await sandbox().enviar('', 'x')).error).toContain('no coincide');
    expect(JSON.stringify(agotado)).not.toContain('clave-de-prueba');
  });

  it('sin número autorizado no envía nada', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await sandbox('').enviar('341 555-1003', 'x')).toMatchObject({ aceptado: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registra la URL del webhook de estados', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(200, { url: 'ok' }));
    expect((await sandbox().configurarWebhook('https://tunel.ejemplo.dev/api/whatsapp/webhook/360dialog/t')).ok).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('https://waba-sandbox.360dialog.io/v1/configs/webhook');
  });
});

describe('Estados de los webhooks de WhatsApp (Meta y 360dialog)', () => {
  const webhook = (statuses: object[]) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses } }] }] });

  it('traduce sent, delivered, read y failed; ignora mensajes entrantes y estados desconocidos', () => {
    const estados = interpretarEstadosWhatsapp(
      webhook([
        { id: 'wamid.A', status: 'sent', timestamp: '1794939343' },
        { id: 'wamid.A', status: 'delivered', timestamp: '1794939350' },
        { id: 'wamid.A', status: 'read', timestamp: '1794939360' },
        { id: 'wamid.B', status: 'failed', timestamp: '1794939343', errors: [{ code: 131031, title: 'Business Account locked', error_data: { details: 'Business account has been locked.' } }] },
        { id: 'wamid.C', status: 'deleted' },
      ]),
    );
    expect(estados.map((e) => e.estado)).toEqual(['ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO']);
    expect(estados[0].fecha.toISOString()).toBe(new Date(1794939343000).toISOString());
    expect(estados[3].error).toContain('131031 Business Account locked');
    expect(interpretarEstadosWhatsapp({ entry: [{ changes: [{ value: { messages: [{ from: '549', text: { body: 'hola' } }] } }] }] })).toEqual([]);
    expect(interpretarEstadosWhatsapp(null)).toEqual([]);
  });

  it('valida la firma X-Hub-Signature-256 de Meta y el token de la ruta de 360dialog', () => {
    const cuerpo = Buffer.from('{"entry":[]}');
    const firma = `sha256=${crypto.createHmac('sha256', 'clave-app').update(cuerpo).digest('hex')}`;
    expect(firmaMetaValida(cuerpo, firma, 'clave-app')).toBe(true);
    expect(firmaMetaValida(cuerpo, firma, 'otra-clave')).toBe(false);
    expect(firmaMetaValida(cuerpo, undefined, 'clave-app')).toBe(false);
    expect(firmaMetaValida(cuerpo, firma, '')).toBe(false);
    expect(tokenValido('abc', 'abc')).toBe(true);
    expect(tokenValido('abd', 'abc')).toBe(false);
    expect(tokenValido('abc', '')).toBe(false);
  });
});
