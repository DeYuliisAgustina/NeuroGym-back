import {
  validarRutinaGenerada,
  type EjercicioCatalogo,
  type PreferenciasRutina,
  type RutinaGenerada,
  type ServicioIA,
  type VarianteSugerida,
} from './ServicioIA';

/** Parámetros de carga por objetivo (series, repeticiones, descanso). */
const CARGAS: Record<string, { series: number; repeticiones: number; descansoSeg: number }> = {
  hipertrofia: { series: 4, repeticiones: 10, descansoSeg: 90 },
  resistencia: { series: 3, repeticiones: 15, descansoSeg: 45 },
  movilidad: { series: 2, repeticiones: 12, descansoSeg: 30 },
  'fuerza y bienestar': { series: 4, repeticiones: 6, descansoSeg: 120 },
};

/**
 * SIMULACIÓN del servicio de IA (sin GEMINI_API_KEY), como prevé el TFI
 * para el prototipo: arma una rutina determinística con reglas simples
 * repartiendo grupos musculares por día. No reemplaza a la integración real.
 */
export class ServicioIASimulado implements ServicioIA {
  readonly descripcion = 'simulación local (sin API de IA)';

  async generarRutina(preferencias: PreferenciasRutina, catalogo: EjercicioCatalogo[]): Promise<RutinaGenerada> {
    const carga = CARGAS[preferencias.objetivo.toLowerCase()] ?? CARGAS.hipertrofia;
    const factorNivel = preferencias.nivel.toLowerCase().startsWith('princ') ? -1 : preferencias.nivel.toLowerCase().startsWith('avan') ? 1 : 0;
    const disponibles = catalogo.filter((e) => e.disponible);
    const grupos = [...new Set(disponibles.map((e) => e.grupoMuscular))];
    const ejercicios: RutinaGenerada['ejercicios'] = [];
    for (let dia = 1; dia <= preferencias.diasPorSemana; dia++) {
      // Cada día rota los grupos musculares para distribuir el trabajo.
      const gruposDia = grupos.filter((_, i) => i % preferencias.diasPorSemana === (dia - 1) % preferencias.diasPorSemana);
      const elegidos = disponibles.filter((e) => (gruposDia.length ? gruposDia : grupos).includes(e.grupoMuscular)).slice(0, 5);
      const lista = elegidos.length >= 3 ? elegidos : disponibles.slice((dia - 1) * 4, (dia - 1) * 4 + 5);
      lista.forEach((e, i) =>
        ejercicios.push({
          ejercicioId: e.id,
          dia,
          orden: i + 1,
          series: Math.max(2, carga.series + factorNivel),
          repeticiones: carga.repeticiones,
          pesoKg: null,
          descansoSeg: carga.descansoSeg,
        }),
      );
    }
    return validarRutinaGenerada({ ejercicios }, preferencias, catalogo);
  }

  async sugerirVariante(actual: EjercicioCatalogo, _objetivo: string, catalogo: EjercicioCatalogo[]): Promise<VarianteSugerida> {
    const variante = catalogo.find((e) => e.disponible && e.id !== actual.id && e.grupoMuscular === actual.grupoMuscular);
    return variante
      ? { ejercicioId: variante.id, fundamento: `Trabaja el mismo grupo muscular (${actual.grupoMuscular}) con equipamiento disponible.` }
      : { ejercicioId: null, fundamento: 'No hay otra variante disponible para ese grupo muscular.' };
  }
}
