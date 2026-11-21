import { prisma } from '../config/prisma';
import { reglaNegocio } from '../utils/errores';
import { aFechaDb, aHoraDb, ahoraLocal, diaSemanaIso, fechaIso, horaTexto, sumarDias } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { tenant } from './tenant.service';
import { TurnoClase } from '../domain';

interface DatosTurno {
  sedeId: number;
  actividad: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
}

const MAX_DIAS_SERIE = 90;

/** Vista de un turno con sus cupos ocupados. */
export function describirTurno(t: {
  id: number;
  sedeId: number;
  actividad: string;
  fecha: Date;
  horaInicio: Date;
  horaFin: Date;
  cupo: number;
  habilitado: boolean;
  sede?: { nombre: string };
  _count?: { reservas: number };
}) {
  const reservadas = t._count?.reservas ?? 0;
  return {
    id: t.id,
    sedeId: t.sedeId,
    sede: t.sede?.nombre,
    actividad: t.actividad,
    fecha: fechaIso(t.fecha),
    horaInicio: horaTexto(t.horaInicio),
    horaFin: horaTexto(t.horaFin),
    cupo: t.cupo,
    reservadas,
    disponibles: Math.max(0, t.cupo - reservadas),
    habilitado: t.habilitado,
  };
}

const contarReservadas = { _count: { select: { reservas: { where: { estado: 'RESERVADO' as const } } } } };

