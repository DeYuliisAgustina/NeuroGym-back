import { z } from 'zod';
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

const URL_API = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Integración con la API de Gemini (Google AI Studio) por REST, con salida JSON
 * restringida al esquema Zod y validada otra vez al recibirla. Requiere GEMINI_API_KEY.
 * La IA solo sugiere: la respuesta se valida contra el catálogo disponible.
 */
export class ServicioIAGemini implements ServicioIA {
  readonly descripcion = `Gemini (${env.ia.geminiModelo})`;

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

  /** Prueba el modelo principal y, si está saturado o sin cupo, los de respaldo. */
  private async consultar<S extends z.ZodType>(pedido: string, esquema: S): Promise<z.infer<S>> {
    const modelos = [env.ia.geminiModelo, ...env.ia.geminiModelosRespaldo.filter((m) => m !== env.ia.geminiModelo)];
    for (const [i, modelo] of modelos.entries()) {
      try {
        return await this.consultarModelo(modelo, pedido, esquema);
      } catch (error) {
        const reintentable = error instanceof ErrorServicioIA && /\((429|500|503|504)\)|no respondió$/.test(error.message);
        if (!reintentable || i === modelos.length - 1) throw error;
      }
    }
    throw new ErrorServicioIA('El servicio de IA no respondió');
  }

  private async consultarModelo<S extends z.ZodType>(modelo: string, pedido: string, esquema: S): Promise<z.infer<S>> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${URL_API}/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST',
        // La clave va en un encabezado, nunca en la URL (no queda en registros).
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.ia.geminiApiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SISTEMA }] },
          contents: [{ role: 'user', parts: [{ text: pedido }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: z.toJSONSchema(esquema, { target: 'draft-7' }),
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ErrorServicioIA('El servicio de IA no respondió');
    }
    if (!respuesta.ok) throw new ErrorServicioIA(`El servicio de IA no respondió (${respuesta.status})`);

    const cuerpo = (await respuesta.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const texto = cuerpo?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return esquema.parse(JSON.parse(texto)) as z.infer<S>;
    } catch {
      throw new ErrorServicioIA('El servicio de IA no devolvió una respuesta válida');
    }
  }
}
