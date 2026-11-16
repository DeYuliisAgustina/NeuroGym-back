import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma, type Tx } from '../config/prisma';
import { asistenciaRepository } from '../repositories/asistencia.repository';
import { firmaValida, generarCodigoQr } from '../utils/codigoQr';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal, fechaIso, horaTexto, minutosDeHora } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { tenant } from './tenant.service';

/** Personal autorizado que opera la recepción. */
export interface PersonalRecepcion {
  personalId: number;
  usuarioId: number;
  gimnasioId: number;
  puedeGestionar: boolean;
}

type ReservaDelDia = Awaited<ReturnType<typeof asistenciaRepository.reservasDelDia>>[number];

/** Motivo de rechazo de CU-004-003 (o null si existe una reserva válida). */
export type ResultadoReserva =
  | { valida: true; reserva: ReservaDelDia }
  | { valida: false; codigo: 'SIN_RESERVA' | 'SEDE_INCORRECTA' | 'FUERA_DE_HORARIO' | 'INGRESO_DUPLICADO'; mensaje: string };

/**
 * CU-004-003 Verificar reserva vigente (función pura, sin acceso a datos).
 * Busca una reserva RESERVADA de la fecha, en la sede de recepción, dentro de la
 * ventana del turno según la tolerancia del gimnasio y sin asistencia (RD7).
 */
export function verificarReservaVigente(
  reservas: ReservaDelDia[],
  sedeId: number,
  minutosIngreso: number,
  tolerancia: { antesMin: number; despuesMin: number },
): ResultadoReserva {
  if (reservas.length === 0) return { valida: false, codigo: 'SIN_RESERVA', mensaje: 'Sin reserva válida' };
  const enSede = reservas.filter((r) => r.turno.sedeId === sedeId);
  if (enSede.length === 0) return { valida: false, codigo: 'SEDE_INCORRECTA', mensaje: 'Sede incorrecta' };
  const enHorario = enSede.filter((r) => {
    const inicio = minutosDeHora(r.turno.horaInicio);
    return minutosIngreso >= inicio - tolerancia.antesMin && minutosIngreso <= inicio + tolerancia.despuesMin;
  });
  if (enHorario.length === 0) return { valida: false, codigo: 'FUERA_DE_HORARIO', mensaje: 'Fuera del horario permitido' };
  const sinAsistencia = enHorario.find((r) => !r.asistencia);
  if (!sinAsistencia) return { valida: false, codigo: 'INGRESO_DUPLICADO', mensaje: 'Ingreso duplicado' };
  return { valida: true, reserva: sinAsistencia };
}

/** CU-004-004: la cuota está impaga si hay cuotas vencidas sin pagar (RD8). */
async function verificarEstadoCuota(socioId: number, cliente: Tx | typeof prisma = prisma) {
  const impagas = await asistenciaRepository.cuotasImpagas(socioId, cliente);
  return { alDia: impagas.length === 0, periodosAdeudados: impagas.map((c) => c.periodo) };
}

function describirIngreso(reserva: ReservaDelDia, socio: { nombre: string; apellido: string }, fechaHora: Date) {
  return {
    socio: `${socio.nombre} ${socio.apellido}`,
    actividad: reserva.turno.actividad,
    sede: reserva.turno.sede.nombre,
    turno: `${horaTexto(reserva.turno.horaInicio)} a ${horaTexto(reserva.turno.horaFin)}`,
    hora: fechaHora.toISOString(),
  };
}

/**
 * CU-004-008 y CU-004-009: registra la asistencia una sola vez por reserva y,
 * si es la primera asistencia confirmada del día, acumula el día de constancia.
 */
