import { prisma, type Tx } from '../config/prisma';
import { aFechaDb } from '../utils/fechas';

type Cliente = Tx | typeof prisma;

/**
 * SocioRepository: datos del socio que usa la recepción (CU-004). Los nombres de
 * las operaciones son los de los diagramas de secuencia (Figuras 99, 101, 105 a 107).
 */
export const socioRepository = {
  /** CU-004-002: código QR emitido, con su socio, usuario y sede. */
  buscarQrEmitido(codigo: string) {
    return prisma.codigoQr.findUnique({
      where: { codigo },
      include: { socio: { include: { usuario: true, sede: true } } },
    });
  },

  /** CU-004-004: cuotas vencidas sin pagar del socio (RD8). */
  consultarCuota(socioId: number, cliente: Cliente = prisma) {
    return cliente.cuota.findMany({ where: { socioId, estado: 'IMPAGA' }, orderBy: { periodo: 'asc' } });
  },

  buscarDiaConstancia(socioId: number, fecha: string, cliente: Cliente = prisma) {
    return cliente.diaConstancia.findUnique({ where: { socioId_fecha: { socioId, fecha: aFechaDb(fecha) } } });
  },

  /** CU-004-009: registra el día de constancia de la primera asistencia confirmada del día (RD9). */
  registrarDiaConstancia(datos: { socioId: number; asistenciaId: number; fecha: string; puntos: number }, tx: Tx) {
    return tx.diaConstancia.create({ data: { socioId: datos.socioId, asistenciaId: datos.asistenciaId, fecha: aFechaDb(datos.fecha), puntos: datos.puntos } });
  },

  /** CU-004-009: suma los puntos del día al saldo del socio. */
  /** Guarda el saldo de puntos que calculó Socio.sumarPuntos() (Figura 105). */
  sumarPuntos(socioId: number, saldoPuntos: number, tx: Tx) {
    return tx.socio.update({ where: { id: socioId }, data: { saldoPuntos } });
  },
};
