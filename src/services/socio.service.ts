import type { Prisma, TipoPlanSocio } from '@prisma/client';
import { prisma } from '../config/prisma';
import { generarPasswordTemporal } from '../utils/credenciales';
import { conflicto, noEncontrado, reglaNegocio } from '../utils/errores';
import { ahoraLocal, fechaIso } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { hashPassword } from './auth.service';
import { servicioEnvios } from './envioMensajes.service';
import { generarCuotaSocio } from './cuotaGeneracion.service';
import { verificarCupoSocios } from './gimnasio.service';
import { aSocio, bonificacionVigente, preciosDePlanes, preciosParaSocio } from './precios.service';
import { tenant } from './tenant.service';
import { PlanSocio, Usuario } from '../domain';

interface DatosSocio {
  email: string;
  nombre: string;
  apellido: string;
  telefono: string;
  sedeId: number;
  plan: TipoPlanSocio;
  consentimientoDatos: boolean;
}

const seleccionUsuario = { select: { id: true, email: true, nombre: true, apellido: true, activo: true, fechaAlta: true } };

async function planDelGimnasio(gimnasioId: number, tipo: TipoPlanSocio) {
  return prisma.planSocio.findUniqueOrThrow({ where: { gimnasioId_tipo: { gimnasioId, tipo } } });
}

