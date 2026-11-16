import type { EstadoCuota, EstadoPropuesta, TipoPlanSocio } from '@prisma/client';
import { prisma } from '../config/prisma';
import { procesoEtl } from '../jobs/ProcesoETLAsistencia';
import { ErrorApp, noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal, fechaIso, sumarDias } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { tieneIntelligence } from './gimnasio.service';
import { notificacionService } from './notificacion.service';
import { tenant } from './tenant.service';

type Responsable = { gimnasioId: number; personalId: number; usuarioId: number };

export interface FiltrosRetencion {
  sedeId?: number;
  plan?: TipoPlanSocio;
  estadoCuota?: EstadoCuota;
  nivel?: string;
  desde?: string;
  hasta?: string;
  busqueda?: string;
}

const MIN_DIAS_HISTORIAL = 14;

/** Última fecha en que el ETL detectó señales en el gimnasio. */
async function ultimaDeteccion(gimnasioId: number) {
  const ultima = await prisma.senalAbandono.findFirst({ where: { socio: { sede: { gimnasioId } } }, orderBy: { detectadaEl: 'desc' } });
  return ultima?.detectadaEl ?? null;
}

/** Gestión de retención de socios (CU-002) y analítica de NeuroGym Intelligence (RF27, RD3). */
export const retencionService = {
  /** CU-002-001 y CU-002-002: indicadores de constancia y listado de socios filtrable. */
  async dashboard(gimnasioId: number, filtros: FiltrosRetencion) {
    const hoy = ahoraLocal().fecha;
    const desde = filtros.desde ?? `${hoy.slice(0, 7)}-01`;
    const hasta = filtros.hasta ?? hoy;
    const [indicadores, socios, deteccion, intelligence, gimnasio] = await Promise.all([
      prisma.indicadorAsistencia.groupBy({
        by: ['sedeId', 'tipoPlan'],
        where: {
          sede: { gimnasioId },
          ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
          ...(filtros.plan ? { tipoPlan: filtros.plan } : {}),
          fecha: { gte: aFechaDb(desde), lte: aFechaDb(hasta) },
        },
        _sum: { asistencias: true, sociosConAsistencia: true },
      }),
      prisma.socio.findMany({
        where: {
          sede: { gimnasioId },
          usuario: {
            activo: true,
            ...(filtros.busqueda
              ? { OR: [{ nombre: { contains: filtros.busqueda, mode: 'insensitive' } }, { apellido: { contains: filtros.busqueda, mode: 'insensitive' } }, { email: { contains: filtros.busqueda, mode: 'insensitive' } }] }
              : {}),
          },
          ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
          ...(filtros.plan ? { plan: { tipo: filtros.plan } } : {}),
          ...(filtros.estadoCuota ? { cuotas: { some: { periodo: hoy.slice(0, 7), estado: filtros.estadoCuota } } } : {}),
        },
        include: {
          usuario: { select: { nombre: true, apellido: true, email: true } },
          plan: true,
          sede: { select: { id: true, nombre: true } },
          cuotas: { where: { periodo: hoy.slice(0, 7) }, select: { estado: true } },
          senales: { orderBy: { detectadaEl: 'desc' }, take: 1 },
          reservas: {
            where: { asistencia: { isNot: null } },
            select: { turno: { select: { fecha: true } } },
            orderBy: { turno: { fecha: 'desc' } },
          },
        },
        orderBy: { usuario: { apellido: 'asc' } },
      }),
      ultimaDeteccion(gimnasioId),
      tieneIntelligence(gimnasioId),
      prisma.gimnasio.findUniqueOrThrow({ where: { id: gimnasioId }, select: { ultimaEjecucionEtl: true } }),
    ]);
    const sedes = await prisma.sede.findMany({ where: { gimnasioId }, select: { id: true, nombre: true } });
    const listado = socios
      .map((s) => {
        const fechas = s.reservas.map((r) => fechaIso(r.turno.fecha));
        const senal = s.senales[0] && deteccion && s.senales[0].detectadaEl.getTime() === deteccion.getTime() ? s.senales[0] : null;
        return {
          socioId: s.id,
          nombre: `${s.usuario.apellido}, ${s.usuario.nombre}`,
          email: s.usuario.email,
          sede: s.sede.nombre,
          plan: s.plan.tipo,
          saldoPuntos: s.saldoPuntos,
          estadoCuota: s.cuotas[0]?.estado ?? null,
          asistenciasPeriodo: fechas.filter((f) => f >= desde && f <= hasta).length,
          ultimaVisita: fechas[0] ?? null,
          senal: senal ? { id: senal.id, tipo: senal.tipo, nivel: senal.nivel, detalle: senal.detalle } : null,
        };
      })
      .filter((s) => !filtros.nivel || s.senal?.nivel === filtros.nivel);
    return {
      periodo: { desde, hasta },
      ultimaEjecucionEtl: gimnasio.ultimaEjecucionEtl,
      intelligenceDisponible: intelligence,
      indicadores: sedes.map((sede) => {
        const filas = indicadores.filter((i) => i.sedeId === sede.id);
        return {
          sedeId: sede.id,
          sede: sede.nombre,
          asistencias: filas.reduce((t, f) => t + (f._sum.asistencias ?? 0), 0),
          porPlan: filas.map((f) => ({ plan: f.tipoPlan, asistencias: f._sum.asistencias ?? 0 })),
        };
      }).filter((i) => !filtros.sedeId || i.sedeId === filtros.sedeId),
      socios: listado,
      resumen: {
        sociosActivos: listado.length,
        conSenal: listado.filter((s) => s.senal).length,
        sinAsistenciaEnPeriodo: listado.filter((s) => s.asistenciasPeriodo === 0).length,
      },
    };
  },

  /** CU-002-003: socios con señales de la última detección del ETL. */
  async senales(gimnasioId: number, filtros: Pick<FiltrosRetencion, 'sedeId' | 'nivel'>) {
    const deteccion = await ultimaDeteccion(gimnasioId);
    if (!deteccion) return [];
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

  /** Asistencia reciente del socio y acciones registradas (CU-002-003 paso 4). */
  async detalleSocio(socioId: number, gimnasioId: number) {
    const socio = await tenant.socio(socioId, gimnasioId);
    const hoy = ahoraLocal().fecha;
    const asistencias = await prisma.asistencia.findMany({
      where: { reserva: { socioId }, fechaHoraReal: { gte: aFechaDb(sumarDias(hoy, -84)) } },
      select: { fechaHoraReal: true },
    });
    const semanas = Array.from({ length: 12 }, (_, i) => {
      const inicio = sumarDias(hoy, -7 * (12 - i));
      const fin = sumarDias(inicio, 7);
      return { desde: inicio, asistencias: asistencias.filter((a) => { const f = ahoraLocal(a.fechaHoraReal).fecha; return f > inicio && f <= fin; }).length };
    });
    const [senales, propuestas, bonificaciones, estimacion] = await Promise.all([
      prisma.senalAbandono.findMany({ where: { socioId }, orderBy: { detectadaEl: 'desc' }, take: 5 }),
      prisma.propuestaIncentivo.findMany({ where: { socioId }, orderBy: { fechaCreacion: 'desc' } }),
      prisma.bonificacionPremium.findMany({ where: { socioId }, orderBy: { desde: 'desc' } }),
      (await tieneIntelligence(gimnasioId)) ? prisma.estimacionRiesgo.findFirst({ where: { socioId }, orderBy: { fecha: 'desc' }, include: { decisiones: true } }) : null,
    ]);
    return {
      socio: { id: socio.id, nombre: `${socio.usuario.nombre} ${socio.usuario.apellido}`, plan: socio.plan.tipo, sede: socio.sede.nombre, saldoPuntos: socio.saldoPuntos },
      semanas,
      senales,
      propuestas,
      bonificaciones,
      estimacion,
    };
  },

  // ---------------- Incentivos y bonificaciones (CU-002-004, 005, 010) ----------------

  /**
   * Guarda la propuesta sin comunicarla (RD10). Si el incentivo es Premium
   * bonificado, queda pendiente de aprobación (CU-002-010).
   */
  async crearPropuesta(
    r: Responsable,
    datos: { socioId: number; senalId?: number; incentivo: string; mensaje: string; premiumDias?: number; premiumPorcentaje?: number },
  ) {
    await tenant.socio(datos.socioId, r.gimnasioId);
    if (datos.senalId && !(await prisma.senalAbandono.findFirst({ where: { id: datos.senalId, socioId: datos.socioId } }))) {
      throw noEncontrado('Señal');
    }
    const esPremium = datos.premiumDias !== undefined;
    const propuesta = await prisma.propuestaIncentivo.create({
      data: {
        socioId: datos.socioId,
        senalId: datos.senalId,
        incentivo: datos.incentivo,
        mensaje: datos.mensaje,
        responsableId: r.personalId,
        estado: esPremium ? 'PENDIENTE' : 'PREPARADA',
        premiumDias: datos.premiumDias,
        premiumPorcentaje: esPremium ? (datos.premiumPorcentaje ?? 100) : undefined,
      },
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'PROPUESTA_INCENTIVO', entidad: 'propuesta_incentivo', entidadId: propuesta.id });
    return propuesta;
  },

  listarPropuestas(gimnasioId: number, estado?: EstadoPropuesta) {
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

  /** CU-002-004 5.1: la propuesta no aprobada queda pendiente y no se comunica. */
  async posponerPropuesta(propuestaId: number, r: Responsable) {
    const propuesta = await this.propuestaDelGimnasio(propuestaId, r.gimnasioId);
    if (propuesta.estado === 'APROBADA') throw reglaNegocio('YA_APROBADA', 'La propuesta ya fue aprobada');
    return prisma.propuestaIncentivo.update({ where: { id: propuestaId }, data: { estado: 'PENDIENTE' } });
  },

  /**
   * Aprobación del administrador (RD10): registra el responsable, comunica el
   * incentivo al socio (CU-002-005) y, si es Premium bonificado, habilita el
   * plan durante el período otorgado (CU-002-010).
   */
  async aprobarPropuesta(propuestaId: number, r: Responsable) {
    const propuesta = await this.propuestaDelGimnasio(propuestaId, r.gimnasioId);
    if (propuesta.estado === 'APROBADA') throw reglaNegocio('YA_APROBADA', 'La propuesta ya fue aprobada');
    const hoy = ahoraLocal().fecha;
    const resultado = await prisma.$transaction(async (tx) => {
      const aprobada = await tx.propuestaIncentivo.update({
        where: { id: propuestaId },
        data: { estado: 'APROBADA', fechaAprobacion: new Date(), responsableId: r.personalId },
      });
      let bonificacion = null;
      if (propuesta.premiumDias) {
        bonificacion = await tx.bonificacionPremium.create({
          data: {
            socioId: propuesta.socioId,
            desde: aFechaDb(hoy),
            hasta: aFechaDb(sumarDias(hoy, propuesta.premiumDias - 1)),
            porcentaje: propuesta.premiumPorcentaje ?? 100,
            responsableId: r.personalId,
          },
        });
      }
      await notificacionService.notificar(
        {
          usuarioId: propuesta.socio.usuarioId,
          tipo: bonificacion ? 'BENEFICIO' : 'INCENTIVO',
          mensaje: `Un incentivo para tu regreso: ${propuesta.incentivo}. ${propuesta.mensaje}`,
        },
        tx,
      );
      return { propuesta: aprobada, bonificacion };
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'APROBAR_INCENTIVO', entidad: 'propuesta_incentivo', entidadId: propuestaId });
    return { ...resultado, mensaje: 'El incentivo fue aprobado y comunicado al socio.' };
  },

  async propuestaDelGimnasio(propuestaId: number, gimnasioId: number) {
    const propuesta = await prisma.propuestaIncentivo.findFirst({ where: { id: propuestaId, socio: { sede: { gimnasioId } } }, include: { socio: true } });
    if (!propuesta) throw noEncontrado('Propuesta');
    return propuesta;
  },

  // ---------------- NeuroGym Intelligence (RD3) ----------------

  async exigirIntelligence(gimnasioId: number) {
    if (!(await tieneIntelligence(gimnasioId))) {
      throw new ErrorApp(403, 'REQUIERE_INTELLIGENCE', 'La analítica avanzada está disponible con NeuroGym Intelligence');
    }
  },

  /** CU-002-006: evolución, comparación entre sedes, riesgo y recomendaciones. */
  async analitica(gimnasioId: number, filtros: { sedeId?: number; desde?: string; hasta?: string }) {
    await this.exigirIntelligence(gimnasioId);
    const hoy = ahoraLocal().fecha;
    const desde = filtros.desde ?? sumarDias(hoy, -180);
    const hasta = filtros.hasta ?? hoy;
    const indicadores = await prisma.indicadorAsistencia.findMany({
      where: { sede: { gimnasioId }, fecha: { gte: aFechaDb(desde), lte: aFechaDb(hasta) } },
      include: { sede: { select: { nombre: true } } },
    });
    const diasConDatos = new Set(indicadores.filter((i) => !filtros.sedeId || i.sedeId === filtros.sedeId).map((i) => fechaIso(i.fecha))).size;
    if (filtros.sedeId && diasConDatos < MIN_DIAS_HISTORIAL) {
      return { historialDisponible: false, mensaje: 'Historial aún no disponible', desde, hasta };
    }
    const meses = new Map<string, number>();
    const porSede = new Map<string, { asistencias: number; dias: Set<string> }>();
    for (const i of indicadores) {
      const fecha = fechaIso(i.fecha);
      if (!filtros.sedeId || i.sedeId === filtros.sedeId) meses.set(fecha.slice(0, 7), (meses.get(fecha.slice(0, 7)) ?? 0) + i.asistencias);
      const s = porSede.get(i.sede.nombre) ?? { asistencias: 0, dias: new Set<string>() };
      s.asistencias += i.asistencias;
      s.dias.add(fecha);
      porSede.set(i.sede.nombre, s);
    }
    const sociosSede = await prisma.socio.groupBy({ by: ['sedeId'], where: { sede: { gimnasioId }, usuario: { activo: true } }, _count: true });
    const sedes = await prisma.sede.findMany({ where: { gimnasioId } });
    const estimaciones = await this.riesgos(gimnasioId, filtros.sedeId);
    return {
      historialDisponible: diasConDatos >= MIN_DIAS_HISTORIAL || !filtros.sedeId,
      desde,
      hasta,
      evolucionMensual: [...meses].sort(([a], [b]) => a.localeCompare(b)).map(([mes, asistencias]) => ({ mes, asistencias })),
      comparacionSedes: sedes.map((s) => {
        const datos = porSede.get(s.nombre);
        const socios = sociosSede.find((g) => g.sedeId === s.id)?._count ?? 0;
        return {
          sede: s.nombre,
          asistencias: datos?.asistencias ?? 0,
          promedioDiario: datos ? Math.round((datos.asistencias / datos.dias.size) * 10) / 10 : 0,
          sociosActivos: socios,
          asistenciasPorSocio: socios ? Math.round(((datos?.asistencias ?? 0) / socios) * 10) / 10 : 0,
        };
      }),
      riesgo: {
        alto: estimaciones.filter((e) => e.nivel === 'ALTO').length,
        medio: estimaciones.filter((e) => e.nivel === 'MEDIO').length,
        bajo: estimaciones.filter((e) => e.nivel === 'BAJO').length,
      },
      estimaciones,
    };
  },

  /** CU-002-007: última estimación de cada socio, ordenada por prioridad. */
  async riesgos(gimnasioId: number, sedeId?: number) {
    const lista = await prisma.estimacionRiesgo.findMany({
      where: { socio: { sede: { gimnasioId }, usuario: { activo: true }, ...(sedeId ? { sedeId } : {}) } },
      include: {
        socio: { include: { usuario: { select: { nombre: true, apellido: true } }, sede: { select: { nombre: true } } } },
        decisiones: { orderBy: { fecha: 'desc' }, take: 1 },
      },
      orderBy: { fecha: 'desc' },
    });
    const ultimas = new Map<number, (typeof lista)[number]>();
    lista.forEach((e) => ultimas.has(e.socioId) || ultimas.set(e.socioId, e));
    const orden = { ALTO: 0, MEDIO: 1, BAJO: 2 } as Record<string, number>;
    return [...ultimas.values()]
      .sort((a, b) => (orden[a.nivel] ?? 3) - (orden[b.nivel] ?? 3))
      .map((e) => ({
        estimacionId: e.id,
        socioId: e.socioId,
        socio: `${e.socio.usuario.apellido}, ${e.socio.usuario.nombre}`,
        sede: e.socio.sede.nombre,
        nivel: e.nivel,
        fundamento: e.fundamento,
        recomendacion: e.recomendacion,
        fecha: fechaIso(e.fecha),
        ultimaDecision: e.decisiones[0] ?? null,
      }));
  },

  /**
   * CU-002-008: decisión del administrador sobre la recomendación. Preparar una
   * propuesta crea un borrador sin aplicarlo ni comunicarlo (RD10).
   */
  async registrarDecision(
    estimacionId: number,
    r: Responsable,
    datos: { decision: 'MANTENER_EN_OBSERVACION' | 'PREPARAR_PROPUESTA'; motivo: string; incentivo?: string; mensaje?: string; premiumDias?: number },
  ) {
    await this.exigirIntelligence(r.gimnasioId);
    const estimacion = await prisma.estimacionRiesgo.findFirst({ where: { id: estimacionId, socio: { sede: { gimnasioId: r.gimnasioId } } } });
    if (!estimacion) throw noEncontrado('Estimación');
    if (datos.decision === 'PREPARAR_PROPUESTA' && (!datos.incentivo?.trim() || !datos.mensaje?.trim())) {
      throw reglaNegocio('DATOS_INCOMPLETOS', 'Completá el incentivo y el mensaje');
    }
    const decision = await prisma.decisionRetencion.create({
      data: { estimacionId, decision: datos.decision, motivo: datos.motivo, responsableId: r.personalId },
    });
    const propuesta =
      datos.decision === 'PREPARAR_PROPUESTA'
        ? await this.crearPropuesta(r, { socioId: estimacion.socioId, incentivo: datos.incentivo!, mensaje: datos.mensaje!, premiumDias: datos.premiumDias })
        : null;
    return { decision, propuesta };
  },

  /** CU-002-009: exportación en Excel (.xlsx). */
  async exportar(gimnasioId: number, filtros: { sedeId?: number; desde?: string; hasta?: string }) {
    const analitica = await this.analitica(gimnasioId, filtros);
    if (!analitica.historialDisponible) throw reglaNegocio('SIN_HISTORIAL', 'La sede seleccionada no tiene historial disponible');
    return procesoEtl.exportarXlsx(gimnasioId, { sedeId: filtros.sedeId, desde: analitica.desde, hasta: analitica.hasta });
  },
};
