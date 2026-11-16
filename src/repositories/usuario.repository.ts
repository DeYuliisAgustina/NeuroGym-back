import { prisma } from '../config/prisma';

/** Acceso a datos de usuarios y del contexto de seguridad. */
export const usuarioRepository = {
  buscarPorEmail(email: string) {
    return prisma.usuario.findUnique({ where: { email: email.toLowerCase() } });
  },

  /** Usuario con su perfil y, si es personal, el rol con permisos para armar el Composite. */
  buscarContexto(usuarioId: number) {
    return prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: {
        socio: { include: { sede: { select: { gimnasioId: true } } } },
        profesional: { select: { id: true } },
        personal: {
          include: {
            rol: { include: { permisos: { include: { permiso: { include: { modulo: true } } } } } },
          },
        },
      },
    });
  },

  codigosModulo() {
    return prisma.modulo.findMany({ select: { codigo: true } }).then((m) => m.map((x) => x.codigo));
  },

  actualizarPassword(usuarioId: number, passwordHash: string) {
    return prisma.usuario.update({ where: { id: usuarioId }, data: { passwordHash } });
  },
};
