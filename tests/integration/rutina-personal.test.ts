import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, catalogo, conToken, crearGimnasio, crearPersonal, crearRol, crearSocio, limpiarBase } from './fixtures';

/** RF5: el personal autorizado genera con IA y edita la rutina de un socio de su gimnasio. */
describe('Rutina del socio gestionada por el personal', () => {
  let a: Awaited<ReturnType<typeof crearGimnasio>>;
  let b: Awaited<ReturnType<typeof crearGimnasio>>;
  const preferencias = { objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 2 };

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    a = await crearGimnasio();
    b = await crearGimnasio('STANDARD');
    await prisma.ejercicio.createMany({
      data: [
        { nombre: 'Prensa', grupoMuscular: 'Piernas' },
        { nombre: 'Sentadilla', grupoMuscular: 'Piernas' },
        { nombre: 'Press de banca', grupoMuscular: 'Pecho' },
        { nombre: 'Remo', grupoMuscular: 'Espalda' },
        { nombre: 'Plancha', grupoMuscular: 'Core' },
      ],
    });
  });
  afterAll(() => prisma.$disconnect());

  it('genera la rutina con IA para el socio, que la ve en «Mi rutina», y queda en la auditoría', async () => {
    const socio = await crearSocio(a.sedeA.id);
    const h = conToken(a.admin.token);
    expect((await request(app).get(`/api/admin/socios/${socio.id}/rutina`).set(h)).body.rutina).toBeNull();

    const r = await request(app).post(`/api/admin/socios/${socio.id}/rutina`).set(h).send(preferencias);
    expect(r.status).toBe(201);
    expect(r.body.rutina.ejercicios.length).toBeGreaterThan(0);
    expect(r.body.preferencias).toMatchObject(preferencias);

    // El socio ve la misma rutina desde su espacio.
    const propia = await request(app).get('/api/rutinas/actual').set(conToken(socio.token));
    expect(propia.body.rutina.id).toBe(r.body.rutina.id);
    const auditoria = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'RUTINA_GENERADA_POR_PERSONAL' } });
    expect(auditoria.usuarioId).toBe(a.admin.usuarioId);
    expect(auditoria.detalle).toMatchObject({ socioId: socio.id, objetivo: 'Hipertrofia' });

    // Una nueva generación reemplaza a la vigente.
    await request(app).post(`/api/admin/socios/${socio.id}/rutina`).set(h).send({ ...preferencias, objetivo: 'Resistencia' });
    expect(await prisma.rutina.count({ where: { socioId: socio.id, vigente: true } })).toBe(1);
  });

  it('edita series, repeticiones, peso y ejercicio dentro de los rangos válidos', async () => {
    const socio = await crearSocio(a.sedeA.id);
    const h = conToken(a.admin.token);
    const rutina = (await request(app).post(`/api/admin/socios/${socio.id}/rutina`).set(h).send(preferencias)).body.rutina;
    const item = rutina.ejercicios[0];
    const ruta = `/api/admin/socios/${socio.id}/rutina/ejercicios/${item.id}`;

    const r = await request(app).put(ruta).set(h).send({ series: 4, repeticiones: 12, pesoKg: 40, descansoSeg: 90, nombreEjercicio: 'Remo' });
    expect(r.status).toBe(200);
    const editado = r.body.rutina.ejercicios.find((e: { id: number }) => e.id === item.id);
    expect(editado).toMatchObject({ series: 4, repeticiones: 12, pesoKg: 40, descansoSeg: 90, nombre: 'Remo' });
    expect(await prisma.auditoria.count({ where: { accion: 'RUTINA_EDITADA_POR_PERSONAL', entidadId: item.id } })).toBe(1);

    expect((await request(app).put(ruta).set(h).send({ series: 50 })).status).toBe(400);
    // Un ejercicio de la rutina de otro socio no se puede editar por esta ruta.
    const otro = await crearSocio(a.sedeA.id);
    expect((await request(app).put(`/api/admin/socios/${otro.id}/rutina/ejercicios/${item.id}`).set(h).send({ series: 3 })).status).toBe(404);
  });

  it('respeta los permisos: con CONSULTA solo ve; sin el módulo Socios no accede', async () => {
    const socio = await crearSocio(a.sedeA.id);
    const consulta = await crearPersonal(a.gimnasio.id, (await crearRol(a.gimnasio.id, 'Recepción', [['SOCIOS', 'CONSULTA']])).id, 'recepcion');
    const otroModulo = await crearPersonal(a.gimnasio.id, (await crearRol(a.gimnasio.id, 'Cobranzas', [['COBROS', 'GESTION']])).id, 'cobros');
    expect((await request(app).get(`/api/admin/socios/${socio.id}/rutina`).set(conToken(consulta.token))).status).toBe(200);
    expect((await request(app).post(`/api/admin/socios/${socio.id}/rutina`).set(conToken(consulta.token)).send(preferencias)).status).toBe(403);
    expect((await request(app).get(`/api/admin/socios/${socio.id}/rutina`).set(conToken(otroModulo.token))).status).toBe(403);
    // El socio no puede usar las rutas del personal.
    expect((await request(app).get(`/api/admin/socios/${socio.id}/rutina`).set(conToken(socio.token))).status).toBe(403);
  });

  it('RNF4 y RD20: no accede a socios de otro gimnasio ni modifica la rutina de un socio desactivado', async () => {
    const ajeno = await crearSocio(b.sedeA.id);
    expect((await request(app).get(`/api/admin/socios/${ajeno.id}/rutina`).set(conToken(a.admin.token))).status).toBe(404);
    expect((await request(app).post(`/api/admin/socios/${ajeno.id}/rutina`).set(conToken(a.admin.token)).send(preferencias)).status).toBe(404);

    const socio = await crearSocio(a.sedeA.id);
    await prisma.usuario.update({ where: { id: socio.usuarioId }, data: { activo: false } });
    const r = await request(app).post(`/api/admin/socios/${socio.id}/rutina`).set(conToken(a.admin.token)).send(preferencias);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('SOCIO_INACTIVO');
    // Consultar la rutina sí se puede.
    expect((await request(app).get(`/api/admin/socios/${socio.id}/rutina`).set(conToken(a.admin.token))).status).toBe(200);
  });
});
