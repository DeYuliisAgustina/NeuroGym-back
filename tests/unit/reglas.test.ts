import { detectarSenal, estimarRiesgo } from '../../src/jobs/reglasRetencion';
import { validarTransicion } from '../../src/services/turnoProfesional.service';
import { verificarReservaVigente } from '../../src/services/asistencia.service';
import { firmaValida, generarCodigoQr } from '../../src/utils/codigoQr';
import { GeneradorEventoCalendario } from '../../src/utils/GeneradorEventoCalendario';
import { aHoraDb } from '../../src/utils/fechas';
import { validarRutinaGenerada } from '../../src/integrations/ia';
import { ServicioIASimulado } from '../../src/integrations/ia/ServicioIASimulado';

describe('RD16: transiciones del turno profesional', () => {
  it.each([
    ['SOLICITADO', 'CONFIRMADO'],
    ['SOLICITADO', 'RECHAZADO'],
    ['SOLICITADO', 'CANCELADO'],
    ['CONFIRMADO', 'REPROGRAMADO'],
    ['CONFIRMADO', 'COMPLETADO'],
    ['REPROGRAMADO', 'REPROGRAMADO'],
    ['REPROGRAMADO', 'CANCELADO'],
  ] as const)('%s → %s es válida', (a, b) => expect(() => validarTransicion(a, b)).not.toThrow());

  it.each([
    ['SOLICITADO', 'COMPLETADO'],
    ['SOLICITADO', 'REPROGRAMADO'],
    ['CONFIRMADO', 'RECHAZADO'],
    ['CANCELADO', 'CONFIRMADO'],
    ['COMPLETADO', 'CANCELADO'],
    ['RECHAZADO', 'CONFIRMADO'],
  ] as const)('%s → %s es inválida', (a, b) => expect(() => validarTransicion(a, b)).toThrow('no puede pasar'));
});

describe('CU-004-003: verificación de la reserva vigente', () => {
  const tolerancia = { antesMin: 15, despuesMin: 60 };
  const reserva = (id: number, sedeId: number, hora: string, conAsistencia = false) =>
    ({ id, turno: { sedeId, horaInicio: aHoraDb(hora) }, asistencia: conAsistencia ? { id: 1 } : null }) as never;

  it('sin reservas → SIN_RESERVA', () => expect(verificarReservaVigente([], 1, 600, tolerancia)).toMatchObject({ codigo: 'SIN_RESERVA' }));
  it('reserva en otra sede → SEDE_INCORRECTA', () =>
    expect(verificarReservaVigente([reserva(1, 2, '10:00')], 1, 600, tolerancia)).toMatchObject({ codigo: 'SEDE_INCORRECTA' }));
  it('antes de la tolerancia → FUERA_DE_HORARIO', () =>
    expect(verificarReservaVigente([reserva(1, 1, '10:00')], 1, 584, tolerancia)).toMatchObject({ codigo: 'FUERA_DE_HORARIO' }));
  it('después de la tolerancia → FUERA_DE_HORARIO', () =>
    expect(verificarReservaVigente([reserva(1, 1, '10:00')], 1, 661, tolerancia)).toMatchObject({ codigo: 'FUERA_DE_HORARIO' }));
  it('con asistencia registrada → INGRESO_DUPLICADO (RD7)', () =>
    expect(verificarReservaVigente([reserva(1, 1, '10:00', true)], 1, 600, tolerancia)).toMatchObject({ codigo: 'INGRESO_DUPLICADO' }));
  it('dentro de la ventana y sin asistencia → válida', () => {
    const r = verificarReservaVigente([reserva(1, 1, '07:00'), reserva(2, 1, '10:00')], 1, 590, tolerancia);
    expect(r.valida).toBe(true);
    if (r.valida) expect(r.reserva.id).toBe(2);
  });
});

