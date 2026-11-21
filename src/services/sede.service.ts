import { prisma } from '../config/prisma';
import { Gimnasio, Sede, SuscripcionSaaS } from '../domain';
import { registrarAuditoria } from './auditoria.service';
import { tenant } from './tenant.service';

interface DatosSede {
  nombre: string;
  direccion: string;
  horarios: string;
}

/** RD2: el gimnasio agrega una sede habilitada solo si su suscripción SaaS lo permite. */
async function verificarCupoSedes(gimnasioId: number, sede: Sede) {
  const gimnasio = await prisma.gimnasio.findUniqueOrThrow({ where: { id: gimnasioId }, include: { suscripcion: true } });
  const habilitadas = await prisma.sede.count({ where: { gimnasioId, habilitada: true } });
  new Gimnasio(gimnasio, new SuscripcionSaaS(gimnasio.suscripcion!), habilitadas).agregarSede(sede);
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
    await verificarCupoSedes(gimnasioId, new Sede({ ...datos, habilitada: true }));
    const sede = await prisma.sede.create({ data: { ...datos, gimnasioId } });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_SEDE', entidad: 'sede', entidadId: sede.id });
    return sede;
  },

  async actualizar(sedeId: number, gimnasioId: number, usuarioId: number, datos: Partial<DatosSede>) {
    const actual = new Sede(await tenant.sede(sedeId, gimnasioId));
    if (datos.horarios !== undefined) actual.configurarHorarios(datos.horarios);
    const sede = await prisma.sede.update({ where: { id: sedeId }, data: { ...datos, ...(datos.horarios !== undefined ? { horarios: actual.horarios } : {}) } });
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
    const dominio = new Sede(sede);
    if (habilitada) await verificarCupoSedes(gimnasioId, dominio);
    dominio.cambiarHabilitacion(habilitada);
    const actualizada = await prisma.sede.update({ where: { id: sedeId }, data: { habilitada: dominio.habilitada } });
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
