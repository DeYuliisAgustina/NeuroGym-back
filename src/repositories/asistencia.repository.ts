import { prisma, type Tx } from '../config/prisma';
import { aFechaDb } from '../utils/fechas';

type Cliente = Tx | typeof prisma;

/** Acceso a datos de recepción: códigos QR, reservas del día, asistencias y rechazos. */
export const asistenciaRepository = {
  crearCodigo(socioId: number, codigo: string, expiraEn: Date) {
    return prisma.codigoQr.create({ data: { socioId, codigo, expiraEn } });
  },

  buscarCodigo(codigo: string) {
    return prisma.codigoQr.findUnique({
      where: { codigo },
      include: { socio: { include: { usuario: true, sede: true } } },
    });
  },

  /** Reservas activas del socio para una fecha, con su turno y asistencia (CU-004-003). */
  reservasDelDia(socioId: number, fecha: string, cliente: Cliente = prisma) {
    return cliente.reserva.findMany({
      where: { socioId, estado: 'RESERVADO', turno: { fecha: aFechaDb(fecha) } },
      include: { turno: { include: { sede: true } }, asistencia: true },
      orderBy: { turno: { horaInicio: 'asc' } },
    });
  },

  /** Cuotas impagas del socio (CU-004-004). */
  cuotasImpagas(socioId: number, cliente: Cliente = prisma) {
    return cliente.cuota.findMany({ where: { socioId, estado: 'IMPAGA' }, orderBy: { periodo: 'asc' } });
  },

  registrarRechazo(datos: { socioId: number; motivo: string; responsableId?: number }) {
    return prisma.rechazoIngreso.create({ data: datos });
  },

  asistenciaDeReserva(reservaId: number, cliente: Cliente = prisma) {
    return cliente.asistencia.findUnique({ where: { reservaId } });
  },

  diaConstancia(socioId: number, fecha: string, cliente: Cliente = prisma) {
    return cliente.diaConstancia.findUnique({ where: { socioId_fecha: { socioId, fecha: aFechaDb(fecha) } } });
  },
};
