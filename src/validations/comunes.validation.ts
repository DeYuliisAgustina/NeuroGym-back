import { z } from 'zod';

export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha AAAA-MM-DD');
export const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato de hora HH:MM');
export const periodoSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato de período AAAA-MM');
export const idSchema = z.coerce.number().int().positive();
export const textoSchema = (max: number) => z.string().trim().min(1, 'Campo obligatorio').max(max);
export const telefonoSchema = z.string().trim().regex(/^[+\d\s()-]{8,30}$/, 'Usá solo números, espacios, + o guiones (mínimo 8)');
/** Nombre o apellido de una persona: solo letras (con tildes), espacios, apóstrofo y guion. */
export const nombrePersonaSchema = z
  .string()
  .trim()
  .min(2, 'Escribí al menos 2 letras')
  .max(100)
  .regex(/^\p{L}[\p{L}\s'’.-]*$/u, 'Usá solo letras, sin números ni símbolos');
export const importeSchema = z.coerce.number().nonnegative().max(9_999_999_999).multipleOf(0.01);
export const booleanoQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
