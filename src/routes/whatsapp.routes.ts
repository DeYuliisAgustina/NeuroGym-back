import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { firmaMetaValida, interpretarEstadosWhatsapp, tokenValido } from '../integrations/mensajeria';
import { prisma } from '../config/prisma';
import { pdfDeComprobante } from '../services/comprobantePdf.service';
import { verificarEnlace } from '../services/enlaceComprobante';
import { servicioEnvios } from '../services/envioMensajes.service';

/**
 * Webhooks oficiales de estado de los mensajes de WhatsApp (sent, delivered,
 * read, failed). Son públicos y se autentican: Meta con la firma
 * X-Hub-Signature-256; el sandbox de 360dialog con un token secreto en la ruta.
 */
export const whatsappRoutes = Router();

async function registrar(req: Request, res: Response, origen: string) {
  const estados = interpretarEstadosWhatsapp(req.body);
  const resultado = await servicioEnvios.registrarEstados(estados);
  if (env.nodeEnv === 'development' && estados.length) {
    console.log(`[WhatsApp] webhook ${origen}:`, estados.map((e) => `${e.estado}${e.error ? ` (${e.error})` : ''}`).join(', '), '→', resultado);
  }
  res.json(resultado);
}

// Meta: verificación de la suscripción (hub.challenge) y estados firmados.
whatsappRoutes.get('/webhook/meta', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && tokenValido(String(req.query['hub.verify_token'] ?? ''), env.mensajeria.metaVerifyToken);
  if (!ok) return res.status(403).json({ error: 'VERIFICACION_INVALIDA' });
  res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
});
whatsappRoutes.post('/webhook/meta', async (req, res) => {
  const crudo = (req as unknown as { cuerpoCrudo?: Buffer }).cuerpoCrudo;
  if (!firmaMetaValida(crudo, req.header('x-hub-signature-256'), env.mensajeria.metaAppSecret)) {
    return res.status(401).json({ error: 'FIRMA_INVALIDA' });
  }
  await registrar(req, res, 'Meta');
});

// PDF del comprobante para que WhatsApp lo descargue: enlace firmado (HMAC) y vigente
// por 15 minutos. Sin firma válida no se entrega nada; no se guarda ningún archivo.
whatsappRoutes.get('/comprobantes/:archivo', async (req, res) => {
  const envioId = Number(/^(\d+)\.pdf$/.exec(req.params.archivo)?.[1]);
  if (!envioId) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  const verificacion = verificarEnlace(envioId, req.query.vence, req.query.firma);
  if (verificacion === 'invalido') return res.status(401).json({ error: 'ENLACE_INVALIDO' });
  if (verificacion === 'vencido') return res.status(410).json({ error: 'ENLACE_VENCIDO' });
  const envio = await prisma.envioMensaje.findUnique({ where: { id: envioId }, include: { comprobante: true } });
  if (!envio || envio.tipo !== 'COMPROBANTE' || !envio.comprobante) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  const pdf = await pdfDeComprobante(envio.comprobante.pagoId);
  if (!pdf) return res.status(404).json({ error: 'NO_ENCONTRADO' });
  res
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdf.nombre}"`,
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow',
    })
    .send(pdf.contenido);
});

// 360dialog (sandbox): la URL registrada incluye el token secreto.
whatsappRoutes.post('/webhook/360dialog/:token', async (req, res) => {
  if (!tokenValido(req.params.token, env.mensajeria.webhookToken)) return res.status(401).json({ error: 'TOKEN_INVALIDO' });
  await registrar(req, res, '360dialog');
});
