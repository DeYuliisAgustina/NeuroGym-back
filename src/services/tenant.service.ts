import { prisma, type Tx } from '../config/prisma';
import { noEncontrado } from '../utils/errores';

type Cliente = Tx | typeof prisma;

/**
 * Aislamiento multiempresa (RNF4). Cada búsqueda por identificador se filtra
 * por el gimnasio del usuario autenticado: cambiar un id en la solicitud no
 * permite leer ni modificar datos de otro gimnasio (responde 404).
 */
export const tenant = {
  async sede(sedeId: number, gimnasioId: number, cliente: Cliente = prisma) {
    const sede = await cliente.sede.findFirst({ where: { id: sedeId, gimnasioId } });
    if (!sede) throw noEncontrado('Sede');
    return sede;
  },

  async socio(socioId: number, gimnasioId: number, cliente: Cliente = prisma) {
    const socio = await cliente.socio.findFirst({
      where: { id: socioId, sede: { gimnasioId } },
      include: { usuario: true, plan: true, sede: true },
    });
    if (!socio) throw noEncontrado('Socio');
    return socio;
  },

  async equipo(equipoId: number, gimnasioId: number, cliente: Cliente = prisma) {
    const equipo = await cliente.equipo.findFirst({ where: { id: equipoId, sede: { gimnasioId } }, include: { sede: true } });
    if (!equipo) throw noEncontrado('Equipo');
    return equipo;
  },

  async turnoClase(turnoId: number, gimnasioId: number, cliente: Cliente = prisma) {
    const turno = await cliente.turnoClase.findFirst({ where: { id: turnoId, sede: { gimnasioId } }, include: { sede: true } });
    if (!turno) throw noEncontrado('Turno');
    return turno;
  },

  async personal(personalId: number, gimnasioId: number, cliente: Cliente = prisma) {
    const personal = await cliente.personalAdministrativo.findFirst({
      where: { id: personalId, gimnasioId },
      include: { usuario: true, rol: true },
    });
    if (!personal) throw noEncontrado('Integrante del personal');
    return personal;
  },

  async rol(rolId: number, gimnasioId: number, cliente: Cliente = prisma) {
    const rol = await cliente.rol.findFirst({ where: { id: rolId, gimnasioId } });
    if (!rol) throw noEncontrado('Rol');
    return rol;
  },
};
