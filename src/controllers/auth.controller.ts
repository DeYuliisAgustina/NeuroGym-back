import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { cambioPasswordSchema, loginSchema, recuperacionPasswordSchema, soloEmailSchema, verificacionEmailSchema } from '../validations/auth.validation';
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

  /** Reenvía el código para confirmar el correo del autorregistro. */
  async reenviarVerificacion(req: Request, res: Response) {
    const { email } = validar(soloEmailSchema, req.body);
    await authService.reenviarVerificacion(email);
    res.status(204).end();
  },

  async verificarEmail(req: Request, res: Response) {
    const { email, codigo } = validar(verificacionEmailSchema, req.body);
    await authService.verificarEmail(email, codigo);
    res.status(204).end();
  },

  /** «Olvidé mi contraseña»: envía el código por correo. */
  async solicitarRecuperacion(req: Request, res: Response) {
    const { email } = validar(soloEmailSchema, req.body);
    await authService.solicitarRecuperacion(email);
    res.status(204).end();
  },

  async recuperarPassword(req: Request, res: Response) {
    const { email, codigo, nueva } = validar(recuperacionPasswordSchema, req.body);
    await authService.recuperarPassword(email, codigo, nueva);
    res.status(204).end();
  },
};
