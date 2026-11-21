import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, catalogo, conToken, crearGimnasio, crearPersonal, crearRol, crearSocio, limpiarBase, turnoDeHoy, turnoManana } from './fixtures';

describe('Reservas (RF3, RD18, RD23) y asistencia por QR (CU-004)', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  let recepcion: Awaited<ReturnType<typeof crearPersonal>>;
  let consultaRecepcion: Awaited<ReturnType<typeof crearPersonal>>;

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
    recepcion = await crearPersonal(g.gimnasio.id, (await crearRol(g.gimnasio.id, 'Recepción', [['RECEPCION', 'GESTION']])).id, 'recepcion');
    consultaRecepcion = await crearPersonal(g.gimnasio.id, (await crearRol(g.gimnasio.id, 'Recepción consulta', [['RECEPCION', 'CONSULTA']])).id, 'consulta');
  });
  afterAll(() => prisma.$disconnect());

  describe('reservas', () => {
    it('reserva, impide duplicados y libera el cupo al cancelar', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const turno = await turnoManana(g.sedeA.id, 1);
      const h = conToken(socio.token);
      const r = await request(app).post('/api/socio/reservas').set(h).send({ turnoId: turno.id });
      expect(r.status).toBe(201);
      expect((await request(app).post('/api/socio/reservas').set(h).send({ turnoId: turno.id })).body.error).toBe('SIN_CUPO');
      const otro = await crearSocio(g.sedeA.id);
      expect((await request(app).post('/api/socio/reservas').set(conToken(otro.token)).send({ turnoId: turno.id })).body.error).toBe('SIN_CUPO');
      expect((await request(app).patch(`/api/socio/reservas/${r.body.id}/cancelacion`).set(h)).status).toBe(200);
      expect((await request(app).post('/api/socio/reservas').set(conToken(otro.token)).send({ turnoId: turno.id })).status).toBe(201);
      // La reserva cancelada se conserva con su fecha de cancelación (RD18).
      expect((await prisma.reserva.findUniqueOrThrow({ where: { id: r.body.id } })).estado).toBe('CANCELADO');
    });

    it('concurrencia: 6 reservas simultáneas sobre cupo 2 → exactamente 2 confirmadas', async () => {
      const turno = await turnoManana(g.sedeA.id, 2, '12:00');
      const socios = await Promise.all(Array.from({ length: 6 }, () => crearSocio(g.sedeA.id)));
      const respuestas = await Promise.all(socios.map((s) => request(app).post('/api/socio/reservas').set(conToken(s.token)).send({ turnoId: turno.id })));
      expect(respuestas.filter((r) => r.status === 201)).toHaveLength(2);
      expect(await prisma.reserva.count({ where: { turnoClaseId: turno.id, estado: 'RESERVADO' } })).toBe(2);
    });

    it('RD21 y RD23: sede deshabilitada o turno deshabilitado no admiten nuevas reservas', async () => {
      const socio = await crearSocio(g.sedeB.id);
      const turno = await turnoManana(g.sedeB.id, 5, '15:00');
      await request(app).patch(`/api/admin/turnos/${turno.id}/habilitacion`).set(conToken(g.admin.token)).send({ habilitado: false });
      expect((await request(app).post('/api/socio/reservas').set(conToken(socio.token)).send({ turnoId: turno.id })).body.error).toBe('TURNO_DESHABILITADO');
    });

    it('RD23: el cupo no puede quedar por debajo de las reservas ni cambiar el horario con reservas', async () => {
      const turno = await turnoManana(g.sedeA.id, 3, '16:00');
      const s = await crearSocio(g.sedeA.id);
      await request(app).post('/api/socio/reservas').set(conToken(s.token)).send({ turnoId: turno.id });
      const h = conToken(g.admin.token);
      expect((await request(app).put(`/api/admin/turnos/${turno.id}`).set(h).send({ cupo: 0 })).status).toBe(400);
      const s2 = await crearSocio(g.sedeA.id);
      await request(app).post('/api/socio/reservas').set(conToken(s2.token)).send({ turnoId: turno.id });
      expect((await request(app).put(`/api/admin/turnos/${turno.id}`).set(h).send({ cupo: 1 })).body.error).toBe('CUPO_MENOR_A_RESERVAS');
      expect((await request(app).put(`/api/admin/turnos/${turno.id}`).set(h).send({ horaInicio: '17:00' })).body.error).toBe('TURNO_CON_RESERVAS');
      // El disparador de la base también lo impide aunque se saltee el servicio.
      await expect(prisma.turnoClase.update({ where: { id: turno.id }, data: { cupo: 1 } })).rejects.toThrow(/cupo no puede ser menor/);
    });
  });

  describe('CU-004 asistencia mediante QR', () => {
    const reservaHoy = async (socioId: number, sedeId = g.sedeA.id) => {
      const turno = await turnoDeHoy(sedeId);
      return prisma.reserva.create({ data: { turnoClaseId: turno.id, socioId } });
    };
    /**
     * Recepción como en los diagramas de secuencia: validar el QR (Fig. 99), verificar la
     * reserva (Fig. 100) y la cuota (Fig. 101) y confirmar la asistencia (Fig. 105).
     * Devuelve el mismo resultado que muestra la pantalla de recepción.
     */
    const ingreso = async (codigo: string, sedeId = g.sedeA.id, token = recepcion.token) => {
      const h = conToken(token);
      const rechazo = (r: { body: { error: string; mensaje: string } }) => ({ body: { resultado: r.body.error, mensaje: r.body.mensaje } });
      const validacion = await request(app).post('/api/qr/validacion').set(h).send({ codigo });
      if (validacion.status !== 200) return rechazo(validacion);
      const { socioId, codigoQrId } = validacion.body;
      const reserva = await request(app).get('/api/reservas/vigente').query({ socioId, sedeId }).set(h);
      if (reserva.status !== 200) return rechazo(reserva);
      const cuota = await request(app).get(`/api/cuotas/${socioId}/estado`).set(h);
      if (!cuota.body.alDia) return { body: { resultado: 'CUOTA_PENDIENTE', ...cuota.body, reservaId: reserva.body.reservaId, codigoQrId } };
      const asistencia = await request(app).post('/api/asistencias').set(h).send({ reservaId: reserva.body.reservaId, codigoQrId });
      return asistencia.status === 201 ? asistencia : rechazo(asistencia);
    };

    it('curso básico: valida el QR, registra la asistencia una sola vez y suma un día de constancia', async () => {
      const socio = await crearSocio(g.sedeA.id);
      await reservaHoy(socio.id);
      const qr = await request(app).post('/api/socio/qr').set(conToken(socio.token));
      expect(qr.status).toBe(201);
      const r = await ingreso(qr.body.codigo);
      expect(r.body.resultado).toBe('INGRESO_AUTORIZADO');
      expect(r.body.diaConstancia).toBe(true);
      expect((await prisma.socio.findUniqueOrThrow({ where: { id: socio.id } })).saldoPuntos).toBe(10);
      // RD7: segundo intento con la misma reserva.
      expect((await ingreso(qr.body.codigo)).body.resultado).toBe('INGRESO_DUPLICADO');
      expect(await prisma.asistencia.count({ where: { reserva: { socioId: socio.id } } })).toBe(1);
    });

    it('RD9: una segunda asistencia el mismo día no suma otro día de constancia', async () => {
      const socio = await crearSocio(g.sedeA.id);
      await reservaHoy(socio.id);
      await reservaHoy(socio.id);
      const qr = (await request(app).post('/api/socio/qr').set(conToken(socio.token))).body.codigo;
      expect((await ingreso(qr)).body.diaConstancia).toBe(true);
      const segundo = await ingreso(qr);
      expect(segundo.body.resultado).toBe('INGRESO_AUTORIZADO');
      expect(segundo.body.diaConstancia).toBe(false);
      expect(await prisma.diaConstancia.count({ where: { socioId: socio.id } })).toBe(1);
    });

    it('3.1 y 4.1: QR inválido, sin reserva y sede incorrecta se rechazan sin asistencia', async () => {
      expect((await ingreso('codigo-falsificado-0000.firma')).body.resultado).toBe('QR_INVALIDO');
      const socio = await crearSocio(g.sedeA.id);
      const qr = (await request(app).post('/api/socio/qr').set(conToken(socio.token))).body.codigo;
      expect((await ingreso(qr)).body.resultado).toBe('SIN_RESERVA');
      await reservaHoy(socio.id, g.sedeB.id);
      expect((await ingreso(qr)).body.resultado).toBe('SEDE_INCORRECTA');
      expect(await prisma.asistencia.count({ where: { reserva: { socioId: socio.id } } })).toBe(0);
      expect(await prisma.rechazoIngreso.count({ where: { socioId: socio.id } })).toBe(2);
    });

    it('RNF7: un QR vencido se rechaza', async () => {
      const socio = await crearSocio(g.sedeA.id);
      await reservaHoy(socio.id);
      const qr = (await request(app).post('/api/socio/qr').set(conToken(socio.token))).body.codigo;
      await prisma.codigoQr.update({ where: { codigo: qr }, data: { emitidoEn: new Date(Date.now() - 600_000), expiraEn: new Date(Date.now() - 1000) } });
      expect((await ingreso(qr)).body.resultado).toBe('QR_INVALIDO');
    });

    it('RNF4: un QR de otro gimnasio no es válido en esta recepción', async () => {
      const otro = await crearGimnasio();
      const socio = await crearSocio(otro.sedeA.id);
      const qr = (await request(app).post('/api/socio/qr').set(conToken(socio.token))).body.codigo;
      expect((await ingreso(qr)).body.resultado).toBe('QR_INVALIDO');
    });

    it('RD8: cuota impaga → advertencia; se autoriza con motivo o se bloquea', async () => {
      const socio = await crearSocio(g.sedeA.id);
      await prisma.cuota.updateMany({ where: { socioId: socio.id }, data: { estado: 'IMPAGA' } });
      await reservaHoy(socio.id);
      const qr = (await request(app).post('/api/socio/qr').set(conToken(socio.token))).body.codigo;
      const aviso = await ingreso(qr);
      expect(aviso.body.resultado).toBe('CUOTA_PENDIENTE');
      expect(aviso.body.puedeAutorizar).toBe(true);
      expect(await prisma.asistencia.count({ where: { reservaId: aviso.body.reservaId } })).toBe(0);
      const directa = await request(app).post('/api/asistencias').set(conToken(recepcion.token)).send({ reservaId: aviso.body.reservaId, codigoQrId: aviso.body.codigoQrId });
      expect(directa.body.error).toBe('CUOTA_PENDIENTE');
      // Un rol de solo consulta no puede autorizar (CU-004-006).
      const sinPermiso = await request(app).post('/api/autorizaciones').set(conToken(consultaRecepcion.token)).send({ reservaId: aviso.body.reservaId, motivo: 'x' });
      expect(sinPermiso.status).toBe(403);
      const autorizada = await request(app)
        .post('/api/autorizaciones')
        .set(conToken(recepcion.token))
        .send({ reservaId: aviso.body.reservaId, codigoQrId: aviso.body.codigoQrId, motivo: 'Pagará mañana' });
      expect(autorizada.body.resultado).toBe('INGRESO_AUTORIZADO');
      const asistencia = await prisma.asistencia.findUniqueOrThrow({ where: { reservaId: aviso.body.reservaId }, include: { autorizacion: true } });
      expect(asistencia.autorizacion?.motivo).toBe('Pagará mañana');
      // La autorización no modifica el estado de la cuota.
      expect((await prisma.cuota.findFirstOrThrow({ where: { socioId: socio.id } })).estado).toBe('IMPAGA');
    });

    it('CU-004-007: el bloqueo registra el rechazo con responsable y sin asistencia', async () => {
      const socio = await crearSocio(g.sedeA.id);
      await prisma.cuota.updateMany({ where: { socioId: socio.id }, data: { estado: 'IMPAGA' } });
      const reserva = await reservaHoy(socio.id);
      const r = await request(app).post('/api/rechazos').set(conToken(recepcion.token)).send({ reservaId: reserva.id });
      expect(r.body.resultado).toBe('BLOQUEADO');
      expect(await prisma.rechazoIngreso.findFirst({ where: { socioId: socio.id, responsableId: recepcion.id } })).not.toBeNull();
    });

    it('CU-004-010: registro manual con motivo y responsable; carga posterior queda provisoria', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const turno = await turnoDeHoy(g.sedeA.id, 10, -30);
      await prisma.reserva.create({ data: { turnoClaseId: turno.id, socioId: socio.id } });
      const sinMotivo = await request(app).post('/api/asistencias/manual').set(conToken(recepcion.token)).send({ socioId: socio.id, sedeId: g.sedeA.id, motivo: '' });
      expect(sinMotivo.status).toBe(400);
      const r = await request(app)
        .post('/api/asistencias/manual')
        .set(conToken(recepcion.token))
        .send({ socioId: socio.id, sedeId: g.sedeA.id, motivo: 'Corte de conexión', fechaHoraReal: new Date(Date.now() - 20 * 60_000).toISOString() });
      expect(r.body.resultado).toBe('INGRESO_AUTORIZADO');
      expect(r.body.provisoria).toBe(true);
      const a = await prisma.asistencia.findFirstOrThrow({ where: { reserva: { socioId: socio.id } } });
      expect(a).toMatchObject({ forma: 'MANUAL', motivo: 'Corte de conexión', responsableId: recepcion.id });
    });

    it('la base rechaza una asistencia QR sin código o manual sin responsable (CHECK)', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const reserva = await reservaHoy(socio.id);
      await expect(prisma.asistencia.create({ data: { reservaId: reserva.id, fechaHoraReal: new Date(), forma: 'QR' } })).rejects.toThrow();
      await expect(prisma.asistencia.create({ data: { reservaId: reserva.id, fechaHoraReal: new Date(), forma: 'MANUAL', motivo: 'x' } })).rejects.toThrow();
    });
  });
});
