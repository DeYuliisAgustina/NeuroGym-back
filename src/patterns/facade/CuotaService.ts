import { Prisma, type MedioPago } from '@prisma/client';
import { prisma, type Tx } from '../../config/prisma';
import type {
  CobroDeSuscripcion,
  MercadoPagoGateway,
  NotificacionEntrante,
  OrigenResultado,
  ResultadoOperacion,
} from '../../integrations/mercadopago';
import type { ServicioMensajeria } from '../../integrations/mensajeria';
import { cuotaRepository } from '../../repositories/cuota.repository';
import { registrarAuditoria } from '../../services/auditoria.service';
import { generarCuotaSocio } from '../../services/cuotaGeneracion.service';
import { notificacionService } from '../../services/notificacion.service';
import { preciosParaSocio } from '../../services/precios.service';
import { aNumero } from '../../utils/dinero';
import { ErrorApp, noEncontrado, reglaNegocio } from '../../utils/errores';
import { aFechaDb, ahoraLocal, fechaIso, periodoDe, sumarDias } from '../../utils/fechas';
import { crearEstrategiasCobro, type ComposicionImporte, type EstrategiaCobro } from '../strategy';

/** Quién consulta una cuota: el socio titular o el personal de su gimnasio (RNF4). */
export type Solicitante = { socioId: number } | { gimnasioId: number };

/** Resultado del registro de una operación informada por Mercado Pago. */
export type ResultadoRegistro = { procesado: boolean; pagoId?: number; duplicado?: boolean; pendienteConciliacion?: boolean };

const MEDIOS: MedioPago[] = ['PAGO_UNICO', 'DEBITO_AUTOMATICO', 'EFECTIVO'];

/** Período en curso ('AAAA-MM') en la zona horaria de los gimnasios. */
const periodoActual = () => periodoDe(ahoraLocal().fecha);

/** Mismo día del mes siguiente (máximo 28, válido en todos los meses): inicio de una suscripción diferida. */
function mesSiguiente(desde = new Date()): Date {
  return new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + 1, Math.min(desde.getUTCDate(), 28), 15, 0, 0));
}

const DEBITO_PROGRAMADO = () =>
  reglaNegocio('DEBITO_PROGRAMADO', 'La cuota del período se debitará automáticamente con tu adhesión. Si el débito se rechaza, vas a poder pagarla por otro medio.');

/**
 * Patrón Facade (estructural).
 * CuotaService ofrece una interfaz única para las operaciones de cuotas y oculta
 * la coordinación entre las estrategias de cobro (Strategy), Mercado Pago,
 * la emisión de comprobantes, la mensajería y la persistencia.
 */
export class CuotaService {
  private estrategia: EstrategiaCobro;
  private readonly estrategias: Record<MedioPago, EstrategiaCobro>;

  constructor(
    private readonly gateway: MercadoPagoGateway,
    private readonly mensajeria: ServicioMensajeria,
  ) {
    this.estrategias = crearEstrategiasCobro(gateway);
    this.estrategia = this.estrategias.PAGO_UNICO;
  }

  /** Strategy: selecciona el comportamiento según la modalidad de cobro. */
  seleccionarEstrategia(medio: MedioPago): EstrategiaCobro {
    this.estrategia = this.estrategias[medio];
    return this.estrategia;
  }

  // ------------------------------------------------------------------
  // Consultas (CU-001-001, CU-001-002, CU-001-005, CU-001-008, CU-001-009)
  // ------------------------------------------------------------------

  /**
   * CU-001-001: la cuota del período en curso y, por separado, las cuotas
   * anteriores sin pagar, que el socio puede elegir y regularizar una por una.
   */
  async obtenerDetalleCuota(socioId: number) {
    const periodo = periodoActual();
    const cuota = await cuotaRepository.cuotaDelPeriodo(socioId, periodo);
    const adhesion = await cuotaRepository.adhesionActiva(socioId);
    if (!cuota) return { cuota: null, adeudadas: [], adhesion, importes: null };
    const adeudadas = await cuotaRepository.cuotasAdeudadas(socioId, cuota.periodo);
    const importes = cuota.estado === 'PAGADA' ? null : await this.obtenerImportesPorMedio(cuota.id, { socioId });
    return {
      cuota: await this.describirCuota(cuota),
      adeudadas: await Promise.all(adeudadas.map((c) => this.describirCuota(c))),
      adhesion,
      importes,
    };
  }

