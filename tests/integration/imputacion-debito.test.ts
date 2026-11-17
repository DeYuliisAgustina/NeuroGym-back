import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import type { CobroDeSuscripcion } from '../../src/integrations/mercadopago';
import { MensajeriaSimulada, servicioMensajeria } from '../../src/integrations/mensajeria';
import { cuotaService } from '../../src/patterns/facade';
import { generarCuotaSocio, marcarCuotasVencidas } from '../../src/services/cuotaGeneracion.service';
import { ahoraLocal, fechaIso } from '../../src/utils/fechas';
import { app, catalogo, conToken, crearGimnasio, crearPersonal, crearRol, crearSocio, limpiarBase } from './fixtures';
import type { MercadoPagoDobleDePrueba } from '../mocks/MercadoPagoDobleDePrueba';

const mensajeria = servicioMensajeria as MensajeriaSimulada;

// Doble de prueba de Mercado Pago inyectado SOLO en esta suite.
const { doble } = vi.hoisted(() => ({ doble: { actual: null as unknown as MercadoPagoDobleDePrueba } }));
vi.mock('../../src/integrations/mercadopago', async (original) => {
  const modulo = await original<typeof import('../../src/integrations/mercadopago')>();
  const { MercadoPagoDobleDePrueba: Doble } = await import('../mocks/MercadoPagoDobleDePrueba');
  doble.actual = new Doble();
  return { ...modulo, crearGatewayMercadoPago: () => doble.actual };
});

