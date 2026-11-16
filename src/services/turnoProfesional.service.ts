import type { EstadoTurnoProfesional, ModalidadConsulta, TipoEventoTurno } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { gestorEventosTurno, type TurnoObservado } from '../patterns/observer';
import { aNumero, redondear } from '../utils/dinero';
import { noEncontrado, prohibido, reglaNegocio } from '../utils/errores';
import { aFechaDb, aHoraDb, ahoraLocal, DIAS_SEMANA, diaSemanaIso, fechaIso, horaTexto, minutosDeHora } from '../utils/fechas';
import { GeneradorEventoCalendario } from '../utils/GeneradorEventoCalendario';
import { notificacionService } from './notificacion.service';
import { esPremium } from './precios.service';

/**
 * RD16: transiciones válidas del turno profesional, validadas en el backend.
 * SOLICITADO → confirmar, rechazar o cancelar; CONFIRMADO/REPROGRAMADO →
 * reprogramar (sin nueva aprobación), cancelar o completar luego de su fecha.
 */
export const TRANSICIONES: Record<EstadoTurnoProfesional, EstadoTurnoProfesional[]> = {
  SOLICITADO: ['CONFIRMADO', 'RECHAZADO', 'CANCELADO'],
  CONFIRMADO: ['REPROGRAMADO', 'CANCELADO', 'COMPLETADO'],
  REPROGRAMADO: ['REPROGRAMADO', 'CANCELADO', 'COMPLETADO'],
  RECHAZADO: [],
  CANCELADO: [],
  COMPLETADO: [],
};

export function validarTransicion(actual: EstadoTurnoProfesional, nuevo: EstadoTurnoProfesional): void {
  if (!TRANSICIONES[actual].includes(nuevo)) {
    throw reglaNegocio('TRANSICION_INVALIDA', `Un turno ${actual.toLowerCase()} no puede pasar a ${nuevo.toLowerCase()}`);
  }
}

const ACTIVOS: EstadoTurnoProfesional[] = ['SOLICITADO', 'CONFIRMADO', 'REPROGRAMADO'];

type Actor = { usuarioId: number; socioId?: number; profesionalId?: number };

const incluirTurno = {
  socio: { include: { usuario: { select: { nombre: true, apellido: true } } } },
  profesional: { include: { usuario: { select: { nombre: true, apellido: true } }, plan: true } },
  metodoPago: true,
  comision: true,
};

type TurnoCompleto = NonNullable<Awaited<ReturnType<typeof buscarTurno>>>;

function buscarTurno(turnoId: number, cliente: Tx | typeof prisma = prisma) {
  return cliente.turnoProfesional.findUnique({ where: { id: turnoId }, include: incluirTurno });
}

function describir(t: TurnoCompleto) {
  return {
    id: t.id,
    profesionalId: t.profesionalId,
    estado: t.estado,
    fecha: fechaIso(t.fecha),
    horaInicio: horaTexto(t.horaInicio),
    horaFin: horaTexto(t.horaFin),
    modalidad: t.modalidad,
    motivo: t.motivo,
    fechaSolicitud: t.fechaSolicitud,
    metodoPago: t.metodoPago,
    socio: `${t.socio.usuario.nombre} ${t.socio.usuario.apellido}`,
    profesional: `${t.profesional.usuario.nombre} ${t.profesional.usuario.apellido}`,
    especialidad: t.profesional.especialidad,
    comision: t.comision,
  };
}

function observado(t: TurnoCompleto): TurnoObservado {
  return {
    id: t.id,
    fecha: fechaIso(t.fecha),
    horaInicio: horaTexto(t.horaInicio),
    horaFin: horaTexto(t.horaFin),
    modalidad: t.modalidad,
    motivo: t.motivo,
    socio: { usuarioId: t.socio.usuarioId, nombre: `${t.socio.usuario.nombre} ${t.socio.usuario.apellido}`, telefono: t.socio.telefono },
    profesional: { usuarioId: t.profesional.usuarioId, nombre: `${t.profesional.usuario.nombre} ${t.profesional.usuario.apellido}`, especialidad: t.profesional.especialidad },
  };
}

