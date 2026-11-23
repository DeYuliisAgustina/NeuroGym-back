import { z } from 'zod';
import { CODIGOS_MODULO } from '../models/modulos';
import { emailSchema } from './auth.validation';
import { booleanoQuery, fechaSchema, horaSchema, idSchema, importeSchema, nombrePersonaSchema, telefonoSchema, textoSchema } from './comunes.validation';

export const politicasSchema = z
  .object({
    toleranciaAntesMin: z.number().int().min(0).max(240),
    toleranciaDespuesMin: z.number().int().min(0).max(240),
    politicaCuotaPendiente: z.enum(['BLOQUEAR', 'AUTORIZAR']),
  })
  .partial();

export const sedeSchema = z.object({
  nombre: textoSchema(100),
  direccion: textoSchema(200),
  horarios: textoSchema(200),
});

export const habilitacionSchema = z.object({ habilitada: z.boolean() });
export const estadoSchema = z.object({ activo: z.boolean() });
/** RF2: el personal confirma (alta) o rechaza el pre-registro de un socio. */
export const altaSocioSchema = z.object({ aprobar: z.boolean() });

const permisoSchema = z.object({ modulo: z.enum(CODIGOS_MODULO as [string, ...string[]]), acceso: z.enum(['CONSULTA', 'GESTION']) });

export const rolSchema = z.object({
  nombre: textoSchema(100),
  permisos: z.array(permisoSchema).min(1, 'Asigná al menos un permiso'),
});

export const personalSchema = z.object({
  email: emailSchema,
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  rolId: idSchema,
});

export const actualizarPersonalSchema = personalSchema.omit({ email: true }).partial();

export const precioSchema = z.object({
  importeNuevo: importeSchema,
  vigenteDesde: fechaSchema.optional(),
  motivo: textoSchema(255),
});

export const socioSchema = z.object({
  email: emailSchema,
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  telefono: telefonoSchema,
  sedeId: idSchema,
  plan: z.enum(['BASICO', 'PREMIUM']),
  consentimientoDatos: z.literal(true, { message: 'Se requiere el consentimiento para el tratamiento de datos' }),
});

export const actualizarSocioSchema = socioSchema.pick({ nombre: true, apellido: true, telefono: true, sedeId: true, plan: true }).partial();

export const filtroSociosSchema = z.object({
  sedeId: idSchema.optional(),
  plan: z.enum(['BASICO', 'PREMIUM']).optional(),
  activo: booleanoQuery,
  pendiente: booleanoQuery,
  busqueda: z.string().trim().max(100).optional(),
});

export const turnoSchema = z.object({
  sedeId: idSchema,
  actividad: textoSchema(100),
  fecha: fechaSchema,
  horaInicio: horaSchema,
  horaFin: horaSchema,
  cupo: z.number().int().positive().max(500),
});

export const serieTurnosSchema = turnoSchema.omit({ fecha: true }).extend({
  desde: fechaSchema,
  hasta: fechaSchema,
  diasSemana: z.array(z.number().int().min(1).max(7)).min(1),
});

export const actualizarTurnoSchema = turnoSchema.omit({ sedeId: true }).partial();

export const filtroTurnosSchema = z.object({ sedeId: idSchema.optional(), desde: fechaSchema.optional(), hasta: fechaSchema.optional() });
