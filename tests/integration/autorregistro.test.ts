import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, catalogo, conToken, crearGimnasio, crearSocio, limpiarBase } from './fixtures';

/** RF2: autorregistro del socio (pre-registro) y confirmación del alta por el gimnasio. */
describe('Autorregistro del socio', () => {
  let a: Awaited<ReturnType<typeof crearGimnasio>>;
  let b: Awaited<ReturnType<typeof crearGimnasio>>;
  const datos = (email: string, sedeId: number) => ({
    email,
    password: 'Registro123',
    nombre: 'Lucía',
    apellido: 'Pérez',
    telefono: '341 555-1234',
    sedeId,
    consentimientoDatos: true,
  });

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    a = await crearGimnasio();
    b = await crearGimnasio('STANDARD');
  });
  afterAll(() => prisma.$disconnect());

  it('ofrece los gimnasios con sus sedes habilitadas para elegir al registrarse', async () => {
    await prisma.sede.update({ where: { id: a.sedeB.id }, data: { habilitada: false } });
    const r = await request(app).get('/api/auth/registro/opciones');
    expect(r.status).toBe(200);
    const gimnasio = r.body.find((g: { id: number }) => g.id === a.gimnasio.id);
    expect(gimnasio.sedes.map((s: { id: number }) => s.id)).toEqual([a.sedeA.id]);
    await prisma.sede.update({ where: { id: a.sedeB.id }, data: { habilitada: true } });
  });

  it('el pre-registro crea la cuenta inactiva y sin cuota; no puede ingresar hasta el alta', async () => {
    const r = await request(app).post('/api/auth/registro').send(datos('nuevo1@prueba.test', a.sedeA.id));
    expect(r.status).toBe(201);
    expect(r.body.token).toBeUndefined();
    const socio = await prisma.socio.findFirstOrThrow({ where: { usuario: { email: 'nuevo1@prueba.test' } }, include: { usuario: true, plan: true, cuotas: true } });
    expect(socio.pendienteAlta).toBe(true);
    expect(socio.usuario.activo).toBe(false);
    expect(socio.plan.tipo).toBe('BASICO');
    expect(socio.cuotas).toHaveLength(0);
    const login = await request(app).post('/api/auth/login').send({ email: 'nuevo1@prueba.test', password: 'Registro123' });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe('ALTA_PENDIENTE');
  });

  it('valida consentimiento, contraseña, correo repetido y sede deshabilitada', async () => {
    expect((await request(app).post('/api/auth/registro').send({ ...datos('x1@prueba.test', a.sedeA.id), consentimientoDatos: false })).status).toBe(400);
    expect((await request(app).post('/api/auth/registro').send({ ...datos('x2@prueba.test', a.sedeA.id), password: 'corta' })).status).toBe(400);
    expect((await request(app).post('/api/auth/registro').send(datos('nuevo1@prueba.test', a.sedeA.id))).status).toBe(409);
    await prisma.sede.update({ where: { id: a.sedeB.id }, data: { habilitada: false } });
    expect((await request(app).post('/api/auth/registro').send(datos('x3@prueba.test', a.sedeB.id))).status).toBe(422);
    await prisma.sede.update({ where: { id: a.sedeB.id }, data: { habilitada: true } });
  });

  it('el personal ve los pendientes y, al confirmar el alta, el socio ingresa y tiene su cuota', async () => {
    const h = conToken(a.admin.token);
    const pendientes = await request(app).get('/api/admin/socios?pendiente=true').set(h);
    expect(pendientes.body.map((s: { usuario: { email: string } }) => s.usuario.email)).toEqual(['nuevo1@prueba.test']);
    const socio = pendientes.body[0];
    // Mientras está pendiente no se activa por el camino de la baja lógica.
    expect((await request(app).patch(`/api/admin/socios/${socio.id}/estado`).set(h).send({ activo: true })).status).toBe(422);

    expect((await request(app).patch(`/api/admin/socios/${socio.id}/alta`).set(h).send({ aprobar: true })).status).toBe(204);
    const login = await request(app).post('/api/auth/login').send({ email: 'nuevo1@prueba.test', password: 'Registro123' });
    expect(login.status).toBe(200);
    expect(login.body.usuario.socioId).toBe(socio.id);
    expect(await prisma.cuota.count({ where: { socioId: socio.id } })).toBe(1);
    expect(await prisma.auditoria.count({ where: { accion: 'ALTA_SOCIO', entidadId: socio.id } })).toBe(1);
    // Ya no está pendiente: no se puede volver a resolver.
    expect((await request(app).patch(`/api/admin/socios/${socio.id}/alta`).set(h).send({ aprobar: true })).status).toBe(422);
  });

  it('el personal puede rechazar el pre-registro: la cuenta sigue sin poder ingresar', async () => {
    await request(app).post('/api/auth/registro').send(datos('nuevo2@prueba.test', a.sedeA.id));
    const socio = await prisma.socio.findFirstOrThrow({ where: { usuario: { email: 'nuevo2@prueba.test' } } });
    expect((await request(app).patch(`/api/admin/socios/${socio.id}/alta`).set(conToken(a.admin.token)).send({ aprobar: false })).status).toBe(204);
    const login = await request(app).post('/api/auth/login').send({ email: 'nuevo2@prueba.test', password: 'Registro123' });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe('CUENTA_INACTIVA');
  });

  it('RNF4: otro gimnasio no puede confirmar el alta de un socio ajeno', async () => {
    await request(app).post('/api/auth/registro').send(datos('nuevo3@prueba.test', a.sedeA.id));
    const socio = await prisma.socio.findFirstOrThrow({ where: { usuario: { email: 'nuevo3@prueba.test' } } });
    expect((await request(app).patch(`/api/admin/socios/${socio.id}/alta`).set(conToken(b.admin.token)).send({ aprobar: true })).status).toBe(404);
  });

  it('RD2: el alta respeta el cupo de socios activos de la suscripción', async () => {
    await prisma.suscripcionSaas.update({ where: { gimnasioId: b.gimnasio.id }, data: { maxSociosActivos: 1 } });
    await crearSocio(b.sedeA.id);
    await request(app).post('/api/auth/registro').send(datos('nuevo4@prueba.test', b.sedeA.id));
    const socio = await prisma.socio.findFirstOrThrow({ where: { usuario: { email: 'nuevo4@prueba.test' } } });
    const r = await request(app).patch(`/api/admin/socios/${socio.id}/alta`).set(conToken(b.admin.token)).send({ aprobar: true });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('LIMITE_SOCIOS');
  });
});
