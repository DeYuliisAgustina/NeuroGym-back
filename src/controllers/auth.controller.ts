import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { cambioPasswordSchema, loginSchema } from '../validations/auth.validation';
import { validar } from '../utils/validar';

export const authController = {
  /** Ingreso público: socios y profesionales (RF2). */
  async login(req: Request, res: Response) {
    const { email, password } = validar(loginSchema, req.body);
    res.json(await authService.iniciarSesion(email, password, 'PUBLICO'));
  },

  /** Acceso administrativo separado para el personal del gimnasio (RF14). */
  async loginAdministrativo(req: Request, res: Response) {
    const { email, password } = validar(loginSchema, req.body);
    res.json(await authService.iniciarSesion(email, password, 'ADMINISTRATIVO'));
  },

  async sesion(req: Request, res: Response) {
    res.json(authService.describirSesion(req.usuario!));
  },

  async cambiarPassword(req: Request, res: Response) {
    const { actual, nueva } = validar(cambioPasswordSchema, req.body);
    await authService.cambiarPassword(req.usuario!.usuarioId, actual, nueva);
    res.status(204).end();
  },
};
