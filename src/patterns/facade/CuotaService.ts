import { Prisma, type MedioPago } from '@prisma/client';
import { prisma, type Tx } from '../../config/prisma';
import type { MercadoPagoGateway, NotificacionEntrante, ResultadoOperacion } from '../../integrations/mercadopago';
import type { ServicioMensajeria } from '../../integrations/mensajeria';
import { cuotaRepository } from '../../repositories/cuota.repository';
import { registrarAuditoria } from '../../services/auditoria.service';
import { notificacionService } from '../../services/notificacion.service';
import { preciosParaSocio } from '../../services/precios.service';
import { aNumero } from '../../utils/dinero';
import { ErrorApp, noEncontrado, reglaNegocio } from '../../utils/errores';
import { ahoraLocal, fechaIso } from '../../utils/fechas';
import { crearEstrategiasCobro, type ComposicionImporte, type EstrategiaCobro } from '../strategy';

/** Quién consulta una cuota: el socio titular o el personal de su gimnasio (RNF4). */
export type Solicitante = { socioId: number } | { gimnasioId: number };

const MEDIOS: MedioPago[] = ['PAGO_UNICO', 'DEBITO_AUTOMATICO', 'EFECTIVO'];

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

  async obtenerDetalleCuota(socioId: number) {
    const cuota = await cuotaRepository.cuotaActual(socioId);
    const adhesion = await cuotaRepository.adhesionActiva(socioId);
    if (!cuota) return { cuota: null, adhesion, importes: null };
    const importes = cuota.estado === 'PAGADA' ? null : await this.obtenerImportesPorMedio(cuota.id, { socioId });
    return { cuota: this.describirCuota(cuota), adhesion, importes };
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

  /** Inicia el cobro con la estrategia del medio elegido por el socio. */
  async iniciarOperacion(cuotaId: number, medio: MedioPago, socioId: number) {
    const estrategia = this.seleccionarEstrategia(medio);
    if (medio === 'EFECTIVO') {
      // CU-001 3.3: se informa el importe completo; el cobro lo registra administración.
      const cuota = await this.cuotaAccesible(cuotaId, { socioId });
      if (cuota.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
      return { tipo: 'INFORMADO' as const, composicion: estrategia.calcularImporte(await preciosParaSocio(socioId)) };
    }
    return prisma.$transaction(async (tx) => {
      await cuotaRepository.bloquear(cuotaId, tx);
      const cuota = await cuotaRepository.buscarConSocio(cuotaId, tx);
      if (!cuota || cuota.socioId !== socioId) throw noEncontrado('Cuota');
      if (cuota.estado === 'PAGADA') throw reglaNegocio('CUOTA_PAGADA', 'La cuota ya está pagada');
      const adhesion = await cuotaRepository.adhesionActiva(socioId, tx);
      return estrategia.cobrar(
        { id: cuota.id, periodo: cuota.periodo, socioId, precios: await preciosParaSocio(socioId, undefined, tx) },
        {
          tx,
          socio: { id: socioId, email: cuota.socio.usuario.email, nombre: cuota.socio.usuario.nombre },
          adhesionActivaId: adhesion?.id ?? null,
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
    const actualizada = await prisma.adhesionDebito.update({
      where: { id: adhesion.id },
      data: { estado: 'CANCELADA', fechaBaja: new Date(`${ahoraLocal().fecha}T00:00:00Z`) },
    });
    await registrarAuditoria({ accion: 'BAJA_DEBITO', entidad: 'adhesion_debito', entidadId: adhesion.id });
    return actualizada;
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
    return this.registrarResultado(resultado);
  }

  /**
   * Retorno desde Checkout Pro: con el payment_id que devuelve Mercado Pago se
   * consulta el pago en la API oficial (no se confía en los parámetros de la URL)
   * y se registra por el mismo camino idempotente que el webhook.
   */
  async confirmarRetornoPago(paymentId: string, socioId: number) {
    const resultado = await this.gateway.consultarPago(paymentId);
    if (!resultado || resultado.tipo !== 'PAGO') return { procesado: false, estado: 'PENDIENTE_DE_CONFIRMACION' };
    const pago = await prisma.pago.findUnique({ where: { id: resultado.pagoId }, include: { cuota: true } });
    if (!pago || pago.cuota.socioId !== socioId) throw noEncontrado('Pago');
    return { ...(await this.registrarResultado(resultado)), aprobado: resultado.aprobado };
  }

  /** Retorno desde la autorización del débito automático (preapproval_id). */
  async confirmarRetornoAdhesion(idPreaprobacion: string, socioId: number) {
    const resultado = await this.gateway.consultarPreaprobacion(idPreaprobacion);
    if (!resultado || resultado.tipo !== 'ADHESION') return { procesado: false };
    if (resultado.socioId !== socioId) throw noEncontrado('Adhesión');
    return { ...(await this.registrarResultado(resultado)), autorizada: resultado.autorizada };
  }

  /**
   * Registra el resultado de una operación. Es idempotente: una notificación
   * repetida no duplica pagos (referencia_externa única y un solo pago APROBADO por cuota).
   */
  async registrarResultado(op: ResultadoOperacion): Promise<{ procesado: boolean; pagoId?: number; duplicado?: boolean }> {
    try {
      if (op.tipo === 'ADHESION') return await this.registrarAdhesion(op);
      const pagoAprobado = op.tipo === 'PAGO' ? await this.registrarPagoUnico(op) : await this.registrarDebito(op);
      if (pagoAprobado.pagoId && pagoAprobado.aprobado) await this.enviarComprobante(pagoAprobado.pagoId);
      return { procesado: pagoAprobado.procesado, pagoId: pagoAprobado.pagoId, duplicado: pagoAprobado.duplicado };
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
      if (!pago || pago.medio !== 'PAGO_UNICO' || pago.estado !== 'PENDIENTE') {
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

  private async registrarDebito(op: Extract<ResultadoOperacion, { tipo: 'DEBITO' }>) {
    return prisma.$transaction(async (tx) => {
      if (await cuotaRepository.pagoPorReferencia(op.referenciaExterna, tx)) return { procesado: false, duplicado: true, aprobado: false };
      const adhesion = await cuotaRepository.adhesionPorPreaprobacion(op.idPreaprobacion, tx);
      if (!adhesion) return { procesado: false, aprobado: false };
      const cuota = await cuotaRepository.cuotaActual(adhesion.socioId, tx);
      if (!cuota || cuota.estado === 'PAGADA') {
        await registrarAuditoria({ accion: 'DEBITO_SIN_CUOTA_PENDIENTE', entidad: 'adhesion_debito', entidadId: adhesion.id }, tx);
        return { procesado: false, aprobado: false };
      }
      await cuotaRepository.bloquear(cuota.id, tx);
      const composicion = this.estrategias.DEBITO_AUTOMATICO.calcularImporte(await preciosParaSocio(adhesion.socioId, undefined, tx));
      const pago = await tx.pago.create({
        data: {
          cuotaId: cuota.id,
          adhesionId: adhesion.id,
          medio: 'DEBITO_AUTOMATICO',
          importe: composicion.importeFinal,
          estado: op.aprobado ? 'APROBADO' : 'RECHAZADO',
          referenciaExterna: op.referenciaExterna,
        },
      });
      if (op.aprobado) await this.confirmarPago(tx, pago.id, composicion);
      else await this.notificarSocio(tx, adhesion.socioId, `No se pudo debitar la cuota ${cuota.periodo}. Podés pagarla con Mercado Pago o en efectivo.`);
      return { procesado: true, pagoId: pago.id, aprobado: op.aprobado };
    });
  }

  private async registrarAdhesion(op: Extract<ResultadoOperacion, { tipo: 'ADHESION' }>) {
    return prisma.$transaction(async (tx) => {
      if (await cuotaRepository.adhesionPorPreaprobacion(op.idPreaprobacion, tx)) return { procesado: false, duplicado: true };
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
  private async enviarComprobante(pagoId: number): Promise<boolean> {
    const pago = await cuotaRepository.comprobanteDePago(pagoId);
    if (!pago?.comprobante) return false;
    const { socio } = pago.cuota;
    const texto =
      `NeuroGym - Comprobante ${pago.comprobante.numero}\n` +
      `Cuota ${pago.cuota.periodo} · ${pago.medio.replace('_', ' ').toLowerCase()}\n` +
      `Importe abonado: $${aNumero(pago.importe).toFixed(2)} · ${fechaIso(pago.fecha)}`;
    await notificacionService.notificar({ usuarioId: socio.usuarioId, tipo: 'PAGO', mensaje: `Pago confirmado: cuota ${pago.cuota.periodo}.` });
    const resultado = await this.mensajeria.enviar(socio.telefono, texto);
    if (!resultado.enviado) return false;
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

  private describirCuota(cuota: { id: number; periodo: string; estado: string; fechaVencimiento: Date } & Record<string, unknown>) {
    return {
      id: cuota.id,
      periodo: cuota.periodo,
      estado: cuota.estado,
      fechaVencimiento: fechaIso(cuota.fechaVencimiento),
      cuotaBase: aNumero(cuota.cuotaBase as Prisma.Decimal),
      adicionalPremium: aNumero(cuota.adicionalPremium as Prisma.Decimal),
      descuento: aNumero(cuota.descuento as Prisma.Decimal),
      importeFinal: aNumero(cuota.importeFinal as Prisma.Decimal),
    };
  }
}