/** Registra el evento (RD17) y notifica a los observadores suscriptos (patrón Observer). */
async function emitirEvento(turnoId: number, tipo: TipoEventoTurno, realizadoPorId: number) {
  const evento = await prisma.eventoTurno.create({ data: { turnoProfesionalId: turnoId, tipo, realizadoPorId } });
  const turno = await buscarTurno(turnoId);
  await gestorEventosTurno.notificar(observado(turno!), { id: evento.id, tipo, realizadoPorId });
  return evento;
}

/** Turnos libres de un profesional en una fecha según su disponibilidad semanal. */
async function horariosLibres(profesionalId: number, fecha: string, excluirTurnoId?: number) {
  const dia = DIAS_SEMANA[diaSemanaIso(fecha) - 1];
  const [bloques, ocupados] = await Promise.all([
    prisma.disponibilidad.findMany({ where: { profesionalId, diaSemana: dia }, orderBy: { horaInicio: 'asc' } }),
    prisma.turnoProfesional.findMany({
      where: { profesionalId, fecha: aFechaDb(fecha), estado: { in: ACTIVOS }, ...(excluirTurnoId ? { id: { not: excluirTurnoId } } : {}) },
    }),
  ]);
  const hoy = ahoraLocal();
  const libres: { horaInicio: string; horaFin: string }[] = [];
  for (const b of bloques) {
    for (let m = minutosDeHora(b.horaInicio); m + b.duracionConsultaMin <= minutosDeHora(b.horaFin); m += b.duracionConsultaMin) {
      const fin = m + b.duracionConsultaMin;
      if (fecha < hoy.fecha || (fecha === hoy.fecha && m <= hoy.minutos)) continue;
      if (ocupados.some((o) => minutosDeHora(o.horaInicio) < fin && minutosDeHora(o.horaFin) > m)) continue;
      const hhmm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
      libres.push({ horaInicio: hhmm(m), horaFin: hhmm(fin) });
    }
  }
  return libres;
}

/** El socio y el profesional del turno pueden operarlo; nadie más. */
async function turnoDeActor(turnoId: number, actor: Actor) {
  const turno = await buscarTurno(turnoId);
  if (!turno) throw noEncontrado('Turno');
  const esSocio = actor.socioId !== undefined && turno.socioId === actor.socioId;
  const esProfesional = actor.profesionalId !== undefined && turno.profesionalId === actor.profesionalId;
  if (!esSocio && !esProfesional) throw noEncontrado('Turno');
  return { turno, esSocio, esProfesional };
}

