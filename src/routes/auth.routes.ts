import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { autenticar } from '../middlewares/autenticacion.middleware';
import { limitarIntentos } from '../middlewares/limite.middleware';

export const authRoutes = Router();

authRoutes.post('/login', limitarIntentos, authController.login);
authRoutes.post('/admin/login', limitarIntentos, authController.loginAdministrativo);
authRoutes.get('/sesion', autenticar, authController.sesion);
authRoutes.put('/password', autenticar, authController.cambiarPassword);
