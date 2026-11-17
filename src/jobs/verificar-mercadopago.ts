import { MercadoPagoConfig, User } from 'mercadopago';
import { env } from '../config/env';
import { esCuentaDePrueba } from '../integrations/mercadopago/MercadoPagoApiGateway';

/**
 * Diagnóstico de la configuración de Mercado Pago: `npm run mp:verificar`.
 * Informa si las variables están cargadas y si el Access Token pertenece a una
 * cuenta de prueba. Nunca muestra el token, la clave del webhook ni correos.
 */
async function verificar() {
  const mp = env.mercadoPago;
  const cargada = (v: string) => (v ? 'cargada' : 'VACÍA');
  console.log('MP_ACCESS_TOKEN       ', cargada(mp.accessToken));
  console.log('MP_WEBHOOK_SECRET     ', cargada(mp.webhookSecret), '(necesaria para recibir webhooks)');
  console.log('MP_TEST_PAYER_EMAIL   ', cargada(mp.emailPagadorPrueba), '(solo para el débito automático)');
  console.log('MP_PUBLIC_FRONTEND_URL', cargada(mp.urlRetornoPublica), '(opcional: regreso automático con HTTPS)');
  if (!mp.accessToken) {
    console.log('\nResultado: integración deshabilitada (sin Access Token).');
    return;
  }
  if (mp.accessToken.startsWith('TEST-')) {
    console.log('\nResultado: credencial de prueba (prefijo TEST-). NeuroGym puede operar en modo de prueba.');
    return;
  }
  const usuario = await new User(new MercadoPagoConfig({ accessToken: mp.accessToken, options: { timeout: 10000 } })).get();
  const senales = [
    usuario.tags?.includes('test_user') && 'etiqueta test_user',
    /^TESTUSER/i.test(usuario.nickname ?? '') && 'apodo TESTUSER',
    /@testuser\.com$/i.test(usuario.email ?? '') && 'correo @testuser.com',
  ].filter(Boolean);
  console.log('\nPaís de la cuenta:', usuario.site_id ?? 'desconocido');
  if (esCuentaDePrueba(usuario)) {
    console.log(`Resultado: cuenta DE PRUEBA (${senales.join(', ')}). NeuroGym puede operar en modo de prueba.`);
  } else {
    console.log('Resultado: la credencial NO pertenece a una cuenta de prueba. NeuroGym la rechaza: copiá el Access Token del entorno "Prueba".');
    process.exitCode = 2;
  }
}

verificar().catch((error: { status?: number; message?: string }) => {
  console.error('No se pudo consultar Mercado Pago:', error.status ?? '', error.message ?? 'error desconocido');
  process.exitCode = 1;
});
