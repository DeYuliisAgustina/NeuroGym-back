import { z } from 'zod';
import { fechaSchema, idSchema, periodoSchema, textoSchema } from './comunes.validation';

export const reservaSchema = z.object({ turnoId: idSchema });
export const filtroDisponiblesSchema = z.object({ sedeId: idSchema.optional(), fecha: fechaSchema.optional(), dias: z.coerce.number().int().min(1).max(31).optional() });

/** POST /api/qr/validacion — CU-004-002. */
export const validacionQrSchema = z.object({ codigo: z.string().trim().min(10).max(128) });
/** GET /api/reservas/vigente — CU-004-003. */
export const reservaVigenteSchema = z.object({ socioId: idSchema, sedeId: idSchema });
/** POST /api/asistencias — CU-004-008: reserva vigente y código QR validado. */
export const confirmacionAsistenciaSchema = z.object({ reservaId: idSchema, codigoQrId: idSchema });
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
/** POST /api/operaciones (CU-001): cuota elegida y medio de pago. */
export const operacionSchema = medioPagoSchema.extend({ cuotaId: idSchema });
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
/**
 * Datos del regreso desde Mercado Pago: el id interno del pago único (orden de
 * Checkout Pro) o el preapproval_id de la adhesión al débito automático.
 */
export const retornoMercadoPagoSchema = z
  .object({
    pagoId: idSchema.optional(),
    preapprovalId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  })
  .refine((d) => Boolean(d.pagoId) !== Boolean(d.preapprovalId), 'Indicá pagoId o preapprovalId');
