import { z } from 'zod';
import { fechaSchema, idSchema, periodoSchema, textoSchema } from './comunes.validation';

export const reservaSchema = z.object({ turnoId: idSchema });
export const filtroDisponiblesSchema = z.object({ sedeId: idSchema.optional(), fecha: fechaSchema.optional(), dias: z.coerce.number().int().min(1).max(31).optional() });

export const ingresoQrSchema = z.object({ codigo: z.string().trim().min(10).max(128), sedeId: idSchema });
export const autorizacionSchema = z.object({ reservaId: idSchema, codigoQrId: idSchema.optional(), motivo: textoSchema(255) });
export const bloqueoSchema = z.object({ reservaId: idSchema, motivo: z.string().trim().max(255).optional() });
export const asistenciaManualSchema = z.object({
  socioId: idSchema,
  sedeId: idSchema,
  motivo: textoSchema(255),
  fechaHoraReal: z.string().datetime({ offset: true }).optional(),
  autorizacionCuota: z.string().trim().max(255).optional(),
});
export const filtroAsistenciasSchema = z.object({ sedeId: idSchema.optional(), fecha: fechaSchema.optional() });

export const medioPagoSchema = z.object({ medio: z.enum(['PAGO_UNICO', 'DEBITO_AUTOMATICO', 'EFECTIVO']) });
export const filtroPagosSchema = z.object({
  medio: z.enum(['PAGO_UNICO', 'DEBITO_AUTOMATICO', 'EFECTIVO']).optional(),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  periodo: periodoSchema.optional(),
  referencia: z.string().trim().max(100).optional(),
});
export const filtroCuotasSchema = z.object({
  sedeId: idSchema.optional(),
  estado: z.enum(['PENDIENTE', 'PAGADA', 'IMPAGA']).optional(),
  periodo: periodoSchema.optional(),
  busqueda: z.string().trim().max(100).optional(),
});
export const simulacionSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('PAGO'), pagoId: idSchema, aprobar: z.boolean() }),
  z.object({ tipo: z.literal('ADHESION'), socioId: idSchema, aprobar: z.boolean() }),
  z.object({ tipo: z.literal('DEBITO'), socioId: idSchema, aprobar: z.boolean() }),
]);
