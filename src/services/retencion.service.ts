import type { EstadoCuota, EstadoPropuesta, TipoPlanSocio } from '@prisma/client';
import { prisma } from '../config/prisma';
import { retencionRepository } from '../repositories/retencion.repository';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { ahoraLocal, fechaIso, sumarDias } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { tieneIntelligence } from './gimnasio.service';
import { tenant } from './tenant.service';

export type Responsable = { gimnasioId: number; personalId: number; usuarioId: number };

export interface FiltrosRetencion {
  sedeId?: number;
  plan?: TipoPlanSocio;
  estadoCuota?: EstadoCuota;
  nivel?: string;
  desde?: string;
  hasta?: string;
  busqueda?: string;
}

export interface DatosPropuesta {
  socioId: number;
  senalId?: number;
  incentivo: string;
  mensaje: string;
  premiumDias?: number;
  premiumPorcentaje?: number;
}

/**
 * RetencionService: constancia y regreso de socios (CU-002-001 a 005 y 010).
 * Las operaciones son las de los diagramas de secuencia (Figuras 78 a 82 y 87).
 */
export const retencionService = {
  /** CU-002-001 y CU-002-002: indicadores de constancia y listado de socios filtrable. */
  async obtenerIndicadores(gimnasioId: number, filtros: FiltrosRetencion) {
    const hoy = ahoraLocal().fecha;
    const desde = filtros.desde ?? `${hoy.slice(0, 7)}-01`;
    const hasta = filtros.hasta ?? hoy;
    const [{ indicadores, socios, gimnasio, sedes }, deteccion, intelligence] = await Promise.all([
      retencionRepository.buscarIndicadores(gimnasioId, filtros, { desde, hasta, mes: hoy.slice(0, 7) }),
      retencionRepository.ultimaDeteccion(gimnasioId),
      tieneIntelligence(gimnasioId),
    ]);
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
      indicadores: sedes
        .map((sede) => {
          const filas = indicadores.filter((i) => i.sedeId === sede.id);
          return {
            sedeId: sede.id,
            sede: sede.nombre,
            asistencias: filas.reduce((t, f) => t + (f._sum.asistencias ?? 0), 0),
            porPlan: filas.map((f) => ({ plan: f.tipoPlan, asistencias: f._sum.asistencias ?? 0 })),
          };
        })
        .filter((i) => !filtros.sedeId || i.sedeId === filtros.sedeId),
      socios: listado,
      resumen: {
        sociosActivos: listado.length,
        conSenal: listado.filter((s) => s.senal).length,
        sinAsistenciaEnPeriodo: listado.filter((s) => s.asistenciasPeriodo === 0).length,
      },
    };
  },

  /** CU-002-003: socios con señales de la última detección del ETL. */
  async obtenerSenales(gimnasioId: number, filtros: Pick<FiltrosRetencion, 'sedeId' | 'nivel'>) {
    const deteccion = await retencionRepository.ultimaDeteccion(gimnasioId);
    if (!deteccion) return [];
    return retencionRepository.buscarSociosConSenal(gimnasioId, deteccion, filtros);
  },

  /** CU-002-003 paso 4: asistencia reciente del socio (12 semanas) y acciones registradas. */
  async obtenerAsistenciaReciente(socioId: number, gimnasioId: number) {
    const socio = await tenant.socio(socioId, gimnasioId);
    const hoy = ahoraLocal().fecha;
    const { asistencias, senales, propuestas, bonificaciones } = await retencionRepository.buscarAsistencias(socioId, sumarDias(hoy, -84));
    const semanas = Array.from({ length: 12 }, (_, i) => {
      const inicio = sumarDias(hoy, -7 * (12 - i));
      const fin = sumarDias(inicio, 7);
      return {
        desde: inicio,
        asistencias: asistencias.filter((a) => {
          const f = ahoraLocal(a.fechaHoraReal).fecha;
          return f > inicio && f <= fin;
        }).length,
      };
    });
    return {
      socio: { id: socio.id, nombre: `${socio.usuario.nombre} ${socio.usuario.apellido}`, plan: socio.plan.tipo, sede: socio.sede.nombre, saldoPuntos: socio.saldoPuntos },
      semanas,
      senales,
      propuestas,
      bonificaciones,
    };
  },

  // ---------------- Incentivos y bonificaciones (CU-002-004, 005, 010) ----------------

  /**
   * CU-002-004: guarda la propuesta sin comunicarla (RD10). Si el incentivo es
   * Premium bonificado, queda pendiente de aprobación (CU-002-010).
   */
  async registrarPropuesta(r: Responsable, datos: DatosPropuesta) {
    await tenant.socio(datos.socioId, r.gimnasioId);
    if (datos.senalId && !(await retencionRepository.buscarSenal(datos.senalId, datos.socioId))) throw noEncontrado('Señal');
    const esPremium = datos.premiumDias !== undefined;
    const propuesta = await retencionRepository.guardarPropuesta({
      socioId: datos.socioId,
      senalId: datos.senalId,
      incentivo: datos.incentivo,
      mensaje: datos.mensaje,
      responsableId: r.personalId,
      estado: esPremium ? 'PENDIENTE' : 'PREPARADA',
      premiumDias: datos.premiumDias,
      premiumPorcentaje: esPremium ? (datos.premiumPorcentaje ?? 100) : undefined,
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'PROPUESTA_INCENTIVO', entidad: 'propuesta_incentivo', entidadId: propuesta.id });
    return propuesta;
  },

  listarPropuestas(gimnasioId: number, estado?: EstadoPropuesta) {
    return retencionRepository.buscarPropuestas(gimnasioId, estado);
  },

  /** CU-002-004 5.1: la propuesta no aprobada queda pendiente y no se comunica. */
  async posponerPropuesta(propuestaId: number, r: Responsable) {
    const propuesta = await this.propuestaDelGimnasio(propuestaId, r.gimnasioId);
    if (propuesta.estado === 'APROBADA') throw reglaNegocio('YA_APROBADA', 'La propuesta ya fue aprobada');
    return retencionRepository.actualizarPropuesta(propuestaId, { estado: 'PENDIENTE' });
  },

  /**
   * CU-002-005: aprobación del administrador (RD10). Registra el responsable y
   * comunica el incentivo al socio. Si es Premium bonificado, la aprobación la
   * resuelve aprobarBonificacion (CU-002-010).
   */
  async aprobarPropuesta(propuestaId: number, r: Responsable) {
    const propuesta = await this.propuestaDelGimnasio(propuestaId, r.gimnasioId);
    if (propuesta.premiumDias) return this.aprobarBonificacion(propuestaId, r);
    if (propuesta.estado === 'APROBADA') throw reglaNegocio('YA_APROBADA', 'La propuesta ya fue aprobada');
    const aprobada = await prisma.$transaction(async (tx) => {
      const actualizada = await retencionRepository.actualizarPropuesta(
        propuestaId,
        { estado: 'APROBADA', fechaAprobacion: new Date(), responsableId: r.personalId },
        tx,
      );
      await retencionRepository.registrarNotificacion(
        propuesta.socio.usuarioId,
        'INCENTIVO',
        `Un incentivo para tu regreso: ${propuesta.incentivo}. ${propuesta.mensaje}`,
        tx,
      );
      return actualizada;
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'APROBAR_INCENTIVO', entidad: 'propuesta_incentivo', entidadId: propuestaId });
    return { propuesta: aprobada, bonificacion: null, mensaje: 'El incentivo fue aprobado y comunicado al socio.' };
  },

  /** CU-002-010: aprueba el Plan Premium bonificado, lo habilita durante el período y lo notifica al socio. */
  async aprobarBonificacion(propuestaId: number, r: Responsable) {
    const propuesta = await this.propuestaDelGimnasio(propuestaId, r.gimnasioId);
    if (propuesta.estado === 'APROBADA') throw reglaNegocio('YA_APROBADA', 'La propuesta ya fue aprobada');
    if (!propuesta.premiumDias) throw reglaNegocio('SIN_BONIFICACION', 'La propuesta no bonifica el Plan Premium');
    const hoy = ahoraLocal().fecha;
    const dias = propuesta.premiumDias;
    const resultado = await prisma.$transaction(async (tx) => {
      const aprobada = await retencionRepository.actualizarPropuesta(
        propuestaId,
        { estado: 'APROBADA', fechaAprobacion: new Date(), responsableId: r.personalId },
        tx,
      );
      const bonificacion = await retencionRepository.registrarBonificacion(
        { socioId: propuesta.socioId, desde: hoy, hasta: sumarDias(hoy, dias - 1), porcentaje: propuesta.premiumPorcentaje ?? 100, responsableId: r.personalId },
        tx,
      );
      await retencionRepository.registrarNotificacion(
        propuesta.socio.usuarioId,
        'BENEFICIO',
        `Un incentivo para tu regreso: ${propuesta.incentivo}. ${propuesta.mensaje}`,
        tx,
      );
      return { propuesta: aprobada, bonificacion };
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'APROBAR_INCENTIVO', entidad: 'propuesta_incentivo', entidadId: propuestaId });
    return { ...resultado, mensaje: 'El incentivo fue aprobado y comunicado al socio.' };
  },

  async propuestaDelGimnasio(propuestaId: number, gimnasioId: number) {
    const propuesta = await retencionRepository.buscarPropuesta(propuestaId, gimnasioId);
    if (!propuesta) throw noEncontrado('Propuesta');
    return propuesta;
  },
};
