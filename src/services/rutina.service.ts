import { ErrorServicioIA, exigeZonaEvitada, servicioIA, type EjercicioCatalogo, type PreferenciasRutina } from '../integrations/ia';
import { equipamientoRepository } from '../repositories/equipamiento.repository';
import { rutinaRepository } from '../repositories/rutina.repository';
import { aNumero } from '../utils/dinero';
import { ErrorApp, noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal } from '../utils/fechas';
import { equipoDisponible } from './equipamiento.service';

type SocioCtx = { socioId: number; sedeId: number };

export const OBJETIVOS = ['Fuerza y bienestar', 'Resistencia', 'Hipertrofia', 'Movilidad'] as const;
export const NIVELES = ['Principiante', 'Intermedio', 'Avanzado'] as const;

/**
 * CU-003-006: un ejercicio está disponible si no requiere equipo o si al menos
 * uno de sus equipos en la sede del socio está OPERATIVO. La disponibilidad la
 * registra el gimnasio; el sistema no detecta fallas (RD11).
 */
async function catalogo(sedeId: number) {
  const [lista, mantenimientos] = await Promise.all([rutinaRepository.catalogoConEquipos(sedeId), equipamientoRepository.buscarMantenimientosProgramados(sedeId)]);
  return lista.map((e) => {
    const disponible = e.equipos.length === 0 || e.equipos.some((eq) => eq.estado === 'OPERATIVO');
    const hasta = mantenimientos.filter((m) => e.equipos.some((eq) => eq.id === m.equipoId)).map((m) => m.finProgramado);
    return {
      id: e.id,
      nombre: e.nombre,
      grupoMuscular: e.grupoMuscular,
      disponible,
      equipos: e.equipos.map((eq) => ({ id: eq.id, nombre: eq.nombre, estado: eq.estado })),
      mantenimientoHasta: disponible || hasta.length === 0 ? null : new Date(Math.max(...hasta.map((d) => d.getTime()))),
    };
  });
}

const aCatalogoIA = (e: { id: number; nombre: string; grupoMuscular: string; disponible: boolean }): EjercicioCatalogo => ({
  id: e.id,
  nombre: e.nombre,
  grupoMuscular: e.grupoMuscular,
  disponible: e.disponible,
});

/**
 * RutinaService: rutinas personalizadas con IA y registro de entrenamientos
 * (CU-003, RF5, RF6, RF7). Las operaciones son las de los diagramas de secuencia
 * (Figuras 88 a 97).
 */
