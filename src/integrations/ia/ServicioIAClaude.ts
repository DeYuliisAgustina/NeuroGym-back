import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { env } from '../../config/env';
import {
  ErrorServicioIA,
  indicacionZonasEvitar,
  rutinaGeneradaSchema,
  validarRutinaGenerada,
  varianteSchema,
  type EjercicioCatalogo,
  type PreferenciasRutina,
  type RutinaGenerada,
  type ServicioIA,
  type VarianteSugerida,
} from './ServicioIA';

const SISTEMA = `Sos un asistente de entrenamiento de gimnasio. Armás rutinas seguras y progresivas
eligiendo SOLO ejercicios del catálogo recibido (por su id) que figuren como disponibles.
No pedís ni usás datos biométricos ni de salud. Respondé únicamente con el JSON solicitado.`;

/**
 * Integración con la API de Claude (Anthropic) mediante el SDK oficial y
 * salidas estructuradas validadas con Zod. Requiere ANTHROPIC_API_KEY.
 */
export class ServicioIAClaude implements ServicioIA {
  readonly descripcion = `Claude (${env.ia.modelo})`;
  private readonly cliente = new Anthropic({ apiKey: env.ia.anthropicApiKey, timeout: 60_000, maxRetries: 2 });

  async generarRutina(preferencias: PreferenciasRutina, catalogo: EjercicioCatalogo[]): Promise<RutinaGenerada> {
    const disponibles = catalogo.filter((e) => e.disponible).map(({ id, nombre, grupoMuscular }) => ({ id, nombre, grupoMuscular }));
    const pedido =
      `Objetivo: ${preferencias.objetivo}. Experiencia: ${preferencias.nivel}. Días por semana: ${preferencias.diasPorSemana}.\n` +
      `Armá una rutina con 4 a 7 ejercicios por día, usando días 1 a ${preferencias.diasPorSemana}, ` +
      `orden consecutivo desde 1 en cada día, series, repeticiones, peso sugerido en kg (null si es con peso corporal) y descanso en segundos.\n` +
      `Catálogo disponible: ${JSON.stringify(disponibles)}` +
      indicacionZonasEvitar(preferencias.evitar);
    const respuesta = await this.consultar(pedido, rutinaGeneradaSchema);
    return validarRutinaGenerada(respuesta, preferencias, catalogo);
  }

  async sugerirVariante(actual: EjercicioCatalogo, objetivo: string, catalogo: EjercicioCatalogo[]): Promise<VarianteSugerida> {
    const opciones = catalogo.filter((e) => e.disponible && e.id !== actual.id).map(({ id, nombre, grupoMuscular }) => ({ id, nombre, grupoMuscular }));
    const pedido =
      `El ejercicio "${actual.nombre}" (grupo ${actual.grupoMuscular}) no puede hacerse porque su equipo no está disponible. ` +
      `Objetivo del socio: ${objetivo}. Elegí UNA variante del catálogo que trabaje el mismo grupo muscular ` +
      `y explicá brevemente por qué. Si ninguna sirve, devolvé ejercicioId null.\nCatálogo: ${JSON.stringify(opciones)}`;
    const variante = await this.consultar(pedido, varianteSchema);
    if (variante.ejercicioId !== null && !opciones.some((o) => o.id === variante.ejercicioId)) {
      throw new ErrorServicioIA('La variante sugerida no pertenece al catálogo disponible');
    }
    return variante;
  }

  private async consultar<S extends z.ZodType>(pedido: string, esquema: S): Promise<z.infer<S>> {
    try {
      const respuesta = await this.cliente.messages.parse({
        model: env.ia.modelo,
        max_tokens: 16000,
        system: SISTEMA,
        output_config: { effort: 'low', format: zodOutputFormat(esquema) },
        messages: [{ role: 'user', content: pedido }],
      });
      if (respuesta.stop_reason === 'refusal' || !respuesta.parsed_output) {
        throw new ErrorServicioIA('El servicio de IA no devolvió una respuesta válida');
      }
      return respuesta.parsed_output as z.infer<S>;
    } catch (error) {
      if (error instanceof ErrorServicioIA) throw error;
      if (error instanceof Anthropic.APIError) throw new ErrorServicioIA(`El servicio de IA no respondió (${error.status ?? 'sin estado'})`);
      throw new ErrorServicioIA('El servicio de IA no respondió');
    }
  }
}
