import { reglaNegocio } from '../utils/errores';

/** Paquete «Rutinas con IA y entrenamiento» del diagrama de clases (10.5.7). */

/** Ejercicio del catálogo con los equipos de la sede que lo permiten. */
export class Ejercicio {
  nombre: string;
  grupoMuscular: string;
  private readonly equipos: { estado: string }[];

  constructor(datos: { nombre: string; grupoMuscular: string }, equipos: { estado: string }[] = []) {
    this.nombre = datos.nombre;
    this.grupoMuscular = datos.grupoMuscular;
    this.equipos = equipos;
  }

  requiereEquipo(): boolean {
    return this.equipos.length > 0;
  }

  /** CU-003-006: disponible si no requiere equipo o si alguno de sus equipos está OPERATIVO (RD11). */
  estaDisponible(): boolean {
    return !this.requiereEquipo() || this.equipos.some((e) => e.estado === 'OPERATIVO');
  }
}

/** Ejercicio dentro de la rutina del socio, editable (CU-003-003 a 005). */
export class EjercicioRutina {
  dia: number;
  series: number;
  repeticiones: number;
  peso: number | null;
  ejercicioId: number;

  constructor(datos: { dia: number; series: number; repeticiones: number; pesoKg: number | null; ejercicioId: number }) {
    this.dia = datos.dia;
    this.series = datos.series;
    this.repeticiones = datos.repeticiones;
    this.peso = datos.pesoKg;
    this.ejercicioId = datos.ejercicioId;
  }

  /** CU-003-005: nuevas series, repeticiones y peso (los valores omitidos se conservan). */
  ajustarCarga(s?: number, r?: number, p?: number | null): void {
    if (s !== undefined) this.series = s;
    if (r !== undefined) this.repeticiones = r;
    if (p !== undefined) this.peso = p;
  }

  /** CU-003-008: reemplaza el ejercicio por la variante; debe estar disponible (RD11). */
  reemplazarPor(v: { id: number; disponible: boolean }): void {
    if (!v.disponible) throw reglaNegocio('VARIANTE_NO_DISPONIBLE', 'La variante elegida tampoco está disponible');
    this.ejercicioId = v.id;
  }
}

/** Entrenamiento registrado por el socio (CU-003-009). */
export class Entrenamiento {
  fecha: string;
  completados: number;
  total: number;

  constructor(datos: { fecha: string; completados: number; total: number }) {
    this.fecha = datos.fecha;
    this.completados = datos.completados;
    this.total = datos.total;
  }
}

/** Rutina vigente del socio (RF5, RF6). */
export class Rutina {
  fechaGeneracion: Date;
  vigente: boolean;
  private readonly ejercicios: { id: number; dia: number }[];

  constructor(datos: { fechaGeneracion: Date; vigente: boolean }, ejercicios: { id: number; dia: number }[]) {
    this.fechaGeneracion = datos.fechaGeneracion;
    this.vigente = datos.vigente;
    this.ejercicios = ejercicios;
  }

  /**
   * CU-003-009: registra los ejercicios realizados de un día. Sin ejercicios
   * marcados no se registra (5.1); solo admite ejercicios de ese día.
   */
  registrarEntrenamiento(n: number, dia: number, realizados: number[], fecha: string): Entrenamiento {
    const delDia = this.ejercicios.filter((e) => e.dia === dia);
    if (delDia.length === 0) throw reglaNegocio('DIA_INVALIDO', 'La rutina no tiene ejercicios para ese día');
    if (n === 0) throw reglaNegocio('SIN_EJERCICIOS', 'Marcá al menos un ejercicio realizado');
    if (realizados.some((id) => !delDia.some((e) => e.id === id))) throw reglaNegocio('EJERCICIO_AJENO', 'Hay ejercicios que no pertenecen a ese día de la rutina');
    return new Entrenamiento({ fecha, completados: n, total: delDia.length });
  }
}
