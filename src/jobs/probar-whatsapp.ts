import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { enmascararTelefono } from '../integrations/mensajeria/WhatsAppCloudApi';
import { cuotaService } from '../patterns/facade';

/**
 * Prueba de WhatsApp Business Cloud API con el número de prueba gratuito de Meta:
 *   npm run whatsapp:probar             → solo verifica la configuración
 *   npm run whatsapp:probar -- <pagoId> → reenvía el comprobante de ese pago aprobado
 * No crea pagos ni cobra nada. Nunca muestra el token y oculta el número destino.
 */
async function probar() {
  const m = env.mensajeria;
  const cargada = (v: string) => (v ? 'cargada' : 'VACÍA');
  console.log('WHATSAPP_TOKEN          ', cargada(m.whatsappToken));
  console.log('WHATSAPP_PHONE_NUMBER_ID', cargada(m.whatsappPhoneNumberId));
  console.log('WHATSAPP_TEST_RECIPIENT ', m.destinoPrueba ? enmascararTelefono(m.destinoPrueba) : 'VACÍA');
  console.log('Graph API               ', m.apiVersion);
  if (m.simulado) {
    console.log('\nResultado: mensajería SIMULADA (faltan el token o el id del número).');
    return;
  }
  // Datos públicos del número emisor (el de prueba de Meta se llama "Test Number").
  const r = await fetch(`https://graph.facebook.com/${m.apiVersion}/${m.whatsappPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
    headers: { Authorization: `Bearer ${m.whatsappToken}` },
  });
  const numero = (await r.json()) as { verified_name?: string; display_phone_number?: string; error?: { code?: number; message?: string } };
  if (!r.ok) {
    console.log(`\nMeta rechazó la consulta del número (${numero.error?.code ?? r.status}): ${numero.error?.message ?? ''}`);
    return;
  }
  console.log(`Número emisor            ${numero.verified_name} (${numero.display_phone_number})`);

  const pagoId = Number(process.argv[2]);
  if (!pagoId) return;
  const resultado = await cuotaService.reenviarComprobante(pagoId);
  console.log(resultado.enviado ? `\nComprobante del pago #${pagoId} enviado.` : `\nNo se envió: ${resultado.error}`);
}

probar()
  .catch((e) => console.error('Error:', (e as Error).message))
  .finally(() => prisma.$disconnect());
