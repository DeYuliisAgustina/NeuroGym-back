import { ErrorServicioIA, ServicioIAGemini, type EjercicioCatalogo } from '../../src/integrations/ia';

const respuesta = (status: number, cuerpo: object) => ({ ok: status < 300, status, json: async () => cuerpo }) as Response;
const conTexto = (texto: string) => respuesta(200, { candidates: [{ content: { parts: [{ text: texto }] } }] });

const catalogo: EjercicioCatalogo[] = [
  { id: 1, nombre: 'Sentadilla', grupoMuscular: 'Piernas', disponible: true },
  { id: 2, nombre: 'Prensa', grupoMuscular: 'Piernas', disponible: true },
  { id: 3, nombre: 'Press banca', grupoMuscular: 'Pecho', disponible: true },
  { id: 4, nombre: 'Remo', grupoMuscular: 'Espalda', disponible: true },
  { id: 5, nombre: 'Prensa 45°', grupoMuscular: 'Piernas', disponible: false },
] as EjercicioCatalogo[];

describe('Servicio de IA con Gemini (Google AI Studio)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pide la variante con salida JSON restringida al esquema y la clave en el encabezado', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(conTexto(JSON.stringify({ ejercicioId: 2, fundamento: 'Mismo grupo muscular.' })));
    const variante = await new ServicioIAGemini().sugerirVariante(catalogo[0], 'Hipertrofia', catalogo);
    expect(variante).toEqual({ ejercicioId: 2, fundamento: 'Mismo grupo muscular.' });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
    expect(String(url)).not.toContain('key=');
    expect(init?.headers).toHaveProperty('x-goog-api-key');
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo.generationConfig.responseMimeType).toBe('application/json');
    expect(cuerpo.generationConfig.responseJsonSchema.required).toEqual(['ejercicioId', 'fundamento']);
    // Solo se envía el catálogo disponible, sin el ejercicio actual ni datos personales.
    expect(cuerpo.contents[0].parts[0].text).not.toContain('Prensa 45°');
  });

  it('si el modelo principal está saturado (503) usa el modelo de respaldo', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respuesta(503, {}))
      .mockResolvedValueOnce(conTexto(JSON.stringify({ ejercicioId: 2, fundamento: 'Mismo grupo muscular.' })));
    expect((await new ServicioIAGemini().sugerirVariante(catalogo[0], 'Hipertrofia', catalogo)).ejercicioId).toBe(2);
    expect(String(fetch.mock.calls[0][0])).not.toBe(String(fetch.mock.calls[1][0]));
  });

  it('rechaza una variante fuera del catálogo disponible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(conTexto(JSON.stringify({ ejercicioId: 5, fundamento: 'x' })));
    await expect(new ServicioIAGemini().sugerirVariante(catalogo[0], 'Hipertrofia', catalogo)).rejects.toBeInstanceOf(ErrorServicioIA);
  });

  it('una respuesta que no cumple el esquema o un error HTTP se informan como ErrorServicioIA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(conTexto('no es JSON'));
    await expect(new ServicioIAGemini().sugerirVariante(catalogo[0], 'Hipertrofia', catalogo)).rejects.toThrow('respuesta válida');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respuesta(429, {}));
    await expect(new ServicioIAGemini().sugerirVariante(catalogo[0], 'Hipertrofia', catalogo)).rejects.toThrow('(429)');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sin red'));
    await expect(new ServicioIAGemini().sugerirVariante(catalogo[0], 'Hipertrofia', catalogo)).rejects.toThrow('no respondió');
  });
});