  /** Importe final de cada medio con los precios vigentes (RD12: los nuevos precios rigen para pagos posteriores). */
  async obtenerImportesPorMedio(cuotaId: number, solicitante: Solicitante): Promise<Record<MedioPago, ComposicionImporte>> {
    const cuota = await this.cuotaAccesible(cuotaId, solicitante);
    if (cuota.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
    const precios = await preciosParaSocio(cuota.socioId);
    return Object.fromEntries(MEDIOS.map((m) => [m, this.seleccionarEstrategia(m).calcularImporte(precios)])) as Record<
      MedioPago,
      ComposicionImporte
    >;
  }

  /** CU-001-005: descuento por débito automático sobre el total del plan. */
  async calcularDescuento(socioId: number): Promise<ComposicionImporte> {
    return this.seleccionarEstrategia('DEBITO_AUTOMATICO').calcularImporte(await preciosParaSocio(socioId));
  }

  listarPagos(socioId: number, filtros: Parameters<typeof cuotaRepository.listarPagos>[1] = {}) {
    return cuotaRepository.listarPagos(socioId, filtros);
  }

  async obtenerComprobante(pagoId: number, solicitante: Solicitante) {
    const pago = await cuotaRepository.comprobanteDePago(pagoId);
    if (!pago || !pago.comprobante || !this.puedeVer(pago.cuota, solicitante)) throw noEncontrado('Comprobante');
    const { cuota } = pago;
    // RD12: el comprobante muestra los importes congelados al momento del pago.
    return {
      numero: pago.comprobante.numero,
      fechaEmision: pago.comprobante.fechaEmision,
      fechaEnvio: pago.comprobante.fechaEnvio,
      socio: `${cuota.socio.usuario.nombre} ${cuota.socio.usuario.apellido}`,
      sede: cuota.socio.sede.nombre,
      periodo: cuota.periodo,
      plan: aNumero(cuota.adicionalPremium) > 0 ? 'Premium' : 'Básico',
      cuotaBase: aNumero(cuota.cuotaBase),
      adicionalPremium: aNumero(cuota.adicionalPremium),
      descuento: aNumero(cuota.descuento),
      importe: aNumero(pago.importe),
      medio: pago.medio,
      fechaPago: pago.fecha,
      referencia: pago.referenciaExterna ?? pago.comprobante.numero,
    };
  }

  // ------------------------------------------------------------------
  // Operaciones (CU-001-003, CU-001-004, CU-001-006, CU-001-010, RF19)
  // ------------------------------------------------------------------

  /**
   * Inicia el cobro de la cuota elegida con la estrategia del medio. El pago
   * único y el efectivo abonan exactamente esa cuota (también una vencida); el
   * débito automático solo cubre la cuota del período en curso.
   */
  async iniciarOperacion(cuotaId: number, medio: MedioPago, socioId: number) {
    const estrategia = this.seleccionarEstrategia(medio);
    const periodo = periodoActual();
    if (medio === 'EFECTIVO') {
      // CU-001 3.3: se informa el importe completo; el cobro lo registra administración.
      const cuota = await this.cuotaAccesible(cuotaId, { socioId });
      if (cuota.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
      if (await cuotaRepository.debitoProgramado(cuota, periodo)) throw DEBITO_PROGRAMADO();
      return { tipo: 'INFORMADO' as const, composicion: estrategia.calcularImporte(await preciosParaSocio(socioId)) };
    }
    return prisma.$transaction(async (tx) => {
      await cuotaRepository.bloquear(cuotaId, tx);
      const cuota = await cuotaRepository.buscarConSocio(cuotaId, tx);
      if (!cuota || cuota.socioId !== socioId) throw noEncontrado('Cuota');
      const adhesion = await cuotaRepository.adhesionActiva(socioId, tx);
      let inicioDebito: Date | undefined;
      if (medio === 'DEBITO_AUTOMATICO') {
        if (cuota.periodo !== periodo) {
          throw reglaNegocio(
            'DEBITO_SOLO_PERIODO',
            'El débito automático se aplica a la cuota del período en curso. Las cuotas anteriores se abonan con Mercado Pago o en efectivo.',
          );
        }
        // Cuota del período ya pagada: la suscripción empieza el mes siguiente, sin cobro inmediato.
        if (cuota.estado === 'PAGADA' && !adhesion) inicioDebito = mesSiguiente();
      } else {
        if (cuota.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
        if (await cuotaRepository.debitoProgramado(cuota, periodo, tx)) throw DEBITO_PROGRAMADO();
      }
      return estrategia.cobrar(
        { id: cuota.id, periodo: cuota.periodo, socioId, precios: await preciosParaSocio(socioId, undefined, tx) },
        {
          tx,
          socio: { id: socioId, email: cuota.socio.usuario.email, nombre: cuota.socio.usuario.nombre },
          adhesionActivaId: adhesion?.id ?? null,
          inicioDebito,
        },
      );
    });
  }

  /** RF19: el personal autorizado registra un pago en efectivo (RNF13: con responsable). */
  async registrarEfectivo(cuotaId: number, personal: { personalId: number; gimnasioId: number; usuarioId: number }) {
    const pagoId = await prisma.$transaction(async (tx) => {
      await cuotaRepository.bloquear(cuotaId, tx);
      const cuota = await cuotaRepository.buscarConSocio(cuotaId, tx);
      if (!cuota || cuota.socio.sede.gimnasioId !== personal.gimnasioId) throw noEncontrado('Cuota');
      if (cuota.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
      if (await cuotaRepository.debitoProgramado(cuota, periodoActual(), tx)) throw DEBITO_PROGRAMADO();
      const resultado = await this.seleccionarEstrategia('EFECTIVO').cobrar(
        { id: cuota.id, periodo: cuota.periodo, socioId: cuota.socioId, precios: await preciosParaSocio(cuota.socioId, undefined, tx) },
        {
          tx,
          socio: { id: cuota.socioId, email: cuota.socio.usuario.email, nombre: cuota.socio.usuario.nombre },
          responsableId: personal.personalId,
        },
      );
      if (resultado.tipo !== 'REGISTRADO') throw new ErrorApp(500, 'COBRO_INCONSISTENTE', 'No se registró el pago');
      await this.confirmarPago(tx, resultado.pagoId, resultado.composicion);
      await registrarAuditoria(
        { gimnasioId: personal.gimnasioId, usuarioId: personal.usuarioId, accion: 'PAGO_EFECTIVO', entidad: 'pago', entidadId: resultado.pagoId },
        tx,
      );
      return resultado.pagoId;
    });
    // CU-001-007: el registro en efectivo también envía el comprobante.
    const envio = await this.enviarComprobante(pagoId);
    return { pagoId, comprobanteEnviado: envio };
  }

  /** CU-001-010: baja de la adhesión; desde la cuota siguiente se cobra el importe completo. */
  async cancelarAdhesion(socioId: number) {
    const adhesion = await cuotaRepository.adhesionActiva(socioId);
    if (!adhesion) throw reglaNegocio('SIN_ADHESION', 'No tenés un débito automático activo');
    try {
      await this.gateway.cancelarDebito(adhesion.idPreaprobacion);
    } catch {
      // Curso alternativo 4.1: si Mercado Pago no confirma la baja, la adhesión sigue activa.
      throw new ErrorApp(502, 'MP_BAJA_NO_CONFIRMADA', 'Mercado Pago no confirmó la baja. La adhesión continúa activa.');
    }
    return prisma.$transaction((tx) => this.darDeBajaLocal(tx, adhesion, 'BAJA_DEBITO', { origen: 'SOCIO' }));
  }

  /**
   * Baja de la adhesión en NeuroGym. Sin débito programado, una cuota ya vencida
   * vuelve a su estado real (IMPAGA) y conserva su fecha de vencimiento.
   */
  private async darDeBajaLocal(tx: Tx, adhesion: { id: number; socioId: number }, accion: string, detalle: Prisma.InputJsonValue) {
    const hoy = ahoraLocal().fecha;
    const actualizada = await tx.adhesionDebito.update({ where: { id: adhesion.id }, data: { estado: 'CANCELADA', fechaBaja: aFechaDb(hoy) } });
    await this.marcarVencidasImpagas(tx, adhesion.socioId);
    await registrarAuditoria({ accion, entidad: 'adhesion_debito', entidadId: adhesion.id, detalle }, tx);
    return actualizada;
  }

  private async marcarVencidasImpagas(tx: Tx, socioId: number) {
    const hoy = aFechaDb(ahoraLocal().fecha);
    await tx.cuota.updateMany({ where: { socioId, estado: 'PENDIENTE', fechaVencimiento: { lt: hoy } }, data: { estado: 'IMPAGA' } });
  }

  // ------------------------------------------------------------------
  // Resultados informados por Mercado Pago (CU-001-006 y CU-001-007)
  // ------------------------------------------------------------------

  /** Modo de la integración con Mercado Pago (PRUEBA, NO_CONFIGURADO o doble de prueba). */
  get modoIntegracion() {
    return this.gateway.modo;
  }

  /** Webhook: verifica la firma, consulta el recurso en la API oficial y registra el resultado. */
  async procesarWebhook(notificacion: NotificacionEntrante) {
    if (!this.gateway.validarWebhook(notificacion)) throw new ErrorApp(401, 'FIRMA_INVALIDA', 'Notificación no autenticada');
    let resultado: ResultadoOperacion | null;
    try {
      resultado = await this.gateway.interpretarNotificacion(notificacion);
    } catch (error) {
      // Recurso inexistente (por ejemplo, la notificación de ejemplo del panel): se confirma sin reintentos.
      if ((error as { status?: number }).status === 404) return { procesado: false, motivo: 'RECURSO_INEXISTENTE' };
      throw error;
    }
    if (!resultado) return { procesado: false };
    return this.registrarResultado(resultado, 'WEBHOOK');
  }

  /**
   * Retorno desde Checkout Pro: la URL de retorno trae el id interno del pago;
   * se verifica que pertenezca al socio, se consulta su orden en la API oficial
   * de Orders (no se confía en los parámetros de la URL) y se registra por el
   * mismo camino idempotente que el webhook.
   */
  async confirmarRetornoPago(pagoId: number, socioId: number) {
    const pago = await prisma.pago.findUnique({ where: { id: pagoId }, include: { cuota: true } });
    if (!pago || pago.medio !== 'PAGO_UNICO' || pago.cuota.socioId !== socioId) throw noEncontrado('Pago');
    const resultado = await this.gateway.consultarOrdenDePago(pagoId, pago.fecha);
    if (!resultado || resultado.tipo !== 'PAGO' || resultado.pagoId !== pagoId) return { procesado: false, estado: 'PENDIENTE_DE_CONFIRMACION' };
    return { ...(await this.registrarResultado(resultado, 'RETORNO')), aprobado: resultado.aprobado };
  }

  /** Retorno desde la autorización del débito automático (preapproval_id). */
  async confirmarRetornoAdhesion(idPreaprobacion: string, socioId: number) {
    const resultado = await this.gateway.consultarPreaprobacion(idPreaprobacion);
    if (!resultado || resultado.tipo !== 'ADHESION') return { procesado: false };
    if (resultado.socioId !== socioId) throw noEncontrado('Adhesión');
    return { ...(await this.registrarResultado(resultado, 'RETORNO')), autorizada: resultado.autorizada };
  }

  /**
   * Registra el resultado de una operación. Es idempotente: una notificación
   * repetida no duplica pagos (referencia_externa única y un solo pago APROBADO por cuota).
   * El origen (webhook, retorno o conciliación) queda en la auditoría de cada débito.
   */
  async registrarResultado(op: ResultadoOperacion, origen: OrigenResultado = 'WEBHOOK'): Promise<ResultadoRegistro> {
    try {
      if (op.tipo === 'ADHESION') {
        const adhesion = await this.registrarAdhesion(op, origen);
        if (op.autorizada) await this.sincronizarCobrosDeAdhesion(op.idPreaprobacion, origen);
        return adhesion;
      }
      const pagoAprobado = op.tipo === 'PAGO' ? await this.registrarPagoUnico(op) : await this.registrarDebito(op, origen);
      if (pagoAprobado.pagoId && pagoAprobado.aprobado) await this.enviarComprobante(pagoAprobado.pagoId);
      return {
        procesado: pagoAprobado.procesado,
        pagoId: pagoAprobado.pagoId,
        duplicado: pagoAprobado.duplicado,
        ...('pendienteConciliacion' in pagoAprobado && pagoAprobado.pendienteConciliacion ? { pendienteConciliacion: true } : {}),
      };
    } catch (error) {
      // Dos notificaciones simultáneas del mismo evento: la segunda choca con la unicidad.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { procesado: false, duplicado: true };
      throw error;
    }
  }

  private async registrarPagoUnico(op: Extract<ResultadoOperacion, { tipo: 'PAGO' }>) {
    return prisma.$transaction(async (tx) => {
      const existente = await cuotaRepository.pagoPorReferencia(op.referenciaExterna, tx);
      if (existente) return { procesado: false, duplicado: true, pagoId: existente.id, aprobado: false };
      const pago = await tx.pago.findUnique({ where: { id: op.pagoId } });
      // RECHAZADO admite un nuevo resultado: el socio puede reintentar en la misma
      // orden de Mercado Pago (cada intento tiene su propia referencia).
      if (!pago || pago.medio !== 'PAGO_UNICO' || (pago.estado !== 'PENDIENTE' && pago.estado !== 'RECHAZADO')) {
        return { procesado: false, duplicado: true, pagoId: pago?.id, aprobado: false };
      }
      await cuotaRepository.bloquear(pago.cuotaId, tx);
      const cuota = await tx.cuota.findUniqueOrThrow({ where: { id: pago.cuotaId } });
      if (!op.aprobado) {
        await tx.pago.update({ where: { id: pago.id }, data: { estado: 'RECHAZADO', referenciaExterna: op.referenciaExterna } });
        await this.notificarSocio(tx, cuota.socioId, `Mercado Pago rechazó el pago de la cuota ${cuota.periodo}. La cuota sigue pendiente.`);
        return { procesado: true, pagoId: pago.id, aprobado: false };
      }
      if (cuota.estado === 'PAGADA') {
        // La cuota ya se abonó por otro medio: se registra para su devolución manual.
        await tx.pago.update({ where: { id: pago.id }, data: { referenciaExterna: op.referenciaExterna } });
        await registrarAuditoria({ accion: 'PAGO_SOBRE_CUOTA_PAGADA', entidad: 'pago', entidadId: pago.id }, tx);
        return { procesado: true, pagoId: pago.id, aprobado: false };
      }
      await tx.pago.update({ where: { id: pago.id }, data: { estado: 'APROBADO', referenciaExterna: op.referenciaExterna } });
      // La composición se calcula con los precios vigentes al iniciar el pago.
      const precios = await preciosParaSocio(cuota.socioId, ahoraLocal(pago.fecha).fecha, tx);
      await this.confirmarPago(tx, pago.id, this.estrategias.PAGO_UNICO.calcularImporte(precios));
      return { procesado: true, pagoId: pago.id, aprobado: true };
    });
  }

  /**
   * Registra los cobros ya resueltos de la suscripción (por ejemplo, el primer
   * débito que Mercado Pago hace al autorizar) por el mismo camino idempotente
   * del webhook. Una falla de consulta no deshace la adhesión.
   */
  private async sincronizarCobrosDeAdhesion(idPreaprobacion: string, origen: OrigenResultado) {
    let cobros: CobroDeSuscripcion[];
    try {
      cobros = await this.gateway.consultarCobrosDeAdhesion(idPreaprobacion);
    } catch (error) {
      console.warn('[Mercado Pago] No se pudieron consultar los cobros de la adhesión:', (error as Error).message);
      return;
    }
    for (const cobro of cobros) await this.registrarResultado(cobro, origen);
  }

  /**
   * Débito de la suscripción. Se imputa a la cuota del PERÍODO FACTURADO (nunca a
   * la deuda más antigua); si esa cuota no existe se genera con las reglas de
   * facturación. Si el período no puede determinarse o la cuota ya estaba pagada,
   * no se registra un segundo pago: queda pendiente de conciliación en auditoría.
   * Cada débito deja en auditoría su origen y los identificadores de Mercado Pago.
   */
  private async registrarDebito(op: CobroDeSuscripcion, origen: OrigenResultado) {
    return prisma.$transaction(async (tx) => {
      const detalle = {
        origen,
        cobro: op.referenciaExterna,
        pagoMercadoPago: op.pagoMercadoPago ?? null,
        importeCobrado: op.importe ?? null,
        fechaDebito: op.fechaDebito ?? null,
        intento: op.intento ?? null,
        periodo: op.periodo,
        aprobado: op.aprobado,
      };
      const existente = await cuotaRepository.pagoPorReferencia(op.referenciaExterna, tx);
      if (existente) {
        // Mercado Pago reintenta un débito rechazado con el mismo cobro (retry_attempt).
        if (!(existente.estado === 'RECHAZADO' && op.aprobado)) return { procesado: false, duplicado: true, pagoId: existente.id, aprobado: false };
        await cuotaRepository.bloquear(existente.cuotaId, tx);
        const cuota = await tx.cuota.findUniqueOrThrow({ where: { id: existente.cuotaId } });
        if (cuota.estado === 'PAGADA') {
          await this.auditarCobroPendiente(tx, 'DEBITO_SOBRE_CUOTA_PAGADA', existente.adhesionId, { ...detalle, cuota: cuota.periodo });
          return { procesado: false, pendienteConciliacion: true, aprobado: false };
        }
        const composicion = await this.composicionDebito(cuota.socioId, op, tx);
        await tx.pago.update({ where: { id: existente.id }, data: { estado: 'APROBADO', importe: op.importe ?? composicion.importeFinal } });
        await this.confirmarPago(tx, existente.id, composicion);
        await registrarAuditoria({ accion: 'DEBITO_REGISTRADO', entidad: 'pago', entidadId: existente.id, detalle: { ...detalle, reintento: true } }, tx);
        return { procesado: true, pagoId: existente.id, aprobado: true };
      }

      const adhesion = await cuotaRepository.adhesionPorPreaprobacion(op.idPreaprobacion, tx);
      if (!adhesion) return { procesado: false, aprobado: false };
      if (!op.periodo) {
        await this.auditarCobroPendiente(tx, 'DEBITO_PENDIENTE_CONCILIACION', adhesion.id, { ...detalle, motivo: 'Mercado Pago no permite identificar el período facturado' });
        return { procesado: false, pendienteConciliacion: true, aprobado: false };
      }
      const { cuota: generada } = await generarCuotaSocio(adhesion.socioId, op.periodo, tx);
      await cuotaRepository.bloquear(generada.id, tx);
      const cuota = await tx.cuota.findUniqueOrThrow({ where: { id: generada.id } });
      if (cuota.estado === 'PAGADA') {
        // Ya pagada por otro medio: ni segundo pago ni segundo comprobante.
        await this.auditarCobroPendiente(tx, 'DEBITO_SOBRE_CUOTA_PAGADA', adhesion.id, { ...detalle, cuota: cuota.periodo });
        return { procesado: false, pendienteConciliacion: true, aprobado: false };
      }
      const composicion = await this.composicionDebito(adhesion.socioId, op, tx);
      const pago = await tx.pago.create({
        data: {
          cuotaId: cuota.id,
          adhesionId: adhesion.id,
          medio: 'DEBITO_AUTOMATICO',
          // Se guarda lo que efectivamente cobró Mercado Pago; una diferencia queda auditada.
          importe: op.importe ?? composicion.importeFinal,
          estado: op.aprobado ? 'APROBADO' : 'RECHAZADO',
          referenciaExterna: op.referenciaExterna,
        },
      });
      if (op.importe !== undefined && Math.abs(op.importe - composicion.importeFinal) >= 0.01) {
        await registrarAuditoria(
          { accion: 'DIFERENCIA_IMPORTE_DEBITO', entidad: 'pago', entidadId: pago.id, detalle: { ...detalle, importeEsperado: composicion.importeFinal } },
          tx,
        );
      }
      if (op.aprobado) {
        await this.confirmarPago(tx, pago.id, composicion);
      } else {
        // Débito rechazado: la cuota deja de estar programada; si ya venció, figura impaga.
        if (fechaIso(cuota.fechaVencimiento) < ahoraLocal().fecha) await tx.cuota.update({ where: { id: cuota.id }, data: { estado: 'IMPAGA' } });
        await this.notificarSocio(tx, adhesion.socioId, `No se pudo debitar la cuota ${cuota.periodo}. Podés pagarla con Mercado Pago o en efectivo.`);
      }
      await registrarAuditoria({ accion: 'DEBITO_REGISTRADO', entidad: 'pago', entidadId: pago.id, detalle }, tx);
      return { procesado: true, pagoId: pago.id, aprobado: op.aprobado };
    });
  }

  /** Composición del débito con los precios vigentes a la fecha del cobro (RD6, RD12). */
  private async composicionDebito(socioId: number, op: CobroDeSuscripcion, tx: Tx) {
    const fecha = op.fechaDebito ? ahoraLocal(new Date(op.fechaDebito)).fecha : undefined;
    return this.estrategias.DEBITO_AUTOMATICO.calcularImporte(await preciosParaSocio(socioId, fecha, tx));
  }

  /** Deja un cobro sin imputar en auditoría una sola vez por cobro de Mercado Pago. */
  private async auditarCobroPendiente(tx: Tx, accion: string, adhesionId: number | null, detalle: Record<string, unknown> & { cobro: string }) {
    const previo = await tx.auditoria.findFirst({ where: { accion, detalle: { path: ['cobro'], equals: detalle.cobro } } });
    if (!previo) await registrarAuditoria({ accion, entidad: 'adhesion_debito', entidadId: adhesionId, detalle: detalle as Prisma.InputJsonValue }, tx);
  }

  /**
   * Conciliación periódica: consulta en Mercado Pago los cobros de las adhesiones
   * activas y de las dadas de baja en los últimos 35 días, y registra los que no
   * llegaron por webhook, por el mismo camino idempotente. Deja un resumen en auditoría.
   */
  async conciliarDebitos(hoy = ahoraLocal().fecha) {
    if (this.gateway.modo === 'NO_CONFIGURADO') return { omitida: true as const };
    const adhesiones = await prisma.adhesionDebito.findMany({
      where: { OR: [{ estado: 'ACTIVA' }, { estado: 'CANCELADA', fechaBaja: { gte: aFechaDb(sumarDias(hoy, -35)) } }] },
      orderBy: { id: 'asc' },
    });
    const resumen = {
      fecha: hoy,
      adhesiones: adhesiones.length,
      estadosActualizados: 0,
      cobros: 0,
      registrados: 0,
      duplicados: 0,
      pendientes: 0,
      sinRegistrar: 0,
      errores: 0,
    };
    for (const adhesion of adhesiones) {
      try {
        // Estado de la suscripción: una baja o pausa hecha en Mercado Pago se refleja en NeuroGym.
        if (adhesion.estado === 'ACTIVA') {
          const suscripcion = await this.gateway.consultarPreaprobacion(adhesion.idPreaprobacion);
          if (suscripcion?.tipo === 'ADHESION' && (await this.registrarAdhesion(suscripcion, 'CONCILIACION')).procesado) resumen.estadosActualizados++;
        }
        const cobros = await this.gateway.consultarCobrosDeAdhesion(adhesion.idPreaprobacion);
        for (const cobro of cobros) {
          resumen.cobros++;
          const r = await this.registrarResultado(cobro, 'CONCILIACION');
          if (r.procesado) resumen.registrados++;
          else if (r.duplicado) resumen.duplicados++;
          else if (r.pendienteConciliacion) resumen.pendientes++;
          else resumen.sinRegistrar++;
        }
      } catch (error) {
        resumen.errores++;
        console.warn(`[Mercado Pago] Conciliación: adhesión ${adhesion.id} sin consultar:`, (error as Error).message);
      }
    }
    await registrarAuditoria({ accion: 'CONCILIACION_DEBITOS', entidad: 'adhesion_debito', detalle: resumen });
    return resumen;
  }

  /**
   * Alta de la adhesión, o actualización de su estado si ya existe: una baja o
   * pausa hecha directamente en Mercado Pago (webhook, regreso o conciliación)
   * se refleja en NeuroGym para que la cuota no quede como débito programado.
   */
  private async registrarAdhesion(op: Extract<ResultadoOperacion, { tipo: 'ADHESION' }>, origen: OrigenResultado = 'WEBHOOK') {
    return prisma.$transaction(async (tx) => {
      const existente = await cuotaRepository.adhesionPorPreaprobacion(op.idPreaprobacion, tx);
      if (existente) return this.actualizarEstadoAdhesion(tx, existente, op.estado, origen);
      // Suscripción creada y todavía sin autorizar: no es un resultado.
      if (op.estado === 'pending') return { procesado: false };
      if (!op.autorizada) {
        // CU-001-004 5.1: la autorización no se confirmó; el socio sigue sin débito.
        await this.notificarSocio(tx, op.socioId, 'No pudo completarse la adhesión al débito automático.');
        return { procesado: true };
      }
      if (await cuotaRepository.adhesionActiva(op.socioId, tx)) return { procesado: false, duplicado: true };
      await tx.adhesionDebito.create({
        data: { socioId: op.socioId, idPreaprobacion: op.idPreaprobacion, estado: 'ACTIVA', fechaAlta: new Date(`${ahoraLocal().fecha}T00:00:00Z`) },
      });
      await this.notificarSocio(tx, op.socioId, 'Tu adhesión al débito automático quedó activa: tus cuotas tendrán 10 % de descuento.');
      return { procesado: true };
    });
  }

  private async actualizarEstadoAdhesion(
    tx: Tx,
    adhesion: { id: number; socioId: number; estado: string },
    estadoMp: string | undefined,
    origen: OrigenResultado,
  ): Promise<ResultadoRegistro> {
    if (adhesion.estado !== 'ACTIVA' || !estadoMp) return { procesado: false, duplicado: true };
    if (estadoMp === 'cancelled') {
      await this.darDeBajaLocal(tx, adhesion, 'BAJA_DEBITO_EN_MERCADO_PAGO', { origen });
      await this.notificarSocio(tx, adhesion.socioId, 'Tu débito automático figura cancelado en Mercado Pago. Tus cuotas se abonan con Mercado Pago o en efectivo.');
      return { procesado: true };
    }
    const pausada = await cuotaRepository.adhesionPausada(adhesion.id, tx);
    if (estadoMp === 'paused' && !pausada) {
      await registrarAuditoria({ accion: 'ADHESION_PAUSADA_EN_MERCADO_PAGO', entidad: 'adhesion_debito', entidadId: adhesion.id, detalle: { origen } }, tx);
      await this.marcarVencidasImpagas(tx, adhesion.socioId);
      await this.notificarSocio(tx, adhesion.socioId, 'Tu débito automático está pausado en Mercado Pago. Mientras tanto, tus cuotas se abonan con Mercado Pago o en efectivo.');
      return { procesado: true };
    }
    if (estadoMp === 'authorized' && pausada) {
      await registrarAuditoria({ accion: 'ADHESION_REANUDADA_EN_MERCADO_PAGO', entidad: 'adhesion_debito', entidadId: adhesion.id, detalle: { origen } }, tx);
      await this.notificarSocio(tx, adhesion.socioId, 'Tu débito automático volvió a estar activo en Mercado Pago.');
      return { procesado: true };
    }
    return { procesado: false, duplicado: true };
  }

  /** CU-001-007 pasos 1 y 2: cuota PAGADA con su composición y comprobante emitido. */
  private async confirmarPago(tx: Tx, pagoId: number, composicion: ComposicionImporte) {
    const pago = await tx.pago.findUniqueOrThrow({ where: { id: pagoId } });
    await tx.cuota.update({
      where: { id: pago.cuotaId },
      data: {
        estado: 'PAGADA',
        cuotaBase: composicion.cuotaBase,
        adicionalPremium: composicion.adicionalPremium,
        descuento: composicion.descuento,
        importeFinal: composicion.importeFinal,
      },
    });
    await tx.comprobante.create({ data: { pagoId, numero: `NG-${String(pagoId).padStart(8, '0')}` } });
  }

  /** CU-001-007 paso 3: envío por WhatsApp. Si falla, el comprobante queda en el historial (3.1). */
  /**
   * Reenvía por mensajería el comprobante de un pago ya aprobado. No crea pagos
   * ni comprobantes ni consulta a Mercado Pago: solo repite el envío.
   */
  async reenviarComprobante(pagoId: number): Promise<{ enviado: boolean; error?: string }> {
    const pago = await cuotaRepository.comprobanteDePago(pagoId);
    if (!pago?.comprobante || pago.estado !== 'APROBADO') throw noEncontrado('Comprobante');
    let error: string | undefined;
    const enviado = await this.enviarComprobante(pagoId, { avisoInterno: false, alFallar: (e) => (error = e) });
    return { enviado, error };
  }

  private async enviarComprobante(pagoId: number, opciones: { avisoInterno?: boolean; alFallar?: (error?: string) => void } = {}): Promise<boolean> {
    const pago = await cuotaRepository.comprobanteDePago(pagoId);
    if (!pago?.comprobante) return false;
    const { socio } = pago.cuota;
    const texto =
      `NeuroGym - Comprobante ${pago.comprobante.numero}\n` +
      `Cuota ${pago.cuota.periodo} · ${pago.medio.replace('_', ' ').toLowerCase()}\n` +
      `Importe abonado: $${aNumero(pago.importe).toFixed(2)} · ${fechaIso(pago.fecha)}`;
    if (opciones.avisoInterno !== false) {
      await notificacionService.notificar({ usuarioId: socio.usuarioId, tipo: 'PAGO', mensaje: `Pago confirmado: cuota ${pago.cuota.periodo}.` });
    }
    const resultado = await this.mensajeria.enviar(socio.telefono, texto);
    if (!resultado.enviado) {
      opciones.alFallar?.(resultado.error);
      return false;
    }
    await prisma.$transaction([
      prisma.comprobante.update({ where: { id: pago.comprobante.id }, data: { fechaEnvio: new Date() } }),
      prisma.notificacion.create({ data: { usuarioId: socio.usuarioId, tipo: 'PAGO', canal: 'MENSAJERIA', mensaje: texto } }),
    ]);
    return true;
  }

  // ------------------------------------------------------------------

  private async notificarSocio(tx: Tx, socioId: number, mensaje: string) {
    const socio = await tx.socio.findUniqueOrThrow({ where: { id: socioId } });
    await notificacionService.notificar({ usuarioId: socio.usuarioId, tipo: 'PAGO', mensaje }, tx);
  }

  private async cuotaAccesible(cuotaId: number, solicitante: Solicitante) {
    const cuota = await cuotaRepository.buscarConSocio(cuotaId);
    if (!cuota || !this.puedeVer(cuota, solicitante)) throw noEncontrado('Cuota');
    return cuota;
  }

  private puedeVer(cuota: { socioId: number; socio: { sede: { gimnasioId: number } } }, solicitante: Solicitante) {
    return 'socioId' in solicitante ? cuota.socioId === solicitante.socioId : cuota.socio.sede.gimnasioId === solicitante.gimnasioId;
  }

  /**
   * Estado para mostrar y medios habilitados de una cuota. El débito solo cubre
   * la cuota del período en curso; una cuota con débito programado no admite otros
   * medios hasta conocer el resultado. El vencimiento original se conserva.
   */
  private async describirCuota(cuota: { id: number; socioId: number; periodo: string; estado: string; fechaVencimiento: Date } & Record<string, unknown>) {
    const periodo = periodoActual();
    const debitoProgramado = await cuotaRepository.debitoProgramado(cuota, periodo);
    const adhesion = cuota.estado === 'PAGADA' || debitoProgramado ? null : await cuotaRepository.adhesionActiva(cuota.socioId);
    const mediosHabilitados: MedioPago[] =
      cuota.estado === 'PAGADA' || debitoProgramado
        ? []
        : cuota.periodo === periodo && !adhesion
          ? ['PAGO_UNICO', 'DEBITO_AUTOMATICO', 'EFECTIVO']
          : ['PAGO_UNICO', 'EFECTIVO'];
    return {
      id: cuota.id,
      periodo: cuota.periodo,
      estado: cuota.estado,
      debitoProgramado,
      mediosHabilitados,
      fechaVencimiento: fechaIso(cuota.fechaVencimiento),
      cuotaBase: aNumero(cuota.cuotaBase as Prisma.Decimal),
      adicionalPremium: aNumero(cuota.adicionalPremium as Prisma.Decimal),
      descuento: aNumero(cuota.descuento as Prisma.Decimal),
      importeFinal: aNumero(cuota.importeFinal as Prisma.Decimal),
    };
  }
}
