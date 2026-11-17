import type { Request, Response } from 'express';
import { cuotaService } from '../patterns/facade';
import { cobranzaService } from '../services/cobranza.service';
import { personalDe, socioDe } from '../utils/contexto';
import { aFechaDb } from '../utils/fechas';
import { idParam, validar } from '../utils/validar';
import { filtroCuotasSchema, filtroPagosSchema, medioPagoSchema, retornoMercadoPagoSchema } from '../validations/operacion.validation';
import { periodoSchema } from '../validations/comunes.validation';

/**
 * CuotaController: recibe las solicitudes HTTP y delega en la fachada
 * CuotaService (patrón Facade), como en los diagramas de secuencia de CU-001.
 */
export const cuotaController = {
  // ---------------- Socio (CU-001) ----------------
  async detalle(req: Request, res: Response) {
    res.json(await cuotaService.obtenerDetalleCuota(socioDe(req).socioId));
  },
  /** GET /api/cuotas/{id}/medios — CU-001-002. */
  async medios(req: Request, res: Response) {
    res.json(await cuotaService.obtenerImportesPorMedio(idParam(req.params.id), { socioId: socioDe(req).socioId }));
  },
  async descuentoDebito(req: Request, res: Response) {
    res.json(await cuotaService.calcularDescuento(socioDe(req).socioId));
  },
  /** POST /api/cuotas/{id}/pagos — inicia el pago con la estrategia del medio elegido. */
  async pagar(req: Request, res: Response) {
    const { medio } = validar(medioPagoSchema, req.body);
    res.status(201).json(await cuotaService.iniciarOperacion(idParam(req.params.id), medio, socioDe(req).socioId));
  },
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
  async comprobante(req: Request, res: Response) {
    const usuario = req.usuario!;
    const solicitante = usuario.tipo === 'SOCIO' ? { socioId: usuario.socioId! } : { gimnasioId: usuario.gimnasioId! };
    res.json(await cuotaService.obtenerComprobante(idParam(req.params.id), solicitante));
  },
  async cancelarDebito(req: Request, res: Response) {
    res.json(await cuotaService.cancelarAdhesion(socioDe(req).socioId));
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
  /** Webhook de Mercado Pago: responde 200 rápido; la firma se valida en la fachada. */
  async webhook(req: Request, res: Response) {
    const resultado = await cuotaService.procesarWebhook({ encabezados: req.headers, query: req.query as Record<string, unknown>, cuerpo: req.body });
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

  /** Estado de la integración, visible en la defensa (sin datos sensibles). */
  async estadoIntegracion(_req: Request, res: Response) {
    res.json({ mercadoPago: cuotaService.modoIntegracion });
  },
};
