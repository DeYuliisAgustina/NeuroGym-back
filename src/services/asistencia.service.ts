import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma, type Tx } from '../config/prisma';
import { asistenciaRepository } from '../repositories/asistencia.repository';
import { socioRepository } from '../repositories/socio.repository';
import { firmaValida, generarCodigoQr } from '../utils/codigoQr';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal, fechaIso, horaTexto, minutosDeHora } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { tenant } from './tenant.service';
import { Asistencia, CodigoQR } from '../domain';
import { aSocio } from './precios.service';

/** Personal autorizado que opera la recepción. */
export interface PersonalRecepcion {
  personalId: number;
  usuarioId: number;
  gimnasioId: number;
  puedeGestionar: boolean;
}

type ReservaDelDia = Awaited<ReturnType<typeof asistenciaRepository.buscarReservas>>[number];

/** Motivo de rechazo de CU-004-003 (o null si existe una reserva válida). */
export type ResultadoReserva =
  | { valida: true; reserva: ReservaDelDia }
  | { valida: false; codigo: 'SIN_RESERVA' | 'SEDE_INCORRECTA' | 'FUERA_DE_HORARIO' | 'INGRESO_DUPLICADO'; mensaje: string };

/** Un código leído minutos antes sigue sirviendo para confirmar el ingreso que se validó con él. */
const MARGEN_CONFIRMACION_MS = 5 * 60_000;

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

const qrInvalido = () => reglaNegocio('QR_INVALIDO', 'QR vencido o inválido');

function describirIngreso(reserva: ReservaDelDia, socio: { nombre: string; apellido: string }, fechaHora: Date) {
  return {
    socio: `${socio.nombre} ${socio.apellido}`,
    actividad: reserva.turno.actividad,
    sede: reserva.turno.sede.nombre,
    turno: `${horaTexto(reserva.turno.horaInicio)} a ${horaTexto(reserva.turno.horaFin)}`,
    hora: fechaHora.toISOString(),
  };
}

async function tolerancias(gimnasioId: number) {
  const gimnasio = await prisma.gimnasio.findUniqueOrThrow({ where: { id: gimnasioId } });
  return { gimnasio, tolerancia: { antesMin: gimnasio.toleranciaAntesMin, despuesMin: gimnasio.toleranciaDespuesMin } };
}

/**
 * CU-004-008 y CU-004-009: registra la asistencia una sola vez por reserva y, si
 * es la primera asistencia confirmada del día, acumula el día de constancia y sus puntos.
 */
async function registrarIngreso(
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
  const ingreso = new Asistencia(datos);
  ingreso.confirmar();
  const asistencia = await asistenciaRepository.registrarAsistencia(
    {
      reservaId: datos.reservaId,
      codigoQrId: datos.codigoQrId,
      fechaHoraReal: ingreso.fechaHoraReal,
      forma: ingreso.forma,
      provisoria: ingreso.provisoria,
      motivo: datos.motivo,
      responsableId: datos.responsableId,
    },
    tx,
  );
  if (datos.autorizacion) await asistenciaRepository.registrarAutorizacion({ asistenciaId: asistencia.id, ...datos.autorizacion }, tx);
  // RD9: como máximo un día de constancia por fecha y solo con asistencia confirmada.
  const fecha = ahoraLocal(datos.fechaHoraReal).fecha;
  let diaConstancia = false;
  if (!(await socioRepository.buscarDiaConstancia(datos.socioId, fecha, tx))) {
    await socioRepository.registrarDiaConstancia({ socioId: datos.socioId, asistenciaId: asistencia.id, fecha, puntos: env.puntosPorDia }, tx);
    const socio = aSocio(await tx.socio.findUniqueOrThrow({ where: { id: datos.socioId }, include: { plan: true, usuario: true } }));
    socio.sumarPuntos(env.puntosPorDia);
    await socioRepository.sumarPuntos(datos.socioId, socio.saldoPuntos, tx);
    diaConstancia = true;
  }
  return { asistencia, diaConstancia };
}

/**
 * AsistenciaService: registro de asistencia mediante QR (CU-004) y registro manual
 * excepcional (CU-004-010). Las operaciones son las de los diagramas de secuencia
 * (Figuras 99 a 107): validarCodigo → verificarReserva → verificarCuota → confirmarAsistencia.
 */
