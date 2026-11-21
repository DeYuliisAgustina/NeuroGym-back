import { describe, expect, it } from 'vitest';
import {
  AdhesionDebito,
  Beneficio,
  BonificacionPremium,
  CodigoQR,
  Comprobante,
  Cuota,
  Equipo,
  Mantenimiento,
  PlanMarketplace,
  Reserva,
  Rutina,
  Socio,
  TurnoClase,
  TurnoProfesional,
} from '../../src/domain';

/** Capa de dominio: clases, atributos y métodos del diagrama de clases (10.5.7). */

const socio = (plan: 'BASICO' | 'PREMIUM', saldoPuntos = 0, bonificaciones: BonificacionPremium[] = []) =>
  new Socio({ apellido: 'Prueba', telefono: '+5491100000000', consentimientoDatos: true, saldoPuntos, pendienteAlta: false, plan }, bonificaciones);

describe('Socio', () => {
  it('esPremium(): plan Premium o bonificación vigente en la fecha', () => {
    const bonificacion = new BonificacionPremium({ desde: '2026-11-01', hasta: '2026-11-30', porcentaje: 100, responsableId: 1 });
    expect(socio('PREMIUM').esPremium('2026-11-21')).toBe(true);
    expect(socio('BASICO', 0, [bonificacion]).esPremium('2026-11-21')).toBe(true);
    expect(socio('BASICO', 0, [bonificacion]).esPremium('2026-12-01')).toBe(false);
  });

  it('canjear(): descuenta los puntos y rechaza el saldo insuficiente', () => {
    const beneficio = new Beneficio({ nombre: 'Batido', descripcion: 'Proteico', costoPuntos: 30, disponible: true, vigenciaDias: 15 });
    const s = socio('BASICO', 50);
    expect(s.canjear(beneficio)).toEqual({ puntosUtilizados: 30, vigenciaDias: 15 });
    expect(s.saldoPuntos).toBe(20);
    expect(() => s.canjear(beneficio)).toThrow(/Necesitás 30 puntos y tenés 20/);
  });
});

describe('TurnoProfesional', () => {
  const turno = (estado: 'SOLICITADO' | 'CONFIRMADO') => new TurnoProfesional({ fecha: '2026-11-25', hora: '10:00', modalidad: 'PRESENCIAL', estado, motivo: null });

  it('respeta las transiciones de RD16', () => {
    const t = turno('SOLICITADO');
    t.confirmar();
    t.reprogramar('2026-11-26', '11:00');
    expect([t.estado, t.fecha, t.hora]).toEqual(['REPROGRAMADO', '2026-11-26', '11:00']);
    expect(() => turno('CONFIRMADO').confirmar()).toThrow(/no puede pasar a confirmado/);
  });

  it('registrarRealizada(): comisión del plan o exenta (RD13)', () => {
    const basico = new PlanMarketplace({ tipo: 'BASICO', precioMensualUsd: 0, porcentajeComision: 8, perfilPromocionado: false });
    expect(turno('CONFIRMADO').registrarRealizada(10000, basico, false).importe).toBe(800);
    expect(turno('CONFIRMADO').registrarRealizada(10000, basico, true)).toMatchObject({ importe: 0, exenta: true, porcentaje: 8 });
  });
});

describe('Turnos, reservas y QR', () => {
  it('TurnoClase.hayCupo() compara los ocupados con el cupo', () => {
    const datos = { actividad: 'Funcional', fecha: '2026-11-25', horario: '18:00-19:00', cupo: 2, habilitado: true };
    expect(new TurnoClase(datos, 1).hayCupo()).toBe(true);
    expect(new TurnoClase(datos, 2).hayCupo()).toBe(false);
  });

  it('Reserva.cancelar(): solo antes del inicio y sin asistencia', () => {
    const ahora = { fecha: '2026-11-25', minutos: 17 * 60 };
    const reserva = (conAsistencia: boolean, inicioMin: number) => new Reserva({ estado: 'RESERVADO', fechaReserva: new Date() }, { fecha: '2026-11-25', inicioMin }, conAsistencia);
    const vigente = reserva(false, 18 * 60);
    vigente.cancelar(ahora);
    expect(vigente.estado).toBe('CANCELADO');
    expect(() => reserva(true, 18 * 60).cancelar(ahora)).toThrow(/asistencia registrada/);
    expect(() => reserva(false, 16 * 60).cancelar(ahora)).toThrow(/ya comenzó/);
  });

  it('CodigoQR.estaVigente() con margen de confirmación', () => {
    const ahora = new Date('2026-11-25T18:00:00Z');
    const qr = new CodigoQR({ codigo: 'x', expiraEn: new Date('2026-11-25T17:58:00Z') });
    expect(qr.estaVigente(ahora)).toBe(false);
    expect(qr.estaVigente(ahora, 5 * 60 * 1000)).toBe(true);
  });
});

