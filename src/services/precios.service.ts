import type { TipoPlanSocio } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import type { PreciosCuota } from '../patterns/strategy';
import { aFechaDb, ahoraLocal } from '../utils/fechas';
import { aNumero, redondear } from '../utils/dinero';

type Cliente = Tx | typeof prisma;

/**
 * RD12: un cambio de precio rige desde su fecha de vigencia y solo para pagos
 * posteriores. El importe vigente en una fecha surge del historial de cambios.
 */
export async function precioVigente(planSocioId: number, fecha = ahoraLocal().fecha, cliente: Cliente = prisma): Promise<number> {
  const dia = aFechaDb(fecha);
  const ultimoAplicado = await cliente.actualizacionPrecio.findFirst({
    where: { planSocioId, vigenteDesde: { lte: dia } },
    orderBy: [{ vigenteDesde: 'desc' }, { fecha: 'desc' }],
  });
  if (ultimoAplicado) return aNumero(ultimoAplicado.importeNuevo);
  // Si solo hay cambios futuros, rige el importe anterior al primero de ellos.
  const primeroFuturo = await cliente.actualizacionPrecio.findFirst({
    where: { planSocioId, vigenteDesde: { gt: dia } },
    orderBy: [{ vigenteDesde: 'asc' }, { fecha: 'asc' }],
  });
  if (primeroFuturo) return aNumero(primeroFuturo.importeAnterior);
  const plan = await cliente.planSocio.findUniqueOrThrow({ where: { id: planSocioId } });
  return aNumero(plan.importeMensual);
}

/** Bonificación Premium vigente del socio en una fecha (RF26), si existe. */
export function bonificacionVigente(socioId: number, fecha = ahoraLocal().fecha, cliente: Cliente = prisma) {
  const dia = aFechaDb(fecha);
  return cliente.bonificacionPremium.findFirst({
    where: { socioId, desde: { lte: dia }, hasta: { gte: dia } },
    orderBy: { porcentaje: 'desc' },
  });
}

/** esPremium() del diagrama de clases: plan Premium contratado o bonificación vigente. */
export async function esPremium(socioId: number, cliente: Cliente = prisma): Promise<boolean> {
  const socio = await cliente.socio.findUniqueOrThrow({ where: { id: socioId }, include: { plan: true } });
  if (socio.plan.tipo === 'PREMIUM') return true;
  return (await bonificacionVigente(socioId, undefined, cliente)) !== null;
}

/**
 * Cuota base (Plan Básico vigente) más el adicional Premium cuando corresponde (RD4, RF31).
 * Una bonificación reduce el adicional de un socio Premium; a un socio Básico
 * le habilita Premium sin sumar cargos (al terminar, sigue con su plan, CU-002-010).
 */
export async function preciosParaSocio(socioId: number, fecha = ahoraLocal().fecha, cliente: Cliente = prisma): Promise<PreciosCuota> {
  const socio = await cliente.socio.findUniqueOrThrow({
    where: { id: socioId },
    include: { plan: true, sede: { select: { gimnasioId: true } } },
  });
  const planes = await cliente.planSocio.findMany({ where: { gimnasioId: socio.sede.gimnasioId } });
  const plan = (tipo: TipoPlanSocio) => planes.find((p) => p.tipo === tipo)!;
  const cuotaBase = await precioVigente(plan('BASICO').id, fecha, cliente);
  let adicionalPremium = 0;
  if (socio.plan.tipo === 'PREMIUM') {
    adicionalPremium = await precioVigente(plan('PREMIUM').id, fecha, cliente);
    const bonificacion = await bonificacionVigente(socioId, fecha, cliente);
    if (bonificacion) adicionalPremium = redondear(adicionalPremium * (1 - aNumero(bonificacion.porcentaje) / 100));
  }
  return { cuotaBase, adicionalPremium };
}
