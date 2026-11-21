import bcrypt from 'bcrypt';
import type { TipoAcceso, TipoPlanSocio, TipoSuscripcion } from '@prisma/client';
import type { Rol } from '../patterns/composite';
import { reglaNegocio } from '../utils/errores';

/**
 * Paquete «Seguridad, usuarios y multiempresa» del diagrama de clases (10.5.7).
 * Clases del dominio con los atributos y operaciones del diagrama; los servicios
 * las crean a partir de los registros de la base y persisten su nuevo estado.
 */

/** Usuario de la plataforma (socio, profesional o personal). */
export class Usuario {
  nombre: string;
  email: string;
  passwordHash: string;
  activo: boolean;

  constructor(datos: { nombre: string; email: string; passwordHash: string; activo: boolean }) {
    this.nombre = datos.nombre;
    this.email = datos.email;
    this.passwordHash = datos.passwordHash;
    this.activo = datos.activo;
  }

  /** RNF3: compara la contraseña ingresada con el hash bcrypt guardado. */
  verificarPassword(p: string): Promise<boolean> {
    return bcrypt.compare(p, this.passwordHash);
  }

  /** RD20: baja lógica de la cuenta. */
  desactivar(): void {
    this.activo = false;
  }

  reactivar(): void {
    this.activo = true;
  }
}

/** Personal administrativo del gimnasio con su rol (Composite de permisos). */
export class PersonalAdministrativo {
  esAdminGeneral: boolean;
  private readonly rol: Rol;

  constructor(rol: Rol, esAdminGeneral: boolean) {
    this.rol = rol;
    this.esAdminGeneral = esAdminGeneral;
  }

  /** RF14 y RF15: el rol decide si puede operar el módulo con ese tipo de acceso. */
  puede(m: string, a: TipoAcceso): boolean {
    return this.rol.tienePermiso(m, a);
  }
}

/** Suscripción SaaS del gimnasio (RD1 a RD3). */
export class SuscripcionSaaS {
  tipo: TipoSuscripcion;
  maxSedes: number;
  maxSocios: number;
  fechaAlta: Date;

  constructor(datos: { tipo: TipoSuscripcion; maxSedes: number; maxSociosActivos: number; fechaInicio: Date }) {
    this.tipo = datos.tipo;
    this.maxSedes = datos.maxSedes;
    this.maxSocios = datos.maxSociosActivos;
    this.fechaAlta = datos.fechaInicio;
  }

  /** RD3: la analítica avanzada es exclusiva de NeuroGym Intelligence. */
  incluyeAnaliticaAvanzada(): boolean {
    return this.tipo === 'INTELLIGENCE';
  }
}

/** Gimnasio cliente (inquilino) con su suscripción vigente. */
export class Gimnasio {
  razonSocial: string;
  cuit: string;
  private readonly suscripcion: SuscripcionSaaS;
  private sedesHabilitadas: number;

  constructor(datos: { razonSocial: string; cuit: string }, suscripcion: SuscripcionSaaS, sedesHabilitadas: number) {
    this.razonSocial = datos.razonSocial;
    this.cuit = datos.cuit;
    this.suscripcion = suscripcion;
    this.sedesHabilitadas = sedesHabilitadas;
  }

  /** RD2: suma una sede habilitada si la suscripción todavía lo permite. */
  agregarSede(_s: Sede): void {
    if (this.sedesHabilitadas >= this.suscripcion.maxSedes) {
      throw reglaNegocio('LIMITE_SEDES', `La suscripción ${this.suscripcion.tipo} admite hasta ${this.suscripcion.maxSedes} sedes habilitadas.`);
    }
    this.sedesHabilitadas++;
  }

  /** RD2: con n socios activos, ¿admite uno más? */
  admiteSocios(n: number): boolean {
    return n < this.suscripcion.maxSocios;
  }
}

/** Sede del gimnasio (RF16, RD21). */
export class Sede {
  nombre: string;
  direccion: string;
  horarios: string;
  habilitada: boolean;

  constructor(datos: { nombre: string; direccion: string; horarios: string; habilitada: boolean }) {
    this.nombre = datos.nombre;
    this.direccion = datos.direccion;
    this.horarios = datos.horarios;
    this.habilitada = datos.habilitada;
  }

  configurarHorarios(h: string): void {
    if (!h.trim()) throw reglaNegocio('HORARIOS_VACIOS', 'Indicá los horarios de la sede');
    this.horarios = h.trim();
  }

  /** RD21: una sede deshabilitada no admite nuevos socios, turnos ni reservas. */
  cambiarHabilitacion(h: boolean): void {
    this.habilitada = h;
  }
}

/** Plan del socio (Básico o adicional Premium) con su precio vigente. */
export class PlanSocio {
  tipo: TipoPlanSocio;
  precio: number;

  constructor(datos: { tipo: TipoPlanSocio; importeMensual: number }) {
    this.tipo = datos.tipo;
    this.precio = datos.importeMensual;
  }

  /** RD12: el nuevo precio rige para los pagos posteriores. */
  actualizarPrecio(nuevo: number): void {
    if (!(nuevo > 0)) throw reglaNegocio('PRECIO_INVALIDO', 'El precio debe ser mayor a cero');
    this.precio = nuevo;
  }
}

/** Registro histórico de un cambio de precio (RD12). */
export class ActualizacionPrecio {
  precioAnterior: number;
  precioNuevo: number;
  fecha: Date;
  vigenteDesde: string;
  responsable: number;

  constructor(datos: { precioAnterior: number; precioNuevo: number; vigenteDesde: string; responsable: number; fecha?: Date }) {
    this.precioAnterior = datos.precioAnterior;
    this.precioNuevo = datos.precioNuevo;
    this.vigenteDesde = datos.vigenteDesde;
    this.responsable = datos.responsable;
    this.fecha = datos.fecha ?? new Date();
  }
}

/** Notificación interna del usuario (RF33). */
export class Notificacion {
  tipo: string;
  mensaje: string;
  fecha: Date;
  leida: boolean;

  constructor(datos: { tipo: string; mensaje: string; fecha: Date; leida: boolean }) {
    this.tipo = datos.tipo;
    this.mensaje = datos.mensaje;
    this.fecha = datos.fecha;
    this.leida = datos.leida;
  }

  marcarLeida(): void {
    this.leida = true;
  }
}
