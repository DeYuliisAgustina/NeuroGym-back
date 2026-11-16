import { prisma } from '../config/prisma';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal, fechaIso, horaTexto, minutosDeHora, sumarDias } from '../utils/fechas';
import { notificacionService } from './notificacion.service';
import { describirTurno } from './turno.service';

/** Reservas de turnos de clases y musculación (RF3). Una reserva no es una asistencia. */
export const reservaService = {
  /** Turnos disponibles de una sede del gimnasio del socio, con cupos libres. */
  async disponibles(socio: { socioId: number; gimnasioId: number }, filtros: { sedeId?: number; fecha?: string; dias?: number }) {
    const hoy = ahoraLocal();
    const desde = filtros.fecha && filtros.fecha > hoy.fecha ? filtros.fecha : hoy.fecha;
    const turnos = await prisma.turnoClase.findMany({
      where: {
        habilitado: true,
        sede: { gimnasioId: socio.gimnasioId, habilitada: true },
        ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
        fecha: filtros.fecha ? aFechaDb(desde) : { gte: aFechaDb(desde), lte: aFechaDb(sumarDias(desde, filtros.dias ?? 7)) },
      },
      include: {
        sede: { select: { nombre: true } },
        _count: { select: { reservas: { where: { estado: 'RESERVADO' } } } },
        reservas: { where: { socioId: socio.socioId, estado: 'RESERVADO' }, select: { id: true } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });
    return turnos
      .filter((t) => fechaIso(t.fecha) > hoy.fecha || minutosDeHora(t.horaInicio) > hoy.minutos)
      .map((t) => ({ ...describirTurno(t), reservaPropiaId: t.reservas[0]?.id ?? null }));
  },

  /**
   * Reserva con control de cupo concurrente: la fila del turno se bloquea
   * (SELECT ... FOR UPDATE) y un disparador de la base repite el control.
   */
  async reservar(socio: { socioId: number; gimnasioId: number; usuarioId: number }, turnoId: number) {
    const reserva = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT turno_clase_id FROM turno_clase WHERE turno_clase_id = ${turnoId} FOR UPDATE`;
      const turno = await tx.turnoClase.findFirst({
        where: { id: turnoId, sede: { gimnasioId: socio.gimnasioId } },
        include: { sede: true },
      });
      if (!turno) throw noEncontrado('Turno');
      if (!turno.sede.habilitada) throw reglaNegocio('SEDE_DESHABILITADA', 'La sede no admite nuevas reservas');
      if (!turno.habilitado) throw reglaNegocio('TURNO_DESHABILITADO', 'El turno no admite nuevas reservas');
      const hoy = ahoraLocal();
      const fecha = fechaIso(turno.fecha);
      if (fecha < hoy.fecha || (fecha === hoy.fecha && minutosDeHora(turno.horaInicio) <= hoy.minutos)) {
        throw reglaNegocio('TURNO_INICIADO', 'El turno ya comenzó o finalizó');
      }
      const ocupados = await tx.reserva.count({ where: { turnoClaseId: turnoId, estado: 'RESERVADO' } });
      if (ocupados >= turno.cupo) throw reglaNegocio('SIN_CUPO', 'No hay cupos disponibles para este turno');

      // Evita que el socio reserve dos turnos superpuestos el mismo día.
      const superpuesta = await tx.reserva.findFirst({
        where: {
          socioId: socio.socioId,
          estado: 'RESERVADO',
          turnoClaseId: { not: turnoId },
          turno: { fecha: turno.fecha, horaInicio: { lt: turno.horaFin }, horaFin: { gt: turno.horaInicio } },
        },
      });
      if (superpuesta) throw reglaNegocio('RESERVA_SUPERPUESTA', 'Ya tenés una reserva en ese horario');

      const existente = await tx.reserva.findUnique({ where: { turnoClaseId_socioId: { turnoClaseId: turnoId, socioId: socio.socioId } } });
      if (existente?.estado === 'RESERVADO') throw reglaNegocio('YA_RESERVADO', 'Ya tenés una reserva para este turno');
      // UNIQUE (turno, socio): una reserva cancelada se reactiva en lugar de duplicarse.
      return existente
        ? tx.reserva.update({
            where: { id: existente.id },
            data: { estado: 'RESERVADO', fechaReserva: new Date(), fechaCancelacion: null },
            include: { turno: { include: { sede: true } } },
          })
        : tx.reserva.create({ data: { turnoClaseId: turnoId, socioId: socio.socioId }, include: { turno: { include: { sede: true } } } });
    });
    await notificacionService.notificar({
      usuarioId: socio.usuarioId,
      tipo: 'TURNO_CLASE',
      mensaje: `Reservaste ${reserva.turno.actividad} el ${fechaIso(reserva.turno.fecha)} a las ${horaTexto(reserva.turno.horaInicio)} en ${reserva.turno.sede.nombre}.`,
    });
    return reserva;
  },

  async cancelar(socio: { socioId: number; usuarioId: number }, reservaId: number) {
    const reserva = await prisma.reserva.findFirst({
      where: { id: reservaId, socioId: socio.socioId },
      include: { turno: true, asistencia: true },
    });
    if (!reserva) throw noEncontrado('Reserva');
    if (reserva.estado === 'CANCELADO') throw reglaNegocio('YA_CANCELADA', 'La reserva ya está cancelada');
    if (reserva.asistencia) throw reglaNegocio('CON_ASISTENCIA', 'La reserva ya tiene una asistencia registrada');
    const hoy = ahoraLocal();
    const fecha = fechaIso(reserva.turno.fecha);
    if (fecha < hoy.fecha || (fecha === hoy.fecha && minutosDeHora(reserva.turno.horaInicio) <= hoy.minutos)) {
      throw reglaNegocio('TURNO_INICIADO', 'No se puede cancelar un turno que ya comenzó');
    }
    const cancelada = await prisma.reserva.update({ where: { id: reservaId }, data: { estado: 'CANCELADO', fechaCancelacion: new Date() } });
    await notificacionService.notificar({
      usuarioId: socio.usuarioId,
      tipo: 'TURNO_CLASE',
      mensaje: `Cancelaste tu reserva de ${reserva.turno.actividad} del ${fecha}.`,
    });
    return cancelada;
  },

  /** Próximas reservas e historial de turnos, indicando si hubo asistencia efectiva. */
  async misReservas(socioId: number) {
    const reservas = await prisma.reserva.findMany({
      where: { socioId },
      include: { turno: { include: { sede: { select: { nombre: true } } } }, asistencia: { select: { fechaHoraReal: true, forma: true } } },
      orderBy: [{ turno: { fecha: 'desc' } }, { turno: { horaInicio: 'desc' } }],
      take: 100,
    });
    const hoy = ahoraLocal().fecha;
    const vista = reservas.map((r) => ({
      id: r.id,
      estado: r.estado,
      fechaReserva: r.fechaReserva,
      fechaCancelacion: r.fechaCancelacion,
      asistencia: r.asistencia,
      turno: describirTurno({ ...r.turno, _count: { reservas: 0 } }),
    }));
    return {
      proximas: vista.filter((r) => r.estado === 'RESERVADO' && r.turno.fecha >= hoy && !r.asistencia).reverse(),
      historial: vista.filter((r) => !(r.estado === 'RESERVADO' && r.turno.fecha >= hoy && !r.asistencia)),
    };
  },
};