async function confirmarAsistencia(
  tx: Tx,
  datos: {
    reservaId: number;
    socioId: number;
    fechaHoraReal: Date;
    forma: 'QR' | 'MANUAL';
    codigoQrId?: number;
    motivo?: string;
    responsableId?: number;
    provisoria?: boolean;
    autorizacion?: { motivo: string; responsableId: number };
  },
) {
  // RD7: la unicidad de reserva_id en asistencia impide registros duplicados.
  if (await asistenciaRepository.asistenciaDeReserva(datos.reservaId, tx)) {
    throw reglaNegocio('INGRESO_DUPLICADO', 'La reserva ya tiene una asistencia registrada');
  }
  const asistencia = await tx.asistencia.create({
    data: {
      reservaId: datos.reservaId,
      codigoQrId: datos.codigoQrId,
      fechaHoraReal: datos.fechaHoraReal,
      forma: datos.forma,
      provisoria: datos.provisoria ?? false,
      motivo: datos.motivo,
      responsableId: datos.responsableId,
    },
  });
  if (datos.autorizacion) {
    await tx.autorizacionExcepcional.create({ data: { asistenciaId: asistencia.id, ...datos.autorizacion } });
  }
  // RD9: como máximo un día de constancia por fecha y solo con asistencia confirmada.
  const fecha = ahoraLocal(datos.fechaHoraReal).fecha;
  let diaConstancia = false;
  if (!(await asistenciaRepository.diaConstancia(datos.socioId, fecha, tx))) {
    await tx.diaConstancia.create({ data: { socioId: datos.socioId, asistenciaId: asistencia.id, fecha: aFechaDb(fecha), puntos: env.puntosPorDia } });
    await tx.socio.update({ where: { id: datos.socioId }, data: { saldoPuntos: { increment: env.puntosPorDia } } });
    diaConstancia = true;
  }
  return { asistencia, diaConstancia };
}

