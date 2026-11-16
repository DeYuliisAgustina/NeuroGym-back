import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, catalogo, conToken, crearGimnasio, crearPersonal, crearRol, crearSocio, limpiarBase, PASSWORD } from './fixtures';

describe('Seguridad, permisos (Composite) y aislamiento multiempresa', () => {
  let a: Awaited<ReturnType<typeof crearGimnasio>>;
  let b: Awaited<ReturnType<typeof crearGimnasio>>;
  let socioB: Awaited<ReturnType<typeof crearSocio>>;

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    a = await crearGimnasio();
    b = await crearGimnasio('STANDARD');
    socioB = await crearSocio(b.sedeA.id);
  });
  afterAll(() => prisma.$disconnect());

  it('RF14: el personal no ingresa por el acceso público y el socio no ingresa por el administrativo', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: a.admin.email, password: PASSWORD })).status).toBe(403);
    expect((await request(app).post('/api/auth/admin/login').send({ email: socioB.email, password: PASSWORD })).status).toBe(403);
  });

  it('credenciales incorrectas → 401 con mensaje genérico', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: socioB.email, password: 'otra1234' });
    expect(r.status).toBe(401);
    expect(r.body.mensaje).toBe('Correo o contraseña incorrectos');
  });

  it('la contraseña se guarda como hash bcrypt (RNF3)', async () => {
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: socioB.email } });
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u.passwordHash).not.toContain(PASSWORD);
  });

  it('sin token o con token adulterado → 401', async () => {
    expect((await request(app).get('/api/socio/perfil')).status).toBe(401);
    expect((await request(app).get('/api/socio/perfil').set(conToken(`${socioB.token}x`))).status).toBe(401);
  });

  it('RNF4: cambiar el id en la URL no permite ver ni modificar datos de otro gimnasio', async () => {
    const h = conToken(a.admin.token);
    expect((await request(app).get(`/api/admin/socios/${socioB.id}`).set(h)).status).toBe(404);
    expect((await request(app).put(`/api/admin/socios/${socioB.id}`).set(h).send({ telefono: '341 000-0000' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/socios/${socioB.id}/estado`).set(h).send({ activo: false })).status).toBe(404);
    expect((await request(app).get(`/api/admin/sedes/${b.sedeA.id}`).set(h)).status).toBe(404);
    const lista = await request(app).get('/api/admin/socios').set(h);
    expect(lista.body.every((s: { id: number }) => s.id !== socioB.id)).toBe(true);
    const cuota = await prisma.cuota.findFirstOrThrow({ where: { socioId: socioB.id } });
    expect((await request(app).post(`/api/admin/cuotas/${cuota.id}/efectivo`).set(h)).status).toBe(404);
  });

  it('Composite: un rol de consulta no puede gestionar y un rol sin el módulo recibe 403', async () => {
    const rol = await crearRol(a.gimnasio.id, 'Recepción', [['RECEPCION', 'GESTION'], ['SOCIOS', 'CONSULTA']]);
    const recepcion = await crearPersonal(a.gimnasio.id, rol.id, 'recepcion');
    const h = conToken(recepcion.token);
    expect((await request(app).get('/api/admin/socios').set(h)).status).toBe(200);
    expect((await request(app).post('/api/admin/socios').set(h).send({})).status).toBe(403);
    expect((await request(app).get('/api/admin/cuotas').set(h)).status).toBe(403);
    expect((await request(app).get('/api/admin/personal').set(h)).status).toBe(403);
  });

  it('RF15: el administrador general crea un rol y una cuenta; el cambio de permisos rige al instante', async () => {
    const h = conToken(a.admin.token);
    const rol = await request(app).post('/api/admin/roles').set(h).send({ nombre: 'Cobranzas', permisos: [{ modulo: 'COBROS', acceso: 'GESTION' }] });
    expect(rol.status).toBe(201);
    const alta = await request(app).post('/api/admin/personal').set(h).send({ email: 'cobranzas@prueba.test', nombre: 'C', apellido: 'D', rolId: rol.body.id });
    expect(alta.status).toBe(201);
    const login = await request(app).post('/api/auth/admin/login').send({ email: 'cobranzas@prueba.test', password: alta.body.passwordTemporal });
    expect(login.body.usuario.permisos).toContain('COBROS:GESTION');
    const hc = conToken(login.body.token);
    expect((await request(app).get('/api/admin/cuotas').set(hc)).status).toBe(200);
    await request(app).put(`/api/admin/roles/${rol.body.id}`).set(h).send({ permisos: [{ modulo: 'SOCIOS', acceso: 'CONSULTA' }] });
    expect((await request(app).get('/api/admin/cuotas').set(hc)).status).toBe(403);
  });

  it('RD20: un socio desactivado no puede operar aunque tenga un token vigente', async () => {
    const socio = await crearSocio(a.sedeA.id);
    await request(app).patch(`/api/admin/socios/${socio.id}/estado`).set(conToken(a.admin.token)).send({ activo: false });
    expect((await request(app).get('/api/socio/perfil').set(conToken(socio.token))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: socio.email, password: PASSWORD })).status).toBe(403);
    // Se conserva el historial (cuotas).
    expect(await prisma.cuota.count({ where: { socioId: socio.id } })).toBe(1);
  });

  it('no se puede desactivar al último administrador general', async () => {
    const otro = await crearPersonal(a.gimnasio.id, (await prisma.rol.findFirstOrThrow({ where: { gimnasioId: a.gimnasio.id, esPrincipal: true } })).id, 'admin2');
    const r = await request(app).patch(`/api/admin/personal/${otro.id}/estado`).set(conToken(a.admin.token)).send({ activo: false });
    expect(r.status).toBe(204);
    const propio = await request(app).patch(`/api/admin/personal/${a.admin.id}/estado`).set(conToken(a.admin.token)).send({ activo: false });
    expect(propio.status).toBe(422);
  });

  it('RD2: respeta el límite de sedes de la suscripción', async () => {
    const h = conToken(a.admin.token);
    expect((await request(app).post('/api/admin/sedes').set(h).send({ nombre: 'Sede C', direccion: 'X', horarios: 'Y' })).status).toBe(201);
    const cuarta = await request(app).post('/api/admin/sedes').set(h).send({ nombre: 'Sede D', direccion: 'X', horarios: 'Y' });
    expect(cuarta.status).toBe(422);
    expect(cuarta.body.error).toBe('LIMITE_SEDES');
  });

  it('las validaciones de entrada responden 400 con el detalle por campo', async () => {
    const r = await request(app).post('/api/admin/socios').set(conToken(a.admin.token)).send({ email: 'no-es-correo', consentimientoDatos: false });
    expect(r.status).toBe(400);
    expect(r.body.detalle.map((d: { campo: string }) => d.campo)).toEqual(expect.arrayContaining(['email', 'nombre', 'consentimientoDatos']));
  });

  it('auditoría: registra las operaciones relevantes', async () => {
    expect(await prisma.auditoria.count({ where: { gimnasioId: a.gimnasio.id, accion: 'DESACTIVAR_SOCIO' } })).toBe(1);
  });
});
