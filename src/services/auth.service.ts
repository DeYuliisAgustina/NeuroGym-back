import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { PayloadToken, UsuarioAutenticado } from '../models/auth';
import { Rol, type ComponentePermiso, GrupoPermisos } from '../patterns/composite';
import { usuarioRepository } from '../repositories/usuario.repository';
import { ErrorApp, noAutenticado, reglaNegocio } from '../utils/errores';
import { Usuario } from '../domain';
import { registrarAuditoria } from './auditoria.service';

const RONDAS_BCRYPT = 10;

export const hashPassword = (password: string) => bcrypt.hash(password, RONDAS_BCRYPT);

export function firmarToken(payload: PayloadToken): string {
  return jwt.sign({ tipo: payload.tipo }, env.jwtSecret, {
    subject: String(payload.sub),
    expiresIn: env.jwtExpiracion as SignOptions['expiresIn'],
  });
}

export function verificarToken(token: string): PayloadToken {
  try {
    const decodificado = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    return { sub: Number(decodificado.sub), tipo: decodificado.tipo };
  } catch {
    throw noAutenticado();
  }
}

/** Arma el contexto de seguridad desde la base: refleja bajas lógicas y cambios de rol al instante. */
export async function obtenerContexto(usuarioId: number): Promise<UsuarioAutenticado> {
  const usuario = await usuarioRepository.buscarContexto(usuarioId);
  // RD20: una cuenta desactivada no puede operar aunque conserve un token vigente.
  if (!usuario || !usuario.activo) throw noAutenticado('La cuenta no está activa');

  const contexto: UsuarioAutenticado = {
    usuarioId: usuario.id,
    tipo: usuario.tipo,
    nombre: `${usuario.nombre} ${usuario.apellido}`,
  };
  if (usuario.tipo === 'SOCIO' && usuario.socio) {
    contexto.socioId = usuario.socio.id;
    contexto.sedeId = usuario.socio.sedeId;
    contexto.gimnasioId = usuario.socio.sede.gimnasioId;
  } else if (usuario.tipo === 'PERSONAL' && usuario.personal) {
    contexto.personalId = usuario.personal.id;
    contexto.gimnasioId = usuario.personal.gimnasioId;
    contexto.esAdminGeneral = usuario.personal.rol.esPrincipal;
    const catalogo = usuario.personal.rol.esPrincipal ? await usuarioRepository.codigosModulo() : [];
    contexto.rol = Rol.desdePersistencia(usuario.personal.rol, catalogo);
  } else if (usuario.tipo === 'PROFESIONAL' && usuario.profesional) {
    contexto.profesionalId = usuario.profesional.id;
  } else {
    throw noAutenticado('Perfil de usuario incompleto');
  }
  return contexto;
}

/**
 * RF2 y RF14: el ingreso público es para socios y profesionales; el personal
 * del gimnasio ingresa por un acceso administrativo separado.
 */
export async function iniciarSesion(email: string, password: string, acceso: 'PUBLICO' | 'ADMINISTRATIVO') {
  const usuario = await usuarioRepository.buscarPorEmail(email);
  const valida = usuario ? await new Usuario(usuario).verificarPassword(password) : false;
  // Mensaje genérico: no revela si el correo existe.
  if (!usuario || !valida) throw new ErrorApp(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
  // RF2: un socio autorregistrado no ingresa hasta que el gimnasio confirma su alta.
  if (usuario.socio?.pendienteAlta) throw new ErrorApp(403, 'ALTA_PENDIENTE', 'Tu registro está pendiente: el gimnasio tiene que confirmar tu alta');
  if (!usuario.activo) throw new ErrorApp(403, 'CUENTA_INACTIVA', 'La cuenta está desactivada');

  const esAdministrativo = usuario.tipo === 'PERSONAL';
  if (acceso === 'ADMINISTRATIVO' && !esAdministrativo) {
    throw new ErrorApp(403, 'ACCESO_INCORRECTO', 'Usá el ingreso de socios y profesionales');
  }
  if (acceso === 'PUBLICO' && esAdministrativo) {
    throw new ErrorApp(403, 'ACCESO_INCORRECTO', 'El personal del gimnasio ingresa por el acceso administrativo');
  }

  const contexto = await obtenerContexto(usuario.id);
  await registrarAuditoria({
    gimnasioId: contexto.gimnasioId,
    usuarioId: usuario.id,
    accion: 'INICIO_SESION',
    entidad: 'usuario',
    entidadId: usuario.id,
  });
  return { token: firmarToken({ sub: usuario.id, tipo: usuario.tipo }), usuario: describirSesion(contexto) };
}

export async function cambiarPassword(usuarioId: number, actual: string, nueva: string) {
  const usuario = await usuarioRepository.buscarContexto(usuarioId);
  if (!usuario || !(await new Usuario(usuario).verificarPassword(actual))) {
    throw reglaNegocio('PASSWORD_ACTUAL_INVALIDA', 'La contraseña actual no es correcta');
  }
  await usuarioRepository.actualizarPassword(usuarioId, await hashPassword(nueva));
  await registrarAuditoria({ usuarioId, accion: 'CAMBIO_PASSWORD', entidad: 'usuario', entidadId: usuarioId });
}

/** Lista plana de permisos 'MODULO:ACCESO' recorriendo el árbol Composite. */
function hojas(componente: ComponentePermiso): string[] {
  return componente instanceof GrupoPermisos ? componente.getHijos().flatMap(hojas) : [componente.getNombre()];
}

/** Vista de la sesión para el frontend (sin el árbol Composite). */
export function describirSesion(contexto: UsuarioAutenticado) {
  const { rol, ...resto } = contexto;
  return { ...resto, rol: rol?.nombre, permisos: rol ? rol.getComponentes().flatMap(hojas) : [] };
}