const actual = ahoraLocal().fecha.slice(0, 7);
function desplazar(periodo: string, meses: number) {
  const [a, m] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const anterior = desplazar(actual, -1);
const siguiente = desplazar(actual, 1);
let secuencia = 0;
const nuevaReferencia = () => `ap-test-${Date.now()}-${++secuencia}`;
const debito = (idPreaprobacion: string, datos: Partial<CobroDeSuscripcion> = {}): CobroDeSuscripcion => ({
  tipo: 'DEBITO',
  idPreaprobacion,
  referenciaExterna: nuevaReferencia(),
  aprobado: true,
  periodo: actual,
  importe: 27000,
  ...datos,
});

describe('Imputación del débito automático al período facturado y conciliación', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  let cobranzas: Awaited<ReturnType<typeof crearPersonal>>;

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
    cobranzas = await crearPersonal(g.gimnasio.id, (await crearRol(g.gimnasio.id, 'Cobranzas', [['COBROS', 'GESTION']])).id, 'cobranzas');
  });
  afterAll(() => prisma.$disconnect());

  /** Socio con la cuota del período y una cuota anterior vencida e impaga. */
  async function socioConDeuda() {
    const socio = await crearSocio(g.sedeA.id);
    const { cuota: vieja } = await generarCuotaSocio(socio.id, anterior);
    await prisma.cuota.update({ where: { id: vieja.id }, data: { estado: 'IMPAGA' } });
    const delPeriodo = await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: socio.id, periodo: actual } } });
    return { socio, vieja, delPeriodo };
  }

  async function adherir(socioId: number, id: string) {
    await cuotaService.registrarResultado({ tipo: 'ADHESION', socioId, idPreaprobacion: id, autorizada: true }, 'RETORNO');
  }

  it('el débito paga la cuota del período facturado; la vencida anterior sigue impaga', async () => {
    const { socio, vieja, delPeriodo } = await socioConDeuda();
    await adherir(socio.id, 'PRE-PER');
    const r = await cuotaService.registrarResultado(debito('PRE-PER'), 'WEBHOOK');
    expect(r).toMatchObject({ procesado: true });
    const pagada = await prisma.cuota.findUniqueOrThrow({ where: { id: delPeriodo.id } });
    expect(pagada.estado).toBe('PAGADA');
    expect(Number(pagada.descuento)).toBe(3000); // 10 % solo por débito (RD6)
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: vieja.id } })).estado).toBe('IMPAGA');
    expect(await prisma.pago.count({ where: { cuotaId: vieja.id } })).toBe(0);
    // Trazabilidad: origen e identificadores de Mercado Pago en la auditoría.
    const pago = await prisma.pago.findFirstOrThrow({ where: { cuotaId: delPeriodo.id } });
    const auditoria = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'DEBITO_REGISTRADO', entidadId: pago.id } });
    expect(auditoria.detalle).toMatchObject({ origen: 'WEBHOOK', cobro: pago.referenciaExterna, periodo: actual });

    // Detalle del socio: muestra el período en curso y, aparte, la deuda anterior a elegir.
    const detalle = await request(app).get('/api/socio/cuota').set(conToken(socio.token));
    expect(detalle.body.cuota).toMatchObject({ periodo: actual, estado: 'PAGADA', mediosHabilitados: [] });
    expect(detalle.body.adeudadas).toEqual([expect.objectContaining({ periodo: anterior, estado: 'IMPAGA', mediosHabilitados: ['PAGO_UNICO', 'EFECTIVO'] })]);
  });

  it('si la cuota del período facturado no existe, se genera y se paga', async () => {
    const socio = await crearSocio(g.sedeA.id);
    await adherir(socio.id, 'PRE-GEN');
    await cuotaService.registrarResultado(debito('PRE-GEN', { periodo: siguiente }));
    const generada = await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: socio.id, periodo: siguiente } } });
    expect(generada.estado).toBe('PAGADA');
    expect((await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: socio.id, periodo: actual } } })).estado).not.toBe('PAGADA');
  });

  it('sin período identificable: pendiente de conciliación, sin imputar ni duplicar la auditoría', async () => {
    const socio = await crearSocio(g.sedeA.id);
    await adherir(socio.id, 'PRE-SINPER');
    const cobro = debito('PRE-SINPER', { periodo: null });
    expect(await cuotaService.registrarResultado(cobro)).toMatchObject({ procesado: false, pendienteConciliacion: true });
    await cuotaService.registrarResultado(cobro, 'CONCILIACION');
    expect(await prisma.pago.count({ where: { cuota: { socioId: socio.id } } })).toBe(0);
    expect(await prisma.auditoria.count({ where: { accion: 'DEBITO_PENDIENTE_CONCILIACION', detalle: { path: ['cobro'], equals: cobro.referenciaExterna } } })).toBe(1);
  });

  it('débito sobre una cuota ya pagada por otro medio: ni segundo pago ni comprobante', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: socio.id, periodo: actual } } });
    expect((await request(app).post(`/api/admin/cuotas/${cuota.id}/efectivo`).set(conToken(cobranzas.token))).status).toBe(201);
    await adherir(socio.id, 'PRE-DOBLE');
    const enviados = mensajeria.enviados.length;
    const cobro = debito('PRE-DOBLE');
    expect(await cuotaService.registrarResultado(cobro)).toMatchObject({ procesado: false, pendienteConciliacion: true });
    expect(await prisma.pago.count({ where: { cuotaId: cuota.id } })).toBe(1);
    expect(await prisma.comprobante.count({ where: { pago: { cuotaId: cuota.id } } })).toBe(1);
    expect(mensajeria.enviados.length).toBe(enviados);
    expect(await prisma.auditoria.count({ where: { accion: 'DEBITO_SOBRE_CUOTA_PAGADA', detalle: { path: ['cobro'], equals: cobro.referenciaExterna } } })).toBe(1);
  });

  it('débito programado: no pasa a IMPAGA, bloquea otros medios; rechazo los habilita y el reintento aprobado paga', async () => {
    const { socio, vieja, delPeriodo } = await socioConDeuda();
    await adherir(socio.id, 'PRE-PROG');
    await prisma.cuota.update({ where: { id: delPeriodo.id }, data: { estado: 'PENDIENTE' } });

    // Después del vencimiento, la tarea diaria no la marca impaga (débito todavía no informado).
    await marcarCuotasVencidas(`${actual}-25`);
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: delPeriodo.id } })).estado).toBe('PENDIENTE');
    const detalle = await request(app).get('/api/socio/cuota').set(conToken(socio.token));
    expect(detalle.body.cuota).toMatchObject({ debitoProgramado: true, mediosHabilitados: [], fechaVencimiento: fechaIso(delPeriodo.fechaVencimiento) });

    // Mientras tanto no se admite otro medio para esa cuota; la anterior sí se puede regularizar.
    const unico = await request(app).post(`/api/cuotas/${delPeriodo.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' });
    expect(unico.body.error).toBe('DEBITO_PROGRAMADO');
    expect((await request(app).post(`/api/admin/cuotas/${delPeriodo.id}/efectivo`).set(conToken(cobranzas.token))).body.error).toBe('DEBITO_PROGRAMADO');
    expect((await request(app).post(`/api/cuotas/${vieja.id}/pagos`).set(conToken(socio.token)).send({ medio: 'PAGO_UNICO' })).status).toBe(201);
    expect((await request(app).post(`/api/cuotas/${vieja.id}/pagos`).set(conToken(socio.token)).send({ medio: 'DEBITO_AUTOMATICO' })).body.error).toBe(
      'DEBITO_SOLO_PERIODO',
    );

    // Débito rechazado: deja de estar programada, figura impaga si ya venció y se habilitan otros medios.
    const cobro = debito('PRE-PROG', { aprobado: false, intento: 1 });
    await cuotaService.registrarResultado(cobro);
    const rechazada = await prisma.cuota.findUniqueOrThrow({ where: { id: delPeriodo.id } });
    expect(rechazada.estado).toBe(fechaIso(rechazada.fechaVencimiento) < ahoraLocal().fecha ? 'IMPAGA' : 'PENDIENTE');
    const tras = await request(app).get('/api/socio/cuota').set(conToken(socio.token));
    expect(tras.body.cuota).toMatchObject({ debitoProgramado: false, mediosHabilitados: ['PAGO_UNICO', 'EFECTIVO'] });

    // Mercado Pago reintenta el mismo cobro y lo aprueba: se registra sin duplicar.
    const reintento = await cuotaService.registrarResultado({ ...cobro, aprobado: true, intento: 2 });
    expect(reintento).toMatchObject({ procesado: true });
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: delPeriodo.id } })).estado).toBe('PAGADA');
    expect(await prisma.pago.count({ where: { cuotaId: delPeriodo.id } })).toBe(1);
    expect((await prisma.cuota.findUniqueOrThrow({ where: { id: vieja.id } })).estado).toBe('IMPAGA');
  });

  it('adhesión con la cuota del período ya pagada: la suscripción empieza el mes siguiente', async () => {
    const socio = await crearSocio(g.sedeA.id);
    const cuota = await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: socio.id, periodo: actual } } });
    await request(app).post(`/api/admin/cuotas/${cuota.id}/efectivo`).set(conToken(cobranzas.token));
    const r = await request(app).post(`/api/cuotas/${cuota.id}/pagos`).set(conToken(socio.token)).send({ medio: 'DEBITO_AUTOMATICO' });
    expect(r.body.tipo).toBe('REDIRECCION');
    const solicitud = doble.actual.debitosCreados.at(-1)!;
    expect(solicitud.importeMensual).toBe(27000);
    expect(solicitud.fechaInicio!.toISOString().slice(0, 7)).toBe(siguiente);

    // Con la cuota del período pendiente, el primer cobro es inmediato (sin fecha de inicio).
    const otro = await crearSocio(g.sedeA.id);
    const pendiente = await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: otro.id, periodo: actual } } });
    await request(app).post(`/api/cuotas/${pendiente.id}/pagos`).set(conToken(otro.token)).send({ medio: 'DEBITO_AUTOMATICO' });
    expect(doble.actual.debitosCreados.at(-1)!.fechaInicio).toBeUndefined();
  });

  it('la conciliación registra los débitos que no llegaron por webhook, sin duplicar, y deja resumen', async () => {
    const socio = await crearSocio(g.sedeA.id);
    await adherir(socio.id, 'PRE-CONC');
    const cobro = debito('PRE-CONC');
    doble.actual.cobros.set('PRE-CONC', [cobro]);
    const primera = await cuotaService.conciliarDebitos();
    expect(primera).toMatchObject({ errores: 0 });
    expect((await prisma.cuota.findUniqueOrThrow({ where: { socioId_periodo: { socioId: socio.id, periodo: actual } } })).estado).toBe('PAGADA');
    const pago = await prisma.pago.findUniqueOrThrow({ where: { referenciaExterna: cobro.referenciaExterna } });
    expect((await prisma.auditoria.findFirstOrThrow({ where: { accion: 'DEBITO_REGISTRADO', entidadId: pago.id } })).detalle).toMatchObject({
      origen: 'CONCILIACION',
    });

    const segunda = await cuotaService.conciliarDebitos();
    expect((segunda as { duplicados: number }).duplicados).toBeGreaterThanOrEqual(1);
    expect(await prisma.pago.count({ where: { referenciaExterna: cobro.referenciaExterna } })).toBe(1);
    expect(await prisma.auditoria.count({ where: { accion: 'CONCILIACION_DEBITOS' } })).toBeGreaterThanOrEqual(2);
  });
});
