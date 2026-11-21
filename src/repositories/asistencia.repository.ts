import type { FormaRegistro } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { aFechaDb } from '../utils/fechas';

type Cliente = Tx | typeof prisma;

/**
 * AsistenciaRepository: códigos QR, reservas del día, asistencias, autorizaciones y
 * rechazos. Los nombres de las operaciones son los de los diagramas de secuencia de
 * CU-004 (Figuras 99 a 107).
 */
export const asistenciaRepository = {
  crearCodigo(socioId: number, codigo: string, expiraEn: Date) {
    return prisma.codigoQr.create({ data: { socioId, codigo, expiraEn } });
  },

  /** CU-004-003: reservas activas del socio para una fecha, con su turno y asistencia. */
  buscarReservas(socioId: number, fecha: string, cliente: Cliente = prisma) {
    return cliente.reserva.findMany({
      where: { socioId, estado: 'RESERVADO', turno: { fecha: aFechaDb(fecha) } },
      include: { turno: { include: { sede: true } }, asistencia: true },
      orderBy: { turno: { horaInicio: 'asc' } },
    });
  },

  /** CU-004-010: reservas del socio para la fecha del registro manual (mismo criterio que buscarReservas). */
  buscarReserva(socioId: number, fecha: string, cliente: Cliente = prisma) {
    return this.buscarReservas(socioId, fecha, cliente);
  },

  /** Reserva del gimnasio con su turno, socio y asistencia (para confirmar, autorizar o bloquear). */
  buscarReservaDelGimnasio(reservaId: number, gimnasioId: number) {
    return prisma.reserva.findFirst({
      where: { id: reservaId, socio: { sede: { gimnasioId } } },
      include: { turno: { include: { sede: true } }, socio: { include: { usuario: true } }, asistencia: true },
    });
  },

  /** CU-004-002, 003 y 007: registra el rechazo del ingreso (con su responsable si lo decidió el personal). */
  registrarRechazo(datos: { socioId: number; motivo: string; responsableId?: number }) {
    return prisma.rechazoIngreso.create({ data: datos });
  },

  asistenciaDeReserva(reservaId: number, cliente: Cliente = prisma) {
    return cliente.asistencia.findUnique({ where: { reservaId } });
  },

  /** CU-004-008 y CU-004-010: registra la asistencia con su fecha y hora real y la forma de registro. */
  registrarAsistencia(
    datos: {
      reservaId: number;
      fechaHoraReal: Date;
      forma: FormaRegistro;
      codigoQrId?: number;
      provisoria?: boolean;
      motivo?: string;
      responsableId?: number;
    },
    tx: Tx,
  ) {
    return tx.asistencia.create({ data: { ...datos, provisoria: datos.provisoria ?? false } });
  },

  /** CU-004-006: registra la autorización excepcional (responsable y motivo) del ingreso. */
  registrarAutorizacion(datos: { asistenciaId: number; motivo: string; responsableId: number }, tx: Tx) {
    return tx.autorizacionExcepcional.create({ data: datos });
  },
};
