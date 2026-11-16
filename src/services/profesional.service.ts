import crypto from 'node:crypto';
import type { DiaSemana, Especialidad, ModalidadAtencion, TipoMetodoPago, TipoPlanMarketplace } from '@prisma/client';
import { prisma } from '../config/prisma';
import { aNumero } from '../utils/dinero';
import { conflicto, noEncontrado, reglaNegocio } from '../utils/errores';
import { aHoraDb, horaTexto } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { firmarToken, hashPassword, obtenerContexto, describirSesion } from './auth.service';

interface RegistroProfesional {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  especialidad: Especialidad;
  modalidadAtencion: ModalidadAtencion;
  valorConsulta: number;
  plan: TipoPlanMarketplace;
  consentimientoDatos: boolean;
  codigoReferido?: string;
}

const incluirPerfil = {
  usuario: { select: { nombre: true, apellido: true, email: true, activo: true } },
  plan: true,
  servicios: true,
  disponibilidad: { orderBy: [{ diaSemana: 'asc' as const }, { horaInicio: 'asc' as const }] },
  metodosPago: true,
};

function describirDisponibilidad<T extends { horaInicio: Date; horaFin: Date }>(d: T) {
  return { ...d, horaInicio: horaTexto(d.horaInicio), horaFin: horaTexto(d.horaFin) };
}

