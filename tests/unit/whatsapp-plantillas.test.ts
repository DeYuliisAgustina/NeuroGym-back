import { PLANTILLAS, plantilla, variablesDe } from '../../src/integrations/mensajeria/plantillas';
import { WhatsAppCloudApi, type OpcionesWhatsApp } from '../../src/integrations/mensajeria/WhatsAppCloudApi';

const base: OpcionesWhatsApp = { token: 'token-de-prueba', phoneNumberId: '1234567890', apiVersion: 'v23.0', destinoPrueba: '5491100000000', produccion: false };
const respuesta = (ok: boolean, cuerpo: object) => ({ ok, status: ok ? 200 : 400, json: async () => cuerpo }) as Response;

describe('WhatsApp Cloud API: plantillas aprobadas (mensajes iniciados por NeuroGym)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('envía la plantilla de vencimiento con sus variables en orden y el idioma es_AR', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(true, { messages: [{ id: 'wamid.PLANTILLA' }] }));
    const r = await new WhatsAppCloudApi(base).enviarPlantilla('', plantilla('vencimientoProximo', 'Ana', 'Noviembre 2026', '$ 32.000', '10/11/2026'));
    expect(r).toEqual({ aceptado: true, idMensaje: 'wamid.PLANTILLA', destino: '5491100000000' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5491100000000',
      type: 'template',
      template: {
        name: 'neurogym_vencimiento_cuota',
        language: { code: 'es_AR' },
        components: [{ type: 'body', parameters: ['Ana', 'Noviembre 2026', '$ 32.000', '10/11/2026'].map((text) => ({ type: 'text', text })) }],
      },
    });
  });

  it('el comprobante lleva el PDF en el encabezado de la plantilla', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(true, { messages: [{ id: 'wamid.PDF' }] }));
    await new WhatsAppCloudApi(base).enviarPlantilla('', plantilla('comprobante', 'Ana', '$ 32.000', 'Noviembre 2026', 'NG-00000001'), {
      url: 'https://tunel.prueba.dev/api/comprobantes/x.pdf',
      nombreArchivo: 'comprobante-NG-00000001.pdf',
    });
    const { template } = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(template.name).toBe('neurogym_comprobante_pago');
    expect(template.components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { link: 'https://tunel.prueba.dev/api/comprobantes/x.pdf', filename: 'comprobante-NG-00000001.pdf' } }],
    });
    expect(template.components[1].parameters).toHaveLength(4);
  });

  it('limpia saltos de línea y valores vacíos (Meta los rechaza)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(true, { messages: [{ id: 'x' }] }));
    await new WhatsAppCloudApi(base).enviarPlantilla('', { nombre: 'n', parametros: ['Ana\nMaría', '  '] });
    const { template } = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Ana María', '-']);
  });

  it('cada plantilla del catálogo tiene variables {{1}}..{{n}} consecutivas', () => {
    for (const clave of Object.keys(PLANTILLAS) as (keyof typeof PLANTILLAS)[]) {
      const n = variablesDe(clave);
      expect(n).toBeGreaterThan(0);
      for (let i = 1; i <= n; i++) expect(PLANTILLAS[clave].cuerpo).toContain(`{{${i}}}`);
    }
    expect(variablesDe('comprobante')).toBe(4);
    expect(variablesDe('recordatorioTurno')).toBe(6);
  });
});
