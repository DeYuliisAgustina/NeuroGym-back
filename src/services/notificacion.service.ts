import type { TipoNotificacion } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { servicioMensajeria } from '../integrations/mensajeria';
import { noEncontrado } from '../utils/errores';

/** Notificaciones internas (RF33) y avisos por mensajería compatible con WhatsApp (RNF10). */
export const notificacionService = {
  notificar(
    datos: { usuarioId: number; tipo: TipoNotificacion; mensaje: string; eventoTurnoId?: number },
    tx: Tx | typeof prisma = prisma,
  ) {
    return tx.notificacion.create({ data: { ...datos, canal: 'PLATAFORMA' } });
  },

  /** Envía por mensajería y deja registro solo si el servicio confirma el envío. */
  async enviarMensaje(datos: {
    usuarioId: number;
    telefono: string;
    tipo: TipoNotificacion;
    mensaje: string;
    eventoTurnoId?: number;
  }) {
    const { telefono, ...registro } = datos;
    const resultado = await servicioMensajeria.enviar(telefono, datos.mensaje);
    if (resultado.enviado) await prisma.notificacion.create({ data: { ...registro, canal: 'MENSAJERIA' } });
    return resultado;
  },

  listar(usuarioId: number, soloNoLeidas = false) {
    return prisma.notificacion.findMany({
      where: { usuarioId, canal: 'PLATAFORMA', ...(soloNoLeidas ? { leida: false } : {}) },
      orderBy: { fecha: 'desc' },
      take: 100,
    });
  },

  async marcarLeida(usuarioId: number, notificacionId: number) {
    // El filtro por usuario impide marcar notificaciones ajenas.
    const { count } = await prisma.notificacion.updateMany({ where: { id: notificacionId, usuarioId }, data: { leida: true } });
    if (count === 0) throw noEncontrado('Notificación');
  },

  marcarTodasLeidas(usuarioId: number) {
    return prisma.notificacion.updateMany({ where: { usuarioId, leida: false }, data: { leida: true } });
  },
};
