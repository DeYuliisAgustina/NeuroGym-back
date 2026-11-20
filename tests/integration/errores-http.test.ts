import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { app, catalogo, conToken, crearGimnasio, crearSocio, limpiarBase } from './fixtures';

/**
 * Errores del cliente que generan los middlewares de Express (JSON, tamaño del
 * cuerpo, archivos estáticos y subida de archivos): deben responder 4xx con el
 * formato uniforme de la API, no 500.
 */
describe('Errores HTTP de los middlewares', () => {
  let socio: Awaited<ReturnType<typeof crearSocio>>;

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    const g = await crearGimnasio();
    socio = await crearSocio(g.sedeA.id);
  });
  afterAll(() => prisma.$disconnect());

  it('la raíz y las rutas sin el prefijo /api responden 404 RUTA_INEXISTENTE', async () => {
    for (const ruta of ['/', '/publico/planes-marketplace', '/api']) {
      const r = await request(app).get(ruta);
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('RUTA_INEXISTENTE');
    }
  });

  it('la ruta pública de planes del marketplace está bajo /api/publico', async () => {
    const r = await request(app).get('/api/publico/planes-marketplace');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('un JSON mal formado responde 400 JSON_INVALIDO', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('JSON_INVALIDO');
  });

  it('un cuerpo mayor a 1 MB responde 413', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(`"${'x'.repeat(1_100_000)}"`);
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('CUERPO_DEMASIADO_GRANDE');
  });

  it('un archivo inexistente en /archivos responde 404', async () => {
    const r = await request(app).get('/archivos/no-existe.jpg');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('RUTA_INEXISTENTE');
  });

  it('más de 5 archivos en una incidencia responde 400 sin registrarla', async () => {
    let solicitud = request(app).post('/api/socio/incidencias').set(conToken(socio.token));
    for (let i = 0; i < 6; i++) solicitud = solicitud.attach('archivos', Buffer.from([0xff, 0xd8, 0xff]), { filename: `f${i}.jpg`, contentType: 'image/jpeg' });
    const r = await solicitud;
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('ARCHIVOS_INVALIDOS');
    expect(await prisma.incidencia.count()).toBe(0);
  });
});
