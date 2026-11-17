import { detectarSenal } from '../../src/jobs/reglasRetencion';

/**
 * Test de caja blanca de detectarSenal (CU-002-003), criterio de cubrimiento
 * de flechas (ramas). Grafo de flujo de control documentado en el punto 10.5.10:
 *
 *  N1  habitual = previas / 4                      F1  N1→N2
 *  N2  previas == 0 y recientes == 0 ?             F2  N2→N3 (T)   F3  N2→N4 (F)
 *  N3  return null (sin historial)
 *  N4  recientes == 0 y previas > 0 ?              F4  N4→N5 (T)   F5  N4→N12 (F)
 *  N5  diasDesdeUltima es null ?                   F6  N5→N6 (T)   F7  N5→N7 (F)
 *  N6  dias = 14                                   F8  N6→N8
 *  N7  dias = diasDesdeUltima                      F9  N7→N8
 *  N8  dias >= 21 ?                                F10 N8→N9 (T)   F11 N8→N10 (F)
 *  N9  nivel = ALTO                                F12 N9→N11
 *  N10 nivel = MEDIO                               F13 N10→N11
 *  N11 return Ausencia prolongada
 *  N12 habitual >= 2 y recientes <= 50 % ?         F14 N12→N13 (T) F15 N12→N17 (F)
 *  N13 recientes <= 25 % de la habitual ?          F16 N13→N14 (T) F17 N13→N15 (F)
 *  N14 nivel = ALTO                                F18 N14→N16
 *  N15 nivel = MEDIO                               F19 N15→N16
 *  N16 return Frecuencia en descenso
 *  N17 habitual >= 2 y recientes <= 70 % ?         F20 N17→N18 (T) F21 N17→N19 (F)
 *  N18 return Frecuencia en descenso (BAJO)
 *  N19 return null (sin señal)
 *
 * Las condiciones compuestas (&&) se tratan como una sola decisión.
 * Los 7 casos recorren las 21 flechas (100 %) y, por lo tanto, todas las sentencias.
 */
const casos = [
  { caso: 'C1', previas: 0, recientes: 0, diasDesdeUltima: null, flechas: 'F1 F2', esperado: null },
  {
    caso: 'C2', previas: 8, recientes: 0, diasDesdeUltima: 25, flechas: 'F1 F3 F4 F7 F9 F10 F12',
    esperado: { tipo: 'Ausencia prolongada', nivel: 'ALTO', detalle: 'Sin asistencias en 25 días; frecuencia habitual 2.0 cada 14 días.' },
  },
  {
    caso: 'C3', previas: 8, recientes: 0, diasDesdeUltima: null, flechas: 'F1 F3 F4 F6 F8 F11 F13',
    esperado: { tipo: 'Ausencia prolongada', nivel: 'MEDIO', detalle: 'Sin asistencias en 14 días; frecuencia habitual 2.0 cada 14 días.' },
  },
  {
    caso: 'C4', previas: 20, recientes: 1, diasDesdeUltima: 3, flechas: 'F1 F3 F5 F14 F16 F18',
    esperado: { tipo: 'Frecuencia en descenso', nivel: 'ALTO', detalle: '1 asistencias en 14 días contra 5.0 habituales.' },
  },
  {
    caso: 'C5', previas: 20, recientes: 2, diasDesdeUltima: 3, flechas: 'F1 F3 F5 F14 F17 F19',
    esperado: { tipo: 'Frecuencia en descenso', nivel: 'MEDIO', detalle: '2 asistencias en 14 días contra 5.0 habituales.' },
  },
  {
    caso: 'C6', previas: 20, recientes: 3, diasDesdeUltima: 2, flechas: 'F1 F3 F5 F15 F20',
    esperado: { tipo: 'Frecuencia en descenso', nivel: 'BAJO', detalle: '3 asistencias en 14 días contra 5.0 habituales.' },
  },
  { caso: 'C7', previas: 20, recientes: 5, diasDesdeUltima: 1, flechas: 'F1 F3 F5 F15 F21', esperado: null },
];

describe('Caja blanca: detectarSenal con cubrimiento de flechas', () => {
  for (const c of casos) {
    it(`${c.caso}: previas=${c.previas}, recientes=${c.recientes}, diasDesdeUltima=${c.diasDesdeUltima} → ${c.flechas}`, () => {
      expect(detectarSenal({ previas: c.previas, recientes: c.recientes, diasDesdeUltima: c.diasDesdeUltima })).toEqual(c.esperado);
    });
  }

  it('el conjunto de casos cubre las 21 flechas del grafo', () => {
    const cubiertas = new Set(casos.flatMap((c) => c.flechas.split(' ')));
    const todas = Array.from({ length: 21 }, (_, i) => `F${i + 1}`);
    expect(todas.filter((f) => !cubiertas.has(f))).toEqual([]);
  });
});
