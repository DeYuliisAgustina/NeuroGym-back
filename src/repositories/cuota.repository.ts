import type { EstadoAdhesion, EstadoPago, MedioPago, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { preciosParaSocio } from '../services/precios.service';

type Cliente = Tx | typeof prisma;

const incluirSocio = {
  socio: { include: { usuario: true, plan: true, sede: { select: { gimnasioId: true, nombre: true } } } },
} satisfies Prisma.CuotaInclude;

/**
 * CuotaRepository: acceso a datos de cuotas, pagos, adhesiones y comprobantes.
 * Los nombres de las operaciones son los de los diagramas de secuencia de CU-001.
 */
export const cuotaRepository = {
  /**
   * Cuota del período indicado ('AAAA-MM'); si todavía no existe, la más reciente.
   * Un pago siempre se imputa a la cuota que se eligió, nunca a la deuda más antigua.
   */
  async buscarCuotaDelPeriodo(socioId: number, periodo: string, cliente: Cliente = prisma) {
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
    // Solo el período en curso: al terminar el mes deja de estar programada aunque el cobro no llegue.
    if (cuota.estado === 'PAGADA' || cuota.periodo !== periodoActual) return false;
    const adhesion = await cliente.adhesionDebito.findFirst({ where: { socioId: cuota.socioId, estado: 'ACTIVA' } });
    if (!adhesion || cuota.periodo < adhesion.fechaAlta.toISOString().slice(0, 7)) return false;
    if (await this.adhesionPausada(adhesion.id, cliente)) return false;
    return !(await cliente.pago.findFirst({ where: { cuotaId: cuota.id, medio: 'DEBITO_AUTOMATICO', estado: 'RECHAZADO' } }));
  },

  /**
   * Suscripción pausada en Mercado Pago. El diccionario de datos solo admite
   * ACTIVA/CANCELADA para la adhesión: la pausa se registra en auditoría y vale el
   * último evento (pausada o reanudada) de la adhesión.
   */
  async adhesionPausada(adhesionId: number, cliente: Cliente = prisma) {
    const ultimo = await cliente.auditoria.findFirst({
      where: { entidad: 'adhesion_debito', entidadId: adhesionId, accion: { in: ['ADHESION_PAUSADA_EN_MERCADO_PAGO', 'ADHESION_REANUDADA_EN_MERCADO_PAGO'] } },
      orderBy: { id: 'desc' },
    });
    return ultimo?.accion === 'ADHESION_PAUSADA_EN_MERCADO_PAGO';
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

  /** CU-001-008: pagos del socio con sus filtros. */
  buscarPagos(socioId: number, filtros: { medio?: MedioPago; desde?: Date; hasta?: Date; periodo?: string; referencia?: string }) {
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

  /** CU-001-009: comprobante de un pago con la cuota y el socio. */
  buscarComprobante(pagoId: number) {
    return prisma.pago.findUnique({
      where: { id: pagoId },
      include: { comprobante: true, cuota: { include: incluirSocio } },
    });
  },

  /** Precios vigentes del plan del socio (cuota base y adicional Premium) a una fecha (RD12). */
  obtenerPreciosVigentes(socioId: number, fecha?: string, cliente: Cliente = prisma) {
    return preciosParaSocio(socioId, fecha, cliente);
  },

  /** CU-001-006: guarda el resultado informado por Mercado Pago sobre un pago existente. */
  guardarResultado(pagoId: number, datos: { estado?: EstadoPago; referenciaExterna?: string; importe?: number }, tx: Tx) {
    return tx.pago.update({ where: { id: pagoId }, data: datos });
  },

  /** CU-001-006: registra un débito informado por Mercado Pago (aprobado o rechazado). */
  guardarDebito(datos: { cuotaId: number; adhesionId: number; importe: number; estado: EstadoPago; referenciaExterna: string }, tx: Tx) {
    return tx.pago.create({ data: { ...datos, medio: 'DEBITO_AUTOMATICO' } });
  },

  /** CU-001-007: actualiza el estado de la cuota (y, al pagarse, su composición final). */
  actualizarCuota(
    cuotaId: number,
    datos: { estado: 'PAGADA' | 'IMPAGA'; cuotaBase?: number; adicionalPremium?: number; descuento?: number; importeFinal?: number },
    tx: Tx,
  ) {
    return tx.cuota.update({ where: { id: cuotaId }, data: datos });
  },

  /** CU-001-007: emite el comprobante del pago aprobado. */
  guardarComprobante(pagoId: number, numero: string, tx: Tx) {
    return tx.comprobante.create({ data: { pagoId, numero } });
  },

  /** CU-001-004: alta de la adhesión al débito automático. */
  guardarAdhesion(datos: { socioId: number; idPreaprobacion: string; fechaAlta: Date }, tx: Tx) {
    return tx.adhesionDebito.create({ data: { ...datos, estado: 'ACTIVA' } });
  },

  /** CU-001-010: actualiza el estado de la adhesión (baja con su fecha). */
  actualizarAdhesion(adhesionId: number, datos: { estado: EstadoAdhesion; fechaBaja?: Date }, tx: Tx) {
    return tx.adhesionDebito.update({ where: { id: adhesionId }, data: datos });
  },
};
