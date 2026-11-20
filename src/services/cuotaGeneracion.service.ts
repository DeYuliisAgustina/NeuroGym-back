import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { plantilla } from '../integrations/mensajeria';
import { CobroDebitoAutomatico, CobroPagoUnico } from '../patterns/strategy';
import { cuotaRepository } from '../repositories/cuota.repository';
import { aNumero } from '../utils/dinero';
import { aFechaDb, ahoraLocal, fechaIso, periodoDe } from '../utils/fechas';
import { dinero, mesAnio } from './comprobantePdf.service';
import { notificacionService } from './notificacion.service';
import { preciosParaSocio } from './precios.service';

type Cliente = Tx | typeof prisma;

/** Día del mes en que vence la cuota (el TFI no lo fija; configurable por entorno). */
const DIA_VENCIMIENTO = Number(process.env.CUOTA_DIA_VENCIMIENTO ?? 10);

// Las estrategias solo se usan para calcular importes: no necesitan gateway.
const calculoPagoUnico = new CobroPagoUnico(null as never);
const calculoDebito = new CobroDebitoAutomatico(null as never);

/**
 * Genera la cuota del período si no existe (UNIQUE socio_id, periodo).
 * Con adhesión activa se informa el importe con el descuento del débito (RD6).
 */
export async function generarCuotaSocio(socioId: number, periodo: string, cliente: Cliente = prisma) {
  const existente = await cliente.cuota.findUnique({ where: { socioId_periodo: { socioId, periodo } } });
  if (existente) return { cuota: existente, creada: false };
  const precios = await preciosParaSocio(socioId, `${periodo}-01` > ahoraLocal().fecha ? `${periodo}-01` : undefined, cliente);
  const adhesion = await cliente.adhesionDebito.findFirst({ where: { socioId, estado: 'ACTIVA' } });
  const composicion = (adhesion ? calculoDebito : calculoPagoUnico).calcularImporte(precios);
  const cuota = await cliente.cuota.create({
    data: {
      socioId,
      periodo,
      cuotaBase: composicion.cuotaBase,
      adicionalPremium: composicion.adicionalPremium,
      descuento: composicion.descuento,
      importeFinal: composicion.importeFinal,
      fechaVencimiento: aFechaDb(`${periodo}-${String(DIA_VENCIMIENTO).padStart(2, '0')}`),
    },
  });
  return { cuota, creada: true };
}

/** Tarea mensual: cuotas del período para todos los socios activos (RD20). */
export async function generarCuotasPeriodo(periodo = ahoraLocal().fecha.slice(0, 7)) {
  const socios = await prisma.socio.findMany({ where: { usuario: { activo: true } }, select: { id: true } });
  let creadas = 0;
  for (const { id } of socios) if ((await generarCuotaSocio(id, periodo)).creada) creadas++;
  return { periodo, creadas };
}

/** Variables de las plantillas de cuota: nombre, período, importe y vencimiento (dd/mm/aaaa). */
function datosCuota(cuota: { periodo: string; importeFinal: Prisma.Decimal; fechaVencimiento: Date; socio: { usuario: { nombre: string } } }) {
  const [anio, mes, dia] = fechaIso(cuota.fechaVencimiento).split('-');
  return [cuota.socio.usuario.nombre, mesAnio(cuota.periodo), dinero(aNumero(cuota.importeFinal)), `${dia}/${mes}/${anio}`];
}

/** Tarea diaria: marca IMPAGA la cuota vencida y avisa al socio (RF33, RNF10). */
export async function marcarCuotasVencidas(hoy = ahoraLocal().fecha) {
  const candidatas = await prisma.cuota.findMany({
    where: { estado: 'PENDIENTE', fechaVencimiento: { lt: aFechaDb(hoy) } },
    include: { socio: { include: { usuario: { select: { nombre: true } } } } },
  });
  // «Débito automático programado»: no se marca IMPAGA hasta conocer el resultado del débito.
  const vencidas = [];
  for (const cuota of candidatas) if (!(await cuotaRepository.debitoProgramado(cuota, periodoDe(hoy)))) vencidas.push(cuota);
  for (const cuota of vencidas) {
    await prisma.cuota.update({ where: { id: cuota.id }, data: { estado: 'IMPAGA' } });
    const mensaje = `Tu cuota ${cuota.periodo} venció y figura impaga. Podés abonarla desde "Cuotas y pagos".`;
    await notificacionService.notificar({ usuarioId: cuota.socio.usuarioId, tipo: 'VENCIMIENTO', mensaje });
    await notificacionService.enviarMensaje({
      usuarioId: cuota.socio.usuarioId,
      telefono: cuota.socio.telefono,
      tipo: 'VENCIMIENTO',
      mensaje,
      cuotaId: cuota.id,
      referencia: `vencimiento:${cuota.id}:impaga`,
      plantilla: plantilla('cuotaImpaga', ...datosCuota(cuota)),
    });
  }
  return { impagas: vencidas.length };
}

/** Aviso previo al vencimiento (3 días antes). */
export async function avisarProximosVencimientos(hoy = ahoraLocal().fecha) {
  const limite = new Date(aFechaDb(hoy).getTime() + 3 * 86400000);
  const cuotas = await prisma.cuota.findMany({
    where: { estado: 'PENDIENTE', fechaVencimiento: { equals: limite } },
    include: { socio: { include: { usuario: { select: { nombre: true } } } } },
  });
  for (const cuota of cuotas) {
    const mensaje = `Recordatorio: tu cuota ${cuota.periodo} vence el ${cuota.fechaVencimiento.toISOString().slice(0, 10)}.`;
    await notificacionService.notificar({ usuarioId: cuota.socio.usuarioId, tipo: 'VENCIMIENTO', mensaje });
    await notificacionService.enviarMensaje({
      usuarioId: cuota.socio.usuarioId,
      telefono: cuota.socio.telefono,
      tipo: 'VENCIMIENTO',
      mensaje,
      cuotaId: cuota.id,
      referencia: `vencimiento:${cuota.id}:recordatorio`,
      plantilla: plantilla('vencimientoProximo', ...datosCuota(cuota)),
    });
  }
  return { avisos: cuotas.length };
}
