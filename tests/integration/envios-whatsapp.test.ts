import crypto from 'node:crypto';
import request from 'supertest';
import { env } from '../../src/config/env';
import { prisma } from '../../src/config/prisma';
import type { DocumentoAdjunto, PlantillaWhatsApp, ResultadoEnvio, ServicioMensajeria } from '../../src/integrations/mensajeria';
import { CuotaService } from '../../src/patterns/facade/CuotaService';
import { crearServicioEnvios } from '../../src/services/envioMensajes.service';
import { marcarCuotasVencidas } from '../../src/services/cuotaGeneracion.service';
import { app, catalogo, conToken, crearGimnasio, crearSocio, limpiarBase } from './fixtures';
import { MercadoPagoDobleDePrueba } from '../mocks/MercadoPagoDobleDePrueba';

/**
 * Doble de un proveedor REAL (no simulado) que acepta solicitudes sin usar la red:
 * permite probar el registro de estados como si fuera 360dialog o Meta.
 */
class ProveedorQueAcepta implements ServicioMensajeria {
  readonly proveedor = 'DIALOG360_SANDBOX' as const;
  readonly simulado = false;
  readonly solicitudes: { telefono: string; texto: string }[] = [];
  rechazar = false;
  async enviar(telefono: string, texto: string): Promise<ResultadoEnvio> {
    this.solicitudes.push({ telefono, texto });
    if (this.rechazar) return { aceptado: false, error: '360dialog HTTP 429: se agotaron los 25 mensajes' };
    return { aceptado: true, idMensaje: `wamid.TEST.${crypto.randomUUID()}`, destino: '5490000000000' };
  }
  readonly documentos: DocumentoAdjunto[] = [];
  async enviarDocumento(telefono: string, documento: DocumentoAdjunto): Promise<ResultadoEnvio> {
    this.documentos.push(documento);
    return this.enviar(telefono, documento.texto);
  }
}

/** Doble de WhatsApp Cloud API (Meta): registra las plantillas en lugar de textos libres. */
class ProveedorConPlantillas extends ProveedorQueAcepta {
  readonly plantillas: { plantilla: PlantillaWhatsApp; documento?: { url: string; nombreArchivo: string } }[] = [];
  async enviarPlantilla(_telefono: string, plantilla: PlantillaWhatsApp, documento?: { url: string; nombreArchivo: string }): Promise<ResultadoEnvio> {
    this.plantillas.push({ plantilla, documento });
    return { aceptado: true, idMensaje: `wamid.PLANTILLA.${crypto.randomUUID()}`, destino: '5490000000000' };
  }
}

const webhook = (statuses: object[]) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses } }] }] });
const ts = (desfase = 0) => String(Math.floor(Date.now() / 1000) + desfase);

