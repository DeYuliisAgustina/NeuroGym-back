import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { Dialog360Sandbox, servicioMensajeria } from '../integrations/mensajeria';
import { enmascararTelefono } from '../integrations/mensajeria/WhatsAppCloudApi';
import { cuotaService } from '../patterns/facade';

/**
 * Prueba de WhatsApp con el proveedor configurado (sin costo):
 *   npm run whatsapp:probar                          → muestra la configuración
 *   npm run whatsapp:probar -- --webhook <URL https>  → registra el webhook de estados en el sandbox de 360dialog
 *   npm run whatsapp:probar -- <pagoId>               → reenvía el comprobante de ese pago aprobado y sigue su estado
 * No crea pagos ni comprobantes. Nunca muestra claves ni tokens y oculta el número destino.
 */
async function probar() {
  const m = env.mensajeria;
  const cargada = (v: string) => (v ? 'cargada' : 'VACÍA');
  console.log('Proveedor               ', servicioMensajeria.proveedor);
  console.log('Destinatario de prueba  ', m.destinoPrueba ? enmascararTelefono(m.destinoPrueba) : 'VACÍO');
  console.log('Socios habilitados      ', m.sociosPrueba.length ? m.sociosPrueba.join(', ') : 'NINGUNO');
  if (servicioMensajeria.proveedor === 'DIALOG360_SANDBOX') {
    console.log('DIALOG360_API_KEY       ', cargada(m.dialog360ApiKey));
    console.log('WHATSAPP_WEBHOOK_TOKEN  ', cargada(m.webhookToken));
  }
  if (servicioMensajeria.proveedor === 'META_CLOUD_API') {
    console.log('WHATSAPP_TOKEN          ', cargada(m.whatsappToken));
    console.log('WHATSAPP_APP_SECRET     ', cargada(m.metaAppSecret));
  }

  const [arg, valor] = process.argv.slice(2);
  if (arg === '--webhook') {
    if (!(servicioMensajeria instanceof Dialog360Sandbox)) throw new Error('El registro automático del webhook es para el sandbox de 360dialog');
    if (!valor?.startsWith('https://') || !m.webhookToken) throw new Error('Indicá una URL https pública y cargá WHATSAPP_WEBHOOK_TOKEN');
    const url = `${valor.replace(/\/$/, '')}/api/whatsapp/webhook/360dialog/${m.webhookToken}`;
    const r = await servicioMensajeria.configurarWebhook(url);
    console.log(r.ok ? '\nWebhook de estados registrado en el sandbox.' : `\n360dialog rechazó el webhook (HTTP ${r.estado}): ${r.detalle}`);
    return;
  }

  const pagoId = Number(arg);
  if (!pagoId) return;
  const r = await cuotaService.reenviarComprobante(pagoId);
  console.log(`\nComprobante del pago #${pagoId}: ${r.estado}${r.detalle ? ` · ${r.detalle}` : ''}`);
  if (r.estado !== 'ACEPTADO' || !r.idMensaje) return;
  // Seguimiento: los estados reales llegan por webhook al backend; se consultan durante 60 s.
  for (let i = 0; i < 12; i++) {
    await new Promise((ok) => setTimeout(ok, 5000));
    const envio = await prisma.envioMensaje.findUnique({ where: { idMensaje: r.idMensaje } });
    console.log(`  +${(i + 1) * 5}s: ${envio?.estado}${envio?.detalle ? ` · ${envio.detalle}` : ''}`);
    if (envio && ['ENTREGADO', 'LEIDO', 'FALLIDO'].includes(envio.estado)) break;
  }
}

probar()
  .catch((e) => console.error('Error:', (e as Error).message))
  .finally(() => prisma.$disconnect());
