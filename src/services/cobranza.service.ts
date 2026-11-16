import type { EstadoCuota, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { aNumero } from '../utils/dinero';
import { ahoraLocal } from '../utils/fechas';

/** Consulta de cuotas y pagos del gimnasio para el personal de cobros. */
export const cobranzaService = {
  listarCuotas(gimnasioId: number, filtros: { sedeId?: number; estado?: EstadoCuota; periodo?: string; busqueda?: string }) {
    const where: Prisma.CuotaWhereInput = {
      socio: {
        sede: { gimnasioId },
        ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
        ...(filtros.busqueda
          ? {
              usuario: {
                OR: [
                  { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
                  { apellido: { contains: filtros.busqueda, mode: 'insensitive' } },
                  { email: { contains: filtros.busqueda, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      ...(filtros.estado ? { estado: filtros.estado } : {}),
      ...(filtros.periodo ? { periodo: filtros.periodo } : {}),
    };
    return prisma.cuota.findMany({
      where,
      include: {
        socio: { include: { usuario: { select: { nombre: true, apellido: true, email: true } }, sede: { select: { nombre: true } } } },
        pagos: { include: { comprobante: true, responsable: { include: { usuario: { select: { nombre: true, apellido: true } } } } } },
      },
      orderBy: [{ periodo: 'desc' }, { socio: { usuario: { apellido: 'asc' } } }],
      take: 500,
    });
  },

  /** Indicadores de pagos del período (dashboard administrativo). */
  async resumenPeriodo(gimnasioId: number, periodo = ahoraLocal().fecha.slice(0, 7)) {
    const cuotas = await prisma.cuota.groupBy({
      by: ['estado'],
      where: { periodo, socio: { sede: { gimnasioId } } },
      _count: true,
      _sum: { importeFinal: true },
    });
    const pagos = await prisma.pago.groupBy({
      by: ['medio'],
      where: { estado: 'APROBADO', cuota: { periodo, socio: { sede: { gimnasioId } } } },
      _count: true,
      _sum: { importe: true },
    });
    return {
      periodo,
      cuotas: cuotas.map((c) => ({ estado: c.estado, cantidad: c._count, importe: aNumero(c._sum.importeFinal) })),
      pagosPorMedio: pagos.map((p) => ({ medio: p.medio, cantidad: p._count, importe: aNumero(p._sum.importe) })),
    };
  },
};
