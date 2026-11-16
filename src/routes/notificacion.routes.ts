import { Router, type Request, type Response } from 'express';
import { autenticar } from '../middlewares/autenticacion.middleware';
import { notificacionService } from '../services/notificacion.service';
import { idParam } from '../utils/validar';

/** Notificaciones internas de cualquier perfil autenticado (RF33, RF42). */
export const notificacionRoutes = Router();
notificacionRoutes.use(autenticar);

notificacionRoutes.get('/', async (req: Request, res: Response) => {
  res.json(await notificacionService.listar(req.usuario!.usuarioId, req.query.noLeidas === 'true'));
});
notificacionRoutes.patch('/leidas', async (req: Request, res: Response) => {
  await notificacionService.marcarTodasLeidas(req.usuario!.usuarioId);
  res.status(204).end();
});
notificacionRoutes.patch('/:id/leida', async (req: Request, res: Response) => {
  await notificacionService.marcarLeida(req.usuario!.usuarioId, idParam(req.params.id));
  res.status(204).end();
});
