import type { EstadoEquipo, EstadoIncidencia, TipoMantenimiento } from '@prisma/client';
import { reglaNegocio } from '../utils/errores';

/** Paquete «Equipamiento y mantenimiento» del diagrama de clases (10.5.7). */

/** Equipo del inventario de una sede (RF20, RD22). */
export class Equipo {
  nombre: string;
  estado: EstadoEquipo;
  proximoService: string | null;
  fechaBaja: string | null;

  constructor(datos: { nombre: string; estado: EstadoEquipo; proximoService: string | null; fechaBaja: string | null }) {
    this.nombre = datos.nombre;
    this.estado = datos.estado;
    this.proximoService = datos.proximoService;
    this.fechaBaja = datos.fechaBaja;
  }

  /** La disponibilidad la registra el gimnasio; un equipo dado de baja no vuelve a cambiar (RD22). */
  cambiarEstado(e: EstadoEquipo): void {
    if (this.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'La baja del inventario es definitiva');
    this.estado = e;
  }

  /** RD22: baja definitiva con fecha; conserva su historial. */
  darDeBaja(f: string): void {
    if (this.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'El equipo ya fue dado de baja');
    this.estado = 'DADO_DE_BAJA';
    this.fechaBaja = f;
  }

  /** RF23: el service vence dentro de los próximos 7 días (o ya venció). */
  requiereService(hoy: string, limite: string): boolean {
    return this.estado !== 'DADO_DE_BAJA' && this.proximoService !== null && this.proximoService <= limite && hoy.length > 0;
  }
}

/** Incidencia reportada por un socio sobre un equipo (RF8, RF21). */
export class Incidencia {
  descripcion: string;
  reportante: number;
  fecha: Date;
  estado: EstadoIncidencia;
  adjuntos: string[];
  responsable: number | null;
  equipoId: number;
  agrupadaEn: number | null;

  constructor(datos: {
    id: number;
    descripcion: string;
    reportanteId: number;
    fecha: Date;
    estado: EstadoIncidencia;
    adjuntos?: string[];
    responsableId: number | null;
    equipoId: number;
    agrupadaEnId: number | null;
  }) {
    this.id = datos.id;
    this.descripcion = datos.descripcion;
    this.reportante = datos.reportanteId;
    this.fecha = datos.fecha;
    this.estado = datos.estado;
    this.adjuntos = datos.adjuntos ?? [];
    this.responsable = datos.responsableId;
    this.equipoId = datos.equipoId;
    this.agrupadaEn = datos.agrupadaEnId;
  }

  readonly id: number;

  /** RF21: agrupa esta incidencia dentro de otra principal del mismo equipo y toma su estado. */
  agruparCon(i: Incidencia): void {
    if (i.id === this.id) throw reglaNegocio('AGRUPACION_INVALIDA', 'Una incidencia no puede agruparse consigo misma');
    if (i.equipoId !== this.equipoId) throw reglaNegocio('EQUIPOS_DISTINTOS', 'Solo se agrupan incidencias del mismo equipo');
    if (i.agrupadaEn) throw reglaNegocio('PRINCIPAL_AGRUPADA', 'La incidencia principal ya está agrupada en otra');
    this.agrupadaEn = i.id;
    this.estado = i.estado;
  }

  cambiarEstado(e: EstadoIncidencia): void {
    this.estado = e;
  }
}

/** Mantenimiento preventivo o correctivo programado sobre un equipo (RF22, RF34). */
export class Mantenimiento {
  tipo: TipoMantenimiento;
  fechaProgramada: Date;
  finProgramado: Date;
  fechaRealizada: Date | null;
  observaciones: string | null;
  responsable: number;
  realizado: boolean;

  constructor(datos: {
    tipo: TipoMantenimiento;
    inicioProgramado: Date;
    finProgramado: Date;
    fechaRealizada: Date | null;
    detalleRealizado: string | null;
    responsableId: number;
    realizado?: boolean;
  }) {
    if (datos.finProgramado <= datos.inicioProgramado) throw reglaNegocio('PERIODO_INVALIDO', 'El fin debe ser posterior al inicio');
    this.tipo = datos.tipo;
    this.fechaProgramada = datos.inicioProgramado;
    this.finProgramado = datos.finProgramado;
    this.fechaRealizada = datos.fechaRealizada;
    this.observaciones = datos.detalleRealizado;
    this.responsable = datos.responsableId;
    this.realizado = datos.realizado ?? false;
  }

  registrarRealizado(f: Date, observaciones?: string): void {
    if (this.realizado) throw reglaNegocio('YA_REALIZADO', 'El mantenimiento ya fue registrado como realizado');
    this.realizado = true;
    this.fechaRealizada = f;
    if (observaciones !== undefined) this.observaciones = observaciones;
  }

  /**
   * RF34: el turno se superpone con la ventana del mantenimiento. Los minutos son
   * hora local; el turno se compara contra la parte de la ventana que cae en su fecha.
   */
  afectaTurno(t: { fecha: string; inicioMin: number; finMin: number }, ventana: { desde: string; hasta: string; inicioMin: number; finMin: number }): boolean {
    if (t.fecha < ventana.desde || t.fecha > ventana.hasta) return false;
    const inicio = t.fecha === ventana.desde ? ventana.inicioMin : 0;
    const fin = t.fecha === ventana.hasta ? ventana.finMin : 24 * 60;
    return t.inicioMin < fin && t.finMin > inicio;
  }
}
