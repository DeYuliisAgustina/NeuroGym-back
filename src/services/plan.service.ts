import type { TipoPlanSocio } from '@prisma/client';
import { prisma } from '../config/prisma';
import { aNumero } from '../utils/dinero';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { precioVigente } from './precios.service';

/** Planes Básico y Premium del gimnasio y su historial de precios (RF16, RF20, RD12, RNF13). */
export const planService = {
  async listar(gimnasioId: number) {
    const planes = await prisma.planSocio.findMany({
      where: { gimnasioId },
      include: {
        actualizaciones: {
          orderBy: { fecha: 'desc' },
          include: { responsable: { include: { usuario: { select: { nombre: true, apellido: true } } } } },
        },
      },
      orderBy: { tipo: 'asc' },
    });
    return Promise.all(planes.map(async (p) => ({ ...p, importeVigente: await precioVigente(p.id) })));
  },

  /** Los nuevos precios rigen desde su vigencia, para pagos posteriores; no alteran comprobantes. */
  async actualizarPrecio(
    gimnasioId: number,
    tipo: TipoPlanSocio,
    responsable: { personalId: number; usuarioId: number },
    datos: { importeNuevo: number; vigenteDesde?: string; motivo: string },
  ) {
    const plan = await prisma.planSocio.findUnique({ where: { gimnasioId_tipo: { gimnasioId, tipo } } });
    if (!plan) throw noEncontrado('Plan');
    const hoy = ahoraLocal().fecha;
    const vigenteDesde = datos.vigenteDesde ?? hoy;
    if (vigenteDesde < hoy) throw reglaNegocio('VIGENCIA_PASADA', 'La vigencia no puede ser anterior a hoy');
    const importeAnterior = await precioVigente(plan.id, vigenteDesde);

    const actualizacion = await prisma.$transaction(async (tx) => {
      const registro = await tx.actualizacionPrecio.create({
        data: {
          planSocioId: plan.id,
          importeAnterior,
          importeNuevo: datos.importeNuevo,
          vigenteDesde: aFechaDb(vigenteDesde),
          motivo: datos.motivo,
          responsableId: responsable.personalId,
        },
      });
      if (vigenteDesde <= hoy) await tx.planSocio.update({ where: { id: plan.id }, data: { importeMensual: datos.importeNuevo } });
      return registro;
    });
    await registrarAuditoria({
      gimnasioId,
      usuarioId: responsable.usuarioId,
      accion: 'ACTUALIZAR_PRECIO',
      entidad: 'plan_socio',
      entidadId: plan.id,
      detalle: { tipo, importeAnterior, importeNuevo: datos.importeNuevo, vigenteDesde },
    });
    return actualizacion;
  },

  /** Sincroniza importe_mensual cuando entra en vigencia un precio programado (tarea diaria). */
  async sincronizarPreciosVigentes() {
    const planes = await prisma.planSocio.findMany();
    for (const plan of planes) {
      const vigente = await precioVigente(plan.id);
      if (vigente !== aNumero(plan.importeMensual)) {
        await prisma.planSocio.update({ where: { id: plan.id }, data: { importeMensual: vigente } });
      }
    }
  },
};
