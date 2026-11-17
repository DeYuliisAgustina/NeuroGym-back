import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { manejarErrores } from './middlewares/errores.middleware';
import { apiRoutes } from './routes';

/**
 * Capa de lógica de negocio expuesta como API REST con JSON (arquitectura
 * cliente/servidor de tres capas): presentación (NeuroGym-front) → API → PostgreSQL.
 */
export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.frontendUrl.split(','), credentials: false }));
  app.use(
    express.json({
      limit: '1mb',
      // Cuerpo crudo para validar firmas HMAC de webhooks (X-Hub-Signature-256 de Meta).
      verify: (req, _res, buf) => {
        (req as unknown as { cuerpoCrudo?: Buffer }).cuerpoCrudo = buf;
      },
    }),
  );

  // Archivos de incidencias guardados por el almacenamiento local de desarrollo.
  app.use('/archivos', express.static(env.almacenamiento.directorioLocal, { fallthrough: false }));

  app.get('/api/salud', (_req, res) => res.json({ estado: 'ok', servicio: 'neurogym-back' }));
  app.use('/api', apiRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'RUTA_INEXISTENTE', mensaje: 'Recurso no encontrado' }));
  app.use(manejarErrores);
  return app;
}
