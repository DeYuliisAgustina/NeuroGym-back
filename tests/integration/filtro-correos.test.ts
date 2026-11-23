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

  it('indica en qué campo está cada error: teléfono inexistente y nombre con números', async () => {
    const r = await request(app)
      .post('/api/auth/registro')
      .send({ ...datos('lucia.campos@gmail.com'), telefono: '441 555-1234', nombre: 'Lucía2', apellido: '!!' });
    expect(r.status).toBe(400);
    const campos = Object.fromEntries((r.body.detalle as { campo: string; mensaje: string }[]).map((d) => [d.campo, d.mensaje]));
    expect(campos.telefono).toContain('característica');
    expect(campos.nombre).toContain('solo letras');
    expect(campos.apellido).toBeDefined();
    expect(campos.email).toBeUndefined();
  });

  it('acepta el teléfono escrito con 0, 15 o +54 9', async () => {
    for (const [i, telefono] of ['0341 15 555-1234', '+54 9 341 555-1234'].entries()) {
      const r = await request(app).post('/api/auth/registro').send({ ...datos(`lucia.tel${i}@gmail.com`), telefono });
      expect(r.status).toBe(201);
    }
  });

  it('el dominio reservado .test solo vale fuera de producción (datos de prueba)', () => {
    expect(correoAceptado('socio1@neurogym.test')).toBe(true);
    expect(correoAceptado('sin-arroba')).toBe(false);
  });
});
