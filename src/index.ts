import { crearApp } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { programarTareas } from './jobs/programador';

async function iniciar() {
  await prisma.$connect();
  const app = crearApp();
  app.listen(env.puerto, () => {
    console.log(`NeuroGym API escuchando en http://localhost:${env.puerto}`);
    console.log(
      `Integraciones → Mercado Pago: ${env.mercadoPago.configurado ? 'API oficial (entorno de PRUEBA)' : 'NO CONFIGURADO'} · ` +
        `WhatsApp: ${{ DIALOG360_SANDBOX: 'real (sandbox de 360dialog)', META_CLOUD_API: 'real (WhatsApp Cloud API de Meta)', SIMULADO: 'SIMULADA' }[env.mensajeria.proveedor]} · ` +
        `IA de rutinas: ${{ GEMINI: `real (Gemini, ${env.ia.geminiModelo})`, CLAUDE: `real (Claude, ${env.ia.modelo})`, SIMULADO: 'SIMULADA (sin GEMINI_API_KEY ni ANTHROPIC_API_KEY)' }[env.ia.proveedor]}`,
    );
  });
  if (env.cronHabilitado) programarTareas();
}

iniciar().catch((error) => {
  console.error('No se pudo iniciar el servidor', error);
  process.exit(1);
});
