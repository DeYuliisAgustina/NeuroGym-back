import type { TipoAcceso } from '@prisma/client';
import { prisma } from '../config/prisma';
import { CODIGOS_MODULO, type CodigoModulo } from '../models/modulos';
import { generarPasswordTemporal } from '../utils/credenciales';
import { conflicto, reglaNegocio } from '../utils/errores';
import { registrarAuditoria } from './auditoria.service';
import { hashPassword } from './auth.service';
import { tenant } from './tenant.service';

type PermisoSolicitado = { modulo: CodigoModulo; acceso: TipoAcceso };

const incluirRol = { permisos: { include: { permiso: { include: { modulo: true } } } }, _count: { select: { personal: true } } };

/** Ids de permisos del catálogo a partir de pares módulo/acceso. */
async function idsPermisos(permisos: PermisoSolicitado[]) {
  const desconocido = permisos.find((p) => !CODIGOS_MODULO.includes(p.modulo));
  if (desconocido) throw reglaNegocio('MODULO_INEXISTENTE', `Módulo inexistente: ${desconocido.modulo}`);
  const filas = await prisma.permiso.findMany({
    where: { OR: permisos.map((p) => ({ acceso: p.acceso, modulo: { codigo: p.modulo } })) },
    select: { id: true },
  });
  return filas.map((f) => f.id);
}

/** Cuentas administrativas y roles con permisos por módulo (RF15). Solo el administrador general. */
export const personalService = {
  listar(gimnasioId: number) {
    return prisma.personalAdministrativo.findMany({
      where: { gimnasioId },
      include: { usuario: { select: { id: true, email: true, nombre: true, apellido: true, activo: true, fechaAlta: true } }, rol: true },
      orderBy: { usuario: { apellido: 'asc' } },
    });
  },

  async crear(gimnasioId: number, usuarioId: number, datos: { email: string; nombre: string; apellido: string; rolId: number }) {
    await tenant.rol(datos.rolId, gimnasioId);
    if (await prisma.usuario.findUnique({ where: { email: datos.email } })) throw conflicto('EMAIL_EN_USO', 'El correo ya está registrado');
    const passwordTemporal = generarPasswordTemporal();
    const personal = await prisma.personalAdministrativo.create({
      data: {
        gimnasio: { connect: { id: gimnasioId } },
        rol: { connect: { id_gimnasioId: { id: datos.rolId, gimnasioId } } },
        usuario: {
          create: {
            email: datos.email,
            nombre: datos.nombre,
            apellido: datos.apellido,
            tipo: 'PERSONAL' as const,
            passwordHash: await hashPassword(passwordTemporal),
          },
        },
      },
      include: { usuario: { select: { id: true, email: true, nombre: true, apellido: true } }, rol: true },
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_PERSONAL', entidad: 'personal_administrativo', entidadId: personal.id });
    return { personal, passwordTemporal };
  },

  async actualizar(personalId: number, gimnasioId: number, usuarioId: number, datos: { nombre?: string; apellido?: string; rolId?: number }) {
    const personal = await tenant.personal(personalId, gimnasioId);
    if (datos.rolId) {
      await tenant.rol(datos.rolId, gimnasioId);
      if (personal.rol.esPrincipal && datos.rolId !== personal.rolId) await verificarOtroAdminGeneral(gimnasioId, personalId);
    }
    await prisma.$transaction([
      prisma.usuario.update({ where: { id: personal.usuarioId }, data: { nombre: datos.nombre, apellido: datos.apellido } }),
      prisma.personalAdministrativo.update({ where: { id: personalId }, data: { rolId: datos.rolId } }),
    ]);
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'MODIFICAR_PERSONAL', entidad: 'personal_administrativo', entidadId: personalId, detalle: datos });
    return tenant.personal(personalId, gimnasioId);
  },

  /** RD20: baja lógica y reversible; conserva el historial del que es responsable. */
  async cambiarEstado(personalId: number, gimnasioId: number, solicitante: { usuarioId: number; personalId: number }, activo: boolean) {
    const personal = await tenant.personal(personalId, gimnasioId);
    if (!activo && personalId === solicitante.personalId) throw reglaNegocio('AUTO_DESACTIVACION', 'No podés desactivar tu propia cuenta');
    if (!activo && personal.rol.esPrincipal) await verificarOtroAdminGeneral(gimnasioId, personalId);
    await prisma.usuario.update({ where: { id: personal.usuarioId }, data: { activo } });
    await registrarAuditoria({
      gimnasioId,
      usuarioId: solicitante.usuarioId,
      accion: activo ? 'REACTIVAR_PERSONAL' : 'DESACTIVAR_PERSONAL',
      entidad: 'personal_administrativo',
      entidadId: personalId,
    });
  },

  // ---------------- Roles y permisos ----------------

  listarRoles(gimnasioId: number) {
    return prisma.rol.findMany({ where: { gimnasioId }, include: incluirRol, orderBy: { nombre: 'asc' } });
  },

  catalogoModulos() {
    return prisma.modulo.findMany({ include: { permisos: true }, orderBy: { nombre: 'asc' } });
  },

  async crearRol(gimnasioId: number, usuarioId: number, datos: { nombre: string; permisos: PermisoSolicitado[] }) {
    const ids = await idsPermisos(datos.permisos);
    const rol = await prisma.rol.create({
      data: { gimnasioId, nombre: datos.nombre, permisos: { create: ids.map((permisoId) => ({ permisoId })) } },
      include: incluirRol,
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_ROL', entidad: 'rol', entidadId: rol.id, detalle: datos });
    return rol;
  },

  async actualizarRol(rolId: number, gimnasioId: number, usuarioId: number, datos: { nombre?: string; permisos?: PermisoSolicitado[] }) {
    const rol = await tenant.rol(rolId, gimnasioId);
    if (rol.esPrincipal) throw reglaNegocio('ROL_PRINCIPAL', 'El rol de administrador general no se modifica');
    const ids = datos.permisos ? await idsPermisos(datos.permisos) : null;
    const actualizado = await prisma.$transaction(async (tx) => {
      if (ids) {
        await tx.rolPermiso.deleteMany({ where: { rolId } });
        await tx.rolPermiso.createMany({ data: ids.map((permisoId) => ({ rolId, permisoId })) });
      }
      return tx.rol.update({ where: { id: rolId }, data: { nombre: datos.nombre }, include: incluirRol });
    });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'MODIFICAR_ROL', entidad: 'rol', entidadId: rolId, detalle: datos });
    return actualizado;
  },

  async eliminarRol(rolId: number, gimnasioId: number, usuarioId: number) {
    const rol = await tenant.rol(rolId, gimnasioId);
    if (rol.esPrincipal) throw reglaNegocio('ROL_PRINCIPAL', 'El rol de administrador general no se elimina');
    if (await prisma.personalAdministrativo.count({ where: { rolId } })) {
      throw reglaNegocio('ROL_EN_USO', 'El rol está asignado a integrantes del personal');
    }
    await prisma.rol.delete({ where: { id: rolId } });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'BAJA_ROL', entidad: 'rol', entidadId: rolId });
  },
};

/** Debe quedar al menos un administrador general activo en el gimnasio. */
async function verificarOtroAdminGeneral(gimnasioId: number, excluirPersonalId: number) {
  const otros = await prisma.personalAdministrativo.count({
    where: { gimnasioId, id: { not: excluirPersonalId }, rol: { esPrincipal: true }, usuario: { activo: true } },
  });
  if (otros === 0) throw reglaNegocio('ULTIMO_ADMIN_GENERAL', 'Debe quedar al menos un administrador general activo');
}
