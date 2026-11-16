import { prisma } from '../config/prisma';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal, sumarDias } from '../utils/fechas';
import { notificacionService } from './notificacion.service';
import { bonificacionVigente } from './precios.service';

interface DatosBeneficio {
  nombre: string;
  descripcion: string;
  costoPuntos: number;
  vigenciaDias: number;
  disponible?: boolean;
}

/** Beneficios por constancia (RF11, RD9): configuración del gimnasio y canje del socio. */
export const beneficioService = {
  listar(gimnasioId: number, soloDisponibles = false) {
    return prisma.beneficio.findMany({
      where: { gimnasioId, ...(soloDisponibles ? { disponible: true } : {}) },
      include: { _count: { select: { canjes: true } } },
      orderBy: { costoPuntos: 'asc' },
    });
  },

  crear(gimnasioId: number, datos: DatosBeneficio) {
    return prisma.beneficio.create({ data: { ...datos, gimnasioId } });
  },

  async actualizar(beneficioId: number, gimnasioId: number, datos: Partial<DatosBeneficio>) {
    const { count } = await prisma.beneficio.updateMany({ where: { id: beneficioId, gimnasioId }, data: datos });
    if (count === 0) throw noEncontrado('Beneficio');
    return prisma.beneficio.findUniqueOrThrow({ where: { id: beneficioId } });
  },

  /** "Mis beneficios": saldo, días de constancia y canjes del socio. */
  async resumenSocio(socio: { socioId: number; gimnasioId: number }) {
    const hoy = ahoraLocal().fecha;
    const [datos, diasMes, canjes, beneficios, bonificacion] = await Promise.all([
      prisma.socio.findUniqueOrThrow({ where: { id: socio.socioId }, select: { saldoPuntos: true } }),
      prisma.diaConstancia.count({ where: { socioId: socio.socioId, fecha: { gte: aFechaDb(`${hoy.slice(0, 7)}-01`) } } }),
      prisma.canje.findMany({ where: { socioId: socio.socioId }, include: { beneficio: true }, orderBy: { fecha: 'desc' } }),
      this.listar(socio.gimnasioId, true),
      bonificacionVigente(socio.socioId),
    ]);
    return {
      saldoPuntos: datos.saldoPuntos,
      diasConstanciaMes: diasMes,
      bonificacionPremium: bonificacion,
      beneficios,
      canjes: canjes.map((c) => ({ ...c, vigente: c.venceEl >= aFechaDb(hoy) })),
    };
  },

  /** Canje con bloqueo de la fila del socio para no gastar dos veces los mismos puntos. */
  async canjear(socio: { socioId: number; gimnasioId: number; usuarioId: number }, beneficioId: number) {
    const canje = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT socio_id FROM socio WHERE socio_id = ${socio.socioId} FOR UPDATE`;
      const beneficio = await tx.beneficio.findFirst({ where: { id: beneficioId, gimnasioId: socio.gimnasioId } });
      if (!beneficio) throw noEncontrado('Beneficio');
      if (!beneficio.disponible) throw reglaNegocio('BENEFICIO_NO_DISPONIBLE', 'El beneficio no está disponible');
      const { saldoPuntos } = await tx.socio.findUniqueOrThrow({ where: { id: socio.socioId } });
      if (saldoPuntos < beneficio.costoPuntos) {
        throw reglaNegocio('PUNTOS_INSUFICIENTES', `Necesitás ${beneficio.costoPuntos} puntos y tenés ${saldoPuntos}`);
      }
      await tx.socio.update({ where: { id: socio.socioId }, data: { saldoPuntos: { decrement: beneficio.costoPuntos } } });
      return tx.canje.create({
        data: {
          socioId: socio.socioId,
          beneficioId,
          puntosUtilizados: beneficio.costoPuntos,
          venceEl: aFechaDb(sumarDias(ahoraLocal().fecha, beneficio.vigenciaDias)),
        },
        include: { beneficio: true },
      });
    });
    await notificacionService.notificar({
      usuarioId: socio.usuarioId,
      tipo: 'BENEFICIO',
      mensaje: `Canjeaste "${canje.beneficio.nombre}". Vence el ${canje.venceEl.toISOString().slice(0, 10)}.`,
    });
    return canje;
  },
};