/** ABM de socios con baja lógica (RF16, RD20) y autogestión del plan (RF12). */
export const socioService = {
  async listar(gimnasioId: number, filtros: { sedeId?: number; plan?: TipoPlanSocio; activo?: boolean; pendiente?: boolean; busqueda?: string }) {
    const where: Prisma.SocioWhereInput = {
      sede: { gimnasioId },
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      ...(filtros.plan ? { plan: { tipo: filtros.plan } } : {}),
      ...(filtros.pendiente !== undefined ? { pendienteAlta: filtros.pendiente } : {}),
      usuario: {
        ...(filtros.activo !== undefined ? { activo: filtros.activo } : {}),
        ...(filtros.busqueda
          ? {
              OR: [
                { nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
                { apellido: { contains: filtros.busqueda, mode: 'insensitive' } },
                { email: { contains: filtros.busqueda, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };
    const hoy = ahoraLocal().fecha;
    const socios = await prisma.socio.findMany({
      where,
      include: {
        usuario: seleccionUsuario,
        plan: true,
        sede: { select: { id: true, nombre: true } },
        // Resumen de actividad para el listado: cuota del período y asistencias recientes.
        cuotas: { where: { periodo: hoy.slice(0, 7) }, select: { estado: true } },
        reservas: { where: { asistencia: { isNot: null } }, select: { turno: { select: { fecha: true } } }, orderBy: { turno: { fecha: 'desc' } }, take: 40 },
      },
      orderBy: { usuario: { apellido: 'asc' } },
    });
    return socios.map(({ cuotas, reservas, ...s }) => {
      const fechas = reservas.map((r) => fechaIso(r.turno.fecha));
      return {
        ...s,
        estadoCuota: cuotas[0]?.estado ?? null,
        asistenciasMes: fechas.filter((f) => f.startsWith(hoy.slice(0, 7))).length,
        ultimaVisita: fechas[0] ?? null,
      };
    });
  },

  async obtener(socioId: number, gimnasioId: number) {
    const socio = await tenant.socio(socioId, gimnasioId);
    const [cuotas, reservas, bonificacion] = await Promise.all([
      prisma.cuota.findMany({ where: { socioId }, orderBy: { periodo: 'desc' }, take: 12, include: { pagos: { include: { comprobante: true } } } }),
      prisma.reserva.findMany({
        where: { socioId },
        orderBy: { fechaReserva: 'desc' },
        take: 20,
        include: { turno: { include: { sede: { select: { nombre: true } } } }, asistencia: true },
      }),
      bonificacionVigente(socioId),
    ]);
    const { passwordHash: _omitido, ...usuario } = socio.usuario;
    return { ...socio, usuario, cuotas, reservas, bonificacionVigente: bonificacion };
  },

  async crear(gimnasioId: number, usuarioId: number, datos: DatosSocio) {
    // Datos obligatorios del TFI: consentimiento para el tratamiento de datos (RNF2).
    if (!datos.consentimientoDatos) throw reglaNegocio('SIN_CONSENTIMIENTO', 'Se requiere el consentimiento para el tratamiento de datos');
    const sede = await tenant.sede(datos.sedeId, gimnasioId);
    if (!sede.habilitada) throw reglaNegocio('SEDE_DESHABILITADA', 'La sede está deshabilitada y no admite nuevos socios (RD21)');
    if (await prisma.usuario.findUnique({ where: { email: datos.email } })) throw conflicto('EMAIL_EN_USO', 'El correo ya está registrado');
    await verificarCupoSocios(gimnasioId);
    const plan = await planDelGimnasio(gimnasioId, datos.plan);
    const passwordTemporal = generarPasswordTemporal();

    const socio = await prisma.$transaction(async (tx) => {
      const creado = await tx.socio.create({
        data: {
          sede: { connect: { id: datos.sedeId } },
          plan: { connect: { id: plan.id } },
          telefono: datos.telefono,
          consentimientoDatos: true,
          usuario: {
            create: {
              email: datos.email,
              nombre: datos.nombre,
              apellido: datos.apellido,
              tipo: 'SOCIO' as const,
              passwordHash: await hashPassword(passwordTemporal),
            },
          },
        },
        include: { usuario: seleccionUsuario, plan: true, sede: true },
      });
      // El socio nace con la cuota del período en curso.
      await generarCuotaSocio(creado.id, ahoraLocal().fecha.slice(0, 7), tx);
      await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_SOCIO', entidad: 'socio', entidadId: creado.id }, tx);
      return creado;
    });
    return { socio, passwordTemporal };
  },

  async actualizar(
    socioId: number,
    gimnasioId: number,
    usuarioId: number,
    datos: Partial<Pick<DatosSocio, 'nombre' | 'apellido' | 'telefono' | 'sedeId' | 'plan'>>,
  ) {
    const socio = await tenant.socio(socioId, gimnasioId);
    if (datos.sedeId && datos.sedeId !== socio.sedeId) {
      const sede = await tenant.sede(datos.sedeId, gimnasioId);
      if (!sede.habilitada) throw reglaNegocio('SEDE_DESHABILITADA', 'La sede está deshabilitada (RD21)');
    }
    const plan = datos.plan ? await planDelGimnasio(gimnasioId, datos.plan) : null;
    await prisma.$transaction([
      prisma.usuario.update({ where: { id: socio.usuarioId }, data: { nombre: datos.nombre, apellido: datos.apellido } }),
      prisma.socio.update({ where: { id: socioId }, data: { telefono: datos.telefono, sedeId: datos.sedeId, planSocioId: plan?.id } }),
    ]);
    if (plan && plan.id !== socio.planSocioId) await recalcularCuotaPendiente(socioId);
    await registrarAuditoria({ gimnasioId, usuarioId, accion: 'MODIFICAR_SOCIO', entidad: 'socio', entidadId: socioId, detalle: datos });
    return this.obtener(socioId, gimnasioId);
  },

  // ---------------- Autorregistro (pre-registro) del socio ----------------

  /** RF2: gimnasios con suscripción vigente y sus sedes habilitadas, para elegir al registrarse. */
  opcionesRegistro() {
    return prisma.gimnasio.findMany({
      where: { suscripcion: { isNot: null }, sedes: { some: { habilitada: true } } },
      select: {
        id: true,
        razonSocial: true,
        sedes: { where: { habilitada: true }, select: { id: true, nombre: true, direccion: true }, orderBy: { nombre: 'asc' } },
      },
      orderBy: { razonSocial: 'asc' },
    });
  },

  /**
   * RF2: el socio se registra solo, con su propia contraseña. La cuenta queda
   * inactiva y pendiente hasta que el personal del gimnasio confirma el alta.
   */
  async preRegistrar(datos: Omit<DatosSocio, 'plan'> & { password: string }) {
    if (!datos.consentimientoDatos) throw reglaNegocio('SIN_CONSENTIMIENTO', 'Se requiere el consentimiento para el tratamiento de datos');
    const sede = await prisma.sede.findUnique({ where: { id: datos.sedeId } });
    if (!sede) throw noEncontrado('Sede');
    if (!sede.habilitada) throw reglaNegocio('SEDE_DESHABILITADA', 'La sede está deshabilitada y no admite nuevos socios (RD21)');
    if (await prisma.usuario.findUnique({ where: { email: datos.email } })) throw conflicto('EMAIL_EN_USO', 'El correo ya está registrado');
    // Arranca con el Plan Básico; el Plan Premium se contrata después desde la app (RF12).
    const plan = await planDelGimnasio(sede.gimnasioId, 'BASICO');

    const socio = await prisma.socio.create({
      data: {
        sede: { connect: { id: sede.id } },
        plan: { connect: { id: plan.id } },
        telefono: datos.telefono,
        consentimientoDatos: true,
        pendienteAlta: true,
        usuario: {
          create: {
            email: datos.email,
            nombre: datos.nombre,
            apellido: datos.apellido,
            tipo: 'SOCIO' as const,
            activo: false,
            passwordHash: await hashPassword(datos.password),
          },
        },
      },
    });
    await registrarAuditoria({ gimnasioId: sede.gimnasioId, usuarioId: socio.usuarioId, accion: 'PREREGISTRO_SOCIO', entidad: 'socio', entidadId: socio.id });
    return { mensaje: 'Registro recibido. Tu gimnasio va a confirmar tu alta y te avisamos para que puedas ingresar.' };
  },

  /** RF2/RF16: el personal confirma el alta (activa la cuenta y genera la cuota) o rechaza el pre-registro. */
  async resolverAlta(socioId: number, gimnasioId: number, usuarioId: number, aprobar: boolean) {
    const socio = await tenant.socio(socioId, gimnasioId);
    if (!socio.pendienteAlta) throw reglaNegocio('SIN_ALTA_PENDIENTE', 'El socio no tiene un registro pendiente de alta');

    if (!aprobar) {
      await prisma.socio.update({ where: { id: socioId }, data: { pendienteAlta: false } });
      await registrarAuditoria({ gimnasioId, usuarioId, accion: 'RECHAZO_SOCIO', entidad: 'socio', entidadId: socioId });
      return;
    }
    await verificarCupoSocios(gimnasioId);
    await prisma.$transaction(async (tx) => {
      await tx.socio.update({ where: { id: socioId }, data: { pendienteAlta: false } });
      await tx.usuario.update({ where: { id: socio.usuarioId }, data: { activo: true } });
      // Igual que el alta hecha por el personal: nace con la cuota del período en curso.
      await generarCuotaSocio(socioId, ahoraLocal().fecha.slice(0, 7), tx);
      await registrarAuditoria({ gimnasioId, usuarioId, accion: 'ALTA_SOCIO', entidad: 'socio', entidadId: socioId }, tx);
    });
    // Aviso por WhatsApp (RNF10); si el envío falla, el alta igual queda hecha.
    await servicioEnvios
      .enviar({
        tipo: 'AVISO',
        referencia: `alta-socio-${socioId}`,
        usuarioId: socio.usuarioId,
        telefono: socio.telefono,
        texto: `¡Hola ${socio.usuario.nombre}! Tu gimnasio confirmó tu alta en NeuroGym. Ya podés ingresar con tu correo y contraseña.`,
      })
      .catch(() => undefined);
  },

  /** RD20: baja lógica y reversible. Conserva cuotas, pagos, turnos y asistencias. */
  async cambiarEstado(socioId: number, gimnasioId: number, usuarioId: number, activo: boolean) {
    const socio = await tenant.socio(socioId, gimnasioId);
    if (socio.pendienteAlta) throw reglaNegocio('ALTA_PENDIENTE', 'El socio tiene el registro pendiente: confirmá o rechazá el alta');
    if (socio.usuario.activo === activo) return;
    if (activo) await verificarCupoSocios(gimnasioId);
    const usuario = new Usuario(socio.usuario);
    if (activo) usuario.reactivar();
    else usuario.desactivar();
    await prisma.usuario.update({ where: { id: socio.usuarioId }, data: { activo: usuario.activo } });
    await registrarAuditoria({ gimnasioId, usuarioId, accion: activo ? 'REACTIVAR_SOCIO' : 'DESACTIVAR_SOCIO', entidad: 'socio', entidadId: socioId });
  },

  // ---------------- Autogestión del socio ----------------

  async perfil(socioId: number) {
    const socio = await prisma.socio.findUniqueOrThrow({
      where: { id: socioId },
      include: { usuario: seleccionUsuario, plan: true, sede: { include: { gimnasio: { select: { razonSocial: true, toleranciaAntesMin: true, toleranciaDespuesMin: true } } } }, preferencia: true },
    });
    const [bonificacion, preciosPlanes] = await Promise.all([bonificacionVigente(socioId), preciosDePlanes(socio.sede.gimnasioId)]);
    return { ...socio, esPremium: socio.plan.tipo === 'PREMIUM' || bonificacion !== null, bonificacionVigente: bonificacion, preciosPlanes };
  },

  async actualizarPerfil(socioId: number, datos: { telefono: string }) {
    await prisma.socio.update({ where: { id: socioId }, data: { telefono: datos.telefono } });
    return this.perfil(socioId);
  },

  /** RF12: contratar o dar de baja el Plan Premium. */
  async cambiarPlan(socioId: number, gimnasioId: number, usuarioId: number, tipo: TipoPlanSocio) {
    const plan = await planDelGimnasio(gimnasioId, tipo);
    const socio = aSocio(await prisma.socio.findUniqueOrThrow({ where: { id: socioId }, include: { plan: true, usuario: true } }));
    socio.cambiarPlan(new PlanSocio({ tipo: plan.tipo, importeMensual: Number(plan.importeMensual) }));
    await prisma.socio.update({ where: { id: socioId }, data: { planSocioId: plan.id } });
    await recalcularCuotaPendiente(socioId);
    await registrarAuditoria({ gimnasioId, usuarioId, accion: tipo === 'PREMIUM' ? 'ALTA_PREMIUM' : 'BAJA_PREMIUM', entidad: 'socio', entidadId: socioId });
    return this.perfil(socioId);
  },
};

/**
 * Al cambiar de plan se actualiza la composición de la cuota del período si
 * todavía no tiene pagos aprobados; las cuotas pagadas no se modifican (RD12).
 */
async function recalcularCuotaPendiente(socioId: number) {
  const periodo = ahoraLocal().fecha.slice(0, 7);
  const cuota = await prisma.cuota.findUnique({
    where: { socioId_periodo: { socioId, periodo } },
    include: { pagos: { where: { estado: 'APROBADO' } } },
  });
  if (!cuota || cuota.estado === 'PAGADA' || cuota.pagos.length > 0) return;
  const precios = await preciosParaSocio(socioId);
  const descuentoPct = Number(cuota.descuento) > 0 ? 0.1 : 0;
  const total = precios.cuotaBase + precios.adicionalPremium;
  const descuento = Math.round(total * descuentoPct * 100) / 100;
  await prisma.cuota.update({
    where: { id: cuota.id },
    data: { ...precios, descuento, importeFinal: Math.round((total - descuento) * 100) / 100 },
  });
}
