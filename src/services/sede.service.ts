import { prisma } from '../config/prisma';
import { reglaNegocio } from '../utils/errores';
import { registrarAuditoria } from './auditoria.service';
import { tenant } from './tenant.service';

interface DatosSede {
  nombre: string;
  direccion: string;
  horarios: string;
}

/** RD2: límite de sedes habilitadas según la suscripción SaaS. */
async function verificarCupoSedes(gimnasioId: number) {
  const suscripcion = await prisma.suscripcionSaas.findUniqueOrThrow({ where: { gimnasioId } });
  const habilitadas = await prisma.sede.count({ where: { gimnasioId, habilitada: true } });
  if (habilitadas >= suscripcion.maxSedes) {
    throw reglaNegocio('LIMITE_SEDES', `La suscripción ${suscripcion.tipo} admite hasta ${suscripcion.maxSedes} sedes habilitadas.`);
  }
}

/** ABM de sedes con baja lógica y reversible (RF16, RD20, RD21). */
export const sedeService = {
  listar(gimnasioId: number, soloHabilitadas = false) {
    return prisma.sede.findMany({
      where: { gimnasioId, ...(soloHabilitadas ? { habilitada: true } : {}) },
      include: { _count: { select: { socios: true, equipos: true } } },
      orderBy: { nombre: 'asc' },
    });
  },

  obtener: (sedeId: number, gimnasioId: number) => tenant.sede(sedeId, gimnasioId),

  async crear(gimnasioId: number, usuarioId: number, datos: DatosSede) {
    await verificarCupoSedes(gimnasioId);
    const sede = await prisma.sede.create({ data: { ...datos, gimnasioId } });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_SEDE', entidad: 'sede', entidadId: sede.id });
    return sede;
  },

  async actualizar(sedeId: number, gimnasioId: number, usuarioId: number, datos: Partial<DatosSede>) {
    await tenant.sede(sedeId, gimnasioId);
    const sede = await prisma.sede.update({ where: { id: sedeId }, data: datos });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'MODIFICAR_SEDE', entidad: 'sede', entidadId: sedeId, detalle: datos });
    return sede;
  },

  /**
   * RD21: una sede deshabilitada no admite nuevos socios, turnos ni reservas y
   * conserva todo lo registrado; el personal decide reasignaciones (sin cambios automáticos).
   */
  async cambiarHabilitacion(sedeId: number, gimnasioId: number, usuarioId: number, habilitada: boolean) {
    const sede = await tenant.sede(sedeId, gimnasioId);
    if (sede.habilitada === habilitada) return sede;
    if (habilitada) await verificarCupoSedes(gimnasioId);
    const actualizada = await prisma.sede.update({ where: { id: sedeId }, data: { habilitada } });
    await registrarAuditoria({
      gimnasioId,
      usuarioId,
      accion: habilitada ? 'HABILITAR_SEDE' : 'DESHABILITAR_SEDE',
      entidad: 'sede',
      entidadId: sedeId,
    });
    return actualizada;
  },
};
