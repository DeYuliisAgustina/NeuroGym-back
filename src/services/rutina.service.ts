import { ErrorServicioIA, exigeZonaEvitada, servicioIA, type EjercicioCatalogo, type PreferenciasRutina } from '../integrations/ia';
import { equipamientoRepository } from '../repositories/equipamiento.repository';
import { rutinaRepository } from '../repositories/rutina.repository';
import { aNumero } from '../utils/dinero';
import { ErrorApp, noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { equipoDisponible } from './equipamiento.service';
import { tenant } from './tenant.service';
import { Ejercicio, EjercicioRutina, Rutina } from '../domain';

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
    const disponible = new Ejercicio(e, e.equipos).estaDisponible();
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
    // CU-003-005: el ejercicio de la rutina ajusta su carga (los valores omitidos se conservan).
    const dominio = new EjercicioRutina({ ...item, pesoKg: item.pesoKg === null ? null : aNumero(item.pesoKg) });
    dominio.ajustarCarga(datos.series, datos.repeticiones, datos.pesoKg);
    await rutinaRepository.guardarRutina(ejercicioRutinaId, {
      ejercicioId,
      series: datos.series === undefined ? undefined : dominio.series,
      repeticiones: datos.repeticiones === undefined ? undefined : dominio.repeticiones,
      pesoKg: datos.pesoKg === undefined ? undefined : dominio.peso,
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
    const dominio = new EjercicioRutina({ ...item, pesoKg: item.pesoKg === null ? null : aNumero(item.pesoKg) });
    dominio.reemplazarPor(variante);
    await rutinaRepository.reemplazarEjercicio(ejercicioRutinaId, dominio.ejercicioId);
    return { mensaje: 'Variante aplicada. Tu turno se mantiene.', rutina: await this.obtenerRutina(socio) };
  },

  /** CU-003-009: registro de ejercicios realizados; no reemplaza la asistencia. */
  async registrarEntrenamiento(socio: SocioCtx, datos: { dia: number; realizados: number[] }) {
    const rutina = await rutinaRepository.buscarRutinaVigente(socio.socioId);
    if (!rutina) throw reglaNegocio('SIN_RUTINA', 'No tenés una rutina generada');
    const realizados = [...new Set(datos.realizados)];
    // La rutina valida el día, que haya ejercicios marcados (5.1) y que sean de ese día.
    const entrenamiento = new Rutina(rutina, rutina.ejercicios).registrarEntrenamiento(realizados.length, datos.dia, realizados, ahoraLocal().fecha);
    const delDia = rutina.ejercicios.filter((e) => e.dia === datos.dia);
    // 2.1: no se puede marcar un ejercicio cuyo equipo no está disponible.
    const disponibilidad = new Map((await catalogo(socio.sedeId)).map((e) => [e.id, e.disponible]));
    if (delDia.some((e) => realizados.includes(e.id) && disponibilidad.get(e.ejercicioId) === false)) {
      throw reglaNegocio('EQUIPO_NO_DISPONIBLE', 'Elegí una variante para este equipo.');
    }
    return rutinaRepository.guardarEntrenamiento({
      rutinaId: rutina.id,
      fecha: aFechaDb(entrenamiento.fecha),
      ejerciciosCompletados: entrenamiento.completados,
      ejerciciosTotales: entrenamiento.total,
    });
  },

  historial(socioId: number) {
    return rutinaRepository.buscarEntrenamientos(socioId);
  },
};

type PersonalCtx = { gimnasioId: number; usuarioId: number };

/**
 * RF5: el personal autorizado (permiso SOCIOS) consulta, genera con IA y edita la
 * rutina de un socio de su gimnasio. Usa las mismas operaciones que el socio y deja
 * registrado en la auditoría quién hizo cada cambio. Las variantes las decide el
 * socio (RD11), por eso no se ofrecen acá.
 */
export const rutinaPersonalService = {
  /** Socio del gimnasio del personal (RNF4: nunca de otro gimnasio). */
  async socioDelGimnasio(personal: PersonalCtx, socioId: number, paraModificar = false): Promise<SocioCtx> {
    const socio = await tenant.socio(socioId, personal.gimnasioId);
    // RD20: con la cuenta desactivada (o el alta pendiente) no se registran operaciones nuevas.
    if (paraModificar && (!socio.usuario.activo || socio.pendienteAlta)) {
      throw reglaNegocio('SOCIO_INACTIVO', 'El socio no está activo: no se puede modificar su rutina');
    }
    return { socioId: socio.id, sedeId: socio.sedeId };
  },

  async obtenerRutina(personal: PersonalCtx, socioId: number) {
    return rutinaService.obtenerRutina(await this.socioDelGimnasio(personal, socioId));
  },

  async generarRutina(personal: PersonalCtx, socioId: number, preferencias: PreferenciasRutina) {
    const socio = await this.socioDelGimnasio(personal, socioId, true);
    await rutinaService.generarRutina(socio, preferencias);
    // Como en «Mi rutina», quedan guardados el objetivo, la experiencia y los días (las zonas a evitar no).
    await rutinaService.registrarPreferencias(socio, preferencias);
    const resultado = await rutinaService.obtenerRutina(socio);
    await registrarAuditoria({
      gimnasioId: personal.gimnasioId,
      usuarioId: personal.usuarioId,
      accion: 'RUTINA_GENERADA_POR_PERSONAL',
      entidad: 'rutina',
      entidadId: resultado.rutina?.id ?? null,
      detalle: { socioId, objetivo: preferencias.objetivo, nivel: preferencias.nivel, diasPorSemana: preferencias.diasPorSemana },
    });
    return resultado;
  },

  async actualizarEjercicio(personal: PersonalCtx, socioId: number, ejercicioRutinaId: number, datos: Parameters<typeof rutinaService.actualizarEjercicio>[2]) {
    const socio = await this.socioDelGimnasio(personal, socioId, true);
    const resultado = await rutinaService.actualizarEjercicio(socio, ejercicioRutinaId, datos);
    await registrarAuditoria({
      gimnasioId: personal.gimnasioId,
      usuarioId: personal.usuarioId,
      accion: 'RUTINA_EDITADA_POR_PERSONAL',
      entidad: 'ejercicio_rutina',
      entidadId: ejercicioRutinaId,
      detalle: { socioId, ...datos },
    });
    return resultado;
  },
};
