import { prisma } from '../config/prisma';
import { procesoEtl } from '../jobs/ProcesoETLAsistencia';
import { aFechaDb } from '../utils/fechas';

/**
 * AnaliticaRepository: acceso a datos de NeuroGym Intelligence (CU-002-006 a 009).
 * Los nombres de las operaciones son los de los diagramas de secuencia (Figuras 83 a 86).
 */
export const analiticaRepository = {
  /** CU-002-006: historial de asistencias por sede, socios activos por sede y sedes del gimnasio. */
  async buscarHistorial(gimnasioId: number, desde: string, hasta: string) {
    const [indicadores, sociosSede, sedes] = await Promise.all([
      prisma.indicadorAsistencia.findMany({
        where: { sede: { gimnasioId }, fecha: { gte: aFechaDb(desde), lte: aFechaDb(hasta) } },
        include: { sede: { select: { nombre: true } } },
      }),
      prisma.socio.groupBy({ by: ['sedeId'], where: { sede: { gimnasioId }, usuario: { activo: true } }, _count: true }),
      prisma.sede.findMany({ where: { gimnasioId } }),
    ]);
    return { indicadores, sociosSede, sedes };
  },

  /** CU-002-007: estimaciones de riesgo de los socios activos (con su última decisión). */
  buscarEstimaciones(gimnasioId: number, sedeId?: number) {
    return prisma.estimacionRiesgo.findMany({
      where: { socio: { sede: { gimnasioId }, usuario: { activo: true }, ...(sedeId ? { sedeId } : {}) } },
      include: {
        socio: { include: { usuario: { select: { nombre: true, apellido: true } }, sede: { select: { nombre: true } } } },
        decisiones: { orderBy: { fecha: 'desc' }, take: 1 },
      },
      orderBy: { fecha: 'desc' },
    });
  },

  /** CU-002-007: última estimación de un socio con sus decisiones. */
  buscarEstimacionDelSocio(socioId: number) {
    return prisma.estimacionRiesgo.findFirst({ where: { socioId }, orderBy: { fecha: 'desc' }, include: { decisiones: true } });
  },

  buscarEstimacion(estimacionId: number, gimnasioId: number) {
    return prisma.estimacionRiesgo.findFirst({ where: { id: estimacionId, socio: { sede: { gimnasioId } } } });
  },

  /** CU-002-008: decisión del administrador sobre la recomendación. */
  guardarDecision(datos: { estimacionId: number; decision: 'MANTENER_EN_OBSERVACION' | 'PREPARAR_PROPUESTA'; motivo: string; responsableId: number }) {
    return prisma.decisionRetencion.create({ data: datos });
  },

  /** CU-002-009: datos del reporte avanzado en formato .xlsx. */
  buscarAnalitica(gimnasioId: number, filtros: { sedeId?: number; desde: string; hasta: string }) {
    return procesoEtl.exportarXlsx(gimnasioId, filtros);
  },
};
