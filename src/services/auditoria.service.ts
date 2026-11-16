import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';

/** Registra operaciones relevantes para la trazabilidad (tabla auditoria). */
export async function registrarAuditoria(
  datos: {
    gimnasioId?: number | null;
    usuarioId?: number | null;
    accion: string;
    entidad: string;
    entidadId?: number | null;
    detalle?: Prisma.InputJsonValue;
  },
  tx: Tx | typeof prisma = prisma,
) {
  await tx.auditoria.create({ data: datos });
}
