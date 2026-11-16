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
        `WhatsApp: ${env.mensajeria.simulado ? 'SIMULADA' : 'real'} · IA: ${env.ia.simulado ? 'SIMULADA' : env.ia.modelo}`,
    );
  });
  if (env.cronHabilitado) programarTareas();
}

iniciar().catch((error) => {
  console.error('No se pudo iniciar el servidor', error);
  process.exit(1);
});