describe('WhatsApp: envío automático, estados reales e idempotencia', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  const claves = ['destinoPrueba', 'webhookToken', 'metaAppSecret', 'metaVerifyToken', 'sociosPrueba', 'urlPublica'] as const;
  const original = Object.fromEntries(claves.map((k) => [k, env.mensajeria[k]]));
  const proveedor = new ProveedorQueAcepta();
  const envios = crearServicioEnvios(proveedor);
  const cuotas = new CuotaService(new MercadoPagoDobleDePrueba(), proveedor);

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
    Object.assign(env.mensajeria, { destinoPrueba: '5490000000000', webhookToken: 'token-webhook-prueba', metaAppSecret: 'clave-app-prueba', metaVerifyToken: 'verificar-prueba', urlPublica: 'https://tunel.prueba.dev' });
  });
  afterAll(async () => {
    Object.assign(env.mensajeria, original);
    await prisma.$disconnect();
  });

  async function socioHabilitado(habilitado = true) {
    const socio = await crearSocio(g.sedeA.id);
    env.mensajeria.sociosPrueba = habilitado ? [...env.mensajeria.sociosPrueba, socio.email.toLowerCase()] : env.mensajeria.sociosPrueba;
    return socio;
  }

  it('preparado → aceptado: un HTTP 200 no se registra como enviado y el evento repetido no genera otro mensaje', async () => {
    const socio = await socioHabilitado();
    const antes = proveedor.solicitudes.length;
    const datos = { tipo: 'AVISO' as const, referencia: `prueba:${socio.id}`, usuarioId: socio.usuarioId, telefono: '341 555-0000', texto: 'Hola' };
    const envio = await envios.enviar(datos);
    expect(envio).toMatchObject({ estado: 'ACEPTADO', proveedor: 'DIALOG360_SANDBOX', destino: '5490000000000', fechaEnviado: null, fechaEntregado: null });
    expect(await envios.enviar(datos)).toMatchObject({ id: envio.id, estado: 'ACEPTADO' });
    expect(proveedor.solicitudes.length).toBe(antes + 1);
  });

  it('modo de prueba: un socio no habilitado no recibe nada (OMITIDO) y el proveedor no se llama', async () => {
    const socio = await socioHabilitado(false);
    const antes = proveedor.solicitudes.length;
    const envio = await envios.enviar({ tipo: 'AVISO', referencia: `prueba-omitida:${socio.id}`, usuarioId: socio.usuarioId, telefono: '341 555-0000', texto: 'x' });
    expect(envio).toMatchObject({ estado: 'OMITIDO', detalle: expect.stringContaining('WHATSAPP_SOCIOS_PRUEBA') });
    expect(proveedor.solicitudes.length).toBe(antes);
  });

  it('escenario 1 y 5: pago aprobado → comprobante → envío automático; webhooks de estado reales y repetidos', async () => {
    const socio = await socioHabilitado();
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const pago = await prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 30000, estado: 'PENDIENTE' } });
    const antes = proveedor.solicitudes.length;
    await cuotas.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: 'MP-WA-1', aprobado: true });
    const comprobante = await prisma.comprobante.findUniqueOrThrow({ where: { pagoId: pago.id } });
    const envio = await prisma.envioMensaje.findUniqueOrThrow({ where: { referencia: `comprobante:${comprobante.id}` } });
    expect(envio).toMatchObject({ estado: 'ACEPTADO', tipo: 'COMPROBANTE', cuotaId: cuota.id });
    expect(envio.texto).toContain(comprobante.numero);
    // El comprobante viaja como PDF adjunto (el texto es el caption, no lo reemplaza).
    expect(envio.adjunto).toBe(`comprobante-${comprobante.numero}.pdf`);
    const documento = proveedor.documentos.at(-1)!;
    expect(documento).toMatchObject({ nombreArchivo: `comprobante-${comprobante.numero}.pdf`, texto: envio.texto });
    expect(documento.url).toMatch(new RegExp(`^https://tunel\\.prueba\\.dev/api/whatsapp/comprobantes/${envio.id}\\.pdf\\?vence=\\d+&firma=`));
    // El enlace firmado entrega el PDF; alterado o sin firma, no.
    const enlace = new URL(documento.url);
    const pdf = await request(app).get(`${enlace.pathname}${enlace.search}`).buffer(true).parse((r, fin) => {
      const partes: Buffer[] = [];
      r.on('data', (p: Buffer) => partes.push(p));
      r.on('end', () => fin(null, Buffer.concat(partes)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toContain('no-store');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await request(app).get(`${enlace.pathname}?vence=${enlace.searchParams.get('vence')}&firma=alterada`).expect(401);
    await request(app).get(enlace.pathname).expect(401);
    expect(comprobante.fechaEnvio).toBeNull(); // todavía sin confirmación del proveedor

    // Webhook de Mercado Pago repetido: ni otro comprobante ni otro mensaje.
    await cuotas.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: 'MP-WA-1', aprobado: true });
    expect(await prisma.comprobante.count({ where: { pagoId: pago.id } })).toBe(1);
    expect(await prisma.envioMensaje.count({ where: { comprobanteId: comprobante.id } })).toBe(1);
    expect(proveedor.solicitudes.length).toBe(antes + 1);

    // Webhook del proveedor (360dialog): enviado, entregado, leído.
    const ruta = '/api/whatsapp/webhook/360dialog/token-webhook-prueba';
    const id = envio.idMensaje!;
    await request(app).post(ruta).send(webhook([{ id, status: 'sent', timestamp: ts(1) }])).expect(200);
    const enviado = await prisma.envioMensaje.findUniqueOrThrow({ where: { id: envio.id } });
    expect(enviado).toMatchObject({ estado: 'ENVIADO', fechaEnviado: expect.any(Date) });
    expect((await prisma.comprobante.findUniqueOrThrow({ where: { id: comprobante.id } })).fechaEnvio).toEqual(enviado.fechaEnviado);
    await request(app).post(ruta).send(webhook([{ id, status: 'delivered', timestamp: ts(2) }, { id, status: 'read', timestamp: ts(3) }])).expect(200);
    // Repetido o atrasado: no retrocede; un «failed» tardío no pisa una entrega confirmada.
    await request(app).post(ruta).send(webhook([{ id, status: 'delivered', timestamp: ts(2) }, { id, status: 'sent', timestamp: ts(1) }])).expect(200);
    await request(app).post(ruta).send(webhook([{ id, status: 'failed', timestamp: ts(4), errors: [{ code: 131026, title: 'Undeliverable' }] }])).expect(200);
    const final = await prisma.envioMensaje.findUniqueOrThrow({ where: { id: envio.id } });
    expect(final).toMatchObject({ estado: 'LEIDO', fechaEntregado: expect.any(Date), fechaLeido: expect.any(Date) });

    // El socio ve el estado real en su comprobante.
    const vista = await request(app).get(`/api/socio/pagos/${pago.id}/comprobante`).set(conToken(socio.token));
    expect(vista.body).toMatchObject({ fechaEnvio: expect.any(String), envioWhatsapp: { estado: 'LEIDO', proveedor: 'DIALOG360_SANDBOX' } });
    // Token incorrecto: rechazado.
    await request(app).post('/api/whatsapp/webhook/360dialog/otro').send(webhook([{ id, status: 'read' }])).expect(401);
  });

  it('escenario 4: si WhatsApp falla, el pago queda registrado y el fallo documentado', async () => {
    const socio = await socioHabilitado();
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const pago = await prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 30000, estado: 'PENDIENTE' } });
    proveedor.rechazar = true;
    await cuotas.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: 'MP-WA-FALLA', aprobado: true });
    proveedor.rechazar = false;
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: pago.id } })).estado).toBe('APROBADO');
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).estado).toBe('PAGADA');
    const comprobante = await prisma.comprobante.findUniqueOrThrow({ where: { pagoId: pago.id } });
    expect(await prisma.envioMensaje.findUniqueOrThrow({ where: { referencia: `comprobante:${comprobante.id}` } })).toMatchObject({
      estado: 'FALLIDO',
      detalle: expect.stringContaining('25 mensajes'),
    });

    // Fallo informado después por el webhook (p. ej. cuenta bloqueada): se registra como FALLIDO.
    const aceptado = await envios.enviar({ tipo: 'AVISO', referencia: `fallo-posterior:${socio.id}`, usuarioId: socio.usuarioId, telefono: 'x', texto: 'x' });
    await request(app)
      .post('/api/whatsapp/webhook/360dialog/token-webhook-prueba')
      .send(webhook([{ id: aceptado.idMensaje, status: 'failed', timestamp: ts(), errors: [{ code: 131031, title: 'Business Account locked' }] }]))
      .expect(200);
    expect(await prisma.envioMensaje.findUniqueOrThrow({ where: { id: aceptado.id } })).toMatchObject({ estado: 'FALLIDO', detalle: expect.stringContaining('131031') });
  });

  it('sin URL pública HTTPS el comprobante no se envía y nunca se reemplaza por solo texto', async () => {
    const socio = await socioHabilitado();
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const pago = await prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 30000, estado: 'PENDIENTE' } });
    const base = env.mensajeria.urlPublica;
    env.mensajeria.urlPublica = '';
    const antes = proveedor.solicitudes.length;
    await cuotas.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: 'MP-WA-SINURL', aprobado: true });
    env.mensajeria.urlPublica = base;
    const comprobante = await prisma.comprobante.findUniqueOrThrow({ where: { pagoId: pago.id } });
    expect(await prisma.envioMensaje.findUniqueOrThrow({ where: { referencia: `comprobante:${comprobante.id}` } })).toMatchObject({
      estado: 'FALLIDO',
      detalle: expect.stringContaining('WHATSAPP_URL_PUBLICA'),
    });
    expect(proveedor.solicitudes.length).toBe(antes);
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: pago.id } })).estado).toBe('APROBADO');
  });

  it('con Meta, el comprobante viaja como plantilla aprobada con el PDF en el encabezado', async () => {
    const meta = new ProveedorConPlantillas();
    const cuotasMeta = new CuotaService(new MercadoPagoDobleDePrueba(), meta);
    const socio = await socioHabilitado();
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const pago = await prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 30000, estado: 'PENDIENTE' } });
    await cuotasMeta.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: 'MP-WA-PLANTILLA', aprobado: true });
    const comprobante = await prisma.comprobante.findUniqueOrThrow({ where: { pagoId: pago.id } });
    expect(meta.solicitudes).toHaveLength(0);
    const [enviada] = meta.plantillas;
    expect(enviada.plantilla.nombre).toBe('neurogym_comprobante_pago');
    expect(enviada.plantilla.parametros).toEqual(['Socio', expect.stringContaining('30.000'), expect.any(String), comprobante.numero]);
    expect(enviada.documento?.nombreArchivo).toBe(`comprobante-${comprobante.numero}.pdf`);
    const envio = await prisma.envioMensaje.findUniqueOrThrow({ where: { referencia: `comprobante:${comprobante.id}` } });
    expect(envio.estado).toBe('ACEPTADO');
  });

  it('escenario 3: un pago rechazado no genera comprobante ni envío', async () => {
    const socio = await socioHabilitado();
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const pago = await prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 30000, estado: 'PENDIENTE' } });
    await cuotas.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: 'MP-WA-RECH', aprobado: false });
    expect(await prisma.comprobante.count({ where: { pagoId: pago.id } })).toBe(0);
    expect(await prisma.envioMensaje.count({ where: { usuarioId: socio.usuarioId, tipo: 'COMPROBANTE' } })).toBe(0);
  });

  it('escenario 2: el aviso de vencimiento lo dispara la regla de vencimiento y no se repite', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    await prisma.cuota.update({ where: { id: cuota.id }, data: { estado: 'PENDIENTE' } });
    const despues = new Date(cuota.fechaVencimiento.getTime() + 86_400_000).toISOString().slice(0, 10);
    await marcarCuotasVencidas(despues);
    const aviso = await prisma.envioMensaje.findUniqueOrThrow({ where: { referencia: `vencimiento:${cuota.id}:impaga` } });
    expect(aviso).toMatchObject({ tipo: 'VENCIMIENTO', cuotaId: cuota.id });
    // Repetir la tarea no genera otro aviso (la cuota ya está IMPAGA y la referencia es única).
    await marcarCuotasVencidas(despues);
    expect(await prisma.envioMensaje.count({ where: { cuotaId: cuota.id, tipo: 'VENCIMIENTO' } })).toBe(1);
  });

  it('webhook de Meta: verificación de suscripción y firma obligatoria', async () => {
    const reto = await request(app).get('/api/whatsapp/webhook/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verificar-prueba', 'hub.challenge': '12345' });
    expect(reto.status).toBe(200);
    expect(reto.text).toBe('12345');
    expect((await request(app).get('/api/whatsapp/webhook/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '1' })).status).toBe(403);

    const socio = await socioHabilitado();
    const envio = await envios.enviar({ tipo: 'AVISO', referencia: `meta:${socio.id}`, usuarioId: socio.usuarioId, telefono: 'x', texto: 'x' });
    const cuerpo = JSON.stringify(webhook([{ id: envio.idMensaje, status: 'delivered', timestamp: ts() }]));
    const firma = `sha256=${crypto.createHmac('sha256', 'clave-app-prueba').update(cuerpo).digest('hex')}`;
    await request(app).post('/api/whatsapp/webhook/meta').set('Content-Type', 'application/json').send(cuerpo).expect(401);
    await request(app).post('/api/whatsapp/webhook/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', firma).send(cuerpo).expect(200);
    expect((await prisma.envioMensaje.findUniqueOrThrow({ where: { id: envio.id } })).estado).toBe('ENTREGADO');
  });
});
