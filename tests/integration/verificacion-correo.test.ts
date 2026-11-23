import request from 'supertest';
import { prisma } from '../../src/config/prisma';
import { servicioCorreo, type CorreoSimulado } from '../../src/integrations/correo';
import { PASSWORD, app, catalogo, crearGimnasio, crearSocio, limpiarBase, ultimoCodigo } from './fixtures';

const correo = servicioCorreo as CorreoSimulado;
const correosA = (email: string) => correo.enviados.filter((c) => c.para === email);
/** Simula que pasó el minuto de espera entre dos envíos. */
const envejecerCodigos = (email: string) =>
  prisma.codigoEmail.updateMany({ where: { usuario: { email } }, data: { fechaAlta: new Date(Date.now() - 2 * 60 * 1000) } });

/** Código de verificación al registrarse y recuperación de la contraseña por correo. */
describe('Verificación del correo y recuperación de la contraseña', () => {
  let g: Awaited<ReturnType<typeof crearGimnasio>>;
  const registro = (email: string) =>
    request(app).post('/api/auth/registro').send({
      email,
      password: 'Registro123',
      nombre: 'Lucía',
      apellido: 'Pérez',
      telefono: '341 555-1234',
      sedeId: g.sedeA.id,
      consentimientoDatos: true,
    });
  const verificar = (email: string, codigo: string) => request(app).post('/api/auth/verificacion').send({ email, codigo });

  beforeAll(async () => {
    await limpiarBase();
    await catalogo();
    g = await crearGimnasio();
  });
  afterAll(() => prisma.$disconnect());

  it('al registrarse envía un código de 6 dígitos (solo se guarda su hash) y lo confirma', async () => {
    expect((await registro('v1@prueba.test')).status).toBe(201);
    const enviados = correosA('v1@prueba.test');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].asunto).toMatch(/confirmar el correo/);
    const codigo = ultimoCodigo('v1@prueba.test');
    const guardado = await prisma.codigoEmail.findFirstOrThrow({ where: { usuario: { email: 'v1@prueba.test' } } });
    expect(guardado.codigoHash).not.toContain(codigo);
    expect(guardado.proposito).toBe('VERIFICACION_EMAIL');

    const incorrecto = await verificar('v1@prueba.test', codigo === '000000' ? '111111' : '000000');
    expect(incorrecto.status).toBe(422);
    expect(incorrecto.body.error).toBe('CODIGO_INCORRECTO');
    expect(incorrecto.body.mensaje).toMatch(/quedan 4 intentos/);
    expect(incorrecto.body.detalle).toEqual([{ campo: 'codigo', mensaje: incorrecto.body.mensaje }]);

    expect((await verificar('v1@prueba.test', codigo)).status).toBe(204);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { email: 'v1@prueba.test' } })).emailVerificado).toBe(true);
    expect(await prisma.auditoria.count({ where: { accion: 'VERIFICACION_EMAIL' } })).toBe(1);
    // Una cuenta ya verificada no cambia; un correo sin cuenta no revela nada distinto de un código vencido.
    expect((await verificar('v1@prueba.test', codigo)).status).toBe(204);
    const sinCuenta = await verificar('nadie@prueba.test', '123456');
    expect(sinCuenta.status).toBe(422);
    expect(sinCuenta.body.error).toBe('CODIGO_VENCIDO');
    expect((await verificar('v1@prueba.test', '12ab')).status).toBe(400);
  });

  it('reenvía el código solo después de un minuto y el nuevo anula al anterior', async () => {
    await registro('v2@prueba.test');
    const primero = ultimoCodigo('v2@prueba.test');
    expect((await request(app).post('/api/auth/verificacion/codigo').send({ email: 'v2@prueba.test' })).status).toBe(204);
    expect(correosA('v2@prueba.test')).toHaveLength(1);

    await envejecerCodigos('v2@prueba.test');
    expect((await request(app).post('/api/auth/verificacion/codigo').send({ email: 'v2@prueba.test' })).status).toBe(204);
    expect(correosA('v2@prueba.test')).toHaveLength(2);
    const segundo = ultimoCodigo('v2@prueba.test');
    if (segundo !== primero) expect((await verificar('v2@prueba.test', primero)).status).toBe(422);
    expect((await verificar('v2@prueba.test', segundo)).status).toBe(204);
    // Un correo sin cuenta responde igual y no envía nada.
    expect((await request(app).post('/api/auth/verificacion/codigo').send({ email: 'nadie@prueba.test' })).status).toBe(204);
    expect(correosA('nadie@prueba.test')).toHaveLength(0);
  });

  it('el ingreso sin verificar reenvía el código; tras 5 errores o al vencer hay que pedir otro', async () => {
    await registro('v3@prueba.test');
    await envejecerCodigos('v3@prueba.test');
    const login = await request(app).post('/api/auth/login').send({ email: 'v3@prueba.test', password: 'Registro123' });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe('EMAIL_NO_VERIFICADO');
    expect(correosA('v3@prueba.test')).toHaveLength(2);
    // Con la contraseña incorrecta no dice nada del correo ni envía códigos.
    expect((await request(app).post('/api/auth/login').send({ email: 'v3@prueba.test', password: 'Otra12345' })).status).toBe(401);

    const codigo = ultimoCodigo('v3@prueba.test');
    const otro = codigo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await verificar('v3@prueba.test', otro);
    expect((await verificar('v3@prueba.test', codigo)).body.error).toBe('CODIGO_VENCIDO');

    await envejecerCodigos('v3@prueba.test');
    await request(app).post('/api/auth/verificacion/codigo').send({ email: 'v3@prueba.test' });
    await prisma.codigoEmail.updateMany({ where: { usuario: { email: 'v3@prueba.test' }, usado: false }, data: { vence: new Date(Date.now() - 1000) } });
    expect((await verificar('v3@prueba.test', ultimoCodigo('v3@prueba.test'))).body.error).toBe('CODIGO_VENCIDO');
  });

  it('recupera la contraseña con el código enviado por correo', async () => {
    const socio = await crearSocio(g.sedeA.id);
    expect((await request(app).post('/api/auth/recuperacion').send({ email: 'nadie@prueba.test' })).status).toBe(204);
    expect(correosA('nadie@prueba.test')).toHaveLength(0);

    expect((await request(app).post('/api/auth/recuperacion').send({ email: socio.email.toUpperCase() })).status).toBe(204);
    const enviado = correosA(socio.email).at(-1)!;
    expect(enviado.asunto).toMatch(/cambiar la contraseña/);
    const codigo = ultimoCodigo(socio.email);
    const confirmar = (datos: object) => request(app).post('/api/auth/recuperacion/confirmacion').send({ email: socio.email, codigo, nueva: 'Nueva12345', ...datos });

    expect((await confirmar({ nueva: 'corta' })).status).toBe(400);
    expect((await confirmar({ codigo: codigo === '000000' ? '111111' : '000000' })).body.error).toBe('CODIGO_INCORRECTO');
    // El código se usa una sola vez.
    expect((await confirmar({})).status).toBe(204);
    expect((await confirmar({})).body.error).toBe('CODIGO_VENCIDO');

    expect((await request(app).post('/api/auth/login').send({ email: socio.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: socio.email, password: 'Nueva12345' })).status).toBe(200);
    expect(await prisma.auditoria.count({ where: { accion: 'RECUPERACION_PASSWORD', usuarioId: socio.usuarioId } })).toBe(1);
  });

  it('recuperar la contraseña también confirma el correo de una cuenta sin verificar', async () => {
    await registro('v4@prueba.test');
    await request(app).post('/api/auth/recuperacion').send({ email: 'v4@prueba.test' });
    const codigo = ultimoCodigo('v4@prueba.test');
    const r = await request(app).post('/api/auth/recuperacion/confirmacion').send({ email: 'v4@prueba.test', codigo, nueva: 'Nueva12345' });
    expect(r.status).toBe(204);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { email: 'v4@prueba.test' } })).emailVerificado).toBe(true);
  });

  it('si el correo no se puede enviar responde 502 y deja pedir otro enseguida', async () => {
    const socio = await crearSocio(g.sedeA.id);
    correo.fallar = true;
    const r = await request(app).post('/api/auth/recuperacion').send({ email: socio.email });
    correo.fallar = false;
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('CORREO_NO_ENVIADO');
    expect((await request(app).post('/api/auth/recuperacion').send({ email: socio.email })).status).toBe(204);
    expect(correosA(socio.email)).toHaveLength(1);
  });

  it('si falla el envío al registrarse, la cuenta se crea igual y el código se puede pedir de nuevo', async () => {
    correo.fallar = true;
    const r = await registro('v5@prueba.test');
    correo.fallar = false;
    expect(r.status).toBe(201);
    expect((await request(app).post('/api/auth/verificacion/codigo').send({ email: 'v5@prueba.test' })).status).toBe(204);
    expect((await verificar('v5@prueba.test', ultimoCodigo('v5@prueba.test'))).status).toBe(204);
  });
});
