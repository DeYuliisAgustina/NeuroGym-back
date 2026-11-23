import crypto from 'node:crypto';
import type { PropositoCodigo } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { servicioCorreo } from '../integrations/correo';
import { ErrorApp, reglaNegocio } from '../utils/errores';

export const VIGENCIA_CODIGO_MIN = 15;
export const MAX_INTENTOS_CODIGO = 5;
/** Tiempo mínimo entre dos envíos del mismo código (evita llenar la casilla de alguien). */
export const ESPERA_REENVIO_SEG = 60;

const hashCodigo = (usuarioId: number, proposito: PropositoCodigo, codigo: string) =>
  crypto.createHmac('sha256', env.jwtSecret).update(`${usuarioId}:${proposito}:${codigo}`).digest('hex');

const errorCodigo = (codigo: string, mensaje: string) => reglaNegocio(codigo, mensaje, [{ campo: 'codigo', mensaje }]);
/** Código inexistente, vencido o ya usado (mismo mensaje si el correo no tiene cuenta). */
export const codigoNoValido = () => errorCodigo('CODIGO_VENCIDO', 'El código venció o ya no es válido. Pedí uno nuevo.');

function armarCorreo(nombre: string, proposito: PropositoCodigo, codigo: string) {
  const accion = proposito === 'VERIFICACION_EMAIL' ? 'confirmar tu correo' : 'elegir una contraseña nueva';
  const asunto = proposito === 'VERIFICACION_EMAIL' ? `Tu código para confirmar el correo: ${codigo}` : `Tu código para cambiar la contraseña: ${codigo}`;
  const aviso =
    proposito === 'VERIFICACION_EMAIL'
      ? 'Si no te registraste en NeuroGym, ignorá este correo.'
      : 'Si no pediste cambiar la contraseña, ignorá este correo: tu contraseña sigue igual.';
  const texto = `Hola, ${nombre}:\n\nTu código para ${accion} en NeuroGym es ${codigo}.\nVence en ${VIGENCIA_CODIGO_MIN} minutos.\n\n${aviso}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2a1c">
  <h2 style="color:#3d5a2e;margin:0 0 16px">NeuroGym</h2>
  <p>Hola, ${escapar(nombre)}:</p>
  <p>Tu código para ${accion} es:</p>
  <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0">${codigo}</p>
  <p>Vence en ${VIGENCIA_CODIGO_MIN} minutos.</p>
  <p style="color:#6b7280;font-size:13px">${aviso}</p>
</div>`;
  return { asunto, texto, html };
}

const escapar = (texto: string) => texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Genera un código de 6 dígitos, invalida los anteriores del mismo propósito y lo envía
 * por correo. Si ya se envió uno hace menos de un minuto, no envía otro (devuelve false).
 */
export async function enviarCodigo(usuario: { id: number; email: string; nombre: string }, proposito: PropositoCodigo): Promise<boolean> {
  const reciente = await prisma.codigoEmail.findFirst({
    where: { usuarioId: usuario.id, proposito, usado: false, fechaAlta: { gt: new Date(Date.now() - ESPERA_REENVIO_SEG * 1000) } },
  });
  if (reciente) return false;

  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.codigoEmail.updateMany({ where: { usuarioId: usuario.id, proposito, usado: false }, data: { usado: true } });
  const registro = await prisma.codigoEmail.create({
    data: {
      usuarioId: usuario.id,
      proposito,
      codigoHash: hashCodigo(usuario.id, proposito, codigo),
      vence: new Date(Date.now() + VIGENCIA_CODIGO_MIN * 60 * 1000),
    },
  });
  try {
    await servicioCorreo.enviar({ para: usuario.email, ...armarCorreo(usuario.nombre, proposito, codigo) });
  } catch (e) {
    // El código no llegó: se anula para que se pueda pedir otro enseguida.
    await prisma.codigoEmail.update({ where: { id: registro.id }, data: { usado: true } });
    console.error(`No se pudo enviar el correo (${servicioCorreo.proveedor}):`, (e as Error).message);
    throw new ErrorApp(502, 'CORREO_NO_ENVIADO', 'No pudimos enviar el correo. Probá de nuevo en unos minutos.');
  }
  return true;
}

/** Comprueba el código vigente y lo marca como usado. Cada error descuenta un intento. */
export async function verificarCodigo(usuarioId: number, proposito: PropositoCodigo, codigo: string): Promise<void> {
  const vigente = await prisma.codigoEmail.findFirst({
    where: { usuarioId, proposito, usado: false, vence: { gt: new Date() } },
    orderBy: { fechaAlta: 'desc' },
  });
  if (!vigente || vigente.intentos >= MAX_INTENTOS_CODIGO) {
    throw codigoNoValido();
  }
  const esperado = Buffer.from(vigente.codigoHash, 'hex');
  const recibido = Buffer.from(hashCodigo(usuarioId, proposito, codigo.trim()), 'hex');
  if (!crypto.timingSafeEqual(esperado, recibido)) {
    const intentos = vigente.intentos + 1;
    await prisma.codigoEmail.update({ where: { id: vigente.id }, data: { intentos } });
    const quedan = MAX_INTENTOS_CODIGO - intentos;
    throw quedan > 0
      ? errorCodigo('CODIGO_INCORRECTO', `El código no es correcto. Te ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.`)
      : errorCodigo('CODIGO_VENCIDO', 'Agotaste los intentos. Pedí un código nuevo.');
  }
  await prisma.codigoEmail.update({ where: { id: vigente.id }, data: { usado: true } });
}
