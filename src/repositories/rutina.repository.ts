import { prisma, type Tx } from '../config/prisma';
import type { RutinaGenerada } from '../integrations/ia';

type Cliente = Tx | typeof prisma;

/**
 * RutinaRepository: catálogo, preferencias, rutinas y entrenamientos. Los nombres
 * de las operaciones son los de los diagramas de secuencia de CU-003 (Figuras 88 a 97).
 */
export const rutinaRepository = {
  /** Catálogo con los equipos que usa cada ejercicio y su estado en la sede indicada. */
  catalogoConEquipos(sedeId: number) {
    return prisma.ejercicio
      .findMany({
        include: { equipos: { include: { equipo: { select: { id: true, nombre: true, estado: true, sedeId: true } } } } },
        orderBy: [{ grupoMuscular: 'asc' }, { nombre: 'asc' }],
      })
      .then((lista) =>
        lista.map((e) => ({ ...e, equipos: e.equipos.map((ee) => ee.equipo).filter((eq) => eq.sedeId === sedeId && eq.estado !== 'DADO_DE_BAJA') })),
      );
  },

  /** CU-003-001: guarda (o actualiza) las preferencias de entrenamiento del socio. */
  guardarPreferencias(socioId: number, datos: { objetivo: string; nivel: string; diasPorSemana: number }) {
    return prisma.preferenciaRutina.upsert({
      where: { socioId },
      create: { socioId, ...datos },
      update: { ...datos, fechaActualizacion: new Date() },
    });
  },

  buscarPreferencias(socioId: number) {
    return prisma.preferenciaRutina.findUnique({ where: { socioId } });
  },

  /** CU-003-002: rutina vigente del socio con sus ejercicios ordenados por día. */
  buscarRutinaVigente(socioId: number, cliente: Cliente = prisma) {
    return cliente.rutina.findFirst({
      where: { socioId, vigente: true },
      include: { ejercicios: { include: { ejercicio: true }, orderBy: [{ dia: 'asc' }, { orden: 'asc' }] } },
    });
  },

  /** CU-003 paso 5: asigna la rutina generada y reemplaza la vigente en una sola transacción. */
  asignarRutina(socioId: number, generada: RutinaGenerada) {
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

  buscarEjercicio(ejercicioId: number) {
    return prisma.ejercicio.findUnique({ where: { id: ejercicioId } });
  },

  /** Ejercicio del catálogo por nombre; si el socio escribió uno nuevo, se crea con el grupo muscular del reemplazado. */
  async buscarOCrearEjercicio(nombre: string, grupoMuscular: string) {
    const existente = await prisma.ejercicio.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' } } });
    return existente ?? prisma.ejercicio.create({ data: { nombre, grupoMuscular } });
  },

  /** CU-003-003/004/005: guarda la edición de un ejercicio de la rutina. */
  guardarRutina(
    ejercicioRutinaId: number,
    datos: { ejercicioId?: number; series?: number; repeticiones?: number; pesoKg?: number | null; descansoSeg?: number | null },
  ) {
    return prisma.ejercicioRutina.update({ where: { id: ejercicioRutinaId }, data: datos });
  },

  /** CU-003-008: reemplaza el ejercicio de la rutina por la variante elegida. */
  reemplazarEjercicio(ejercicioRutinaId: number, ejercicioId: number) {
    return prisma.ejercicioRutina.update({ where: { id: ejercicioRutinaId }, data: { ejercicioId } });
  },

  /** CU-003-009: registra el entrenamiento del día con la cantidad de ejercicios completados. */
  guardarEntrenamiento(datos: { rutinaId: number; fecha: Date; ejerciciosCompletados: number; ejerciciosTotales: number }) {
    return prisma.entrenamiento.create({ data: datos });
  },

  buscarEntrenamientos(socioId: number) {
    return prisma.entrenamiento.findMany({ where: { rutina: { socioId } }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: 60 });
  },
};