/** Marketplace: registro, perfil, servicios, disponibilidad y métodos de pago (RF28, RF29, RF36). */
export const profesionalService = {
  planes() {
    return prisma.planMarketplace.findMany({ orderBy: { precioMensualUsd: 'asc' } });
  },

  /** RF28: registro autónomo con plan Marketplace Básico o Profesional. */
  async registrar(datos: RegistroProfesional) {
    if (!datos.consentimientoDatos) throw reglaNegocio('SIN_CONSENTIMIENTO', 'Se requiere el consentimiento para el tratamiento de datos');
    if (await prisma.usuario.findUnique({ where: { email: datos.email } })) throw conflicto('EMAIL_EN_USO', 'El correo ya está registrado');
    const plan = await prisma.planMarketplace.findUnique({ where: { tipo: datos.plan } });
    if (!plan) throw noEncontrado('Plan Marketplace');
    // Referidos Profesionales: el código identifica a quien recomendó.
    const referente = datos.codigoReferido
      ? await prisma.profesional.findUnique({ where: { codigoReferido: datos.codigoReferido.trim().toUpperCase() } })
      : null;
    if (datos.codigoReferido && !referente) throw reglaNegocio('REFERIDO_INVALIDO', 'El código de referido no existe');

    const profesional = await prisma.profesional.create({
      data: {
        especialidad: datos.especialidad,
        modalidadAtencion: datos.modalidadAtencion,
        valorConsulta: datos.valorConsulta,
        consentimientoDatos: true,
        codigoReferido: `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        plan: { connect: { id: plan.id } },
        ...(referente ? { referidoPor: { connect: { id: referente.id } } } : {}),
        usuario: {
          create: {
            email: datos.email,
            nombre: datos.nombre,
            apellido: datos.apellido,
            tipo: 'PROFESIONAL' as const,
            passwordHash: await hashPassword(datos.password),
          },
        },
      },
    });
    await registrarAuditoria({ usuarioId: profesional.usuarioId, accion: 'REGISTRO_PROFESIONAL', entidad: 'profesional', entidadId: profesional.id });
    const contexto = await obtenerContexto(profesional.usuarioId);
    return { token: firmarToken({ sub: profesional.usuarioId, tipo: 'PROFESIONAL' }), usuario: describirSesion(contexto) };
  },

  async perfil(profesionalId: number) {
    const p = await prisma.profesional.findUniqueOrThrow({ where: { id: profesionalId }, include: incluirPerfil });
    return { ...p, disponibilidad: p.disponibilidad.map(describirDisponibilidad) };
  },

  /** RF29: perfil, valor de la consulta y pausa de la publicación. */
  async actualizarPerfil(
    profesionalId: number,
    datos: { nombre?: string; apellido?: string; modalidadAtencion?: ModalidadAtencion; valorConsulta?: number; publicacionPausada?: boolean },
  ) {
    const { nombre, apellido, ...resto } = datos;
    const p = await prisma.profesional.update({
      where: { id: profesionalId },
      data: { ...resto, usuario: nombre || apellido ? { update: { nombre, apellido } } : undefined },
    });
    return this.perfil(p.id);
  },

  async cambiarPlan(profesionalId: number, tipo: TipoPlanMarketplace) {
    const plan = await prisma.planMarketplace.findUniqueOrThrow({ where: { tipo } });
    await prisma.profesional.update({ where: { id: profesionalId }, data: { planMarketplaceId: plan.id } });
    return this.perfil(profesionalId);
  },

  // Servicios
  async crearServicio(profesionalId: number, datos: { nombre: string; descripcion: string; visible?: boolean }) {
    return prisma.servicioProfesional.create({ data: { ...datos, profesionalId } });
  },
  async actualizarServicio(profesionalId: number, servicioId: number, datos: { nombre?: string; descripcion?: string; visible?: boolean }) {
    const { count } = await prisma.servicioProfesional.updateMany({ where: { id: servicioId, profesionalId }, data: datos });
    if (count === 0) throw noEncontrado('Servicio');
    return prisma.servicioProfesional.findUniqueOrThrow({ where: { id: servicioId } });
  },
  async eliminarServicio(profesionalId: number, servicioId: number) {
    const { count } = await prisma.servicioProfesional.deleteMany({ where: { id: servicioId, profesionalId } });
    if (count === 0) throw noEncontrado('Servicio');
  },

  // Disponibilidad semanal
  async crearDisponibilidad(profesionalId: number, datos: { diaSemana: DiaSemana; horaInicio: string; horaFin: string; duracionConsultaMin?: number }) {
    if (datos.horaFin <= datos.horaInicio) throw reglaNegocio('HORARIO_INVALIDO', 'La hora de fin debe ser posterior a la de inicio');
    const superpuesto = await prisma.disponibilidad.findFirst({
      where: { profesionalId, diaSemana: datos.diaSemana, horaInicio: { lt: aHoraDb(datos.horaFin) }, horaFin: { gt: aHoraDb(datos.horaInicio) } },
    });
    if (superpuesto) throw reglaNegocio('DISPONIBILIDAD_SUPERPUESTA', 'El bloque se superpone con otro ya cargado');
    const d = await prisma.disponibilidad.create({
      data: {
        profesionalId,
        diaSemana: datos.diaSemana,
        horaInicio: aHoraDb(datos.horaInicio),
        horaFin: aHoraDb(datos.horaFin),
        duracionConsultaMin: datos.duracionConsultaMin ?? 45,
      },
    });
    return describirDisponibilidad(d);
  },
  async eliminarDisponibilidad(profesionalId: number, disponibilidadId: number) {
    const { count } = await prisma.disponibilidad.deleteMany({ where: { id: disponibilidadId, profesionalId } });
    if (count === 0) throw noEncontrado('Bloque de disponibilidad');
  },

  // Métodos de pago (RF36)
  async crearMetodoPago(profesionalId: number, datos: { tipo: TipoMetodoPago; obraSocial?: string }) {
    if (datos.tipo === 'OBRA_SOCIAL' && !datos.obraSocial?.trim()) throw reglaNegocio('OBRA_SOCIAL_REQUERIDA', 'Indicá la obra social');
    return prisma.metodoPagoConsulta.create({
      data: { profesionalId, tipo: datos.tipo, obraSocial: datos.tipo === 'OBRA_SOCIAL' ? datos.obraSocial!.trim() : null },
    });
  },
  async eliminarMetodoPago(profesionalId: number, metodoPagoId: number) {
    const metodo = await prisma.metodoPagoConsulta.findFirst({ where: { id: metodoPagoId, profesionalId }, include: { _count: { select: { turnos: true } } } });
    if (!metodo) throw noEncontrado('Método de pago');
    if (metodo._count.turnos > 0) throw reglaNegocio('METODO_EN_USO', 'El método está registrado en turnos y no puede eliminarse');
    await prisma.metodoPagoConsulta.delete({ where: { id: metodoPagoId } });
  },

  /** Comisiones registradas (RF41) para el panel del profesional. */
  async comisiones(profesionalId: number) {
    const lista = await prisma.comision.findMany({
      where: { turno: { profesionalId } },
      include: { turno: { select: { fecha: true } } },
      orderBy: { fechaRegistro: 'desc' },
    });
    return {
      total: lista.reduce((t, c) => t + aNumero(c.importeComision), 0),
      comisiones: lista,
    };
  },

  // ---------------- Vista del socio Premium (RF13, RD5) ----------------

  /** Profesionales publicados de todos los gimnasios; los promocionados primero (RF28). */
  async listarParaSocios(filtros: { especialidad?: Especialidad; modalidad?: ModalidadAtencion }) {
    const lista = await prisma.profesional.findMany({
      where: {
        publicacionPausada: false,
        usuario: { activo: true },
        ...(filtros.especialidad ? { especialidad: filtros.especialidad } : {}),
        ...(filtros.modalidad ? { modalidadAtencion: { in: [filtros.modalidad, 'ONLINE_Y_PRESENCIAL'] } } : {}),
      },
      include: {
        usuario: { select: { nombre: true, apellido: true } },
        plan: { select: { perfilPromocionado: true } },
        servicios: { where: { visible: true } },
        metodosPago: true,
      },
    });
    return lista
      .sort((a, b) => Number(b.plan.perfilPromocionado) - Number(a.plan.perfilPromocionado))
      .map((p) => ({
        id: p.id,
        nombre: `${p.usuario.nombre} ${p.usuario.apellido}`,
        especialidad: p.especialidad,
        modalidadAtencion: p.modalidadAtencion,
        valorConsulta: aNumero(p.valorConsulta),
        promocionado: p.plan.perfilPromocionado,
        servicios: p.servicios,
        metodosPago: p.metodosPago,
      }));
  },

  async perfilPublico(profesionalId: number) {
    const p = await prisma.profesional.findFirst({
      where: { id: profesionalId, publicacionPausada: false, usuario: { activo: true } },
      include: { ...incluirPerfil, servicios: { where: { visible: true } } },
    });
    if (!p) throw noEncontrado('Profesional');
    return {
      id: p.id,
      nombre: `${p.usuario.nombre} ${p.usuario.apellido}`,
      especialidad: p.especialidad,
      modalidadAtencion: p.modalidadAtencion,
      valorConsulta: aNumero(p.valorConsulta),
      promocionado: p.plan.perfilPromocionado,
      servicios: p.servicios,
      metodosPago: p.metodosPago,
      disponibilidad: p.disponibilidad.map(describirDisponibilidad),
    };
  },
};
