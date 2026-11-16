import { z } from 'zod';

/** Preferencias informadas por el socio, sin datos biométricos (RD15). */
export interface PreferenciasRutina {
  objetivo: string;
  nivel: string;
  diasPorSemana: number;
}

/** Ejercicio del catálogo que la IA puede elegir, con su disponibilidad en la sede. */
export interface EjercicioCatalogo {
  id: number;
  nombre: string;
  grupoMuscular: string;
  disponible: boolean;
}

/** Estructura que debe devolver el servicio de IA para una rutina. */
export const rutinaGeneradaSchema = z.object({
  ejercicios: z
    .array(
      z.object({
        ejercicioId: z.number().int(),
        dia: z.number().int().min(1).max(7),
        orden: z.number().int().min(1).max(20),
        series: z.number().int().min(1).max(10),
        repeticiones: z.number().int().min(1).max(100),
        pesoKg: z.number().min(0).max(500).nullable(),
        descansoSeg: z.number().int().min(0).max(600),
      }),
    )
    .min(1),
});
export type RutinaGenerada = z.infer<typeof rutinaGeneradaSchema>;

export const varianteSchema = z.object({
  ejercicioId: z.number().int().nullable(),
  fundamento: z.string(),
});
export type VarianteSugerida = z.infer<typeof varianteSchema>;

/** Error del servicio de IA: CU-003 4.1 y CU-003-007 3.1 conservan la rutina vigente. */
export class ErrorServicioIA extends Error {}

/**
 * Puerto del servicio de IA (RF5, RF7). La IA solo sugiere: no modifica reservas
 * ni detecta fallas del equipamiento (RD11); el socio decide si aplica la variante.
 */
export interface ServicioIA {
  readonly descripcion: string;
  generarRutina(preferencias: PreferenciasRutina, catalogo: EjercicioCatalogo[]): Promise<RutinaGenerada>;
  sugerirVariante(actual: EjercicioCatalogo, objetivo: string, catalogo: EjercicioCatalogo[]): Promise<VarianteSugerida>;
}

/**
 * Comprueba que la respuesta use ejercicios del catálogo disponibles y respete
 * los días indicados; una respuesta inconsistente se trata como inválida.
 */
export function validarRutinaGenerada(rutina: RutinaGenerada, preferencias: PreferenciasRutina, catalogo: EjercicioCatalogo[]): RutinaGenerada {
  const disponibles = new Set(catalogo.filter((e) => e.disponible).map((e) => e.id));
  const ejercicios = rutina.ejercicios.filter((e) => disponibles.has(e.ejercicioId) && e.dia <= preferencias.diasPorSemana);
  const claves = new Set(ejercicios.map((e) => `${e.dia}-${e.orden}`));
  if (ejercicios.length === 0 || claves.size !== ejercicios.length) {
    throw new ErrorServicioIA('El servicio de IA no devolvió una rutina válida');
  }
  return { ejercicios };
}
