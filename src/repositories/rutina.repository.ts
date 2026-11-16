import { prisma, type Tx } from '../config/prisma';
import type { RutinaGenerada } from '../integrations/ia';

type Cliente = Tx | typeof prisma;

/** Acceso a datos de entrenamiento: catálogo, rutinas y entrenamientos. */
export const rutinaRepository = {
  /** Catálogo con los equipos que usa cada ejercicio y su estado en la sede indicada. */
  catalogoConEquipos(sedeId: number) {
    return prisma.ejercicio.findMany({
      include: { equipos: { include: { equipo: { select: { id: true, nombre: true, estado: true, sedeId: true } } } } },
      orderBy: [{ grupoMuscular: 'asc' }, { nombre: 'asc' }],
    }).then((lista) =>
      lista.map((e) => ({ ...e, equipos: e.equipos.map((ee) => ee.equipo).filter((eq) => eq.sedeId === sedeId && eq.estado !== 'DADO_DE_BAJA') })),
    );
  },

  rutinaVigente(socioId: number, cliente: Cliente = prisma) {
    return cliente.rutina.findFirst({
      where: { socioId, vigente: true },
      include: { ejercicios: { include: { ejercicio: true }, orderBy: [{ dia: 'asc' }, { orden: 'asc' }] } },
    });
  },

  /** Reemplaza la rutina vigente por la nueva en una sola transacción (CU-003 paso 5). */
  reemplazarRutina(socioId: number, generada: RutinaGenerada) {
    return prisma.$transaction(async (tx) => {
      await tx.rutina.updateMany({ where: { socioId, vigente: true }, data: { vigente: false } });
      return tx.rutina.create({
        data: { socioId, ejercicios: { create: generada.ejercicios } },
        include: { ejercicios: { include: { ejercicio: true } } },
      });
    });
  },

  itemDeRutinaVigente(socioId: number, ejercicioRutinaId: number) {
    return prisma.ejercicioRutina.findFirst({
      where: { id: ejercicioRutinaId, rutina: { socioId, vigente: true } },
      include: { ejercicio: true, rutina: true },
    });
  },
};
