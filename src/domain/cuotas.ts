import type { EstadoAdhesion, EstadoCuota, EstadoPago, MedioPago } from '@prisma/client';
import { reglaNegocio } from '../utils/errores';

/** Paquete «Cuotas y pagos» del diagrama de clases (10.5.7). */

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Cuota mensual del socio (RF9, RF10, RD4 a RD6). */
export class Cuota {
  periodo: string;
  cuotaBase: number;
  adicionalPremium: number;
  descuento: number;
  importeFinal: number;
  estado: EstadoCuota;

  constructor(datos: { periodo: string; cuotaBase: number; adicionalPremium: number; descuento: number; importeFinal: number; estado: EstadoCuota }) {
    this.periodo = datos.periodo;
    this.cuotaBase = datos.cuotaBase;
    this.adicionalPremium = datos.adicionalPremium;
    this.descuento = datos.descuento;
    this.importeFinal = datos.importeFinal;
    this.estado = datos.estado;
  }

  /** RD4 y RD6: cuota base más el adicional Premium, menos el descuento. */
  calcularImporteFinal(): number {
    return redondear(this.cuotaBase + this.adicionalPremium - this.descuento);
  }

  /** CU-001-007: la cuota queda PAGADA con la composición del pago aprobado. */
  marcarPagada(composicion?: { cuotaBase: number; adicionalPremium: number; descuento: number }): void {
    if (this.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
    if (composicion) {
      this.cuotaBase = composicion.cuotaBase;
      this.adicionalPremium = composicion.adicionalPremium;
      this.descuento = composicion.descuento;
    }
    this.importeFinal = this.calcularImporteFinal();
    this.estado = 'PAGADA';
  }

  /** RD8: vencida y sin pagar. */
  estaImpaga(): boolean {
    return this.estado === 'IMPAGA';
  }
}

/** Pago de una cuota (pago único, débito automático o efectivo). */
export class Pago {
  medio: MedioPago;
  importe: number;
  fecha: Date;
  estado: EstadoPago;
  referenciaExterna: string | null;
  responsable: number | null;

  constructor(datos: { medio: MedioPago; importe: number; fecha: Date; estado: EstadoPago; referenciaExterna: string | null; responsableId: number | null }) {
    this.medio = datos.medio;
    this.importe = datos.importe;
    this.fecha = datos.fecha;
    this.estado = datos.estado;
    this.referenciaExterna = datos.referenciaExterna;
    this.responsable = datos.responsableId;
  }

  /** CU-001-006: Mercado Pago (o el personal, en efectivo) aprueba el pago. */
  confirmar(referenciaExterna?: string): void {
    if (this.estado === 'APROBADO') throw reglaNegocio('PAGO_APROBADO', 'El pago ya fue aprobado');
    this.estado = 'APROBADO';
    if (referenciaExterna) this.referenciaExterna = referenciaExterna;
  }
}

/** Comprobante del pago aprobado (CU-001-007, CU-001-009). */
export class Comprobante {
  numero: string;
  fechaEmision: Date;

  constructor(datos: { numero: string; fechaEmision: Date }) {
    this.numero = datos.numero;
    this.fechaEmision = datos.fechaEmision;
  }

  /** Número del comprobante a partir del identificador del pago (NG-00000077). */
  static numeroPara(pagoId: number): string {
    return `NG-${String(pagoId).padStart(8, '0')}`;
  }

  /** Texto que acompaña al PDF del comprobante en el mensaje de WhatsApp. */
  obtenerDetalle(pago: { importe: string; periodo: string }): string {
    return `NeuroGym · Comprobante ${this.numero}\nTu pago de ${pago.importe} de la cuota ${pago.periodo} fue registrado. Te enviamos el comprobante en PDF.`;
  }
}

/** Adhesión del socio al débito automático con Mercado Pago (CU-001-004, CU-001-010). */
export class AdhesionDebito {
  estado: EstadoAdhesion;
  fechaAlta: Date;
  idPreaprobacion: string;
  fechaBaja: Date | null;

  constructor(datos: { estado: EstadoAdhesion; fechaAlta: Date; idPreaprobacion: string; fechaBaja?: Date | null }) {
    this.estado = datos.estado;
    this.fechaAlta = datos.fechaAlta;
    this.idPreaprobacion = datos.idPreaprobacion;
    this.fechaBaja = datos.fechaBaja ?? null;
  }

  /** CU-001-010: baja de la adhesión; desde la cuota siguiente se cobra el importe completo. */
  cancelar(fecha: Date): void {
    if (!this.estaActiva()) throw reglaNegocio('SIN_ADHESION', 'No tenés un débito automático activo');
    this.estado = 'CANCELADA';
    this.fechaBaja = fecha;
  }

  estaActiva(): boolean {
    return this.estado === 'ACTIVA';
  }
}
