import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { CorreoSimulado } from './CorreoSimulado';
import { esDominioDePrueba, type Correo, type ServicioCorreo } from './ServicioCorreo';

/**
 * Envío real con Gmail por SMTP (gratuito). Requiere GMAIL_USUARIO y una contraseña
 * de aplicación (GMAIL_PASSWORD_APP), no la contraseña de la cuenta.
 */
export class CorreoGmail implements ServicioCorreo {
  readonly proveedor = 'GMAIL' as const;
  private readonly transporte: Transporter;
  private readonly simulado = new CorreoSimulado();

  constructor() {
    this.transporte = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.correo.gmailUsuario, pass: env.correo.gmailPasswordApp },
    });
  }

  async enviar(correo: Correo): Promise<void> {
    // Las cuentas de prueba (@neurogym.test) no tienen casilla real: se muestran en la consola.
    if (esDominioDePrueba(correo.para)) return this.simulado.enviar(correo);
    await this.transporte.sendMail({
      from: { name: env.correo.nombreRemitente, address: env.correo.gmailUsuario },
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
    });
  }
}