describe('Equipamiento', () => {
  it('Equipo: la baja es definitiva y el service se alerta 7 días antes', () => {
    const equipo = new Equipo({ nombre: 'Prensa', estado: 'OPERATIVO', proximoService: '2026-11-27', fechaBaja: null });
    expect(equipo.requiereService('2026-11-21', '2026-11-28')).toBe(true);
    equipo.darDeBaja('2026-11-21');
    expect(() => equipo.cambiarEstado('OPERATIVO')).toThrow(/definitiva/);
  });

  it('Mantenimiento.afectaTurno() detecta la superposición con la ventana', () => {
    const m = new Mantenimiento({
      tipo: 'PREVENTIVO',
      inicioProgramado: new Date('2026-11-25T12:00:00Z'),
      finProgramado: new Date('2026-11-25T15:00:00Z'),
      fechaRealizada: null,
      detalleRealizado: null,
      responsableId: 1,
    });
    const ventana = { desde: '2026-11-25', hasta: '2026-11-25', inicioMin: 9 * 60, finMin: 12 * 60 };
    expect(m.afectaTurno({ fecha: '2026-11-25', inicioMin: 11 * 60, finMin: 12 * 60 }, ventana)).toBe(true);
    expect(m.afectaTurno({ fecha: '2026-11-25', inicioMin: 12 * 60, finMin: 13 * 60 }, ventana)).toBe(false);
  });
});

describe('Cuotas, pagos y rutina', () => {
  it('Cuota.marcarPagada() recalcula el importe final con la composición', () => {
    const cuota = new Cuota({ periodo: '2026-11', cuotaBase: 30000, adicionalPremium: 0, descuento: 0, importeFinal: 30000, estado: 'PENDIENTE' });
    cuota.marcarPagada({ cuotaBase: 30000, adicionalPremium: 12000, descuento: 4200 });
    expect([cuota.estado, cuota.importeFinal]).toEqual(['PAGADA', 37800]);
    expect(() => cuota.marcarPagada()).toThrow(/ya está pagada/);
  });

  it('Comprobante y AdhesionDebito', () => {
    expect(Comprobante.numeroPara(77)).toBe('NG-00000077');
    const adhesion = new AdhesionDebito({ estado: 'ACTIVA', fechaAlta: new Date(), idPreaprobacion: 'pre-1' });
    adhesion.cancelar(new Date('2026-11-21'));
    expect(adhesion.estaActiva()).toBe(false);
    expect(() => adhesion.cancelar(new Date())).toThrow(/débito automático activo/);
  });

  it('Rutina.registrarEntrenamiento() valida el día y los ejercicios marcados', () => {
    const rutina = new Rutina({ fechaGeneracion: new Date(), vigente: true }, [
      { id: 1, dia: 1 },
      { id: 2, dia: 1 },
      { id: 3, dia: 2 },
    ]);
    expect(rutina.registrarEntrenamiento(1, 1, [1], '2026-11-21')).toMatchObject({ completados: 1, total: 2 });
    expect(() => rutina.registrarEntrenamiento(0, 1, [], '2026-11-21')).toThrow(/al menos un ejercicio/);
    expect(() => rutina.registrarEntrenamiento(1, 1, [3], '2026-11-21')).toThrow(/no pertenecen/);
  });
});
