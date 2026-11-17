import { Prisma, type EnvioMensaje, type EstadoEnvioMensaje, type TipoEnvioMensaje, type TipoNotificacion } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { servicioMensajeria, type EstadoInformado, type ServicioMensajeria } from '../integrations/mensajeria';

export interface SolicitudEnvio {
  tipo: TipoEnvioMensaje;
  /** Clave de idempotencia: el mismo evento nunca genera dos mensajes. */
  referencia: string;
  usuarioId: number;
  telefono: string;
  texto: string;
  comprobanteId?: number;
  cuotaId?: number;
  /** Tipo de la notificación de historial (canal MENSAJERIA) que se registra al aceptarse. */
  tipoNotificacion?: TipoNotificacion;
  eventoTurnoId?: number;
}

/** Orden de avance de los estados que informa el proveedor (un estado no retrocede). */
const ORDEN: Partial<Record<EstadoEnvioMensaje, number>> = { PREPARADO: 0, ACEPTADO: 1, ENVIADO: 2, ENTREGADO: 3, LEIDO: 4 };
const FECHA_DE: Record<EstadoInformado['estado'], keyof Pick<EnvioMensaje, 'fechaEnviado' | 'fechaEntregado' | 'fechaLeido' | 'fechaFallido'>> = {
  ENVIADO: 'fechaEnviado',
  ENTREGADO: 'fechaEntregado',
  LEIDO: 'fechaLeido',
  FALLIDO: 'fechaFallido',
};

/**
 * Envíos por mensajería compatible con WhatsApp (RNF10). Une los eventos de
 * NeuroGym (pago confirmado, vencimiento, aviso de turno o mantenimiento) con el
 * proveedor configurado y registra el estado real de cada mensaje:
 * PREPARADO → ACEPTADO (respuesta de la API) → ENVIADO / ENTREGADO / LEIDO / FALLIDO
 * (webhooks oficiales). Un HTTP 200 nunca se registra como enviado.
 */
export function crearServicioEnvios(mensajeria: ServicioMensajeria) {
  const produccion = () => env.nodeEnv === 'production';

  /** Modo de prueba: solo los socios habilitados reciben mensajes reales (siempre en el número autorizado). */
  async function motivoOmision(usuarioId: number): Promise<string | null> {
    if (produccion() || mensajeria.simulado) return null;
    if (!env.mensajeria.destinoPrueba) return 'Modo de prueba sin WHATSAPP_TEST_RECIPIENT: no se envía a teléfonos de socios';
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { email: true } });
    if (!usuario || !env.mensajeria.sociosPrueba.includes(usuario.email.toLowerCase())) {
      return 'Modo de prueba: el socio no está en WHATSAPP_SOCIOS_PRUEBA (no se envía)';
    }
    return null;
  }

  return {
    get proveedor() {
      return mensajeria.proveedor;
    },

    /**
     * Prepara y envía un mensaje. Idempotente por referencia: si el evento ya
     * generó un mensaje, devuelve ese registro sin volver a enviar.
     */
    async enviar(s: SolicitudEnvio): Promise<EnvioMensaje> {
      const previo = await prisma.envioMensaje.findUnique({ where: { referencia: s.referencia } });
      if (previo) return previo;
      let envio: EnvioMensaje;
      try {
        envio = await prisma.envioMensaje.create({
          data: {
            usuarioId: s.usuarioId,
            tipo: s.tipo,
            referencia: s.referencia,
            proveedor: mensajeria.proveedor,
            texto: s.texto,
            comprobanteId: s.comprobanteId,
            cuotaId: s.cuotaId,
          },
        });
      } catch (error) {
        // Dos eventos simultáneos con la misma referencia: gana el primero.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return prisma.envioMensaje.findUniqueOrThrow({ where: { referencia: s.referencia } });
        }
        throw error;
      }

      const omision = await motivoOmision(s.usuarioId);
      if (omision) return prisma.envioMensaje.update({ where: { id: envio.id }, data: { estado: 'OMITIDO', detalle: omision } });

      const r = await mensajeria.enviar(s.telefono, s.texto);
      if (!r.aceptado) {
        return prisma.envioMensaje.update({
          where: { id: envio.id },
          data: { estado: 'FALLIDO', detalle: (r.error ?? 'El proveedor rechazó la solicitud').slice(0, 500), fechaFallido: new Date() },
        });
      }
      const actualizado = await prisma.envioMensaje.update({
        where: { id: envio.id },
        data: {
          estado: mensajeria.simulado ? 'SIMULADO' : 'ACEPTADO',
          idMensaje: r.idMensaje ?? null,
          destino: r.destino ?? null,
          fechaAceptado: new Date(),
          ...(mensajeria.simulado ? { detalle: 'Simulación: no se envió ningún mensaje' } : {}),
        },
      });
      // Historial de avisos por mensajería (diccionario: notificacion, canal MENSAJERIA).
      if (s.tipoNotificacion) {
        await prisma.notificacion.create({
          data: { usuarioId: s.usuarioId, tipo: s.tipoNotificacion, canal: 'MENSAJERIA', mensaje: s.texto, eventoTurnoId: s.eventoTurnoId },
        });
      }
      return actualizado;
    },

    /**
     * Aplica los estados que informa el webhook del proveedor. Un estado repetido
     * o atrasado no hace retroceder el mensaje; FALLIDO solo aplica si todavía no
     * se entregó. La fecha de envío del comprobante se completa recién cuando el
     * proveedor confirma el envío.
     */
    async registrarEstados(estados: EstadoInformado[]) {
      let actualizados = 0;
      for (const e of estados) {
        const envio = await prisma.envioMensaje.findUnique({ where: { idMensaje: e.idMensaje } });
        if (!envio) continue;
        const datos: Prisma.EnvioMensajeUpdateInput = {};
        if (!envio[FECHA_DE[e.estado]]) datos[FECHA_DE[e.estado]] = e.fecha;
        if (e.estado === 'FALLIDO') {
          if ((ORDEN[envio.estado] ?? -1) < (ORDEN.ENTREGADO ?? 3)) {
            datos.estado = 'FALLIDO';
            datos.detalle = (e.error ?? 'El proveedor informó un fallo').slice(0, 500);
          }
        } else if ((ORDEN[e.estado] ?? 0) > (ORDEN[envio.estado] ?? -1)) {
          datos.estado = e.estado;
        }
        if (Object.keys(datos).length === 0) continue;
        await prisma.envioMensaje.update({ where: { id: envio.id }, data: datos });
        if (envio.comprobanteId && e.estado !== 'FALLIDO') {
          await prisma.comprobante.updateMany({ where: { id: envio.comprobanteId, fechaEnvio: null }, data: { fechaEnvio: e.fecha } });
        }
        actualizados++;
      }
      return { recibidos: estados.length, actualizados };
    },

    /** Último envío de un comprobante (para mostrar su estado real). */
    ultimoDeComprobante(comprobanteId: number) {
      return prisma.envioMensaje.findFirst({ where: { comprobanteId }, orderBy: { id: 'desc' } });
    },
  };
}

export type ServicioEnvios = ReturnType<typeof crearServicioEnvios>;

/** Instancia compartida con el proveedor configurado. */
export const servicioEnvios = crearServicioEnvios(servicioMensajeria);
