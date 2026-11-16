import type { z } from 'zod';

/** Valida datos de entrada con un esquema Zod; el error se traduce a HTTP 400. */
export const validar = <T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> => esquema.parse(datos);

/** Identificador numérico tomado de la ruta. */
export function idParam(valor: unknown): number {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('Identificador inválido');
    error.name = 'IdInvalido';
    throw error;
  }
  return id;
}
