import type { MedioPago } from '@prisma/client';
import type { MercadoPagoGateway } from '../../integrations/mercadopago/MercadoPagoGateway';
import { CobroDebitoAutomatico } from './CobroDebitoAutomatico';
import { CobroEfectivo } from './CobroEfectivo';
import { CobroPagoUnico } from './CobroPagoUnico';
import type { EstrategiaCobro } from './EstrategiaCobro';

export * from './EstrategiaCobro';
export { CobroPagoUnico, CobroDebitoAutomatico, CobroEfectivo };

/** Crea el conjunto de estrategias disponibles, indexadas por medio de pago. */
export function crearEstrategiasCobro(gateway: MercadoPagoGateway): Record<MedioPago, EstrategiaCobro> {
  return {
    PAGO_UNICO: new CobroPagoUnico(gateway),
    DEBITO_AUTOMATICO: new CobroDebitoAutomatico(gateway),
    EFECTIVO: new CobroEfectivo(),
  };
}
