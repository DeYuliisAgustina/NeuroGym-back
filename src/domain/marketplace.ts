import type { Especialidad, EstadoTurnoProfesional, ModalidadAtencion, ModalidadConsulta, TipoMetodoPago, TipoPlanMarketplace } from '@prisma/client';
import { reglaNegocio } from '../utils/errores';

/** Paquete «Marketplace de profesionales» del diagrama de clases (10.5.7). */

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Método de pago que acepta el profesional (RF36). */
export interface MetodoPagoConsulta {
  tipo: TipoMetodoPago;
  obraSocial: string | null;
}

/** Plan del Marketplace (Básico o Profesional) con su comisión por consulta (RD13). */
export class PlanMarketplace {
  tipo: TipoPlanMarketplace;
  precioMensual: number;
  comision: number;
  promocionado: boolean;

  constructor(datos: { tipo: TipoPlanMarketplace; precioMensualUsd: number; porcentajeComision: number; perfilPromocionado: boolean }) {
    this.tipo = datos.tipo;
    this.precioMensual = datos.precioMensualUsd;
    this.comision = datos.porcentajeComision;
    this.promocionado = datos.perfilPromocionado;
  }

  /** RD13: comisión sobre el importe declarado de la consulta (8 % Básico, 2 % Profesional). */
  calcularComision(i: number): number {
    return redondear((i * this.comision) / 100);
  }
}

/** Profesional independiente del Marketplace (RF28, RF29, RF36). */
export class Profesional {
  especialidad: Especialidad;
  modalidad: ModalidadAtencion;
  valorConsulta: number;
  pausado: boolean;
  metodos: MetodoPagoConsulta[];

  constructor(
    datos: { especialidad: Especialidad; modalidadAtencion: ModalidadAtencion; valorConsulta: number; publicacionPausada: boolean },
    metodos: MetodoPagoConsulta[] = [],
  ) {
    this.especialidad = datos.especialidad;
    this.modalidad = datos.modalidadAtencion;
    this.valorConsulta = datos.valorConsulta;
    this.pausado = datos.publicacionPausada;
    this.metodos = metodos;
  }

  /** RF29: la publicación pausada no aparece en el listado de los socios. */
  pausarPublicacion(): void {
    this.pausado = true;
  }

  /** RF36: habilita un método de pago; la obra social exige su nombre. */
  habilitarMetodo(m: MetodoPagoConsulta): void {
    if (m.tipo === 'OBRA_SOCIAL' && !m.obraSocial?.trim()) throw reglaNegocio('OBRA_SOCIAL_REQUERIDA', 'Indicá la obra social');
    this.metodos.push({ tipo: m.tipo, obraSocial: m.tipo === 'OBRA_SOCIAL' ? m.obraSocial!.trim() : null });
  }
}

/** Franja de disponibilidad semanal del profesional. */
export class Disponibilidad {
  dia: string;
  horaInicio: string;
  horaFin: string;

  constructor(datos: { diaSemana: string; horaInicio: string; horaFin: string }) {
    this.dia = datos.diaSemana;
    this.horaInicio = datos.horaInicio;
    this.horaFin = datos.horaFin;
  }
}

/** Comisión de NeuroGym por una consulta realizada y pagada (RF40, RF41, RD13). */
export class Comision {
  importeDeclarado: number;
  porcentaje: number;
  importe: number;
  exenta: boolean;
  fechaRegistro: Date;

  constructor(datos: { importeDeclarado: number; porcentaje: number; importe: number; exenta: boolean; fechaRegistro?: Date }) {
    this.importeDeclarado = datos.importeDeclarado;
    this.porcentaje = datos.porcentaje;
    this.importe = datos.importe;
    this.exenta = datos.exenta;
    this.fechaRegistro = datos.fechaRegistro ?? new Date();
  }
}

/**
 * Estados del turno con un profesional: SOLICITADO → confirmar, rechazar o cancelar;
 * CONFIRMADO/REPROGRAMADO → reprogramar (sin nueva aprobación), cancelar o completar.
 */
export const TRANSICIONES: Record<EstadoTurnoProfesional, EstadoTurnoProfesional[]> = {
  SOLICITADO: ['CONFIRMADO', 'RECHAZADO', 'CANCELADO'],
  CONFIRMADO: ['REPROGRAMADO', 'CANCELADO', 'COMPLETADO'],
  REPROGRAMADO: ['REPROGRAMADO', 'CANCELADO', 'COMPLETADO'],
  RECHAZADO: [],
  CANCELADO: [],
  COMPLETADO: [],
};

/** Turno solicitado por un socio Premium a un profesional (RF37 a RF42). */
export class TurnoProfesional {
  fecha: string;
  hora: string;
  modalidad: ModalidadConsulta;
  estado: EstadoTurnoProfesional;
  motivo: string | null;

  constructor(datos: { fecha: string; hora: string; modalidad: ModalidadConsulta; estado: EstadoTurnoProfesional; motivo: string | null }) {
    this.fecha = datos.fecha;
    this.hora = datos.hora;
    this.modalidad = datos.modalidad;
    this.estado = datos.estado;
    this.motivo = datos.motivo;
  }

  private pasarA(nuevo: EstadoTurnoProfesional): void {
    if (!TRANSICIONES[this.estado].includes(nuevo)) {
      throw reglaNegocio('TRANSICION_INVALIDA', `Un turno ${this.estado.toLowerCase()} no puede pasar a ${nuevo.toLowerCase()}`);
    }
    this.estado = nuevo;
  }

  confirmar(): void {
    this.pasarA('CONFIRMADO');
  }

  rechazar(m: string): void {
    this.pasarA('RECHAZADO');
    this.motivo = m;
  }

  cancelar(m: string): void {
    this.pasarA('CANCELADO');
    this.motivo = m;
  }

  /** RF39: nueva fecha y hora, sin nueva aprobación. */
  reprogramar(f: string, h: string): void {
    this.pasarA('REPROGRAMADO');
    this.fecha = f;
    this.hora = h;
  }

  /**
   * RF40 y RF41: consulta realizada y pagada; genera la comisión del plan del
   * profesional, o exenta si le quedan consultas de Profesionales Fundadores.
   */
  registrarRealizada(i: number, plan: PlanMarketplace, exenta: boolean): Comision {
    this.pasarA('COMPLETADO');
    return new Comision({ importeDeclarado: i, porcentaje: plan.comision, importe: exenta ? 0 : plan.calcularComision(i), exenta });
  }
}
