import { MercadoPagoSimulado } from '../../src/integrations/mercadopago';
import { CobroDebitoAutomatico, CobroEfectivo, CobroPagoUnico, crearEstrategiasCobro } from '../../src/patterns/strategy';

const precios = { cuotaBase: 32000, adicionalPremium: 12000 };

describe('Patrón Strategy: modalidades de cobro', () => {
  const gateway = new MercadoPagoSimulado();

  it('pago único: importe completo, sin descuento (RD6)', () => {
    const c = new CobroPagoUnico(gateway).calcularImporte(precios);
    expect(c).toMatchObject({ medio: 'PAGO_UNICO', descuento: 0, importeFinal: 44000 });
  });

  it('débito automático: 10 % sobre el total del plan (RD6)', () => {
    const c = new CobroDebitoAutomatico(gateway).calcularImporte(precios);
    expect(c).toMatchObject({ medio: 'DEBITO_AUTOMATICO', descuento: 4400, importeFinal: 39600 });
  });

  it('efectivo: importe completo, sin descuento (RD6)', () => {
    const c = new CobroEfectivo().calcularImporte(precios);
    expect(c).toMatchObject({ medio: 'EFECTIVO', descuento: 0, importeFinal: 44000 });
  });

  it('el descuento se redondea a centavos', () => {
    const c = new CobroDebitoAutomatico(gateway).calcularImporte({ cuotaBase: 333.33, adicionalPremium: 0 });
    expect(c.descuento).toBe(33.33);
    expect(c.importeFinal).toBe(300);
  });

  it('Plan Básico sin adicional Premium', () => {
    expect(new CobroPagoUnico(gateway).calcularImporte({ cuotaBase: 32000, adicionalPremium: 0 }).importeFinal).toBe(32000);
  });

  it('las estrategias son intercambiables a través de la misma interfaz', () => {
    const estrategias = crearEstrategiasCobro(gateway);
    const importes = Object.values(estrategias).map((e) => e.calcularImporte(precios).importeFinal);
    expect(importes).toEqual([44000, 39600, 44000]);
  });

  it('el efectivo exige un responsable del personal (RF19, RNF13)', async () => {
    await expect(
      new CobroEfectivo().cobrar({ id: 1, periodo: '2026-11', socioId: 1, precios }, { tx: {} as never, socio: { id: 1, email: 'x@demo', nombre: 'X' } }),
    ).rejects.toThrow('personal autorizado');
  });

  it('débito con adhesión activa no redirige a Mercado Pago (CU-001 3.2)', async () => {
    const r = await new CobroDebitoAutomatico(gateway).cobrar(
      { id: 1, periodo: '2026-11', socioId: 1, precios },
      { tx: {} as never, socio: { id: 1, email: 'x@demo', nombre: 'X' }, adhesionActivaId: 7 },
    );
    expect(r.tipo).toBe('DEBITO_PROGRAMADO');
  });

  it('débito sin adhesión deriva la autorización a Mercado Pago (CU-001-004)', async () => {
    const r = await new CobroDebitoAutomatico(gateway).cobrar(
      { id: 1, periodo: '2026-11', socioId: 5, precios },
      { tx: {} as never, socio: { id: 5, email: 'x@demo', nombre: 'X' }, adhesionActivaId: null },
    );
    expect(r.tipo).toBe('REDIRECCION');
    if (r.tipo === 'REDIRECCION') expect(r.url).toContain('tipo=ADHESION');
  });
});
