import { exigeZonaEvitada, indicacionZonasEvitar } from '../../src/integrations/ia';

describe('Zonas o movimientos a evitar (preferencia, no dato de salud)', () => {
  it('detecta los ejercicios que exigen una zona evitada', () => {
    expect(exigeZonaEvitada('Sentadilla con barra', ['RODILLAS'])).toBe(true);
    expect(exigeZonaEvitada('Sentadilla con barra', ['ESPALDA_BAJA'])).toBe(true);
    expect(exigeZonaEvitada('Vuelos laterales', ['HOMBROS'])).toBe(true);
    expect(exigeZonaEvitada('Flexiones de brazos', ['MUNECAS'])).toBe(true);
    expect(exigeZonaEvitada('Jalón al pecho', ['RODILLAS', 'MUNECAS', 'IMPACTO'])).toBe(false);
    expect(exigeZonaEvitada('Sentadilla con barra', [])).toBe(false);
  });

  it('la indicación para la IA es una preferencia y aclara que no es un diagnóstico', () => {
    expect(indicacionZonasEvitar([])).toBe('');
    const texto = indicacionZonasEvitar(['ESPALDA_BAJA', 'RODILLAS']);
    expect(texto).toContain('la zona lumbar (espalda baja), las rodillas');
    expect(texto).toContain('no un diagnóstico');
    expect(texto).toContain('no la interpretes como una lesión');
  });
});
