import type { Request, Response } from 'express';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { cuotaService } from '../patterns/facade';
import { cobranzaService } from '../services/cobranza.service';
import { personalDe, socioDe } from '../utils/contexto';
import { ErrorApp, noEncontrado } from '../utils/errores';
import { aFechaDb } from '../utils/fechas';
import { idParam, validar } from '../utils/validar';
import { filtroCuotasSchema, filtroPagosSchema, medioPagoSchema, simulacionSchema } from '../validations/operacion.validation';
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
   * SIMULADOR (solo sin credenciales de Mercado Pago): permite completar en
   * desarrollo el mismo flujo de confirmación que produce un webhook real.
   */
  async simular(req: Request, res: Response) {
    if (!env.mercadoPago.simulado || env.nodeEnv === 'production') throw new ErrorApp(404, 'NO_DISPONIBLE', 'Simulador deshabilitado');
    const datos = validar(simulacionSchema, req.body);
    const usuario = req.usuario!;
    const referencia = `SIM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    if (datos.tipo === 'PAGO') {
      const pago = await prisma.pago.findFirst({ where: { id: datos.pagoId, cuota: { socioId: usuario.socioId } } });
      if (!pago) throw noEncontrado('Pago');
      return res.json(await cuotaService.registrarResultado({ tipo: 'PAGO', pagoId: pago.id, referenciaExterna: referencia, aprobado: datos.aprobar }));
    }
    if (datos.socioId !== usuario.socioId) throw noEncontrado('Socio');
    if (datos.tipo === 'ADHESION') {
      return res.json(
        await cuotaService.registrarResultado({ tipo: 'ADHESION', socioId: datos.socioId, idPreaprobacion: `SIM-PRE-${referencia}`, autorizada: datos.aprobar }),
      );
    }
    const adhesion = await prisma.adhesionDebito.findFirst({ where: { socioId: datos.socioId, estado: 'ACTIVA' } });
    if (!adhesion) throw noEncontrado('Adhesión activa');
    res.json(await cuotaService.registrarResultado({ tipo: 'DEBITO', idPreaprobacion: adhesion.idPreaprobacion, referenciaExterna: referencia, aprobado: datos.aprobar }));
  },
};
