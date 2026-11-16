import { reglaNegocio } from '../../utils/errores';
import { redondear } from '../../utils/dinero';
import type {
  ComposicionImporte,
  ContextoCobro,
  CuotaACobrar,
  EstrategiaCobro,
  PreciosCuota,
  ResultadoCobro,
} from './EstrategiaCobro';

/**
 * Patrón Strategy — estrategia concreta.
 * Efectivo en administración: importe completo, sin Mercado Pago. Solo lo
 * registra el personal autorizado (RF19), que queda como responsable (RNF13).
 */
export class CobroEfectivo implements EstrategiaCobro {
  readonly medio = 'EFECTIVO' as const;

  calcularImporte(precios: PreciosCuota): ComposicionImporte {
    const total = redondear(precios.cuotaBase + precios.adicionalPremium);
    return { medio: this.medio, ...precios, descuento: 0, importeFinal: total };
  }

  async cobrar(cuota: CuotaACobrar, { tx, responsableId }: ContextoCobro): Promise<ResultadoCobro> {
    if (!responsableId) throw reglaNegocio('RESPONSABLE_REQUERIDO', 'El pago en efectivo lo registra el personal autorizado');
    const composicion = this.calcularImporte(cuota.precios);
    const pago = await tx.pago.create({
      data: {
        cuotaId: cuota.id,
        medio: this.medio,
        importe: composicion.importeFinal,
        estado: 'APROBADO',
        responsableId,
      },
    });
    return { tipo: 'REGISTRADO', pagoId: pago.id, composicion };
  }
}
