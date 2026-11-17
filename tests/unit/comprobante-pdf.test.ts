import { Dialog360Sandbox } from '../../src/integrations/mensajeria';
import { generarPdfComprobante, type DatosComprobante } from '../../src/services/comprobantePdf.service';
import { enlaceComprobante, verificarEnlace, VIGENCIA_ENLACE_MS } from '../../src/services/enlaceComprobante';

const datos: DatosComprobante = {
  numero: 'NG-00000077',
  socio: 'Socia Prueba',
  sede: 'Norte',
  periodo: '2026-10',
  plan: 'Premium',
  cuotaBase: 32000,
  adicionalPremium: 12000,
  descuento: 0,
  importe: 44000,
  medio: 'EFECTIVO',
  fechaPago: new Date('2026-11-17T18:00:00.000Z'),
  referencia: 'NG-00000077',
};

describe('Comprobante en PDF', () => {
  it('genera un PDF válido con los metadatos del comprobante', async () => {
    const pdf = await generarPdfComprobante(datos);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000); // logo y fuente Inter embebidos
    expect(pdf.toString('latin1')).toContain('Comprobante NG-00000077');
  });

  it('con descuento por débito también se genera (fila adicional)', async () => {
    const pdf = await generarPdfComprobante({ ...datos, plan: 'Básico', adicionalPremium: 0, descuento: 3200, importe: 28800, medio: 'DEBITO_AUTOMATICO' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Enlace firmado del PDF (no permanente ni público)', () => {
  it('es válido durante 15 minutos y rechaza firmas alteradas o de otro envío', () => {
    const ahora = Date.UTC(2026, 10, 17, 18, 0, 0);
    const url = new URL(enlaceComprobante('https://tunel.ejemplo.dev/', 12, ahora));
    expect(url.pathname).toBe('/api/whatsapp/comprobantes/12.pdf');
    const vence = url.searchParams.get('vence');
    const firma = url.searchParams.get('firma');
    expect(Number(vence)).toBe(ahora + VIGENCIA_ENLACE_MS);
    expect(verificarEnlace(12, vence, firma, ahora + 60_000)).toBe('valido');
    expect(verificarEnlace(12, vence, firma, ahora + VIGENCIA_ENLACE_MS + 1)).toBe('vencido');
    expect(verificarEnlace(13, vence, firma, ahora)).toBe('invalido');
    expect(verificarEnlace(12, Number(vence) + 1000, firma, ahora)).toBe('invalido');
    expect(verificarEnlace(12, vence, undefined, ahora)).toBe('invalido');
  });
});

describe('360dialog: documento por enlace HTTPS', () => {
  afterEach(() => vi.restoreAllMocks());

  it('envía el PDF como documento con nombre de archivo y caption', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 201, json: async () => ({ messages: [{ id: 'wamid.DOC' }] }) } as Response);
    const r = await new Dialog360Sandbox({ apiKey: 'k', url: 'https://waba-sandbox.360dialog.io', destino: '5493410000000' }).enviarDocumento('x', {
      url: 'https://tunel.ejemplo.dev/api/whatsapp/comprobantes/1.pdf?vence=1&firma=f',
      nombreArchivo: 'comprobante-NG-00000001.pdf',
      texto: 'NeuroGym · Comprobante NG-00000001',
    });
    expect(r).toMatchObject({ aceptado: true, idMensaje: 'wamid.DOC' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5493410000000',
      type: 'document',
      document: { link: 'https://tunel.ejemplo.dev/api/whatsapp/comprobantes/1.pdf?vence=1&firma=f', filename: 'comprobante-NG-00000001.pdf', caption: 'NeuroGym · Comprobante NG-00000001' },
    });
  });
});
