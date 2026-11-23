import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { socioController } from '../controllers/socio.controller';
import { autenticar } from '../middlewares/autenticacion.middleware';
import { limitarIntentos } from '../middlewares/limite.middleware';

export const authRoutes = Router();

authRoutes.post('/login', limitarIntentos, authController.login);
authRoutes.post('/admin/login', limitarIntentos, authController.loginAdministrativo);
// RF2: autorregistro del socio (queda pendiente hasta que el gimnasio confirma el alta).
authRoutes.get('/registro/opciones', socioController.opcionesRegistro);
authRoutes.post('/registro', limitarIntentos, socioController.preRegistrar);
// Verificación del correo del autorregistro y recuperación de la contraseña con un código por correo.
authRoutes.post('/verificacion/codigo', limitarIntentos, authController.reenviarVerificacion);
authRoutes.post('/verificacion', limitarIntentos, authController.verificarEmail);
authRoutes.post('/recuperacion', limitarIntentos, authController.solicitarRecuperacion);
authRoutes.post('/recuperacion/confirmacion', limitarIntentos, authController.recuperarPassword);
authRoutes.get('/sesion', autenticar, authController.sesion);
authRoutes.put('/password', autenticar, authController.cambiarPassword);
