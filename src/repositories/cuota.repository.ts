import type { MedioPago, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';

type Cliente = Tx | typeof prisma;

const incluirSocio = {
  socio: { include: { usuario: true, plan: true, sede: { select: { gimnasioId: true, nombre: true } } } },
} satisfies Prisma.CuotaInclude;

/** Acceso a datos de cuotas, pagos, adhesiones y comprobantes. */
export const cuotaRepository = {
  /** Cuota a regularizar: la impaga/pendiente más antigua; si no hay, la más reciente. */
  async cuotaActual(socioId: number, cliente: Cliente = prisma) {
    const pendiente = await cliente.cuota.findFirst({
      where: { socioId, estado: { in: ['PENDIENTE', 'IMPAGA'] } },
      orderBy: { periodo: 'asc' },
    });
    return pendiente ?? cliente.cuota.findFirst({ where: { socioId }, orderBy: { periodo: 'desc' } });
  },

  buscarConSocio(cuotaId: number, cliente: Cliente = prisma) {
    return cliente.cuota.findUnique({ where: { id: cuotaId }, include: incluirSocio });
  },

  /** Bloquea la fila de la cuota durante la transacción (evita confirmar dos pagos a la vez). */
  async bloquear(cuotaId: number, tx: Tx) {
    await tx.$queryRaw`SELECT cuota_id FROM cuota WHERE cuota_id = ${cuotaId} FOR UPDATE`;
  },

  adhesionActiva(socioId: number, cliente: Cliente = prisma) {
    return cliente.adhesionDebito.findFirst({ where: { socioId, estado: 'ACTIVA' } });
  },

  adhesionPorPreaprobacion(idPreaprobacion: string, cliente: Cliente = prisma) {
    return cliente.adhesionDebito.findUnique({ where: { idPreaprobacion } });
  },

  pagoPorReferencia(referenciaExterna: string, cliente: Cliente = prisma) {
    return cliente.pago.findUnique({ where: { referenciaExterna } });
  },

  listarPagos(socioId: number, filtros: { medio?: MedioPago; desde?: Date; hasta?: Date; periodo?: string; referencia?: string }) {
    return prisma.pago.findMany({
      where: {
        cuota: { socioId, ...(filtros.periodo ? { periodo: filtros.periodo } : {}) },
        ...(filtros.medio ? { medio: filtros.medio } : {}),
        ...(filtros.desde || filtros.hasta ? { fecha: { gte: filtros.desde, lte: filtros.hasta } } : {}),
        ...(filtros.referencia
          ? { OR: [{ referenciaExterna: { contains: filtros.referencia } }, { comprobante: { numero: { contains: filtros.referencia } } }] }
          : {}),
      },
      include: { cuota: true, comprobante: true },
      orderBy: { fecha: 'desc' },
    });
  },

  comprobanteDePago(pagoId: number) {
    return prisma.pago.findUnique({
      where: { id: pagoId },
      include: { comprobante: true, cuota: { include: incluirSocio } },
    });
  },
};
