import { z } from 'zod';
import { correoAceptado, MENSAJE_CORREO_NO_ACEPTADO } from '../utils/correos';
import { idSchema, telefonoSchema, textoSchema } from './comunes.validation';

export const emailSchema = z.string().trim().toLowerCase().email('Correo electrónico inválido').max(150);

// Política mínima: 8 caracteres con letras y números.
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir letras')
  .regex(/\d/, 'La contraseña debe incluir números');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Ingresá la contraseña'),
});

export const cambioPasswordSchema = z.object({
  actual: z.string().min(1),
  nueva: passwordSchema,
});

/** RF2: autorregistro (pre-registro) del socio desde el ingreso público. */
/** Correo del autorregistro: además del formato, debe ser de un proveedor reconocido. */
export const emailRegistroSchema = emailSchema.refine(correoAceptado, MENSAJE_CORREO_NO_ACEPTADO);

export const registroSocioSchema = z.object({
  email: emailRegistroSchema,
  password: passwordSchema,
  nombre: textoSchema(100),
  apellido: textoSchema(100),
  telefono: telefonoSchema,
  sedeId: idSchema,
  consentimientoDatos: z.literal(true, { message: 'Se requiere el consentimiento para el tratamiento de datos' }),
});
