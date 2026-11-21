import type { Request, Response } from 'express';
import { cuotaService } from '../patterns/facade';
import { destinoRetornoAdhesion } from '../integrations/mercadopago/MercadoPagoApiGateway';
import { env } from '../config/env';
import { cobranzaService } from '../services/cobranza.service';
import { personalDe, socioDe } from '../utils/contexto';
import { aFechaDb } from '../utils/fechas';
import { idParam, validar } from '../utils/validar';
import { filtroCuotasSchema, filtroPagosSchema, operacionSchema, retornoMercadoPagoSchema } from '../validations/operacion.validation';
import { periodoSchema } from '../validations/comunes.validation';

/**
 * CuotaController: recibe las solicitudes HTTP y delega en la fachada
 * CuotaService (patrón Facade), como en los diagramas de secuencia de CU-001.
 */
export const cuotaController = {
  // ---------------- Socio (CU-001) ----------------
  /** GET /api/cuotas/actual — CU-001-001. */
  async detalle(req: Request, res: Response) {
    res.json(await cuotaService.obtenerDetalleCuota(socioDe(req).socioId));
  },
  /** POST /api/pagos/verificacion — al abrir «Cuotas y pagos», confirma con Mercado Pago los pagos pendientes. */
  async verificarPendientes(req: Request, res: Response) {
    res.json(await cuotaService.verificarPagosPendientes(socioDe(req).socioId));
  },
  /** GET /api/cuotas/{id}/medios — CU-001-002. */
  async medios(req: Request, res: Response) {
    res.json(await cuotaService.obtenerImportesPorMedio(idParam(req.params.id), { socioId: socioDe(req).socioId }));
  },
  /** GET /api/adhesiones/condiciones — CU-001-004 y CU-001-005. */
  async descuentoDebito(req: Request, res: Response) {
    res.json(await cuotaService.calcularDescuento(socioDe(req).socioId));
  },
  /** POST /api/operaciones — CU-001-003/004/006: inicia el pago con la estrategia del medio elegido. */
  async pagar(req: Request, res: Response) {
    const { cuotaId, medio } = validar(operacionSchema, req.body);
    res.status(201).json(await cuotaService.iniciarOperacion(cuotaId, medio, socioDe(req).socioId));
  },
  /** GET /api/pagos?filtros — CU-001-008. */
  async historial(req: Request, res: Response) {
    const f = validar(filtroPagosSchema, req.query);
    res.json(
      await cuotaService.listarPagos(socioDe(req).socioId, {
        medio: f.medio,
        periodo: f.periodo,
        referencia: f.referencia,
        desde: f.desde ? aFechaDb(f.desde) : undefined,
        hasta: f.hasta ? new Date(aFechaDb(f.hasta).getTime() + 86_399_999) : undefined,
      }),
    );
  },
  /** GET /api/pagos/{id}/comprobante — CU-001-009. */
  async comprobante(req: Request, res: Response) {
    const usuario = req.usuario!;
    const solicitante = usuario.tipo === 'SOCIO' ? { socioId: usuario.socioId! } : { gimnasioId: usuario.gimnasioId! };
    res.json(await cuotaService.obtenerComprobante(idParam(req.params.id), solicitante));
  },
  /** Descarga del comprobante en PDF (socio titular o personal de su gimnasio). */
  async comprobantePdf(req: Request, res: Response) {
    const usuario = req.usuario!;
    const solicitante = usuario.tipo === 'SOCIO' ? { socioId: usuario.socioId! } : { gimnasioId: usuario.gimnasioId! };
    const pdf = await cuotaService.pdfComprobante(idParam(req.params.id), solicitante);
    res
      .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdf.nombre}"`, 'Cache-Control': 'no-store, private' })
      .send(pdf.contenido);
  },
  /** DELETE /api/adhesiones/{id} — CU-001-010. */
  async cancelarDebito(req: Request, res: Response) {
    res.json(await cuotaService.cancelarAdhesion(idParam(req.params.id), socioDe(req).socioId));
  },

  // ---------------- Personal de cobros ----------------
  async listar(req: Request, res: Response) {
    res.json(await cobranzaService.listarCuotas(personalDe(req).gimnasioId, validar(filtroCuotasSchema, req.query)));
  },
  async resumen(req: Request, res: Response) {
    const periodo = req.query.periodo ? validar(periodoSchema, req.query.periodo) : undefined;
    res.json(await cobranzaService.resumenPeriodo(personalDe(req).gimnasioId, periodo));
  },
  /** RF19: registro de un pago en efectivo por personal autorizado. */
  async registrarEfectivo(req: Request, res: Response) {
    res.status(201).json(await cuotaService.registrarEfectivo(idParam(req.params.id), personalDe(req)));
  },

  // ---------------- Mercado Pago ----------------
  /** POST /api/webhooks/mp — webhook de Mercado Pago: responde 200 rápido; la firma se valida en la fachada. */
  async webhook(req: Request, res: Response) {
    const cuerpo = (req.body ?? {}) as { type?: string; action?: string };
    const resultado = await cuotaService.procesarWebhook({ encabezados: req.headers, query: req.query as Record<string, unknown>, cuerpo: req.body });
    // Registro de desarrollo para verificar la recepción (sin firmas, ids ni datos personales).
    if (env.nodeEnv === 'development') console.log(`[Mercado Pago] webhook ${cuerpo.type ?? req.query.type ?? '?'} ${cuerpo.action ?? ''} →`, JSON.stringify(resultado));
    res.json(resultado);
  },

  /**
   * Retorno desde Mercado Pago (Checkout Pro o autorización del débito): el
   * resultado se confirma consultando la API oficial, nunca con la URL.
   */
  async confirmarRetorno(req: Request, res: Response) {
    const datos = validar(retornoMercadoPagoSchema, req.body);
    const { socioId } = socioDe(req);
    if (datos.pagoId) return res.json(await cuotaService.confirmarRetornoPago(datos.pagoId, socioId));
    res.json(await cuotaService.confirmarRetornoAdhesion(datos.preapprovalId!, socioId));
  },

  /** Regreso local de la autorización del débito: solo redirige al frontend (no registra nada). */
  retornoAdhesion(req: Request, res: Response) {
    res.redirect(302, destinoRetornoAdhesion(req.query.preapproval_id));
  },

  /** Estado de la integración, visible en la defensa (sin datos sensibles). */
  async estadoIntegracion(_req: Request, res: Response) {
    res.json({ mercadoPago: cuotaService.modoIntegracion });
  },
};
