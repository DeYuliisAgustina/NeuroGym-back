import { prisma } from '../config/prisma';

/**
 * EquipamientoRepository: estado del equipamiento de una sede y sus mantenimientos
 * programados. Nombre de la operación según los diagramas de secuencia de CU-003
 * (Figuras 90, 94, 95 y 97).
 */
export const equipamientoRepository = {
  /** CU-003-006: equipos de la sede (sin los dados de baja) con su próximo mantenimiento programado vigente. */
  buscarDisponibilidad(sedeId: number) {
    return prisma.equipo.findMany({
      where: { sedeId, estado: { not: 'DADO_DE_BAJA' } },
      include: { mantenimientos: { where: { estado: 'PROGRAMADO', finProgramado: { gte: new Date() } }, orderBy: { inicioProgramado: 'asc' }, take: 1 } },
      orderBy: { nombre: 'asc' },
    });
  },

  /** Mantenimientos programados vigentes de la sede (fecha prevista de vuelta del equipo). */
  buscarMantenimientosProgramados(sedeId: number) {
    return prisma.mantenimiento.findMany({
      where: { estado: 'PROGRAMADO', finProgramado: { gte: new Date() }, equipo: { sedeId } },
      select: { equipoId: true, finProgramado: true },
    });
  },
};
