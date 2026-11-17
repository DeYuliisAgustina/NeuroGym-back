import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { MensajeriaSimulada, servicioMensajeria } from '../../src/integrations/mensajeria';
import { cuotaService } from '../../src/patterns/facade';
import { ahoraLocal } from '../../src/utils/fechas';
import { app, catalogo, conToken, crearGimnasio, crearPersonal, crearRol, crearSocio, limpiarBase } from './fixtures';
import type { MercadoPagoDobleDePrueba } from '../mocks/MercadoPagoDobleDePrueba';

const mensajeria = servicioMensajeria as MensajeriaSimulada;

// Doble de prueba de Mercado Pago inyectado SOLO en esta suite (la aplicación usa la API oficial de prueba).
const { doble } = vi.hoisted(() => ({ doble: { actual: null as unknown as MercadoPagoDobleDePrueba } }));
vi.mock('../../src/integrations/mercadopago', async (original) => {
  const modulo = await original<typeof import('../../src/integrations/mercadopago')>();
  const { MercadoPagoDobleDePrueba: Doble } = await import('../mocks/MercadoPagoDobleDePrueba');
  doble.actual = new Doble();
  return { ...modulo, crearGatewayMercadoPago: () => doble.actual };
});

describe('CU-001 Abonar cuota mensual (Facade CuotaService + Strategy)', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  let cobranzas: Awaited<ReturnType<typeof crearPersonal>>;

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
    cobranzas = await crearPersonal(g.gimnasio.id, (await crearRol(g.gimnasio.id, 'Cobranzas', [['COBROS', 'GESTION']])).id, 'cobranzas');
  });
  afterAll(() => prisma.$disconnect());

  it('CU-001-001/002/005: detalle e importes por medio; 10 % solo con débito (RD6)', async () => {
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const detalle = await request(app).get('/api/socio/cuota').set(conToken(socio.token));
    expect(detalle.body.cuota).toMatchObject({ estado: 'PENDIENTE', cuotaBase: 30000, adicionalPremium: 10000 });
    const medios = await request(app).get(`/api/cuotas/${detalle.body.cuota.id}/medios`).set(conToken(socio.token));
    expect(medios.body.PAGO_UNICO.importeFinal).toBe(40000);
    expect(medios.body.EFECTIVO.importeFinal).toBe(40000);
    expect(medios.body.DEBITO_AUTOMATICO).toMatchObject({ descuento: 4000, importeFinal: 36000 });
  });

  it('un socio no puede consultar la cuota de otro (404)', async () => {
    const s1 = await crearSocio(g.sedeA.id);
    const s2 = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: s2.id } });
    expect((await request(app).get(`/api/cuotas/${cuota.id}/medios`).set(conToken(s1.token))).status).toBe(404);
  });

  it('pago único aprobado: cuota PAGADA, comprobante y WhatsApp; la notificación repetida no duplica', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const inicio = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' });
    expect(inicio.status).toBe(201);
    expect(inicio.body).toMatchObject({ tipo: 'REDIRECCION' });
    const pagoId = inicio.body.pagoId;
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: pagoId } })).estado).toBe('PENDIENTE');
    const enviadosAntes = mensajeria.enviados.length;

    const resultado = await cuotaService.registrarResultado({ tipo: 'PAGO', pagoId, referenciaExterna: 'MP-123', aprobado: true });
    expect(resultado.procesado).toBe(true);
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).estado).toBe('PAGADA');
    const comprobante = await prisma.comprobante.findUniqueOrThrow({ where: { pagoId } });
    expect(comprobante.fechaEnvio).not.toBeNull();
    expect(mensajeria.enviados.length).toBe(enviadosAntes + 1);

    // Webhook repetido: no se duplican pagos, comprobantes ni mensajes.
    const repetido = await cuotaService.registrarResultado({ tipo: 'PAGO', pagoId, referenciaExterna: 'MP-123', aprobado: true });
    expect(repetido.duplicado).toBe(true);
    expect(await prisma.pago.count({ where: { cuotaId: cuota.id, estado: 'APROBADO' } })).toBe(1);
    expect(mensajeria.enviados.length).toBe(enviadosAntes + 1);

    const comp = await request(app).get(`/api/socio/pagos/${pagoId}/comprobante`).set(conToken(socio.token));
    expect(comp.body).toMatchObject({ periodo: cuota.periodo, medio: 'PAGO_UNICO', descuento: 0, importe: 30000, referencia: 'MP-123' });
    // Ya pagada: no admite iniciar otro pago.
    expect((await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' })).status).toBe(422);
  });

  it('5.1: pago rechazado → la cuota sigue pendiente', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const { body } = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' });
    await cuotaService.registrarResultado({ tipo: 'PAGO', pagoId: body.pagoId, referenciaExterna: 'MP-rech', aprobado: false });
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).estado).toBe('PENDIENTE');
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: body.pagoId } })).estado).toBe('RECHAZADO');
  });

  it('6.1: si falla WhatsApp, la cuota queda pagada y el comprobante en el historial', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const { body } = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' });
    mensajeria.fallar = true;
    await cuotaService.registrarResultado({ tipo: 'PAGO', pagoId: body.pagoId, referenciaExterna: 'MP-falla', aprobado: true });
    mensajeria.fallar = false;
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).estado).toBe('PAGADA');
    expect((await prisma.comprobante.findUniqueOrThrow({ where: { pagoId: body.pagoId } })).fechaEnvio).toBeNull();

    // Reenvío posterior (npm run whatsapp:probar): repite solo el mensaje, sin nuevos pagos ni comprobantes.
    const enviadosAntes = mensajeria.enviados.length;
    await expect(cuotaService.reenviarComprobante(body.pagoId)).resolves.toEqual({ enviado: true, error: undefined });
    expect(mensajeria.enviados.length).toBe(enviadosAntes + 1);
    expect(mensajeria.enviados.at(-1)?.texto).toContain(`Cuota ${cuota.periodo}`);
    expect(await prisma.pago.count({ where: { cuotaId: cuota.id } })).toBe(1);
    expect(await prisma.comprobante.count({ where: { pagoId: body.pagoId } })).toBe(1);
    expect((await prisma.comprobante.findUniqueOrThrow({ where: { pagoId: body.pagoId } })).fechaEnvio).not.toBeNull();
    // Un pago no aprobado no tiene comprobante para reenviar.
    const rechazado = await prisma.pago.findFirstOrThrow({ where: { estado: 'RECHAZADO' } });
    await expect(cuotaService.reenviarComprobante(rechazado.id)).rejects.toMatchObject({ status: 404 });
  });

  it('CU-001-004 y débito: adhesión autorizada, débito con 10 % y baja de la adhesión', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const inicio = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'DEBITO_AUTOMATICO' });
    expect(inicio.body.tipo).toBe('REDIRECCION');
    expect(await prisma.adhesionDebito.count({ where: { socioId: socio.id } })).toBe(0); // se registra recién al autorizarse
    await cuotaService.registrarResultado({ tipo: 'ADHESION', socioId: socio.id, idPreaprobacion: 'PRE-1', autorizada: true });
    const programado = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'DEBITO_AUTOMATICO' });
    expect(programado.body.tipo).toBe('DEBITO_PROGRAMADO');
    await cuotaService.registrarResultado({ tipo: 'DEBITO', idPreaprobacion: 'PRE-1', referenciaExterna: 'AP-1', aprobado: true });
    const pagada = await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } });
    expect(pagada).toMatchObject({ estado: 'PAGADA' });
    expect(Number(pagada.descuento)).toBe(3000);
    expect(Number(pagada.importeFinal)).toBe(27000);
    const baja = await request(app).delete('/api/socio/debito').set(conToken(socio.token));
    expect(baja.body.estado).toBe('CANCELADA');
  });

  it('RF19: pago en efectivo registrado por personal autorizado con responsable', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const r = await request(app).post(`/api/admin/cuotas/${cuota.id}/efectivo`).set(conToken(cobranzas.token));
    expect(r.status).toBe(201);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: r.body.pagoId } });
    expect(pago).toMatchObject({ medio: 'EFECTIVO', estado: 'APROBADO', responsableId: cobranzas.id });
    expect((await request(app).post(`/api/admin/cuotas/${cuota.id}/efectivo`).set(conToken(cobranzas.token))).body.error).toBe('CUOTA_PAGADA');
  });

  it('RD12: un nuevo precio rige para pagos posteriores sin alterar comprobantes emitidos', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    await request(app).post(`/api/admin/cuotas/${cuota.id}/efectivo`).set(conToken(cobranzas.token));
    const precio = await request(app).put('/api/admin/planes/BASICO/precio').set(conToken(g.admin.token)).send({ importeNuevo: 35000, motivo: 'Ajuste de prueba' });
    expect(precio.status).toBe(201);
    expect(Number((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).importeFinal)).toBe(30000);
    const otro = await crearSocio(g.sedeA.id);
    const nueva = await prisma.cuota.findFirstOrThrow({ where: { socioId: otro.id } });
    const medios = await request(app).get(`/api/cuotas/${nueva.id}/medios`).set(conToken(otro.token));
    expect(medios.body.PAGO_UNICO.importeFinal).toBe(35000);
    expect(await prisma.actualizacionPrecio.count({ where: { motivo: 'Ajuste de prueba', responsableId: g.admin.id } })).toBe(1);
  });

  it('la base rechaza un importe final inconsistente y un segundo pago aprobado (CHECK e índice)', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    await expect(prisma.cuota.update({ where: { id: cuota.id }, data: { importeFinal: 1 } })).rejects.toThrow();
    await prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 10, estado: 'APROBADO', referenciaExterna: 'X-1' } });
    await expect(prisma.pago.create({ data: { cuotaId: cuota.id, medio: 'PAGO_UNICO', importe: 10, estado: 'APROBADO', referenciaExterna: 'X-2' } })).rejects.toThrow();
  });

  it('el webhook sin firma válida se rechaza', async () => {
    doble.actual.firmaValida = false;
    const r = await request(app).post('/api/pagos/webhook').send({ type: 'payment', data: { id: '1' } });
    expect(r.status).toBe(401);
  });

  it('webhook firmado de una orden (Order): consulta la orden, la registra y es idempotente ante reenvíos', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const { body } = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' });
    expect(body.url).toContain('https://');
    doble.actual.firmaValida = true;
    doble.actual.respuestas.set('ORD01TEST9001', { tipo: 'PAGO', pagoId: body.pagoId, referenciaExterna: 'PAY01TEST9001', aprobado: true });
    const notificacion = { type: 'order', action: 'order.processed', data: { id: 'ORD01TEST9001' } };
    const webhook = () => request(app).post('/api/pagos/webhook').query({ 'data.id': 'ORD01TEST9001', type: 'order' }).send(notificacion);
    expect((await webhook()).body.procesado).toBe(true);
    expect((await webhook()).body.duplicado).toBe(true);
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).estado).toBe('PAGADA');
    expect(await prisma.pago.count({ where: { referenciaExterna: 'PAY01TEST9001' } })).toBe(1);
  });

  it('retorno de Checkout Pro: confirma buscando la orden del pago y no acepta pagos ajenos', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const otro = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } });
    const { body } = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' });
    // Orden todavía abierta: no se registra nada y la cuota sigue pendiente.
    const pendiente = await request(app).post('/api/pagos/confirmacion').set(conToken(socio.token)).send({ pagoId: body.pagoId });
    expect(pendiente.body).toMatchObject({ procesado: false, estado: 'PENDIENTE_DE_CONFIRMACION' });
    doble.actual.respuestas.set(`pago-${body.pagoId}`, { tipo: 'PAGO', pagoId: body.pagoId, referenciaExterna: 'PAY01TEST9002', aprobado: true });
    expect((await request(app).post('/api/pagos/confirmacion').set(conToken(otro.token)).send({ pagoId: body.pagoId })).status).toBe(404);
    const r = await request(app).post('/api/pagos/confirmacion').set(conToken(socio.token)).send({ pagoId: body.pagoId });
    expect(r.body).toMatchObject({ procesado: true, aprobado: true });
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: cuota.id } })).estado).toBe('PAGADA');
    expect((await request(app).post('/api/pagos/confirmacion').set(conToken(socio.token)).send({ pagoId: 'abc' })).status).toBe(400);
  });

  it('la cuota del período se genera al dar de alta al socio', async () => {
    const socio = await crearSocio(g.sedeB.id);
    expect(await prisma.cuota.count({ where: { socioId: socio.id, periodo: ahoraLocal().fecha.slice(0, 7) } })).toBe(1);
  });
});
