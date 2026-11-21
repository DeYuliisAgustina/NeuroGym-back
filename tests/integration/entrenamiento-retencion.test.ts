import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { procesoEtl } from '../../src/jobs/ProcesoETLAsistencia';
import { aFechaDb, aHoraDb, ahoraLocal, sumarDias } from '../../src/utils/fechas';
import { app, catalogo, conToken, crearGimnasio, crearPersonal, crearRol, crearSocio, limpiarBase } from './fixtures';

describe('CU-003 rutinas con IA y CU-002 retención', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
    await prisma.ejercicio.createMany({
      data: [
        { nombre: 'Prensa', grupoMuscular: 'Piernas' },
        { nombre: 'Sentadilla', grupoMuscular: 'Piernas' },
        { nombre: 'Press de banca', grupoMuscular: 'Pecho' },
        { nombre: 'Flexiones', grupoMuscular: 'Pecho' },
        { nombre: 'Remo', grupoMuscular: 'Espalda' },
        { nombre: 'Plancha', grupoMuscular: 'Core' },
      ],
    });
    const prensa = await prisma.equipo.create({ data: { sedeId: g.sedeA.id, nombre: 'Prensa 45', categoria: 'Máquina' } });
    await prisma.ejercicioEquipo.create({ data: { equipoId: prensa.id, ejercicioId: (await prisma.ejercicio.findUniqueOrThrow({ where: { nombre: 'Prensa' } })).id } });
  });
  afterAll(() => prisma.$disconnect());

  describe('CU-003', () => {
    it('genera la rutina (servicio de IA simulado), la reemplaza y registra el entrenamiento', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const h = conToken(socio.token);
      const sinDatos = await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Hipertrofia' });
      expect(sinDatos.status).toBe(400);
      const r = await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 2 });
      expect(r.status).toBe(201);
      expect(r.body.rutina.ejercicios.length).toBeGreaterThan(0);
      expect(r.body.generador).toContain('simulación');
      await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Resistencia', nivel: 'Principiante', diasPorSemana: 3 });
      expect(await prisma.rutina.count({ where: { socioId: socio.id, vigente: true } })).toBe(1);
      expect(await prisma.rutina.count({ where: { socioId: socio.id } })).toBe(2);

      const rutina = (await request(app).get('/api/socio/rutina').set(h)).body.rutina;
      const delDia1 = rutina.ejercicios.filter((e: { dia: number }) => e.dia === 1);
      expect((await request(app).post('/api/socio/entrenamientos').set(h).send({ dia: 1, realizados: [] })).body.error).toBe('SIN_EJERCICIOS');
      const ent = await request(app).post('/api/socio/entrenamientos').set(h).send({ dia: 1, realizados: [delDia1[0].id] });
      expect(ent.body).toMatchObject({ ejerciciosCompletados: 1, ejerciciosTotales: delDia1.length });
    });

    it('zonas a evitar: lista cerrada, no se guardan y quitan del catálogo los ejercicios que las exigen', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const h = conToken(socio.token);
      const invalida = await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 2, evitar: ['TENGO_HERNIA'] });
      expect(invalida.status).toBe(400);
      const r = await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 2, evitar: ['RODILLAS', 'MUNECAS'] });
      expect(r.status).toBe(201);
      const nombres: string[] = r.body.rutina.ejercicios.map((e: { nombre: string }) => e.nombre);
      expect(nombres.length).toBeGreaterThan(0);
      // Sentadilla (rodillas), Flexiones, Plancha y Press de banca (muñecas) no se ofrecen.
      expect(nombres.filter((n) => ['Sentadilla', 'Flexiones', 'Plancha', 'Press de banca'].includes(n))).toEqual([]);
      const guardadas = await prisma.preferenciaRutina.findUniqueOrThrow({ where: { socioId: socio.id } });
      expect(guardadas).toMatchObject({ objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 2 });
      expect(guardadas).not.toHaveProperty('evitar');
    });

    it('CU-003-003/005: edición con validación de rangos', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const h = conToken(socio.token);
      const r = await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Movilidad', nivel: 'Avanzado', diasPorSemana: 1 });
      const item = r.body.rutina.ejercicios[0];
      expect((await request(app).put(`/api/socio/rutina/ejercicios/${item.id}`).set(h).send({ series: 50 })).status).toBe(400);
      const ok = await request(app).put(`/api/socio/rutina/ejercicios/${item.id}`).set(h).send({ series: 5, repeticiones: 8, pesoKg: 40, descansoSeg: 90 });
      expect(ok.body.rutina.ejercicios.find((e: { id: number }) => e.id === item.id)).toMatchObject({ series: 5, repeticiones: 8, pesoKg: 40, descansoSeg: 90 });
    });

    it('RF7 y RD11: equipo fuera de servicio → variante sugerida; aplicarla no modifica la reserva', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const h = conToken(socio.token);
      await request(app).post('/api/socio/rutina').set(h).send({ objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 3 });
      const rutina = await prisma.rutina.findFirstOrThrow({ where: { socioId: socio.id, vigente: true }, include: { ejercicios: true } });
      const prensa = await prisma.ejercicio.findUniqueOrThrow({ where: { nombre: 'Prensa' } });
      const item = await prisma.ejercicioRutina.update({ where: { id: rutina.ejercicios[0].id }, data: { ejercicioId: prensa.id } });
      await prisma.equipo.updateMany({ where: { nombre: 'Prensa 45' }, data: { estado: 'FUERA_DE_SERVICIO' } });

      const vista = await request(app).get('/api/socio/rutina').set(h);
      expect(vista.body.rutina.ejercicios.find((e: { id: number }) => e.id === item.id).disponible).toBe(false);
      const marcado = await request(app).post('/api/socio/entrenamientos').set(h).send({ dia: item.dia, realizados: [item.id] });
      expect(marcado.body.mensaje).toBe('Elegí una variante para este equipo.');

      const variante = await request(app).get(`/api/socio/rutina/ejercicios/${item.id}/variante`).set(h);
      expect(variante.body.variante.grupoMuscular).toBe('Piernas');
      const aplicada = await request(app).put(`/api/socio/rutina/ejercicios/${item.id}/variante`).set(h).send({ ejercicioId: variante.body.variante.id });
      expect(aplicada.body.mensaje).toBe('Variante aplicada. Tu turno se mantiene.');
      await prisma.equipo.updateMany({ where: { nombre: 'Prensa 45' }, data: { estado: 'OPERATIVO' } });
    });

    it('RD22: la baja de un equipo es definitiva y conserva su historial', async () => {
      const equipo = await prisma.equipo.create({ data: { sedeId: g.sedeA.id, nombre: 'Bicicleta vieja', categoria: 'Cardio' } });
      const socio = await crearSocio(g.sedeA.id);
      await prisma.incidencia.create({ data: { equipoId: equipo.id, reportanteId: socio.id, descripcion: 'No enciende' } });
      const h = conToken(g.admin.token);
      expect((await request(app).patch(`/api/admin/equipos/${equipo.id}/baja`).set(h).send({ motivo: 'Fin de vida útil' })).body.estado).toBe('DADO_DE_BAJA');
      expect((await request(app).patch(`/api/admin/equipos/${equipo.id}/disponibilidad`).set(h).send({ estado: 'OPERATIVO' })).body.error).toBe('EQUIPO_DADO_DE_BAJA');
      expect((await request(app).get(`/api/admin/equipos/${equipo.id}/historial`).set(h)).body.incidencias).toHaveLength(1);
      await expect(prisma.equipo.update({ where: { id: equipo.id }, data: { fechaBaja: null } })).rejects.toThrow();
    });
  });

  describe('CU-002', () => {
    /** Historial: asistía 3 veces por semana y dejó de venir hace 25 días. */
    async function socioAusente() {
      const socio = await crearSocio(g.sedeA.id);
      const hoy = ahoraLocal().fecha;
      for (let d = 70; d >= 25; d -= 2) {
        const fecha = sumarDias(hoy, -d);
        const turno = await prisma.turnoClase.create({ data: { sedeId: g.sedeA.id, actividad: 'Musculación', fecha: aFechaDb(fecha), horaInicio: aHoraDb('10:00'), horaFin: aHoraDb('11:00'), cupo: 30 } });
        const reserva = await prisma.reserva.create({ data: { turnoClaseId: turno.id, socioId: socio.id } });
        const qr = await prisma.codigoQr.create({ data: { socioId: socio.id, codigo: `seed-${socio.id}-${d}`, emitidoEn: new Date(`${fecha}T12:55:00Z`), expiraEn: new Date(`${fecha}T13:05:00Z`) } });
        await prisma.asistencia.create({ data: { reservaId: reserva.id, codigoQrId: qr.id, forma: 'QR', fechaHoraReal: new Date(`${fecha}T13:00:00Z`) } });
      }
      return socio;
    }

    it('ETL: indicadores con asistencias confirmadas, señal de ausencia y estimación (Intelligence)', async () => {
      const socio = await socioAusente();
      const r = await procesoEtl.ejecutar(g.gimnasio.id);
      expect(r.indicadores).toBeGreaterThan(0);
      const senal = await prisma.senalAbandono.findFirstOrThrow({ where: { socioId: socio.id } });
      expect(senal).toMatchObject({ tipo: 'Ausencia prolongada', nivel: 'ALTO' });
      expect((await prisma.estimacionRiesgo.findFirstOrThrow({ where: { socioId: socio.id } })).nivel).toBe('ALTO');
      // Idempotente: una segunda ejecución el mismo día no duplica señales.
      await procesoEtl.ejecutar(g.gimnasio.id);
      expect(await prisma.senalAbandono.count({ where: { socioId: socio.id } })).toBe(1);
    });

    it('RD10: la propuesta no se comunica hasta su aprobación; al aprobarse se notifica y bonifica Premium', async () => {
      const socio = await crearSocio(g.sedeA.id);
      const h = conToken(g.admin.token);
      const propuesta = await request(app).post('/api/admin/retencion/propuestas').set(h).send({ socioId: socio.id, incentivo: '7 días de Premium bonificado', mensaje: 'Te esperamos', premiumDias: 7 });
      expect(propuesta.body.estado).toBe('PENDIENTE');
      expect(await prisma.notificacion.count({ where: { usuarioId: socio.usuarioId, tipo: { in: ['INCENTIVO', 'BENEFICIO'] } } })).toBe(0);
      expect((await request(app).get('/api/socio/perfil').set(conToken(socio.token))).body.esPremium).toBe(false);
      const aprobada = await request(app).patch(`/api/admin/retencion/propuestas/${propuesta.body.id}/aprobacion`).set(h);
      expect(aprobada.body.bonificacion).not.toBeNull();
      expect(await prisma.notificacion.count({ where: { usuarioId: socio.usuarioId, tipo: 'BENEFICIO' } })).toBe(1);
      expect((await request(app).get('/api/socio/perfil').set(conToken(socio.token))).body.esPremium).toBe(true);
    });

    it('CU-002 4.3: un rol de consulta ve los indicadores pero no registra propuestas', async () => {
      const analista = await crearPersonal(g.gimnasio.id, (await crearRol(g.gimnasio.id, 'Analista', [['RETENCION', 'CONSULTA'], ['INTELLIGENCE', 'CONSULTA']])).id, 'analista');
      const h = conToken(analista.token);
      expect((await request(app).get('/api/admin/retencion/dashboard').set(h)).status).toBe(200);
      expect((await request(app).post('/api/admin/retencion/propuestas').set(h).send({})).status).toBe(403);
      expect((await request(app).get('/api/admin/intelligence/analitica').set(h)).status).toBe(200);
    });

    it('RD3: la analítica avanzada es exclusiva de Intelligence', async () => {
      const standard = await crearGimnasio('STANDARD');
      const r = await request(app).get('/api/admin/intelligence/analitica').set(conToken(standard.admin.token));
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('REQUIERE_INTELLIGENCE');
      expect((await request(app).get('/api/admin/retencion/dashboard').set(conToken(standard.admin.token))).status).toBe(200);
    });

    it('CU-002-009: exporta el reporte .xlsx', async () => {
      const r = await request(app).get('/api/admin/intelligence/reporte.xlsx').set(conToken(g.admin.token)).buffer(true);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('spreadsheetml');
    });

    it('RF11: canje de beneficio descuenta puntos y no permite saldo negativo', async () => {
      const socio = await crearSocio(g.sedeA.id);
      await prisma.socio.update({ where: { id: socio.id }, data: { saldoPuntos: 120 } });
      const beneficio = await prisma.beneficio.create({ data: { gimnasioId: g.gimnasio.id, nombre: 'Botella', descripcion: 'x', costoPuntos: 100, vigenciaDias: 30 } });
      const h = conToken(socio.token);
      expect((await request(app).post(`/api/socio/beneficios/${beneficio.id}/canje`).set(h)).status).toBe(201);
      expect((await request(app).post(`/api/socio/beneficios/${beneficio.id}/canje`).set(h)).body.error).toBe('PUNTOS_INSUFICIENTES');
      expect((await prisma.socio.findUniqueOrThrow({ where: { id: socio.id } })).saldoPuntos).toBe(20);
    });
  });
});
