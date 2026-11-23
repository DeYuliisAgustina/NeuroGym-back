import { z } from 'zod';
import { emailRegistroSchema, passwordSchema } from './auth.validation';
import { booleanoQuery, fechaSchema, horaSchema, idSchema, importeSchema, nombrePersonaSchema, textoSchema } from './comunes.validation';
import { NIVELES, OBJETIVOS } from '../services/rutina.service';

// ---------------- Equipamiento ----------------
export const equipoSchema = z.object({
  sedeId: idSchema,
  nombre: textoSchema(100),
  categoria: textoSchema(50),
  fechaCompra: fechaSchema.nullable().optional(),
  vidaUtilAnios: z.number().int().positive().max(50).nullable().optional(),
  proximoService: fechaSchema.nullable().optional(),
});
export const actualizarEquipoSchema = equipoSchema.omit({ sedeId: true }).partial();
export const disponibilidadEquipoSchema = z.object({ estado: z.enum(['OPERATIVO', 'FUERA_DE_SERVICIO', 'SERVICE_PROGRAMADO']) });
export const bajaEquipoSchema = z.object({ fechaBaja: fechaSchema.optional(), motivo: textoSchema(255) });
export const ejerciciosEquipoSchema = z.object({ ejercicioIds: z.array(idSchema).max(50) });
export const filtroEquiposSchema = z.object({
  sedeId: idSchema.optional(),
  estado: z.enum(['OPERATIVO', 'FUERA_DE_SERVICIO', 'SERVICE_PROGRAMADO', 'DADO_DE_BAJA']).optional(),
  incluirBajas: booleanoQuery,
});
export const incidenciaSchema = z.object({ equipoId: idSchema, descripcion: textoSchema(2000) });
export const gestionIncidenciaSchema = z
  .object({ estado: z.enum(['REPORTADA', 'EN_GESTION', 'RESUELTA']).optional(), prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA']).optional() })
  .refine((d) => d.estado || d.prioridad, 'Indicá el estado o la prioridad');
export const agruparSchema = z.object({ principalId: idSchema });
export const filtroIncidenciasSchema = z.object({
  sedeId: idSchema.optional(),
  equipoId: idSchema.optional(),
  estado: z.enum(['REPORTADA', 'EN_GESTION', 'RESUELTA']).optional(),
});
export const mantenimientoSchema = z.object({
  equipoId: idSchema,
  tipo: z.enum(['PREVENTIVO', 'CORRECTIVO']),
  inicioProgramado: z.string().datetime({ offset: true }),
  finProgramado: z.string().datetime({ offset: true }),
  intervencionPrevista: z.string().trim().max(2000).optional(),
});
export const mantenimientoRealizadoSchema = z.object({
  fechaRealizada: z.string().datetime({ offset: true }).optional(),
  detalleRealizado: textoSchema(2000),
  proximoService: fechaSchema.optional(),
});

// ---------------- Entrenamiento (CU-003) ----------------
export const preferenciasSchema = z.object({
  objetivo: z.enum(OBJETIVOS),
  nivel: z.enum(NIVELES),
  diasPorSemana: z.number().int().min(1).max(7),
  // Lista cerrada de zonas a evitar (preferencia, no dato de salud); no se guarda.
  evitar: z.array(z.enum(['ESPALDA_BAJA', 'RODILLAS', 'HOMBROS', 'MUNECAS', 'IMPACTO'])).max(5).optional(),
});
// CU-003-003 5.1: "Revisá el nombre, las series, las repeticiones y el peso."
export const edicionEjercicioSchema = z.object({
  ejercicioId: idSchema.optional(),
  nombreEjercicio: z.string().trim().min(1).max(100).optional(),
  series: z.number().int().min(1).max(10).optional(),
  repeticiones: z.number().int().min(1).max(100).optional(),
  pesoKg: z.number().min(0).max(500).nullable().optional(),
  descansoSeg: z.number().int().min(0).max(600).nullable().optional(),
});
/** PUT /api/ejercicios/{id} { variante } — CU-003-008. */
export const aplicarVarianteSchema = z.object({ variante: idSchema });
export const entrenamientoSchema = z.object({ dia: z.number().int().min(1).max(7), realizados: z.array(idSchema).max(30) });

// ---------------- Retención (CU-002) ----------------
export const filtroRetencionSchema = z.object({
  sedeId: idSchema.optional(),
  plan: z.enum(['BASICO', 'PREMIUM']).optional(),
  estadoCuota: z.enum(['PENDIENTE', 'PAGADA', 'IMPAGA']).optional(),
  nivel: z.enum(['ALTO', 'MEDIO', 'BAJO']).optional(),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  busqueda: z.string().trim().max(100).optional(),
});
export const propuestaSchema = z.object({
  socioId: idSchema,
  senalId: idSchema.optional(),
  incentivo: textoSchema(100),
  mensaje: textoSchema(2000),
  premiumDias: z.number().int().min(1).max(90).optional(),
  premiumPorcentaje: z.number().min(1).max(100).optional(),
});
export const decisionSchema = z.object({
  estimacionId: idSchema,
  decision: z.enum(['MANTENER_EN_OBSERVACION', 'PREPARAR_PROPUESTA']),
  motivo: textoSchema(255),
  incentivo: z.string().trim().max(100).optional(),
  mensaje: z.string().trim().max(2000).optional(),
  premiumDias: z.number().int().min(1).max(90).optional(),
});
export const beneficioSchema = z.object({
  nombre: textoSchema(100),
  descripcion: textoSchema(255),
  costoPuntos: z.number().int().positive(),
  vigenciaDias: z.number().int().positive().max(365),
  disponible: z.boolean().optional(),
});

// ---------------- Marketplace ----------------
export const registroProfesionalSchema = z.object({
  email: emailRegistroSchema,
  password: passwordSchema,
  nombre: nombrePersonaSchema,
  apellido: nombrePersonaSchema,
  especialidad: z.enum(['NUTRICION', 'DEPORTOLOGIA']),
  modalidadAtencion: z.enum(['ONLINE', 'PRESENCIAL', 'ONLINE_Y_PRESENCIAL']),
  valorConsulta: importeSchema,
  plan: z.enum(['BASICO', 'PROFESIONAL']),
  consentimientoDatos: z.literal(true, { message: 'Se requiere el consentimiento para el tratamiento de datos' }),
  codigoReferido: z.string().trim().max(30).optional(),
});
export const perfilProfesionalSchema = z
  .object({
    nombre: nombrePersonaSchema,
    apellido: nombrePersonaSchema,
    modalidadAtencion: z.enum(['ONLINE', 'PRESENCIAL', 'ONLINE_Y_PRESENCIAL']),
    valorConsulta: importeSchema,
    publicacionPausada: z.boolean(),
  })
  .partial();
export const servicioSchema = z.object({ nombre: textoSchema(100), descripcion: textoSchema(2000), visible: z.boolean().optional() });
export const disponibilidadSchema = z.object({
  diaSemana: z.enum(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']),
  horaInicio: horaSchema,
  horaFin: horaSchema,
  duracionConsultaMin: z.number().int().min(15).max(180).optional(),
});
export const metodoPagoSchema = z.object({
  tipo: z.enum(['OBRA_SOCIAL', 'PARTICULAR', 'ACUERDO_CONSULTA']),
  obraSocial: z.string().trim().max(100).optional(),
});
export const solicitudTurnoSchema = z.object({
  profesionalId: idSchema,
  metodoPagoId: idSchema,
  fecha: fechaSchema,
  horaInicio: horaSchema,
  modalidad: z.enum(['ONLINE', 'PRESENCIAL']),
});
export const motivoSchema = z.object({ motivo: textoSchema(255) });
export const reprogramacionSchema = z.object({ fecha: fechaSchema, horaInicio: horaSchema });
export const completarSchema = z.object({ importeDeclarado: importeSchema.refine((v) => v > 0, 'El importe debe ser mayor que cero') });
export const filtroProfesionalesSchema = z.object({
  especialidad: z.enum(['NUTRICION', 'DEPORTOLOGIA']).optional(),
  modalidad: z.enum(['ONLINE', 'PRESENCIAL', 'ONLINE_Y_PRESENCIAL']).optional(),
});
