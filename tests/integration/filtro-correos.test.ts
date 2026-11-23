import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { correoAceptado } from '../../src/utils/correos';
import { app, catalogo, crearGimnasio, limpiarBase } from './fixtures';

/** RF2: el autorregistro solo acepta correos de proveedores reconocidos (no inventados ni temporales). */
describe('Filtro de correos en el registro', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  const datos = (email: string) => ({
    email,
    password: 'Registro123',
    nombre: 'Lucía',
    apellido: 'Pérez',
    telefono: '341 555-1234',
    sedeId: g.sedeA.id,
    consentimientoDatos: true,
  });

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
  });
  afterAll(() => prisma.$disconnect());

  it.each(['lucia@pepe.com', 'lucia@mailinator.com', 'lucia@10minutemail.com', 'lucia@inventado.com.ar'])(
    'rechaza un correo inventado o temporal (%s)',
    async (email) => {
      const r = await request(app).post('/api/auth/registro').send(datos(email));
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('proveedor conocido');
      expect(await prisma.usuario.count({ where: { email } })).toBe(0);
    },
  );

  it.each(['lucia.perez@gmail.com', 'lucia.perez@hotmail.com', 'lucia.perez@outlook.com.ar', 'lucia.perez@yahoo.com.ar', 'lucia.perez@icloud.com'])(
    'acepta un correo de un proveedor conocido (%s)',
    async (email) => {
      const r = await request(app).post('/api/auth/registro').send(datos(email));
      expect(r.status).toBe(201);
    },
  );

  it('no distingue mayúsculas ni espacios en el correo', async () => {
    const r = await request(app).post('/api/auth/registro').send(datos('  Lucia.Mayus@GMAIL.com '));
    expect(r.status).toBe(201);
  });

  it('también filtra el registro de profesionales', async () => {
    const r = await request(app).post('/api/profesional/registro').send({
      email: 'nutri@pepe.com',
      password: 'Registro123',
      nombre: 'Ana',
      apellido: 'Paz',
      especialidad: 'NUTRICION',
      modalidadAtencion: 'ONLINE',
      valorConsulta: 20000,
      plan: 'BASICO',
      consentimientoDatos: true,
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('proveedor conocido');
  });

  it('el dominio reservado .test solo vale fuera de producción (datos de prueba)', () => {
    expect(correoAceptado('socio1@neurogym.test')).toBe(true);
    expect(correoAceptado('sin-arroba')).toBe(false);
  });
});