export const rutinaService = {
  catalogo: (sedeId: number) => catalogo(sedeId),

  preferencias(socioId: number) {
    return rutinaRepository.buscarPreferencias(socioId);
  },

  /** CU-003-001: registra el objetivo, la experiencia y los días por semana. Las zonas a evitar no se guardan. */
  registrarPreferencias(socio: SocioCtx, datos: PreferenciasRutina) {
    const { evitar: _evitar, ...guardadas } = datos;
    return rutinaRepository.guardarPreferencias(socio.socioId, guardadas);
  },

  /** CU-003: genera la rutina con IA a partir de las preferencias y la asigna (reemplaza a la vigente). */
  async generarRutina(socio: SocioCtx, preferencias: PreferenciasRutina) {
    const { evitar = [], ...datos } = preferencias;
    const lista = await catalogo(socio.sedeId);
    // Los ejercicios que exigen una zona evitada no se le ofrecen a la IA (garantía, no solo indicación).
    const paraIA = lista.map(aCatalogoIA).filter((e) => !exigeZonaEvitada(e.nombre, evitar));
    let generada;
    try {
      generada = await servicioIA.generarRutina({ ...datos, evitar }, paraIA);
    } catch (error) {
      // CU-003 4.1: si la IA falla, se informa y se conserva la rutina vigente (si la hay).
      if (error instanceof ErrorServicioIA) {
        const tieneRutina = (await rutinaRepository.buscarRutinaVigente(socio.socioId)) !== null;
        throw new ErrorApp(
          502,
          'IA_NO_DISPONIBLE',
          `La IA no pudo generar la rutina en este momento. ${tieneRutina ? 'Se conserva tu rutina vigente. ' : ''}Probá de nuevo en unos minutos.`,
        );
      }
      throw error;
    }
    await rutinaRepository.asignarRutina(socio.socioId, generada);
    return this.obtenerRutina(socio);
  },

  /** CU-003-002: rutina vigente con la disponibilidad del equipamiento de cada ejercicio. */
  async obtenerRutina(socio: SocioCtx) {
    const [rutina, preferencias, lista] = await Promise.all([
      rutinaRepository.buscarRutinaVigente(socio.socioId),
      rutinaRepository.buscarPreferencias(socio.socioId),
      catalogo(socio.sedeId),
    ]);
    if (!rutina) return { rutina: null, preferencias, generador: servicioIA.descripcion };
    const porId = new Map(lista.map((e) => [e.id, e]));
    return {
      generador: servicioIA.descripcion,
      preferencias,
      rutina: {
        id: rutina.id,
        fechaGeneracion: rutina.fechaGeneracion,
        ejercicios: rutina.ejercicios.map((er) => {
          const info = porId.get(er.ejercicioId);
          return {
            id: er.id,
            ejercicioId: er.ejercicioId,
            nombre: er.ejercicio.nombre,
            grupoMuscular: er.ejercicio.grupoMuscular,
            dia: er.dia,
            orden: er.orden,
            series: er.series,
            repeticiones: er.repeticiones,
            pesoKg: er.pesoKg === null ? null : aNumero(er.pesoKg),
            descansoSeg: er.descansoSeg,
            disponible: info?.disponible ?? true,
            equipos: info?.equipos ?? [],
            mantenimientoHasta: info?.mantenimientoHasta ?? null,
          };
        }),
      },
    };
  },

  /** CU-003-006 (RF8): disponibilidad del equipamiento de la sede del socio, con la fecha prevista si está en mantenimiento. */
  async obtenerDisponibilidad(sedeId: number) {
    const equipos = await equipamientoRepository.buscarDisponibilidad(sedeId);
    return equipos.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      categoria: e.categoria,
      estado: e.estado,
      disponible: equipoDisponible(e.estado),
      mantenimientoHasta: e.mantenimientos[0]?.finProgramado ?? null,
    }));
  },

  /** CU-003-003/004/005: edición manual; el reemplazo manual no consulta a la IA. */
  async actualizarEjercicio(
    socio: SocioCtx,
    ejercicioRutinaId: number,
    datos: { ejercicioId?: number; nombreEjercicio?: string; series?: number; repeticiones?: number; pesoKg?: number | null; descansoSeg?: number | null },
  ) {
    const item = await rutinaRepository.itemDeRutinaVigente(socio.socioId, ejercicioRutinaId);
    if (!item) throw noEncontrado('Ejercicio de la rutina');
    let ejercicioId = datos.ejercicioId;
    if (!ejercicioId && datos.nombreEjercicio && datos.nombreEjercicio.trim().toLowerCase() !== item.ejercicio.nombre.toLowerCase()) {
      // Un ejercicio nuevo del socio conserva el grupo muscular del reemplazado.
      ejercicioId = (await rutinaRepository.buscarOCrearEjercicio(datos.nombreEjercicio.trim(), item.ejercicio.grupoMuscular)).id;
    }
    if (ejercicioId && !(await rutinaRepository.buscarEjercicio(ejercicioId))) throw noEncontrado('Ejercicio');
    await rutinaRepository.guardarRutina(ejercicioRutinaId, {
      ejercicioId,
      series: datos.series,
      repeticiones: datos.repeticiones,
      pesoKg: datos.pesoKg,
      descansoSeg: datos.descansoSeg,
    });
    return this.obtenerRutina(socio);
  },

  /** CU-003-007: variante sugerida por IA para un ejercicio con equipo no disponible. */
  async sugerirVariante(socio: SocioCtx, ejercicioRutinaId: number) {
    const item = await rutinaRepository.itemDeRutinaVigente(socio.socioId, ejercicioRutinaId);
    if (!item) throw noEncontrado('Ejercicio de la rutina');
    const lista = await catalogo(socio.sedeId);
    const actual = lista.find((e) => e.id === item.ejercicioId)!;
    if (actual.disponible) throw reglaNegocio('EQUIPO_DISPONIBLE', 'El equipo de este ejercicio está disponible');
    const preferencias = await rutinaRepository.buscarPreferencias(socio.socioId);
    let sugerencia;
    try {
      sugerencia = await servicioIA.sugerirVariante(aCatalogoIA(actual), preferencias?.objetivo ?? 'General', lista.map(aCatalogoIA));
    } catch (error) {
      if (error instanceof ErrorServicioIA) throw new ErrorApp(502, 'IA_NO_DISPONIBLE', 'No pudo obtenerse una variante. Tu rutina no cambió.');
      throw error;
    }
    const variante = sugerencia.ejercicioId ? (lista.find((e) => e.id === sugerencia.ejercicioId) ?? null) : null;
    return { actual, variante, fundamento: sugerencia.fundamento };
  },

  /** CU-003-008: aplica la variante elegida por el socio; la reserva no se modifica (RD11). */
  async aplicarVariante(socio: SocioCtx, ejercicioRutinaId: number, ejercicioId: number) {
    const item = await rutinaRepository.itemDeRutinaVigente(socio.socioId, ejercicioRutinaId);
    if (!item) throw noEncontrado('Ejercicio de la rutina');
    const variante = (await catalogo(socio.sedeId)).find((e) => e.id === ejercicioId);
    if (!variante) throw noEncontrado('Ejercicio');
    if (!variante.disponible) throw reglaNegocio('VARIANTE_NO_DISPONIBLE', 'La variante elegida tampoco está disponible');
    await rutinaRepository.reemplazarEjercicio(ejercicioRutinaId, ejercicioId);
    return { mensaje: 'Variante aplicada. Tu turno se mantiene.', rutina: await this.obtenerRutina(socio) };
  },

  /** CU-003-009: registro de ejercicios realizados; no reemplaza la asistencia. */
  async registrarEntrenamiento(socio: SocioCtx, datos: { dia: number; realizados: number[] }) {
    const rutina = await rutinaRepository.buscarRutinaVigente(socio.socioId);
    if (!rutina) throw reglaNegocio('SIN_RUTINA', 'No tenés una rutina generada');
    const delDia = rutina.ejercicios.filter((e) => e.dia === datos.dia);
    if (delDia.length === 0) throw reglaNegocio('DIA_INVALIDO', 'La rutina no tiene ejercicios para ese día');
    const realizados = [...new Set(datos.realizados)];
    // 5.1: si no marcó ningún ejercicio, no se registra el entrenamiento.
    if (realizados.length === 0) throw reglaNegocio('SIN_EJERCICIOS', 'Marcá al menos un ejercicio realizado');
    if (realizados.some((id) => !delDia.some((e) => e.id === id))) throw reglaNegocio('EJERCICIO_AJENO', 'Hay ejercicios que no pertenecen a ese día de la rutina');
    // 2.1: no se puede marcar un ejercicio cuyo equipo no está disponible.
    const disponibilidad = new Map((await catalogo(socio.sedeId)).map((e) => [e.id, e.disponible]));
    if (delDia.some((e) => realizados.includes(e.id) && disponibilidad.get(e.ejercicioId) === false)) {
      throw reglaNegocio('EQUIPO_NO_DISPONIBLE', 'Elegí una variante para este equipo.');
    }
    return rutinaRepository.guardarEntrenamiento({
      rutinaId: rutina.id,
      fecha: aFechaDb(ahoraLocal().fecha),
      ejerciciosCompletados: realizados.length,
      ejerciciosTotales: delDia.length,
    });
  },

  historial(socioId: number) {
    return rutinaRepository.buscarEntrenamientos(socioId);
  },
};