/** Solicitudes, confirmaciones, cancelaciones y reprogramaciones de consultas (RF13, RF30, RF37–RF43). */
export const turnoProfesionalService = {
  horariosLibres,

  /** RF13 y RF37: el socio Premium solicita un turno eligiendo un método de pago habilitado. */
  async solicitar(
    socio: { socioId: number; usuarioId: number },
    datos: { profesionalId: number; metodoPagoId: number; fecha: string; horaInicio: string; modalidad: ModalidadConsulta },
  ) {
    // RD5: solo los socios Premium acceden al marketplace.
    if (!(await esPremium(socio.socioId))) throw prohibido('El marketplace es exclusivo del Plan Premium');
    const profesional = await prisma.profesional.findFirst({
      where: { id: datos.profesionalId, publicacionPausada: false, usuario: { activo: true } },
      include: { metodosPago: true },
    });
    if (!profesional) throw noEncontrado('Profesional');
    if (!profesional.metodosPago.some((m) => m.id === datos.metodoPagoId)) {
      throw reglaNegocio('METODO_NO_HABILITADO', 'El método de pago no está habilitado por el profesional');
    }
    if (profesional.modalidadAtencion !== 'ONLINE_Y_PRESENCIAL' && profesional.modalidadAtencion !== datos.modalidad) {
      throw reglaNegocio('MODALIDAD_NO_DISPONIBLE', 'El profesional no atiende en esa modalidad');
    }
    const slot = (await horariosLibres(datos.profesionalId, datos.fecha)).find((s) => s.horaInicio === datos.horaInicio);
    if (!slot) throw reglaNegocio('HORARIO_NO_DISPONIBLE', 'El horario elegido no está disponible');
    const turno = await prisma.turnoProfesional.create({
      data: {
        socioId: socio.socioId,
        profesionalId: datos.profesionalId,
        metodoPagoId: datos.metodoPagoId,
        fecha: aFechaDb(datos.fecha),
        horaInicio: aHoraDb(slot.horaInicio),
        horaFin: aHoraDb(slot.horaFin),
        modalidad: datos.modalidad,
      },
    });
    await emitirEvento(turno.id, 'CREADO', socio.usuarioId);
    return describir((await buscarTurno(turno.id))!);
  },

  /** RF30: el profesional confirma una solicitud; se notifica sin evento Observer (RD17). */
  async confirmar(profesional: { profesionalId: number; usuarioId: number }, turnoId: number) {
    const { turno, esProfesional } = await turnoDeActor(turnoId, profesional);
    if (!esProfesional) throw prohibido();
    validarTransicion(turno.estado, 'CONFIRMADO');
    await prisma.turnoProfesional.update({ where: { id: turnoId }, data: { estado: 'CONFIRMADO' } });
    await notificacionService.notificar({
      usuarioId: turno.socio.usuarioId,
      tipo: 'TURNO_PROFESIONAL',
      mensaje: `${describir(turno).profesional} confirmó tu consulta del ${fechaIso(turno.fecha)} a las ${horaTexto(turno.horaInicio)}.`,
    });
    return describir((await buscarTurno(turnoId))!);
  },

  /** RF30: rechazo con motivo; se notifica sin evento Observer (RD17). */
  async rechazar(profesional: { profesionalId: number; usuarioId: number }, turnoId: number, motivo: string) {
    const { turno, esProfesional } = await turnoDeActor(turnoId, profesional);
    if (!esProfesional) throw prohibido();
    validarTransicion(turno.estado, 'RECHAZADO');
    await prisma.turnoProfesional.update({ where: { id: turnoId }, data: { estado: 'RECHAZADO', motivo } });
    await notificacionService.notificar({
      usuarioId: turno.socio.usuarioId,
      tipo: 'TURNO_PROFESIONAL',
      mensaje: `${describir(turno).profesional} rechazó tu solicitud del ${fechaIso(turno.fecha)}. Motivo: ${motivo}`,
    });
    return describir((await buscarTurno(turnoId))!);
  },

  /**
   * RF38 y RF30: el socio cancela solicitudes o turnos confirmados/reprogramados;
   * el profesional cancela turnos confirmados o reprogramados. Evento CANCELADO.
   */
  async cancelar(actor: Actor, turnoId: number, motivo: string) {
    const { turno, esProfesional } = await turnoDeActor(turnoId, actor);
    validarTransicion(turno.estado, 'CANCELADO');
    if (esProfesional && turno.estado === 'SOLICITADO') {
      throw reglaNegocio('USAR_RECHAZO', 'Para una solicitud pendiente, el profesional debe rechazarla');
    }
    await prisma.turnoProfesional.update({ where: { id: turnoId }, data: { estado: 'CANCELADO', motivo } });
    await emitirEvento(turnoId, 'CANCELADO', actor.usuarioId);
    return describir((await buscarTurno(turnoId))!);
  },

  /** RF39: reprogramación según disponibilidad, sin nueva aprobación. Evento REPROGRAMADO. */
  async reprogramar(actor: Actor, turnoId: number, datos: { fecha: string; horaInicio: string }) {
    const { turno } = await turnoDeActor(turnoId, actor);
    validarTransicion(turno.estado, 'REPROGRAMADO');
    const slot = (await horariosLibres(turno.profesionalId, datos.fecha, turnoId)).find((s) => s.horaInicio === datos.horaInicio);
    if (!slot) throw reglaNegocio('HORARIO_NO_DISPONIBLE', 'El nuevo horario no está disponible');
    await prisma.turnoProfesional.update({
      where: { id: turnoId },
      data: { estado: 'REPROGRAMADO', fecha: aFechaDb(datos.fecha), horaInicio: aHoraDb(slot.horaInicio), horaFin: aHoraDb(slot.horaFin) },
    });
    await emitirEvento(turnoId, 'REPROGRAMADO', actor.usuarioId);
    return describir((await buscarTurno(turnoId))!);
  },

  /**
   * RF40, RF41, RD13: registro declarativo de consulta realizada y pagada, luego
   * de su fecha y hora. Genera una única comisión (8 % Básico, 2 % Profesional),
   * o exenta si quedan consultas de Profesionales Fundadores.
   */
  async completar(profesional: { profesionalId: number; usuarioId: number }, turnoId: number, importeDeclarado: number) {
    const { turno, esProfesional } = await turnoDeActor(turnoId, profesional);
    if (!esProfesional) throw prohibido();
    validarTransicion(turno.estado, 'COMPLETADO');
    const hoy = ahoraLocal();
    const fecha = fechaIso(turno.fecha);
    if (fecha > hoy.fecha || (fecha === hoy.fecha && minutosDeHora(turno.horaFin) > hoy.minutos)) {
      throw reglaNegocio('CONSULTA_FUTURA', 'La consulta solo puede registrarse como realizada después de su horario');
    }
    await prisma.$transaction(async (tx) => {
      const prof = await tx.profesional.findUniqueOrThrow({ where: { id: profesional.profesionalId }, include: { plan: true } });
      const exenta = prof.consultasExentas > 0;
      const porcentaje = aNumero(prof.plan.porcentajeComision);
      await tx.turnoProfesional.update({ where: { id: turnoId }, data: { estado: 'COMPLETADO' } });
      await tx.comision.create({
        data: {
          turnoProfesionalId: turnoId,
          importeDeclarado,
          porcentaje,
          importeComision: exenta ? 0 : redondear((importeDeclarado * porcentaje) / 100),
          exenta,
        },
      });
      if (exenta) await tx.profesional.update({ where: { id: prof.id }, data: { consultasExentas: { decrement: 1 } } });
    });
    return describir((await buscarTurno(turnoId))!);
  },

  async listarDelSocio(socioId: number) {
    const turnos = await prisma.turnoProfesional.findMany({ where: { socioId }, include: incluirTurno, orderBy: [{ fecha: 'desc' }, { horaInicio: 'desc' }] });
    return turnos.map(describir);
  },

  /** Agenda y solicitudes del profesional (panel "Mi agenda"). */
  async agendaProfesional(profesionalId: number, filtros: { estado?: EstadoTurnoProfesional; desde?: string }) {
    const turnos = await prisma.turnoProfesional.findMany({
      where: { profesionalId, ...(filtros.estado ? { estado: filtros.estado } : {}), ...(filtros.desde ? { fecha: { gte: aFechaDb(filtros.desde) } } : {}) },
      include: incluirTurno,
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });
    return turnos.map(describir);
  },

  async eventos(turnoId: number, actor: Actor) {
    await turnoDeActor(turnoId, actor);
    return prisma.eventoTurno.findMany({ where: { turnoProfesionalId: turnoId }, include: { notificaciones: true }, orderBy: { fecha: 'asc' } });
  },

  /** RF43: archivo .ics y enlace de calendario, solo para consultas confirmadas o reprogramadas. */
  async calendario(turnoId: number, actor: Actor) {
    const { turno } = await turnoDeActor(turnoId, actor);
    if (turno.estado !== 'CONFIRMADO' && turno.estado !== 'REPROGRAMADO') {
      throw reglaNegocio('TURNO_NO_CONFIRMADO', 'Solo se pueden guardar en el calendario las consultas confirmadas');
    }
    const d = describir(turno);
    const datos = {
      turnoId,
      fecha: d.fecha,
      horaInicio: d.horaInicio,
      horaFin: d.horaFin,
      titulo: `Consulta NeuroGym: ${d.profesional} con ${d.socio}`,
      descripcion: `Consulta de ${d.especialidad.toLowerCase()} (${d.modalidad.toLowerCase()}). Pago: ${d.metodoPago.tipo.replace('_', ' ').toLowerCase()}${d.metodoPago.obraSocial ? ` (${d.metodoPago.obraSocial})` : ''}.`,
      ubicacion: d.modalidad === 'ONLINE' ? 'En línea' : 'Consultorio del profesional',
    };
    return { ics: GeneradorEventoCalendario.generarIcs(datos), enlaceGoogle: GeneradorEventoCalendario.generarEnlace(datos) };
  },
};