/** Configuración de horarios, actividades y cupos de turnos (RF16, RD23). */
export const turnoService = {
  async listar(gimnasioId: number, filtros: { sedeId?: number; desde?: string; hasta?: string }) {
    const desde = filtros.desde ?? ahoraLocal().fecha;
    const turnos = await prisma.turnoClase.findMany({
      where: {
        sede: { gimnasioId },
        ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
        fecha: { gte: aFechaDb(desde), lte: aFechaDb(filtros.hasta ?? sumarDias(desde, 14)) },
      },
      include: { sede: { select: { nombre: true } }, ...contarReservadas },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });
    return turnos.map(describirTurno);
  },

  async crear(gimnasioId: number, usuarioId: number, datos: DatosTurno) {
    await validarSedeYFecha(gimnasioId, datos.sedeId, datos.fecha, datos.horaInicio, datos.horaFin);
    const turno = await prisma.turnoClase.create({
      data: {
        sedeId: datos.sedeId,
        actividad: datos.actividad,
        fecha: aFechaDb(datos.fecha),
        horaInicio: aHoraDb(datos.horaInicio),
        horaFin: aHoraDb(datos.horaFin),
        cupo: datos.cupo,
      },
      include: { sede: { select: { nombre: true } }, ...contarReservadas },
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_TURNO', entidad: 'turno_clase', entidadId: turno.id });
    return describirTurno(turno);
  },

  /** Crea los turnos de una franja semanal entre dos fechas (p. ej., Funcional lunes y miércoles 18 h). */
  async crearSerie(
    gimnasioId: number,
    usuarioId: number,
    datos: Omit<DatosTurno, 'fecha'> & { desde: string; hasta: string; diasSemana: number[] },
  ) {
    if (datos.hasta < datos.desde) throw reglaNegocio('RANGO_INVALIDO', 'La fecha final es anterior a la inicial');
    const fechas: string[] = [];
    for (let f = datos.desde; f <= datos.hasta && fechas.length <= MAX_DIAS_SERIE; f = sumarDias(f, 1)) {
      if (datos.diasSemana.includes(diaSemanaIso(f))) fechas.push(f);
    }
    if (fechas.length === 0) throw reglaNegocio('SIN_FECHAS', 'No hay fechas que coincidan con los días elegidos');
    await validarSedeYFecha(gimnasioId, datos.sedeId, fechas[0], datos.horaInicio, datos.horaFin);
    const { count } = await prisma.turnoClase.createMany({
      data: fechas.map((fecha) => ({
        sedeId: datos.sedeId,
        actividad: datos.actividad,
        fecha: aFechaDb(fecha),
        horaInicio: aHoraDb(datos.horaInicio),
        horaFin: aHoraDb(datos.horaFin),
        cupo: datos.cupo,
      })),
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_SERIE_TURNOS', entidad: 'turno_clase', detalle: { ...datos, creados: count } });
    return { creados: count };
  },

  /** RD23: los cambios no alteran reservas existentes (también lo garantiza un disparador). */
  async actualizar(turnoId: number, gimnasioId: number, usuarioId: number, datos: Partial<Omit<DatosTurno, 'sedeId'>>) {
    const turno = await tenant.turnoClase(turnoId, gimnasioId);
    const reservadas = await prisma.reserva.count({ where: { turnoClaseId: turnoId, estado: 'RESERVADO' } });
    if (datos.cupo !== undefined && datos.cupo < reservadas) {
      throw reglaNegocio('CUPO_MENOR_A_RESERVAS', `El cupo no puede ser menor que las ${reservadas} reservas registradas`);
    }
    const cambiaHorario =
      (datos.fecha && datos.fecha !== fechaIso(turno.fecha)) ||
      (datos.horaInicio && datos.horaInicio !== horaTexto(turno.horaInicio)) ||
      (datos.horaFin && datos.horaFin !== horaTexto(turno.horaFin));
    if (cambiaHorario && reservadas > 0) {
      throw reglaNegocio('TURNO_CON_RESERVAS', 'No se puede modificar la fecha ni el horario de un turno con reservas');
    }
    if (cambiaHorario) {
      await validarSedeYFecha(
        gimnasioId,
        turno.sedeId,
        datos.fecha ?? fechaIso(turno.fecha),
        datos.horaInicio ?? horaTexto(turno.horaInicio),
        datos.horaFin ?? horaTexto(turno.horaFin),
      );
    }
    const actualizado = await prisma.turnoClase.update({
      where: { id: turnoId },
      data: {
        actividad: datos.actividad,
        cupo: datos.cupo,
        fecha: datos.fecha ? aFechaDb(datos.fecha) : undefined,
        horaInicio: datos.horaInicio ? aHoraDb(datos.horaInicio) : undefined,
        horaFin: datos.horaFin ? aHoraDb(datos.horaFin) : undefined,
      },
      include: { sede: { select: { nombre: true } }, ...contarReservadas },
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'MODIFICAR_TURNO', entidad: 'turno_clase', entidadId: turnoId, detalle: datos });
    return describirTurno(actualizado);
  },

  /** RD23: un turno deshabilitado solo deja de admitir nuevas reservas. */
  async cambiarHabilitacion(turnoId: number, gimnasioId: number, usuarioId: number, habilitado: boolean) {
    const actual = await tenant.turnoClase(turnoId, gimnasioId);
    const dominio = new TurnoClase({ ...actual, fecha: fechaIso(actual.fecha), horario: `${horaTexto(actual.horaInicio)}-${horaTexto(actual.horaFin)}` });
    if (habilitado) dominio.habilitar();
    else dominio.deshabilitar();
    const turno = await prisma.turnoClase.update({
      where: { id: turnoId },
      data: { habilitado: dominio.habilitado },
      include: { sede: { select: { nombre: true } }, ...contarReservadas },
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: habilitado ? 'HABILITAR_TURNO' : 'DESHABILITAR_TURNO', entidad: 'turno_clase', entidadId: turnoId });
    return describirTurno(turno);
  },

  async reservasDelTurno(turnoId: number, gimnasioId: number) {
    await tenant.turnoClase(turnoId, gimnasioId);
    return prisma.reserva.findMany({
      where: { turnoClaseId: turnoId },
      include: { socio: { include: { usuario: { select: { nombre: true, apellido: true, email: true } } } }, asistencia: true },
      orderBy: { fechaReserva: 'asc' },
    });
  },
};

async function validarSedeYFecha(gimnasioId: number, sedeId: number, fecha: string, horaInicio: string, horaFin: string) {
  const sede = await tenant.sede(sedeId, gimnasioId);
  // RD21: una sede deshabilitada no admite nuevos turnos.
  if (!sede.habilitada) throw reglaNegocio('SEDE_DESHABILITADA', 'La sede está deshabilitada y no admite nuevos turnos');
  if (fecha < ahoraLocal().fecha) throw reglaNegocio('FECHA_PASADA', 'No se pueden crear turnos en fechas pasadas');
  if (horaFin <= horaInicio) throw reglaNegocio('HORARIO_INVALIDO', 'La hora de fin debe ser posterior a la de inicio');
}
