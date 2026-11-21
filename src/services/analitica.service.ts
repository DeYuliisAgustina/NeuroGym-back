import { analiticaRepository } from '../repositories/analitica.repository';
import { ErrorApp, noEncontrado, reglaNegocio } from '../utils/errores';
import { ahoraLocal, fechaIso, sumarDias } from '../utils/fechas';
import { tieneIntelligence } from './gimnasio.service';
import { retencionService, type DatosPropuesta, type Responsable } from './retencion.service';

const MIN_DIAS_HISTORIAL = 14;

type FiltrosAnalitica = { sedeId?: number; desde?: string; hasta?: string };

/**
 * AnaliticaService: analítica avanzada de NeuroGym Intelligence (RF27, RD3).
 * Las operaciones son las de los diagramas de secuencia de CU-002-006 a 009 (Figuras 83 a 86).
 */
export const analiticaService = {
  /** RD3: la analítica avanzada es exclusiva de NeuroGym Intelligence. */
  async exigirIntelligence(gimnasioId: number) {
    if (!(await tieneIntelligence(gimnasioId))) {
      throw new ErrorApp(403, 'REQUIERE_INTELLIGENCE', 'La analítica avanzada está disponible con NeuroGym Intelligence');
    }
  },

  /** CU-002-006 y CU-002-008: evolución, comparación entre sedes, riesgo estimado y acción recomendada. */
  async obtenerAnalitica(gimnasioId: number, filtros: FiltrosAnalitica) {
    await this.exigirIntelligence(gimnasioId);
    const hoy = ahoraLocal().fecha;
    const desde = filtros.desde ?? sumarDias(hoy, -180);
    const hasta = filtros.hasta ?? hoy;
    const { indicadores, sociosSede, sedes } = await analiticaRepository.buscarHistorial(gimnasioId, desde, hasta);
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
    const estimaciones = await this.listarRiesgos(gimnasioId, filtros.sedeId);
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
  async listarRiesgos(gimnasioId: number, sedeId?: number) {
    const lista = await analiticaRepository.buscarEstimaciones(gimnasioId, sedeId);
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

  /** CU-002-007: análisis de un socio (evolución de su frecuencia, señales y estimación orientativa del riesgo). */
  async analizarSocio(socioId: number, gimnasioId: number) {
    const [asistencia, estimacion] = await Promise.all([
      retencionService.obtenerAsistenciaReciente(socioId, gimnasioId),
      tieneIntelligence(gimnasioId).then((tiene) => (tiene ? analiticaRepository.buscarEstimacionDelSocio(socioId) : null)),
    ]);
    return { ...asistencia, estimacion };
  },

  /** CU-002-008: «Preparar propuesta» registra un borrador de incentivo sin comunicarlo (RD10). */
  registrarPropuesta(r: Responsable, datos: DatosPropuesta) {
    return retencionService.registrarPropuesta(r, datos);
  },

  /**
   * CU-002-008: decisión del administrador sobre la recomendación. Preparar una
   * propuesta crea un borrador sin aplicarlo ni comunicarlo (RD10).
   */
  async registrarDecision(
    r: Responsable,
    datos: { estimacionId: number; decision: 'MANTENER_EN_OBSERVACION' | 'PREPARAR_PROPUESTA'; motivo: string; incentivo?: string; mensaje?: string; premiumDias?: number },
  ) {
    await this.exigirIntelligence(r.gimnasioId);
    const estimacion = await analiticaRepository.buscarEstimacion(datos.estimacionId, r.gimnasioId);
    if (!estimacion) throw noEncontrado('Estimación');
    if (datos.decision === 'PREPARAR_PROPUESTA' && (!datos.incentivo?.trim() || !datos.mensaje?.trim())) {
      throw reglaNegocio('DATOS_INCOMPLETOS', 'Completá el incentivo y el mensaje');
    }
    const decision = await analiticaRepository.guardarDecision({
      estimacionId: datos.estimacionId,
      decision: datos.decision,
      motivo: datos.motivo,
      responsableId: r.personalId,
    });
    const propuesta =
      datos.decision === 'PREPARAR_PROPUESTA'
        ? await this.registrarPropuesta(r, { socioId: estimacion.socioId, incentivo: datos.incentivo!, mensaje: datos.mensaje!, premiumDias: datos.premiumDias })
        : null;
    return { decision, propuesta };
  },

  /** CU-002-009: reporte avanzado en Excel (.xlsx). */
  async generarReporte(gimnasioId: number, filtros: FiltrosAnalitica) {
    const analitica = await this.obtenerAnalitica(gimnasioId, filtros);
    if (!analitica.historialDisponible) throw reglaNegocio('SIN_HISTORIAL', 'La sede seleccionada no tiene historial disponible');
    return analiticaRepository.buscarAnalitica(gimnasioId, { sedeId: filtros.sedeId, desde: analitica.desde, hasta: analitica.hasta });
  },
};
