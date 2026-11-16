import type { MercadoPagoGateway } from '../../integrations/mercadopago/MercadoPagoGateway';
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
 * Pago único con Mercado Pago por el importe completo, sin descuento (CU-001-003, RD6).
 */
export class CobroPagoUnico implements EstrategiaCobro {
  readonly medio = 'PAGO_UNICO' as const;

  constructor(private readonly gateway: MercadoPagoGateway) {}

  calcularImporte(precios: PreciosCuota): ComposicionImporte {
    const total = redondear(precios.cuotaBase + precios.adicionalPremium);
    return { medio: this.medio, ...precios, descuento: 0, importeFinal: total };
  }

  async cobrar(cuota: CuotaACobrar, { tx, socio }: ContextoCobro): Promise<ResultadoCobro> {
    const composicion = this.calcularImporte(cuota.precios);
    // El pago queda PENDIENTE hasta que Mercado Pago confirme el resultado (CU-001-006).
    const pago = await tx.pago.create({
      data: { cuotaId: cuota.id, medio: this.medio, importe: composicion.importeFinal, estado: 'PENDIENTE' },
    });
    const url = await this.gateway.crearPago({
      pagoId: pago.id,
      descripcion: `Cuota NeuroGym ${cuota.periodo}`,
      importe: composicion.importeFinal,
      emailPagador: socio.email,
    });
    return { tipo: 'REDIRECCION', pagoId: pago.id, url, composicion };
  }
}
