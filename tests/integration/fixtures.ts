import bcrypt from 'bcrypt';
import request from 'supertest';
import { crearApp } from '../../src/app';
import { prisma } from '../../src/config/prisma';
import { CODIGOS_MODULO, MODULOS } from '../../src/models/modulos';
import { generarCuotaSocio } from '../../src/services/cuotaGeneracion.service';
import { aFechaDb, aHoraDb, ahoraLocal } from '../../src/utils/fechas';

export const app = crearApp();
export const PASSWORD = 'Prueba1234';

/** Vacía todas las tablas de la base de PRUEBA (nunca la de desarrollo). */
export async function limpiarBase() {
  if (!process.env.DATABASE_URL?.includes('test')) throw new Error('Las pruebas de integración solo corren sobre una base *_test');
  const tablas = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tablas.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let hash: string;
const unico = () => Math.random().toString(36).slice(2, 8);

export async function catalogo() {
  for (const codigo of CODIGOS_MODULO) {
    const m = await prisma.modulo.create({ data: { codigo, nombre: MODULOS[codigo] } });
    await prisma.permiso.createMany({ data: [{ moduloId: m.id, acceso: 'CONSULTA' }, { moduloId: m.id, acceso: 'GESTION' }] });
  }
  await prisma.planMarketplace.createMany({
    data: [
      { tipo: 'BASICO', precioMensualUsd: 5, porcentajeComision: 8 },
      { tipo: 'PROFESIONAL', precioMensualUsd: 15, porcentajeComision: 2, perfilPromocionado: true },
    ],
  });
}

/** Gimnasio con una sede, planes, rol principal y un administrador general. */
export async function crearGimnasio(tipo: 'STANDARD' | 'INTELLIGENCE' = 'INTELLIGENCE') {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  const id = unico();
  const gimnasio = await prisma.gimnasio.create({
    data: {
      razonSocial: `Gimnasio Prueba ${id}`,
      cuit: `30-${id}-9`,
      suscripcion: { create: { tipo, maxSedes: 3, maxSociosActivos: 50, fechaInicio: aFechaDb('2026-01-01') } },
      sedes: { create: [{ nombre: 'Sede A', direccion: 'Calle 1', horarios: '7 a 23' }, { nombre: 'Sede B', direccion: 'Calle 2', horarios: '8 a 22' }] },
      planes: { create: [{ tipo: 'BASICO', importeMensual: 30000 }, { tipo: 'PREMIUM', importeMensual: 10000 }] },
    },
    include: { sedes: true, planes: true },
  });
  const rol = await prisma.rol.create({ data: { gimnasioId: gimnasio.id, nombre: 'Administrador general', esPrincipal: true } });
  const admin = await crearPersonal(gimnasio.id, rol.id, 'admin');
  return { gimnasio, sedeA: gimnasio.sedes[0], sedeB: gimnasio.sedes[1], admin };
}

export async function crearRol(gimnasioId: number, nombre: string, permisos: [string, 'CONSULTA' | 'GESTION'][]) {
  const catalogo = await prisma.permiso.findMany({ include: { modulo: true } });
  return prisma.rol.create({
    data: {
      gimnasioId,
      nombre,
      permisos: { create: permisos.map(([m, a]) => ({ permisoId: catalogo.find((p) => p.modulo.codigo === m && p.acceso === a)!.id })) },
    },
  });
}

export async function crearPersonal(gimnasioId: number, rolId: number, prefijo: string) {
  const email = `${prefijo}-${unico()}@prueba.test`;
  const p = await prisma.personalAdministrativo.create({
    data: {
      gimnasio: { connect: { id: gimnasioId } },
      rol: { connect: { id_gimnasioId: { id: rolId, gimnasioId } } },
      usuario: { create: { email, passwordHash: hash, nombre: 'Personal', apellido: prefijo, tipo: 'PERSONAL' } },
    },
  });
  return { ...p, email, token: await token(email, true) };
}

export async function crearSocio(sedeId: number, plan: 'BASICO' | 'PREMIUM' = 'BASICO') {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  const sede = await prisma.sede.findUniqueOrThrow({ where: { id: sedeId } });
  const planSocio = await prisma.planSocio.findUniqueOrThrow({ where: { gimnasioId_tipo: { gimnasioId: sede.gimnasioId, tipo: plan } } });
  const email = `socio-${unico()}@prueba.test`;
  const socio = await prisma.socio.create({
    data: {
      sede: { connect: { id: sedeId } },
      plan: { connect: { id: planSocio.id } },
      telefono: '341 555-0000',
      consentimientoDatos: true,
      usuario: { create: { email, passwordHash: hash, nombre: 'Socio', apellido: unico(), tipo: 'SOCIO' } },
    },
  });
  await generarCuotaSocio(socio.id, ahoraLocal().fecha.slice(0, 7));
  return { ...socio, email, token: await token(email) };
}

/** Turno de hoy que empieza ahora (dentro de la ventana de ingreso por QR). */
export async function turnoDeHoy(sedeId: number, cupo = 10, desplazamientoMin = 0) {
  const ahora = ahoraLocal();
  const inicio = Math.min(Math.max(ahora.minutos + desplazamientoMin, 0), 22 * 60);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return prisma.turnoClase.create({
    data: { sedeId, actividad: 'Musculación', fecha: aFechaDb(ahora.fecha), horaInicio: aHoraDb(hhmm(inicio)), horaFin: aHoraDb(hhmm(inicio + 60)), cupo },
  });
}

/** Turno de mañana: admite reservas por la API sin depender de la hora actual. */
export async function turnoManana(sedeId: number, cupo = 10, hora = '10:00') {
  const fecha = new Date(aFechaDb(ahoraLocal().fecha).getTime() + 86_400_000);
  const [h, m] = hora.split(':').map(Number);
  const fin = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return prisma.turnoClase.create({ data: { sedeId, actividad: 'Funcional', fecha, horaInicio: aHoraDb(hora), horaFin: aHoraDb(fin), cupo } });
}

export async function token(email: string, administrativo = false): Promise<string> {
  const r = await request(app).post(administrativo ? '/api/auth/admin/login' : '/api/auth/login').send({ email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`No se pudo iniciar sesión (${r.status}): ${JSON.stringify(r.body)}`);
  return r.body.token;
}

export const conToken = (t: string) => ({ Authorization: `Bearer ${t}` });
