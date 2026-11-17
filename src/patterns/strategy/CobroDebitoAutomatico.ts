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
 * Débito automático de Mercado Pago con descuento sobre el total del plan.
 */
export class CobroDebitoAutomatico implements EstrategiaCobro {
  readonly medio = 'DEBITO_AUTOMATICO' as const;
  // RD6: el descuento del 10 % se aplica exclusivamente al débito automático.
  static readonly DESCUENTO = 0.1;

  constructor(private readonly gateway: MercadoPagoGateway) {}

  calcularImporte(precios: PreciosCuota): ComposicionImporte {
    const total = precios.cuotaBase + precios.adicionalPremium;
    const descuento = redondear(total * CobroDebitoAutomatico.DESCUENTO);
    return { medio: this.medio, ...precios, descuento, importeFinal: redondear(total - descuento) };
  }

  async cobrar(cuota: CuotaACobrar, { socio, adhesionActivaId, inicioDebito }: ContextoCobro): Promise<ResultadoCobro> {
    const composicion = this.calcularImporte(cuota.precios);
    // CU-001 3.2: con adhesión activa, Mercado Pago debita sin intervención del socio.
    if (adhesionActivaId) return { tipo: 'DEBITO_PROGRAMADO', composicion };

    // CU-001-004: la adhesión se registra recién cuando Mercado Pago confirma la autorización.
    const url = await this.gateway.crearDebito({
      socioId: socio.id,
      descripcion: 'Débito automático cuota NeuroGym',
      importeMensual: composicion.importeFinal,
      emailPagador: socio.email,
      fechaInicio: inicioDebito,
    });
    return { tipo: 'REDIRECCION', url, composicion };
  }
}