describe('CU-002: señales de abandono y estimación de riesgo', () => {
  it('sin historial no genera señal', () => expect(detectarSenal({ recientes: 0, previas: 0, diasDesdeUltima: null })).toBeNull());
  it('ausencia de 21 días o más → ALTO', () =>
    expect(detectarSenal({ recientes: 0, previas: 12, diasDesdeUltima: 25 })).toMatchObject({ tipo: 'Ausencia prolongada', nivel: 'ALTO' }));
  it('ausencia menor a 21 días → MEDIO', () =>
    expect(detectarSenal({ recientes: 0, previas: 12, diasDesdeUltima: 16 })).toMatchObject({ nivel: 'MEDIO' }));
  it('frecuencia en descenso marcada', () =>
    expect(detectarSenal({ recientes: 1, previas: 24, diasDesdeUltima: 3 })).toMatchObject({ tipo: 'Frecuencia en descenso', nivel: 'ALTO' }));
  it('frecuencia estable → sin señal', () => expect(detectarSenal({ recientes: 6, previas: 24, diasDesdeUltima: 1 })).toBeNull());
  it('historial insuficiente → sin estimación', () => expect(estimarRiesgo({ recientes: 1, previas: 0, diasDesdeUltima: 2 }, false)).toBeNull());
  it('la cuota impaga eleva el riesgo', () => {
    const h = { recientes: 2, previas: 16, diasDesdeUltima: 10 };
    expect(estimarRiesgo(h, true)!.puntaje).toBeGreaterThan(estimarRiesgo(h, false)!.puntaje);
  });
  it('ausencia prolongada → riesgo ALTO con recomendación de incentivo', () => {
    const e = estimarRiesgo({ recientes: 0, previas: 20, diasDesdeUltima: 30 }, false)!;
    expect(e.nivel).toBe('ALTO');
    expect(e.recomendacion).toContain('incentivo');
  });
});

describe('RNF7: código QR firmado', () => {
  it('el código generado tiene firma válida y no contiene datos legibles', () => {
    const codigo = generarCodigoQr();
    expect(firmaValida(codigo)).toBe(true);
    expect(codigo).not.toMatch(/@|socio/i);
  });
  it('un código alterado se rechaza', () => {
    const codigo = generarCodigoQr();
    expect(firmaValida(`${codigo.slice(0, -1)}${codigo.endsWith('A') ? 'B' : 'A'}`)).toBe(false);
    expect(firmaValida('texto-cualquiera')).toBe(false);
  });
});

describe('RF43: evento de calendario', () => {
  const datos = { turnoId: 5, fecha: '2026-12-01', horaInicio: '09:00', horaFin: '09:45', titulo: 'Consulta', descripcion: 'Pago: particular', ubicacion: 'En línea' };
  it('genera un .ics válido con zona horaria', () => {
    const ics = GeneradorEventoCalendario.generarIcs(datos);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;TZID=America/Argentina/Buenos_Aires:20261201T090000');
    expect(ics).toContain('UID:turno-profesional-5@neurogym');
  });
  it('genera el enlace de Google Calendar', () => {
    expect(GeneradorEventoCalendario.generarEnlace(datos)).toContain('dates=20261201T090000%2F20261201T094500');
  });
});

describe('CU-003: validación de rutinas de IA', () => {
  const catalogo = [
    { id: 1, nombre: 'Sentadilla', grupoMuscular: 'Piernas', disponible: true },
    { id: 2, nombre: 'Prensa', grupoMuscular: 'Piernas', disponible: false },
    { id: 3, nombre: 'Plancha', grupoMuscular: 'Core', disponible: true },
  ];
  const pref = { objetivo: 'Hipertrofia', nivel: 'Intermedio', diasPorSemana: 2 };
  const item = (ejercicioId: number, dia: number, orden: number) => ({ ejercicioId, dia, orden, series: 3, repeticiones: 10, pesoKg: null, descansoSeg: 60 });

  it('descarta ejercicios no disponibles o fuera de los días', () => {
    const r = validarRutinaGenerada({ ejercicios: [item(1, 1, 1), item(2, 1, 2), item(3, 3, 1)] }, pref, catalogo);
    expect(r.ejercicios.map((e) => e.ejercicioId)).toEqual([1]);
  });
  it('una respuesta sin ejercicios válidos se rechaza (CU-003 4.1)', () => {
    expect(() => validarRutinaGenerada({ ejercicios: [item(2, 1, 1)] }, pref, catalogo)).toThrow('rutina válida');
  });
  it('la simulación sugiere una variante del mismo grupo muscular', async () => {
    const variante = await new ServicioIASimulado().sugerirVariante(catalogo[1], 'Hipertrofia', catalogo);
    expect(variante.ejercicioId).toBe(1);
  });
});
