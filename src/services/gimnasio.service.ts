import type { PoliticaCuotaPendiente } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { registrarAuditoria } from './auditoria.service';

type Cliente = Tx | typeof prisma;

/** Suscripción SaaS y políticas del gimnasio (RD1, RD2, RD3, RD8). */
export const gimnasioService = {
  async obtener(gimnasioId: number) {
    const gimnasio = await prisma.gimnasio.findUnique({ where: { id: gimnasioId }, include: { suscripcion: true } });
    if (!gimnasio) throw noEncontrado('Gimnasio');
    const [sedesHabilitadas, sociosActivos] = await Promise.all([
      prisma.sede.count({ where: { gimnasioId, habilitada: true } }),
      contarSociosActivos(gimnasioId),
    ]);
    return { ...gimnasio, uso: { sedesHabilitadas, sociosActivos } };
  },

  async actualizarPoliticas(
    gimnasioId: number,
    usuarioId: number,
    datos: { toleranciaAntesMin?: number; toleranciaDespuesMin?: number; politicaCuotaPendiente?: PoliticaCuotaPendiente },
  ) {
    const gimnasio = await prisma.gimnasio.update({ where: { id: gimnasioId }, data: datos });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ACTUALIZAR_POLITICAS', entidad: 'gimnasio', entidadId: gimnasioId, detalle: datos });
    return gimnasio;
  },
};

/** RD20: los socios desactivados dejan de computarse entre los activos. */
export function contarSociosActivos(gimnasioId: number, cliente: Cliente = prisma) {
  return cliente.socio.count({ where: { sede: { gimnasioId }, usuario: { activo: true } } });
}

/** RD2: límite de socios activos de la suscripción contratada. */
export async function verificarCupoSocios(gimnasioId: number, cliente: Cliente = prisma) {
  const suscripcion = await cliente.suscripcionSaas.findUnique({ where: { gimnasioId } });
  if (!suscripcion) throw reglaNegocio('SIN_SUSCRIPCION', 'El gimnasio no tiene una suscripción vigente');
  if ((await contarSociosActivos(gimnasioId, cliente)) >= suscripcion.maxSociosActivos) {
    throw reglaNegocio(
      'LIMITE_SOCIOS',
      `La suscripción ${suscripcion.tipo} admite hasta ${suscripcion.maxSociosActivos} socios activos. Consultá una cotización personalizada.`,
    );
  }
}

/** RD3: la analítica avanzada de retención es exclusiva de NeuroGym Intelligence. */
export async function tieneIntelligence(gimnasioId: number): Promise<boolean> {
  const suscripcion = await prisma.suscripcionSaas.findUnique({ where: { gimnasioId } });
  return suscripcion?.tipo === 'INTELLIGENCE';
}
