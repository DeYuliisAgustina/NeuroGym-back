import { Prisma } from '@prisma/client';

/** Redondeo a centavos para importes en ARS (NUMERIC(12,2)). */
export const redondear = (valor: number) => Math.round(valor * 100) / 100;

export const aNumero = (valor: Prisma.Decimal | number | string | null | undefined) =>
  valor === null || valor === undefined ? 0 : Number(valor);
