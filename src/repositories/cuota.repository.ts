import type { MedioPago, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';

type Cliente = Tx | typeof prisma;

const incluirSocio = {
  socio: { include: { usuario: true, plan: true, sede: { select: { gimnasioId: true, nombre: true } } } },
} satisfies Prisma.CuotaInclude;

/** Acceso a datos de cuotas, pagos, adhesiones y comprobantes. */
export const cuotaRepository = {
  /**
   * Cuota del período indicado ('AAAA-MM'); si todavía no existe, la más reciente.
   * Un pago siempre se imputa a la cuota que se eligió, nunca a la deuda más antigua.
   */
  async cuotaDelPeriodo(socioId: number, periodo: string, cliente: Cliente = prisma) {
    return (
      (await cliente.cuota.findUnique({ where: { socioId_periodo: { socioId, periodo } } })) ??
      cliente.cuota.findFirst({ where: { socioId, periodo: { lte: periodo } }, orderBy: { periodo: 'desc' } })
    );
  },

  /** Cuotas anteriores al período sin pagar: siguen pendientes y se regularizan por separado. */
  cuotasAdeudadas(socioId: number, antesDe: string, cliente: Cliente = prisma) {
    return cliente.cuota.findMany({
      where: { socioId, periodo: { lt: antesDe }, estado: { in: ['PENDIENTE', 'IMPAGA'] } },
      orderBy: { periodo: 'asc' },
    });
  },

  /** Débitos rechazados de una cuota (habilitan los medios alternativos). */
  debitoRechazado(cuotaId: number, cliente: Cliente = prisma) {
    return cliente.pago.findFirst({ where: { cuotaId, medio: 'DEBITO_AUTOMATICO', estado: 'RECHAZADO' } });
  },

  /**
   * «Débito automático programado»: la cuota del período en curso de un socio con
   * adhesión activa (desde el período de alta), sin pagar y sin débito rechazado.
   * Mientras tanto no pasa a IMPAGA ni admite otros medios; conserva su vencimiento.
   */
  async debitoProgramado(cuota: { id: number; socioId: number; periodo: string; estado: string }, periodoActual: string, cliente: Cliente = prisma) {
    if (cuota.estado === 'PAGADA' || cuota.periodo !== periodoActual) return false;
    const adhesion = await cliente.adhesionDebito.findFirst({ where: { socioId: cuota.socioId, estado: 'ACTIVA' } });
    if (!adhesion || cuota.periodo < adhesion.fechaAlta.toISOString().slice(0, 7)) return false;
    return !(await cliente.pago.findFirst({ where: { cuotaId: cuota.id, medio: 'DEBITO_AUTOMATICO', estado: 'RECHAZADO' } }));
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
