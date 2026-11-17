import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { firmaMetaValida, interpretarEstadosWhatsapp, tokenValido } from '../integrations/mensajeria';
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

// 360dialog (sandbox): la URL registrada incluye el token secreto.
whatsappRoutes.post('/webhook/360dialog/:token', async (req, res) => {
  if (!tokenValido(req.params.token, env.mensajeria.webhookToken)) return res.status(401).json({ error: 'TOKEN_INVALIDO' });
  await registrar(req, res, '360dialog');
});