/** Registro de asistencia mediante QR (CU-004) y registro manual excepcional (CU-004-010). */
export const asistenciaService = {
  /** RF4 / RNF7: emite un código nuevo, firmado y de corta vigencia. */
  async emitirQr(socioId: number) {
    const emitidoEn = new Date();
    const expiraEn = new Date(emitidoEn.getTime() + env.qrVigenciaSeg * 1000);
    const codigo = await asistenciaRepository.crearCodigo(socioId, generarCodigoQr(), expiraEn);
    return { codigo: codigo.codigo, emitidoEn: codigo.emitidoEn, expiraEn: codigo.expiraEn, vigenciaSeg: env.qrVigenciaSeg };
  },

  /** CU-004-002: validación en el servidor del código leído en recepción. */
  async validarQr(codigo: string, gimnasioId: number) {
    if (!firmaValida(codigo)) return { valido: false as const, socioId: null };
    const registro = await asistenciaRepository.buscarCodigo(codigo);
    if (!registro || registro.socio.sede.gimnasioId !== gimnasioId) return { valido: false as const, socioId: null };
    if (registro.expiraEn <= new Date() || !registro.socio.usuario.activo) {
      return { valido: false as const, socioId: registro.socioId };
    }
    return { valido: true as const, registro };
  },

  /** CU-004 curso básico: QR → reserva → cuota → asistencia confirmada. */
  async procesarIngresoQr(personal: PersonalRecepcion, datos: { codigo: string; sedeId: number }) {
    const sede = await tenant.sede(datos.sedeId, personal.gimnasioId);
    const validacion = await this.validarQr(datos.codigo, personal.gimnasioId);
    if (!validacion.valido) {
      // 3.1: QR vencido o inválido. Solo se registra el rechazo si el código identifica a un socio.
      if (validacion.socioId) await asistenciaRepository.registrarRechazo({ socioId: validacion.socioId, motivo: 'QR vencido o inválido' });
      return { resultado: 'QR_INVALIDO' as const, mensaje: 'QR vencido o inválido' };
    }
    const { registro } = validacion;
    const gimnasio = await prisma.gimnasio.findUniqueOrThrow({ where: { id: personal.gimnasioId } });
    const ahora = new Date();
    const local = ahoraLocal(ahora);

    const reservas = await asistenciaRepository.reservasDelDia(registro.socioId, local.fecha);
    const verificacion = verificarReservaVigente(reservas, sede.id, local.minutos, {
      antesMin: gimnasio.toleranciaAntesMin,
      despuesMin: gimnasio.toleranciaDespuesMin,
    });
    if (!verificacion.valida) {
      await asistenciaRepository.registrarRechazo({ socioId: registro.socioId, motivo: verificacion.mensaje });
      return { resultado: verificacion.codigo, mensaje: verificacion.mensaje, socio: `${registro.socio.usuario.nombre} ${registro.socio.usuario.apellido}` };
    }

    const cuota = await verificarEstadoCuota(registro.socioId);
    if (!cuota.alDia) {
      // CU-004-005: el sistema advierte; la decisión de autorizar o bloquear es del gimnasio (RD8).
      return {
        resultado: 'CUOTA_PENDIENTE' as const,
        mensaje: 'Cuota pendiente',
        periodosAdeudados: cuota.periodosAdeudados,
        politicaSugerida: gimnasio.politicaCuotaPendiente,
        puedeAutorizar: personal.puedeGestionar,
        reservaId: verificacion.reserva.id,
        codigoQrId: registro.id,
        ...describirIngreso(verificacion.reserva, registro.socio.usuario, ahora),
      };
    }

    const { diaConstancia } = await prisma.$transaction((tx) =>
      confirmarAsistencia(tx, {
        reservaId: verificacion.reserva.id,
        socioId: registro.socioId,
        fechaHoraReal: ahora,
        forma: 'QR',
        codigoQrId: registro.id,
      }),
    );
    return { resultado: 'INGRESO_AUTORIZADO' as const, diaConstancia, ...describirIngreso(verificacion.reserva, registro.socio.usuario, ahora) };
  },

  /** CU-004-006: autorización excepcional con motivo; la cuota sigue pendiente. */
  async autorizarExcepcional(personal: PersonalRecepcion, datos: { reservaId: number; codigoQrId?: number; motivo: string }) {
    if (!personal.puedeGestionar) throw reglaNegocio('SIN_PERMISO_GESTION', 'Solo los roles con permiso de gestión pueden autorizar');
    const reserva = await prisma.reserva.findFirst({
      where: { id: datos.reservaId, estado: 'RESERVADO', socio: { sede: { gimnasioId: personal.gimnasioId } } },
      include: { turno: { include: { sede: true } }, socio: { include: { usuario: true } }, asistencia: true },
    });
    if (!reserva) throw noEncontrado('Reserva');
    if (datos.codigoQrId) {
      const codigo = await prisma.codigoQr.findFirst({ where: { id: datos.codigoQrId, socioId: reserva.socioId } });
      if (!codigo) throw reglaNegocio('QR_AJENO', 'El código no corresponde al socio de la reserva');
    }
    const ahora = new Date();
    const resultado = await prisma.$transaction((tx) =>
      confirmarAsistencia(tx, {
        reservaId: reserva.id,
        socioId: reserva.socioId,
        fechaHoraReal: ahora,
        forma: datos.codigoQrId ? 'QR' : 'MANUAL',
        codigoQrId: datos.codigoQrId,
        motivo: datos.codigoQrId ? undefined : datos.motivo,
        responsableId: datos.codigoQrId ? undefined : personal.personalId,
        autorizacion: { motivo: datos.motivo, responsableId: personal.personalId },
      }),
    );
    await registrarAuditoria({
      gimnasioId: personal.gimnasioId,
      usuarioId: personal.usuarioId,
      accion: 'AUTORIZACION_EXCEPCIONAL',
      entidad: 'asistencia',
      entidadId: resultado.asistencia.id,
    });
    return {
      resultado: 'INGRESO_AUTORIZADO' as const,
      advertencia: 'Ingreso autorizado con cuota pendiente',
      diaConstancia: resultado.diaConstancia,
      ...describirIngreso(reserva as ReservaDelDia, reserva.socio.usuario, ahora),
    };
  },

  /** CU-004-007: bloqueo del ingreso; registra el rechazo y no hay asistencia. */
  async bloquearIngreso(personal: PersonalRecepcion, datos: { reservaId: number; motivo?: string }) {
    const reserva = await prisma.reserva.findFirst({
      where: { id: datos.reservaId, socio: { sede: { gimnasioId: personal.gimnasioId } } },
    });
    if (!reserva) throw noEncontrado('Reserva');
    await asistenciaRepository.registrarRechazo({
      socioId: reserva.socioId,
      motivo: datos.motivo?.trim() || 'Cuota pendiente',
      responsableId: personal.personalId,
    });
    return {
      resultado: 'BLOQUEADO' as const,
      mensaje: 'Cuota pendiente: administración debe registrar el pago o autorizar una excepción con motivo',
    };
  },

  /**
   * CU-004-010: registro manual excepcional o carga posterior de asistencias
   * provisorias por falta de conexión (RD14). Mantiene todas las validaciones.
   */
  async registrarManual(
    personal: PersonalRecepcion,
    datos: { socioId: number; sedeId: number; motivo: string; fechaHoraReal?: string; autorizacionCuota?: string },
  ) {
    if (!personal.puedeGestionar) throw reglaNegocio('SIN_PERMISO_GESTION', 'El registro manual requiere permiso de gestión');
    const socio = await tenant.socio(datos.socioId, personal.gimnasioId);
    await tenant.sede(datos.sedeId, personal.gimnasioId);
    const ahora = new Date();
    const fechaHora = datos.fechaHoraReal ? new Date(datos.fechaHoraReal) : ahora;
    if (fechaHora.getTime() > ahora.getTime() + 60_000) throw reglaNegocio('FECHA_FUTURA', 'La fecha y hora del ingreso no puede ser futura');
    const provisoria = ahora.getTime() - fechaHora.getTime() > 5 * 60_000;
    const local = ahoraLocal(fechaHora);
    const gimnasio = await prisma.gimnasio.findUniqueOrThrow({ where: { id: personal.gimnasioId } });

    const verificacion = verificarReservaVigente(await asistenciaRepository.reservasDelDia(socio.id, local.fecha), datos.sedeId, local.minutos, {
      antesMin: gimnasio.toleranciaAntesMin,
      despuesMin: gimnasio.toleranciaDespuesMin,
    });
    if (!verificacion.valida) return { resultado: verificacion.codigo, mensaje: verificacion.mensaje };

    const cuota = await verificarEstadoCuota(socio.id);
    if (!cuota.alDia && !datos.autorizacionCuota?.trim()) {
      return {
        resultado: 'CUOTA_PENDIENTE' as const,
        mensaje: 'Cuota pendiente',
        periodosAdeudados: cuota.periodosAdeudados,
        politicaSugerida: gimnasio.politicaCuotaPendiente,
        puedeAutorizar: true,
        reservaId: verificacion.reserva.id,
      };
    }
    try {
      const resultado = await prisma.$transaction((tx) =>
        confirmarAsistencia(tx, {
          reservaId: verificacion.reserva.id,
          socioId: socio.id,
          fechaHoraReal: fechaHora,
          forma: 'MANUAL',
          motivo: datos.motivo,
          responsableId: personal.personalId,
          provisoria,
          autorizacion: cuota.alDia ? undefined : { motivo: datos.autorizacionCuota!, responsableId: personal.personalId },
        }),
      );
      await registrarAuditoria({
        gimnasioId: personal.gimnasioId,
        usuarioId: personal.usuarioId,
        accion: provisoria ? 'CARGA_ASISTENCIA_PROVISORIA' : 'ASISTENCIA_MANUAL',
        entidad: 'asistencia',
        entidadId: resultado.asistencia.id,
      });
      return { resultado: 'INGRESO_AUTORIZADO' as const, provisoria, diaConstancia: resultado.diaConstancia, ...describirIngreso(verificacion.reserva, socio.usuario, fechaHora) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { resultado: 'INGRESO_DUPLICADO' as const, mensaje: 'Ingreso duplicado' };
      }
      throw error;
    }
  },

  /** Historial de asistencias de la sede (operación y auditoría). */
  listar(gimnasioId: number, filtros: { sedeId?: number; fecha?: string }) {
    const fecha = filtros.fecha ?? ahoraLocal().fecha;
    return prisma.asistencia.findMany({
      where: {
        reserva: {
          turno: { fecha: aFechaDb(fecha), sede: { gimnasioId }, ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}) },
        },
      },
      include: {
        reserva: { include: { turno: { include: { sede: { select: { nombre: true } } } }, socio: { include: { usuario: { select: { nombre: true, apellido: true } } } } } },
        responsable: { include: { usuario: { select: { nombre: true, apellido: true } } } },
        autorizacion: true,
      },
      orderBy: { fechaHoraReal: 'desc' },
    });
  },

  listarRechazos(gimnasioId: number, fecha = ahoraLocal().fecha) {
    const desde = aFechaDb(fecha);
    return prisma.rechazoIngreso.findMany({
      where: { socio: { sede: { gimnasioId } }, fechaHora: { gte: new Date(desde.getTime() - 3 * 3600_000), lt: new Date(desde.getTime() + 27 * 3600_000) } },
      include: { socio: { include: { usuario: { select: { nombre: true, apellido: true } } } } },
      orderBy: { fechaHora: 'desc' },
    });
  },

  /** Historial de asistencias del socio (para "Mis turnos" y constancia). */
  misAsistencias(socioId: number) {
    return prisma.asistencia.findMany({
      where: { reserva: { socioId } },
      include: { reserva: { include: { turno: { include: { sede: { select: { nombre: true } } } } } }, diaConstancia: true },
      orderBy: { fechaHoraReal: 'desc' },
      take: 60,
    }).then((lista) =>
      lista.map((a) => ({
        id: a.id,
        fechaHoraReal: a.fechaHoraReal,
        forma: a.forma,
        actividad: a.reserva.turno.actividad,
        sede: a.reserva.turno.sede.nombre,
        fecha: fechaIso(a.reserva.turno.fecha),
        puntos: a.diaConstancia?.puntos ?? 0,
      })),
    );
  },
};
