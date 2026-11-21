import type { EstadoCuota, EstadoPropuesta, Prisma, TipoNotificacion, TipoPlanSocio } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { notificacionService } from '../services/notificacion.service';
import { aFechaDb } from '../utils/fechas';

type Cliente = Tx | typeof prisma;

/**
 * RetencionRepository: acceso a datos de constancia y regreso (CU-002). Los nombres
 * de las operaciones son los de los diagramas de secuencia (Figuras 78 a 82 y 87).
 */
export const retencionRepository = {
  /** CU-002-001/002: indicadores por sede y plan, socios activos con su actividad y la configuración del gimnasio. */
  async buscarIndicadores(
    gimnasioId: number,
    filtros: { sedeId?: number; plan?: TipoPlanSocio; estadoCuota?: EstadoCuota; busqueda?: string },
    periodo: { desde: string; hasta: string; mes: string },
  ) {
    const [indicadores, socios, gimnasio, sedes] = await Promise.all([
      prisma.indicadorAsistencia.groupBy({
        by: ['sedeId', 'tipoPlan'],
        where: {
          sede: { gimnasioId },
          ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
          ...(filtros.plan ? { tipoPlan: filtros.plan } : {}),
          fecha: { gte: aFechaDb(periodo.desde), lte: aFechaDb(periodo.hasta) },
        },
        _sum: { asistencias: true, sociosConAsistencia: true },
      }),
      prisma.socio.findMany({
        where: {
          sede: { gimnasioId },
          usuario: {
            activo: true,
            ...(filtros.busqueda
              ? {
                  OR: [
                    { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
                    { apellido: { contains: filtros.busqueda, mode: 'insensitive' } },
                    { email: { contains: filtros.busqueda, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
          ...(filtros.plan ? { plan: { tipo: filtros.plan } } : {}),
          ...(filtros.estadoCuota ? { cuotas: { some: { periodo: periodo.mes, estado: filtros.estadoCuota } } } : {}),
        },
        include: {
          usuario: { select: { nombre: true, apellido: true, email: true } },
          plan: true,
          sede: { select: { id: true, nombre: true } },
          cuotas: { where: { periodo: periodo.mes }, select: { estado: true } },
          senales: { orderBy: { detectadaEl: 'desc' }, take: 1 },
          reservas: {
            where: { asistencia: { isNot: null } },
            select: { turno: { select: { fecha: true } } },
            orderBy: { turno: { fecha: 'desc' } },
          },
        },
        orderBy: { usuario: { apellido: 'asc' } },
      }),
      prisma.gimnasio.findUniqueOrThrow({ where: { id: gimnasioId }, select: { ultimaEjecucionEtl: true } }),
      prisma.sede.findMany({ where: { gimnasioId }, select: { id: true, nombre: true } }),
    ]);
    return { indicadores, socios, gimnasio, sedes };
  },

  /** Fecha de la última detección de señales del ETL en el gimnasio. */
  async ultimaDeteccion(gimnasioId: number) {
    const ultima = await prisma.senalAbandono.findFirst({ where: { socio: { sede: { gimnasioId } } }, orderBy: { detectadaEl: 'desc' } });
    return ultima?.detectadaEl ?? null;
  },

  /** CU-002-003: socios activos con señal en una detección del ETL. */
  buscarSociosConSenal(gimnasioId: number, deteccion: Date, filtros: { sedeId?: number; nivel?: string }) {
    return prisma.senalAbandono.findMany({
      where: {
        detectadaEl: deteccion,
        socio: { sede: { gimnasioId }, usuario: { activo: true }, ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}) },
        ...(filtros.nivel ? { nivel: filtros.nivel } : {}),
      },
      include: {
        socio: { include: { usuario: { select: { nombre: true, apellido: true } }, sede: { select: { nombre: true } }, plan: true } },
        propuestas: { select: { id: true, estado: true } },
      },
      orderBy: [{ nivel: 'asc' }],
    });
  },

  /** CU-002-003: asistencias del socio desde una fecha y su historial de retención. */
  async buscarAsistencias(socioId: number, desde: string) {
    const [asistencias, senales, propuestas, bonificaciones] = await Promise.all([
      prisma.asistencia.findMany({ where: { reserva: { socioId }, fechaHoraReal: { gte: aFechaDb(desde) } }, select: { fechaHoraReal: true } }),
      prisma.senalAbandono.findMany({ where: { socioId }, orderBy: { detectadaEl: 'desc' }, take: 5 }),
      prisma.propuestaIncentivo.findMany({ where: { socioId }, orderBy: { fechaCreacion: 'desc' } }),
      prisma.bonificacionPremium.findMany({ where: { socioId }, orderBy: { desde: 'desc' } }),
    ]);
    return { asistencias, senales, propuestas, bonificaciones };
  },

  /** Señal de un socio (para vincularla a una propuesta). */
  buscarSenal(senalId: number, socioId: number) {
    return prisma.senalAbandono.findFirst({ where: { id: senalId, socioId } });
  },

  /** CU-002-004: propuesta de incentivo (PREPARADA, o PENDIENTE si es Premium bonificado). */
  guardarPropuesta(datos: Prisma.PropuestaIncentivoUncheckedCreateInput) {
    return prisma.propuestaIncentivo.create({ data: datos });
  },

  buscarPropuestas(gimnasioId: number, estado?: EstadoPropuesta) {
    return prisma.propuestaIncentivo.findMany({
      where: { socio: { sede: { gimnasioId } }, ...(estado ? { estado } : {}) },
      include: {
        socio: { include: { usuario: { select: { nombre: true, apellido: true } } } },
        senal: true,
        responsable: { include: { usuario: { select: { nombre: true, apellido: true } } } },
      },
      orderBy: { fechaCreacion: 'desc' },
    });
  },

  buscarPropuesta(propuestaId: number, gimnasioId: number) {
    return prisma.propuestaIncentivo.findFirst({ where: { id: propuestaId, socio: { sede: { gimnasioId } } }, include: { socio: true } });
  },

  /** CU-002-005: cambia el estado de la propuesta (aprobada con su responsable, o pendiente). */
  actualizarPropuesta(propuestaId: number, datos: Prisma.PropuestaIncentivoUncheckedUpdateInput, cliente: Cliente = prisma) {
    return cliente.propuestaIncentivo.update({ where: { id: propuestaId }, data: datos });
  },

  /** CU-002-010: habilita el Plan Premium bonificado durante el período otorgado. */
  registrarBonificacion(
    datos: { socioId: number; desde: string; hasta: string; porcentaje: number | Prisma.Decimal; responsableId: number },
    tx: Tx,
  ) {
    return tx.bonificacionPremium.create({
      data: { socioId: datos.socioId, desde: aFechaDb(datos.desde), hasta: aFechaDb(datos.hasta), porcentaje: datos.porcentaje, responsableId: datos.responsableId },
    });
  },

  /** CU-002-005 y CU-002-010: notificación interna del socio. */
  registrarNotificacion(usuarioId: number, tipo: TipoNotificacion, mensaje: string, tx: Tx) {
    return notificacionService.notificar({ usuarioId, tipo, mensaje }, tx);
  },
};
