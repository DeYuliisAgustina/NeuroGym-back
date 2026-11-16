import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { aFechaDb, aHoraDb, ahoraLocal, DIAS_SEMANA, diaSemanaIso, sumarDias } from '../../src/utils/fechas';
import { app, catalogo, conToken, crearGimnasio, crearSocio, limpiarBase } from './fixtures';

describe('Marketplace de profesionales y patrón Observer (RD13, RD16, RD17)', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  let profesional: { token: string; id: number; usuarioId: number };
  let metodoPagoId: number;
  const manana = sumarDias(ahoraLocal().fecha, 1);

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
    const registro = await request(app).post('/api/profesional/registro').send({
      email: 'nutri@prueba.test',
      password: 'Prueba1234',
      nombre: 'Nutri',
      apellido: 'Prueba',
      especialidad: 'NUTRICION',
      modalidadAtencion: 'ONLINE_Y_PRESENCIAL',
      valorConsulta: 25000,
      plan: 'BASICO',
      consentimientoDatos: true,
    });
    expect(registro.status).toBe(201);
    profesional = { token: registro.body.token, id: registro.body.usuario.profesionalId, usuarioId: registro.body.usuario.usuarioId };
    const h = conToken(profesional.token);
    await request(app).post('/api/profesional/disponibilidad').set(h).send({ diaSemana: DIAS_SEMANA[diaSemanaIso(manana) - 1], horaInicio: '09:00', horaFin: '12:00', duracionConsultaMin: 60 });
    metodoPagoId = (await request(app).post('/api/profesional/metodos-pago').set(h).send({ tipo: 'PARTICULAR' })).body.id;
  });
  afterAll(() => prisma.$disconnect());

  const solicitar = (token: string, hora = '09:00') =>
    request(app).post('/api/socio/turnos-profesionales').set(conToken(token)).send({ profesionalId: profesional.id, metodoPagoId, fecha: manana, horaInicio: hora, modalidad: 'ONLINE' });

  it('RD5: un socio Básico no puede solicitar turnos', async () => {
    const basico = await crearSocio(g.sedeA.id, 'BASICO');
    expect((await solicitar(basico.token)).status).toBe(403);
  });

  it('Observer: la solicitud registra el evento CREADO y notifica por plataforma y mensajería', async () => {
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const r = await solicitar(socio.token);
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('SOLICITADO');
    const eventos = await prisma.eventoTurno.findMany({ where: { turnoProfesionalId: r.body.id }, include: { notificaciones: true } });
    expect(eventos.map((e) => e.tipo)).toEqual(['CREADO']);
    const canales = eventos[0].notificaciones.map((n) => `${n.usuarioId === socio.usuarioId ? 'socio' : 'profesional'}:${n.canal}`).sort();
    expect(canales).toEqual(['profesional:PLATAFORMA', 'socio:MENSAJERIA', 'socio:PLATAFORMA']);
    // El horario ocupado ya no se ofrece ni se puede volver a pedir.
    expect((await solicitar((await crearSocio(g.sedeA.id, 'PREMIUM')).token)).body.error).toBe('HORARIO_NO_DISPONIBLE');
  });

  it('RD16/RD17: confirmar no genera evento; reprogramar y cancelar sí; transiciones inválidas → 422', async () => {
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const { body: turno } = await solicitar(socio.token, '10:00');
    const hp = conToken(profesional.token);
    expect((await request(app).patch(`/api/turnos-profesionales/${turno.id}/reprogramacion`).set(conToken(socio.token)).send({ fecha: manana, horaInicio: '11:00' })).body.error).toBe('TRANSICION_INVALIDA');
    expect((await request(app).patch(`/api/profesional/turnos/${turno.id}/confirmacion`).set(hp)).body.estado).toBe('CONFIRMADO');
    expect(await prisma.eventoTurno.count({ where: { turnoProfesionalId: turno.id } })).toBe(1);
    const repro = await request(app).patch(`/api/turnos-profesionales/${turno.id}/reprogramacion`).set(conToken(socio.token)).send({ fecha: manana, horaInicio: '11:00' });
    expect(repro.body).toMatchObject({ estado: 'REPROGRAMADO', horaInicio: '11:00' });
    const ics = await request(app).get(`/api/turnos-profesionales/${turno.id}/calendario`).query({ formato: 'ics' }).set(hp);
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect((await request(app).patch(`/api/turnos-profesionales/${turno.id}/cancelacion`).set(hp).send({ motivo: '' })).status).toBe(400);
    expect((await request(app).patch(`/api/turnos-profesionales/${turno.id}/cancelacion`).set(hp).send({ motivo: 'Imprevisto' })).body.estado).toBe('CANCELADO');
    const tipos = (await prisma.eventoTurno.findMany({ where: { turnoProfesionalId: turno.id }, orderBy: { id: 'asc' } })).map((e) => e.tipo);
    expect(tipos).toEqual(['CREADO', 'REPROGRAMADO', 'CANCELADO']);
    expect((await request(app).patch(`/api/profesional/turnos/${turno.id}/confirmacion`).set(hp)).body.error).toBe('TRANSICION_INVALIDA');
  });

  it('otro socio no puede operar un turno ajeno', async () => {
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const intruso = await crearSocio(g.sedeA.id, 'PREMIUM');
    const turnos = await prisma.turnoProfesional.findFirst({ where: { estado: 'SOLICITADO' } });
    const id = turnos?.id ?? (await solicitar(socio.token, '11:00')).body.id;
    expect((await request(app).patch(`/api/turnos-profesionales/${id}/cancelacion`).set(conToken(intruso.token)).send({ motivo: 'x' })).status).toBe(404);
  });

  it('RD13: consulta realizada y pagada después de su horario → una sola comisión del 8 %', async () => {
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const ayer = sumarDias(ahoraLocal().fecha, -1);
    const turno = await prisma.turnoProfesional.create({
      data: { socioId: socio.id, profesionalId: profesional.id, metodoPagoId, fecha: aFechaDb(ayer), horaInicio: aHoraDb('09:00'), horaFin: aHoraDb('10:00'), modalidad: 'ONLINE', estado: 'CONFIRMADO' },
    });
    const hp = conToken(profesional.token);
    const r = await request(app).patch(`/api/profesional/turnos/${turno.id}/completado`).set(hp).send({ importeDeclarado: 30000 });
    expect(r.body.estado).toBe('COMPLETADO');
    const comision = await prisma.comision.findUniqueOrThrow({ where: { turnoProfesionalId: turno.id } });
    expect(Number(comision.importeComision)).toBe(2400);
    expect((await request(app).patch(`/api/profesional/turnos/${turno.id}/completado`).set(hp).send({ importeDeclarado: 30000 })).body.error).toBe('TRANSICION_INVALIDA');
  });

  it('no se registra como realizada una consulta futura', async () => {
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const turno = await prisma.turnoProfesional.create({
      data: { socioId: socio.id, profesionalId: profesional.id, metodoPagoId, fecha: aFechaDb(manana), horaInicio: aHoraDb('09:00'), horaFin: aHoraDb('10:00'), modalidad: 'ONLINE', estado: 'CONFIRMADO' },
    });
    expect((await request(app).patch(`/api/profesional/turnos/${turno.id}/completado`).set(conToken(profesional.token)).send({ importeDeclarado: 1000 })).body.error).toBe('CONSULTA_FUTURA');
  });

  it('Profesionales Fundadores: consulta exenta de comisión', async () => {
    await prisma.profesional.update({ where: { id: profesional.id }, data: { consultasExentas: 1 } });
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    const turno = await prisma.turnoProfesional.create({
      data: { socioId: socio.id, profesionalId: profesional.id, metodoPagoId, fecha: aFechaDb(sumarDias(ahoraLocal().fecha, -2)), horaInicio: aHoraDb('09:00'), horaFin: aHoraDb('10:00'), modalidad: 'ONLINE', estado: 'CONFIRMADO' },
    });
    await request(app).patch(`/api/profesional/turnos/${turno.id}/completado`).set(conToken(profesional.token)).send({ importeDeclarado: 20000 });
    const comision = await prisma.comision.findUniqueOrThrow({ where: { turnoProfesionalId: turno.id } });
    expect(comision.exenta).toBe(true);
    expect(Number(comision.importeComision)).toBe(0);
  });

  it('la publicación pausada no recibe solicitudes', async () => {
    await request(app).put('/api/profesional/perfil').set(conToken(profesional.token)).send({ publicacionPausada: true });
    const socio = await crearSocio(g.sedeA.id, 'PREMIUM');
    expect((await solicitar(socio.token, '09:00')).status).toBe(404);
    await request(app).put('/api/profesional/perfil').set(conToken(profesional.token)).send({ publicacionPausada: false });
  });
});
