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
  // Inicio de la API: indica que el servidor funciona y dónde están las rutas
  // (al abrir http://localhost:3000/ en el navegador ya no aparece un 404).
  app.get(['/', '/api'], (_req, res) =>
    res.json({
      servicio: 'NeuroGym API',
      estado: 'ok',
      mensaje: 'El backend está funcionando. Las rutas de la API están bajo /api; la aplicación se usa desde el frontend.',
      frontend: env.frontendUrl.split(',')[0],
      salud: '/api/salud',
      ejemplo: '/api/publico/planes-marketplace',
    }),
  );
  app.use('/api', apiRoutes);
  // Una dirección de la API escrita sin el prefijo (por ejemplo /publico/planes-marketplace)
  // redirige a la misma ruta bajo /api; si ahí no existe, responde el 404 de siempre.
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/') && !req.path.startsWith('/archivos/')) {
      return res.redirect(308, `/api${req.originalUrl}`);
    }
    next();
  });
  app.use((_req, res) => res.status(404).json({ error: 'RUTA_INEXISTENTE', mensaje: 'Recurso no encontrado' }));
  app.use(manejarErrores);
  return app;
}
