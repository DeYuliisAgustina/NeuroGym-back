import { interpretarCobroRecurrente, periodoDelCiclo, type CalendarioSuscripcion } from '../../src/integrations/mercadopago/MercadoPagoApiGateway';

// Calendario real de la adhesión 9 en el entorno de prueba (alta el 17/11, mensual).
const real: CalendarioSuscripcion = { start_date: '2026-11-17T11:33:19.000-04:00', frequency: 1, frequency_type: 'months' };
const factura = { id: 7034076181, preapproval_id: 'PRE', status: 'processed', transaction_amount: 28800, retry_attempt: 1 };

describe('Mercado Pago: período facturado de una factura de suscripción', () => {
  it('reconstruye el ciclo con el calendario de la suscripción', () => {
    expect(periodoDelCiclo('2026-11-17T11:34:32.000-04:00', real)).toBe('2026-11'); // factura real
    expect(periodoDelCiclo('2026-12-17T08:00:00.000-03:00', real)).toBe('2026-12');
    // Generada horas antes del ciclo, incluso en el mes anterior: sigue siendo su ciclo.
    expect(periodoDelCiclo('2026-12-16T23:00:00.000-03:00', real)).toBe('2026-12');
    const finDeMes: CalendarioSuscripcion = { start_date: '2026-10-31T10:00:00.000-03:00', frequency: 1, frequency_type: 'months' };
    expect(periodoDelCiclo('2026-12-01T00:30:00.000-03:00', finDeMes)).toBe('2026-11'); // ciclo del 30/11
    // Día de cobro fijo (billing_day).
    expect(periodoDelCiclo('2027-01-05T09:00:00.000-03:00', { ...real, billing_day: 5 })).toBe('2027-01');
  });

  it('sin calendario, con otra frecuencia o lejos de todo ciclo, el período queda sin identificar', () => {
    expect(periodoDelCiclo('2026-11-17T11:34:32.000-04:00', undefined)).toBeNull();
    expect(periodoDelCiclo(undefined, real)).toBeNull();
    expect(periodoDelCiclo('2026-11-20T10:00:00.000-03:00', { ...real, frequency_type: 'days' })).toBeNull();
    expect(periodoDelCiclo('2026-12-02T10:00:00.000-03:00', real)).toBeNull(); // a mitad de camino entre 17/11 y 17/12
    expect(periodoDelCiclo('2026-10-20T10:00:00.000-03:00', real)).toBeNull(); // antes del inicio
  });

  it('interpreta la factura real y conserva los identificadores de Mercado Pago', () => {
    expect(interpretarCobroRecurrente({ ...factura, date_created: '2026-11-17T11:34:32.000-04:00', payment: { id: 190138992156, status: 'approved' } }, real)).toEqual({
      tipo: 'DEBITO',
      idPreaprobacion: 'PRE',
      referenciaExterna: 'ap-7034076181',
      aprobado: true,
      periodo: '2026-11',
      importe: 28800,
      pagoMercadoPago: '190138992156',
      fechaDebito: undefined,
      intento: 1,
    });
    // El reintento cambia debit_date pero no el ciclo; el importe puede llegar como texto.
    const reintento = interpretarCobroRecurrente(
      { ...factura, transaction_amount: '28800.00', status: 'recycling', retry_attempt: 3, date_created: '2026-12-17T08:00:00.000-03:00', debit_date: '2026-12-24T08:00:00.000-03:00', payment: { status: 'rejected' } },
      real,
    );
    expect(reintento).toMatchObject({ periodo: '2026-12', aprobado: false, importe: 28800, intento: 3 });
  });

  it('factura cancelada sin pago = cobro no concretado; programada o en curso = sin resultado', () => {
    expect(interpretarCobroRecurrente({ ...factura, status: 'canceled', date_created: '2026-12-17T08:00:00.000-03:00' }, real)).toMatchObject({ aprobado: false, periodo: '2026-12' });
    expect(interpretarCobroRecurrente({ ...factura, status: 'scheduled' }, real)).toBeNull();
    expect(interpretarCobroRecurrente({ ...factura, status: 'recycling', payment: { status: 'in_process' } }, real)).toBeNull();
  });
});
