import type { MedioPago } from '@prisma/client';
import type { Tx } from '../../config/prisma';

/** Precios vigentes que componen la cuota de un socio (RF31). */
export interface PreciosCuota {
  cuotaBase: number;
  adicionalPremium: number;
}

/** Composición del importe según la modalidad de cobro. */
export interface ComposicionImporte extends PreciosCuota {
  medio: MedioPago;
  descuento: number;
  importeFinal: number;
}

/** Datos de la cuota que se va a cobrar. */
export interface CuotaACobrar {
  id: number;
  periodo: string;
  socioId: number;
  precios: PreciosCuota;
}

/** Contexto de la operación: transacción, socio y, si corresponde, personal responsable. */
export interface ContextoCobro {
  tx: Tx;
  socio: { id: number; email: string; nombre: string };
  responsableId?: number;
  adhesionActivaId?: number | null;
  /** Débito: inicio de la suscripción cuando la cuota del período ya está pagada (sin cobro inmediato). */
  inicioDebito?: Date;
}

/** Resultado de iniciar o registrar un cobro. */
export type ResultadoCobro =
  | { tipo: 'REDIRECCION'; pagoId?: number; url: string; composicion: ComposicionImporte }
  | { tipo: 'DEBITO_PROGRAMADO'; composicion: ComposicionImporte }
  | { tipo: 'REGISTRADO'; pagoId: number; composicion: ComposicionImporte };

/**
 * Patrón Strategy (comportamiento) — estrategia.
 * Cada modalidad de cobro de cuotas calcula su importe y ejecuta su cobro
 * sin que la fachada CuotaService dependa de la modalidad concreta.
 */
export interface EstrategiaCobro {
  readonly medio: MedioPago;
  calcularImporte(precios: PreciosCuota): ComposicionImporte;
  cobrar(cuota: CuotaACobrar, contexto: ContextoCobro): Promise<ResultadoCobro>;
}