export const asistenciaService = {
  /** RF4 / RNF7: emite un código nuevo, firmado y de corta vigencia. */
  async emitirQr(socioId: number) {
    const emitidoEn = new Date();
    const expiraEn = new Date(emitidoEn.getTime() + env.qrVigenciaSeg * 1000);
    const codigo = await asistenciaRepository.crearCodigo(socioId, generarCodigoQr(), expiraEn);
    return { codigo: codigo.codigo, emitidoEn: codigo.emitidoEn, expiraEn: codigo.expiraEn, vigenciaSeg: env.qrVigenciaSeg };
  },

  /**
   * CU-004-002: valida en el servidor el código leído en recepción (firma, emisión,
   * vigencia, socio activo y gimnasio). Si no es válido responde «QR vencido o
   * inválido» y, si el código identifica a un socio, registra el rechazo.
   */
  async validarCodigo(personal: PersonalRecepcion, codigo: string) {
    if (!firmaValida(codigo)) throw qrInvalido();
    const registro = await socioRepository.buscarQrEmitido(codigo);
    if (!registro || registro.socio.sede.gimnasioId !== personal.gimnasioId) throw qrInvalido();
    if (!new CodigoQR(registro).estaVigente() || !registro.socio.usuario.activo) {
      await asistenciaRepository.registrarRechazo({ socioId: registro.socioId, motivo: 'QR vencido o inválido' });
      throw qrInvalido();
    }
    return { socioId: registro.socioId, codigoQrId: registro.id, socio: `${registro.socio.usuario.nombre} ${registro.socio.usuario.apellido}` };
  },

  /**
   * CU-004-003: reserva vigente del socio en la sede de recepción. Sin reserva, en
   * otra sede, fuera de horario o duplicada: registra el rechazo y responde el motivo.
   */
  async verificarReserva(personal: PersonalRecepcion, socioId: number, sedeId: number) {
    const socio = await tenant.socio(socioId, personal.gimnasioId);
    const sede = await tenant.sede(sedeId, personal.gimnasioId);
    const { tolerancia } = await tolerancias(personal.gimnasioId);
    const ahora = new Date();
    const local = ahoraLocal(ahora);
    const verificacion = verificarReservaVigente(await asistenciaRepository.buscarReservas(socioId, local.fecha), sede.id, local.minutos, tolerancia);
    const nombre = `${socio.usuario.nombre} ${socio.usuario.apellido}`;
    if (!verificacion.valida) {
      await asistenciaRepository.registrarRechazo({ socioId, motivo: verificacion.mensaje });
      throw reglaNegocio(verificacion.codigo, verificacion.mensaje, { socio: nombre });
    }
    return { reservaId: verificacion.reserva.id, ...describirIngreso(verificacion.reserva, socio.usuario, ahora) };
  },

  /** CU-004-004: estado de la cuota (impaga si tiene cuotas vencidas sin pagar, RD8) y la política del gimnasio. */
  async verificarCuota(personal: PersonalRecepcion, socioId: number) {
    await tenant.socio(socioId, personal.gimnasioId);
    const [impagas, { gimnasio }] = await Promise.all([socioRepository.consultarCuota(socioId), tolerancias(personal.gimnasioId)]);
    return {
      alDia: impagas.length === 0,
      periodosAdeudados: impagas.map((c) => c.periodo),
      politicaSugerida: gimnasio.politicaCuotaPendiente,
      puedeAutorizar: personal.puedeGestionar,
    };
  },

  /**
   * CU-004-008 y CU-004-009: confirma el ingreso por QR. Vuelve a comprobar en el
   * servidor que el código sea del socio y reciente, que la reserva siga vigente y
   * que la cuota esté al día (con cuota pendiente, el ingreso se autoriza con motivo).
   */
  async confirmarAsistencia(personal: PersonalRecepcion, datos: { reservaId: number; codigoQrId: number }) {
    const reserva = await asistenciaRepository.buscarReservaDelGimnasio(datos.reservaId, personal.gimnasioId);
    if (!reserva || reserva.estado !== 'RESERVADO') throw noEncontrado('Reserva');
    const codigo = await prisma.codigoQr.findFirst({ where: { id: datos.codigoQrId, socioId: reserva.socioId } });
    if (!codigo || !new CodigoQR(codigo).estaVigente(new Date(), MARGEN_CONFIRMACION_MS)) throw qrInvalido();
    const ahora = new Date();
    const local = ahoraLocal(ahora);
    const { tolerancia } = await tolerancias(personal.gimnasioId);
    const verificacion = verificarReservaVigente(await asistenciaRepository.buscarReservas(reserva.socioId, local.fecha), reserva.turno.sedeId, local.minutos, tolerancia);
    if (!verificacion.valida || verificacion.reserva.id !== reserva.id) {
      throw reglaNegocio(verificacion.valida ? 'SIN_RESERVA' : verificacion.codigo, verificacion.valida ? 'Sin reserva válida' : verificacion.mensaje);
    }
    if ((await socioRepository.consultarCuota(reserva.socioId)).length > 0) {
      throw reglaNegocio('CUOTA_PENDIENTE', 'Cuota pendiente: registrá el pago o autorizá el ingreso con motivo');
    }
    const { diaConstancia } = await prisma.$transaction((tx) =>
      registrarIngreso(tx, { reservaId: reserva.id, socioId: reserva.socioId, fechaHoraReal: ahora, forma: 'QR', codigoQrId: codigo.id }),
    );
    return { resultado: 'INGRESO_AUTORIZADO' as const, diaConstancia, ...describirIngreso(reserva, reserva.socio.usuario, ahora) };
  },

  /** CU-004-006: autorización excepcional con motivo; la cuota sigue pendiente. */
  async autorizarIngreso(personal: PersonalRecepcion, datos: { reservaId: number; codigoQrId?: number; motivo: string }) {
    if (!personal.puedeGestionar) throw reglaNegocio('SIN_PERMISO_GESTION', 'Solo los roles con permiso de gestión pueden autorizar');
    const reserva = await asistenciaRepository.buscarReservaDelGimnasio(datos.reservaId, personal.gimnasioId);
    if (!reserva || reserva.estado !== 'RESERVADO') throw noEncontrado('Reserva');
    if (datos.codigoQrId) {
      const codigo = await prisma.codigoQr.findFirst({ where: { id: datos.codigoQrId, socioId: reserva.socioId } });
      if (!codigo) throw reglaNegocio('QR_AJENO', 'El código no corresponde al socio de la reserva');
    }
    const ahora = new Date();
    const resultado = await prisma.$transaction((tx) =>
      registrarIngreso(tx, {
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
      ...describirIngreso(reserva, reserva.socio.usuario, ahora),
    };
  },

  /** CU-004-007: bloqueo del ingreso; registra el rechazo y no hay asistencia. */
  async bloquearIngreso(personal: PersonalRecepcion, datos: { reservaId: number; motivo?: string }) {
    const reserva = await asistenciaRepository.buscarReservaDelGimnasio(datos.reservaId, personal.gimnasioId);
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
    const { gimnasio, tolerancia } = await tolerancias(personal.gimnasioId);

    const verificacion = verificarReservaVigente(await asistenciaRepository.buscarReserva(socio.id, local.fecha), datos.sedeId, local.minutos, tolerancia);
    if (!verificacion.valida) return { resultado: verificacion.codigo, mensaje: verificacion.mensaje };

    const impagas = await socioRepository.consultarCuota(socio.id);
    if (impagas.length > 0 && !datos.autorizacionCuota?.trim()) {
      return {
        resultado: 'CUOTA_PENDIENTE' as const,
        mensaje: 'Cuota pendiente',
        periodosAdeudados: impagas.map((c) => c.periodo),
        politicaSugerida: gimnasio.politicaCuotaPendiente,
        puedeAutorizar: true,
        reservaId: verificacion.reserva.id,
      };
    }
    try {
      const resultado = await prisma.$transaction((tx) =>
        registrarIngreso(tx, {
          reservaId: verificacion.reserva.id,
          socioId: socio.id,
          fechaHoraReal: fechaHora,
          forma: 'MANUAL',
          motivo: datos.motivo,
          responsableId: personal.personalId,
          provisoria,
          autorizacion: impagas.length === 0 ? undefined : { motivo: datos.autorizacionCuota!, responsableId: personal.personalId },
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
