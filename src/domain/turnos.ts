import type { EstadoReserva, FormaRegistro } from '@prisma/client';
import { reglaNegocio } from '../utils/errores';

/** Paquete «Turnos, reservas y asistencia» del diagrama de clases (10.5.7). */

/** Turno de clase o musculación de una sede, con cupo (RF3, RF17). */
export class TurnoClase {
  actividad: string;
  fecha: string;
  horario: string;
  cupo: number;
  habilitado: boolean;
  private readonly ocupados: number;

  constructor(datos: { actividad: string; fecha: string; horario: string; cupo: number; habilitado: boolean }, ocupados = 0) {
    this.actividad = datos.actividad;
    this.fecha = datos.fecha;
    this.horario = datos.horario;
    this.cupo = datos.cupo;
    this.habilitado = datos.habilitado;
    this.ocupados = ocupados;
  }

  /** RF3: quedan cupos libres para una reserva más. */
  hayCupo(): boolean {
    return this.ocupados < this.cupo;
  }

  /** RD23: un turno deshabilitado solo deja de admitir nuevas reservas. */
  deshabilitar(): void {
    this.habilitado = false;
  }

  habilitar(): void {
    this.habilitado = true;
  }
}

/** Reserva de un socio para un turno (RF3, RD7). */
export class Reserva {
  estado: EstadoReserva;
  fecha: Date;
  private readonly conAsistencia: boolean;
  private readonly inicioTurno: { fecha: string; minutos: number };

  constructor(datos: { estado: EstadoReserva; fechaReserva: Date }, turno: { fecha: string; inicioMin: number }, conAsistencia: boolean) {
    this.estado = datos.estado;
    this.fecha = datos.fechaReserva;
    this.inicioTurno = { fecha: turno.fecha, minutos: turno.inicioMin };
    this.conAsistencia = conAsistencia;
  }

  /** La reserva está activa y su turno todavía no comenzó (respecto de la hora local indicada). */
  estaVigente(ahora: { fecha: string; minutos: number }): boolean {
    if (this.estado !== 'RESERVADO') return false;
    const { fecha, minutos } = this.inicioTurno;
    return fecha > ahora.fecha || (fecha === ahora.fecha && minutos > ahora.minutos);
  }

  /** RF3: el socio cancela antes del inicio del turno y sin asistencia registrada. */
  cancelar(ahora: { fecha: string; minutos: number }): void {
    if (this.estado === 'CANCELADO') throw reglaNegocio('YA_CANCELADA', 'La reserva ya está cancelada');
    if (this.conAsistencia) throw reglaNegocio('CON_ASISTENCIA', 'La reserva ya tiene una asistencia registrada');
    if (!this.estaVigente(ahora)) throw reglaNegocio('TURNO_INICIADO', 'No se puede cancelar un turno que ya comenzó');
    this.estado = 'CANCELADO';
  }
}

/** Código QR personal, temporal y firmado (RF4, RNF7). */
export class CodigoQR {
  codigo: string;
  expiraEn: Date;

  constructor(datos: { codigo: string; expiraEn: Date }) {
    this.codigo = datos.codigo;
    this.expiraEn = datos.expiraEn;
  }

  /** El código sigue vigente en el instante indicado (con un margen opcional en milisegundos). */
  estaVigente(ahora = new Date(), margenMs = 0): boolean {
    return this.expiraEn.getTime() > ahora.getTime() - margenMs;
  }
}

/** Asistencia efectiva a un turno (RD7: una sola por reserva). */
export class Asistencia {
  fechaHoraReal: Date;
  forma: FormaRegistro;
  provisoria: boolean;
  motivo: string | null;
  responsable: number | null;
  confirmada = false;

  constructor(datos: { fechaHoraReal: Date; forma: FormaRegistro; provisoria?: boolean; motivo?: string; responsableId?: number }) {
    this.fechaHoraReal = datos.fechaHoraReal;
    this.forma = datos.forma;
    this.provisoria = datos.provisoria ?? false;
    this.motivo = datos.motivo ?? null;
    this.responsable = datos.responsableId ?? null;
  }

  /** CU-004-008: confirma el ingreso; el registro manual exige motivo y responsable (CHECK de la base). */
  confirmar(): void {
    if (this.forma === 'MANUAL' && (!this.motivo?.trim() || !this.responsable)) {
      throw reglaNegocio('MANUAL_INCOMPLETO', 'El registro manual requiere motivo y responsable');
    }
    this.confirmada = true;
  }
}
