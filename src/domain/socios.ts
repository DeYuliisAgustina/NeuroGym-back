import type { EstadoPropuesta, TipoPlanSocio } from '@prisma/client';
import { reglaNegocio } from '../utils/errores';
import type { PlanSocio } from './seguridad';

/** Paquete «Socios, retención y beneficios» del diagrama de clases (10.5.7). */

/** Beneficio por constancia que el socio canjea con puntos (RF11). */
export class Beneficio {
  nombre: string;
  descripcion: string;
  puntosRequeridos: number;
  disponible: boolean;
  vigenciaDias: number;

  constructor(datos: { nombre: string; descripcion: string; costoPuntos: number; disponible: boolean; vigenciaDias: number }) {
    this.nombre = datos.nombre;
    this.descripcion = datos.descripcion;
    this.puntosRequeridos = datos.costoPuntos;
    this.disponible = datos.disponible;
    this.vigenciaDias = datos.vigenciaDias;
  }

  estaDisponible(): boolean {
    return this.disponible;
  }
}

/** Canje de un beneficio con los puntos utilizados. */
export interface Canje {
  puntosUtilizados: number;
  vigenciaDias: number;
}

/** Plan Premium bonificado por el gimnasio durante un período (CU-002-010). */
export class BonificacionPremium {
  desde: string;
  hasta: string;
  porcentaje: number;
  responsable: number;

  constructor(datos: { desde: string; hasta: string; porcentaje: number; responsableId: number }) {
    this.desde = datos.desde;
    this.hasta = datos.hasta;
    this.porcentaje = datos.porcentaje;
    this.responsable = datos.responsableId;
  }

  /** La bonificación cubre la fecha indicada ('AAAA-MM-DD'). */
  estaVigente(f: string): boolean {
    return this.desde <= f && f <= this.hasta;
  }
}

/** Socio del gimnasio (RF2 a RF13). */
export class Socio {
  apellido: string;
  telefono: string;
  consentimiento: boolean;
  saldoPuntos: number;
  pendienteAlta: boolean;
  plan: TipoPlanSocio;
  private readonly bonificaciones: BonificacionPremium[];

  constructor(
    datos: { apellido: string; telefono: string; consentimientoDatos: boolean; saldoPuntos: number; pendienteAlta: boolean; plan: TipoPlanSocio },
    bonificaciones: BonificacionPremium[] = [],
  ) {
    this.apellido = datos.apellido;
    this.telefono = datos.telefono;
    this.consentimiento = datos.consentimientoDatos;
    this.saldoPuntos = datos.saldoPuntos;
    this.pendienteAlta = datos.pendienteAlta;
    this.plan = datos.plan;
    this.bonificaciones = bonificaciones;
  }

  /** RF12 y RF26: Plan Premium contratado o una bonificación vigente en la fecha. */
  esPremium(fecha: string): boolean {
    return this.plan === 'PREMIUM' || this.bonificaciones.some((b) => b.estaVigente(fecha));
  }

  /** RF12: contratar o dar de baja el Plan Premium. */
  cambiarPlan(p: PlanSocio): void {
    if (p.tipo === this.plan) throw reglaNegocio('PLAN_SIN_CAMBIOS', `Ya tenés el Plan ${p.tipo === 'PREMIUM' ? 'Premium' : 'Básico'}`);
    this.plan = p.tipo;
  }

  /** RD9: puntos del día de constancia. */
  sumarPuntos(n: number): void {
    this.saldoPuntos += n;
  }

  /** RF11: canjea un beneficio disponible si el saldo alcanza. */
  canjear(b: Beneficio): Canje {
    if (!b.estaDisponible()) throw reglaNegocio('BENEFICIO_NO_DISPONIBLE', 'El beneficio no está disponible');
    if (this.saldoPuntos < b.puntosRequeridos) {
      throw reglaNegocio('PUNTOS_INSUFICIENTES', `Necesitás ${b.puntosRequeridos} puntos y tenés ${this.saldoPuntos}`);
    }
    this.saldoPuntos -= b.puntosRequeridos;
    return { puntosUtilizados: b.puntosRequeridos, vigenciaDias: b.vigenciaDias };
  }
}

/** Propuesta de incentivo de regreso (RD10: no se comunica hasta su aprobación). */
export class PropuestaIncentivo {
  incentivo: string;
  mensaje: string;
  estado: EstadoPropuesta;
  responsable: number;

  constructor(datos: { incentivo: string; mensaje: string; estado: EstadoPropuesta; responsableId: number }) {
    this.incentivo = datos.incentivo;
    this.mensaje = datos.mensaje;
    this.estado = datos.estado;
    this.responsable = datos.responsableId;
  }

  /** RD10: la aprobación registra al responsable; una propuesta aprobada no vuelve a aprobarse. */
  aprobar(responsable: number): void {
    if (this.estado === 'APROBADA') throw reglaNegocio('YA_APROBADA', 'La propuesta ya fue aprobada');
    this.estado = 'APROBADA';
    this.responsable = responsable;
  }
}
