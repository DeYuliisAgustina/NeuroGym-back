import type { EstadoEquipo, EstadoIncidencia, PrioridadIncidencia, TipoMantenimiento } from '@prisma/client';
import { prisma } from '../config/prisma';
import { almacenamiento, TIPOS_PERMITIDOS, type ArchivoEntrante } from '../integrations/almacenamiento/AlmacenamientoObjetos';
import { noEncontrado, reglaNegocio } from '../utils/errores';
import { aFechaDb, ahoraLocal, fechaIso, horaTexto, minutosDeHora, sumarDias } from '../utils/fechas';
import { registrarAuditoria } from './auditoria.service';
import { notificacionService } from './notificacion.service';
import { tenant } from './tenant.service';

interface DatosEquipo {
  sedeId: number;
  nombre: string;
  categoria: string;
  fechaCompra?: string | null;
  vidaUtilAnios?: number | null;
  proximoService?: string | null;
}

type Responsable = { gimnasioId: number; personalId: number; usuarioId: number };

const fechaOpcional = (f?: string | null) => (f === undefined ? undefined : f === null ? null : aFechaDb(f));

/** Equipo no disponible: fuera de servicio, con service programado o dado de baja (RD22). */
export const equipoDisponible = (estado: EstadoEquipo) => estado === 'OPERATIVO';

/** Inventario, incidencias y mantenimientos del equipamiento (RF8, RF21, RF22, RF23, RF34). */
export const equipamientoService = {
  // ---------------- Inventario ----------------
  listar(gimnasioId: number, filtros: { sedeId?: number; estado?: EstadoEquipo; incluirBajas?: boolean }) {
    return prisma.equipo.findMany({
      where: {
        sede: { gimnasioId },
        ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
        ...(filtros.estado ? { estado: filtros.estado } : filtros.incluirBajas ? {} : { estado: { not: 'DADO_DE_BAJA' } }),
      },
      include: {
        sede: { select: { nombre: true } },
        ejercicios: { include: { ejercicio: true } },
        _count: { select: { incidencias: { where: { estado: { not: 'RESUELTA' } } } } },
      },
      orderBy: [{ sedeId: 'asc' }, { nombre: 'asc' }],
    });
  },

  async crear(r: Responsable, datos: DatosEquipo) {
    const sede = await tenant.sede(datos.sedeId, r.gimnasioId);
    if (!sede.habilitada) throw reglaNegocio('SEDE_DESHABILITADA', 'La sede está deshabilitada');
    const equipo = await prisma.equipo.create({
      data: {
        sedeId: datos.sedeId,
        nombre: datos.nombre,
        categoria: datos.categoria,
        fechaCompra: fechaOpcional(datos.fechaCompra),
        vidaUtilAnios: datos.vidaUtilAnios ?? null,
        proximoService: fechaOpcional(datos.proximoService),
      },
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'ALTA_EQUIPO', entidad: 'equipo', entidadId: equipo.id });
    return equipo;
  },

  async actualizar(equipoId: number, r: Responsable, datos: Partial<Omit<DatosEquipo, 'sedeId'>>) {
    const equipo = await tenant.equipo(equipoId, r.gimnasioId);
    if (equipo.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'Un equipo dado de baja no se modifica');
    const actualizado = await prisma.equipo.update({
      where: { id: equipoId },
      data: {
        nombre: datos.nombre,
        categoria: datos.categoria,
        fechaCompra: fechaOpcional(datos.fechaCompra),
        vidaUtilAnios: datos.vidaUtilAnios,
        proximoService: fechaOpcional(datos.proximoService),
      },
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'MODIFICAR_EQUIPO', entidad: 'equipo', entidadId: equipoId, detalle: datos });
    return actualizado;
  },

  /** RF21: el gimnasio actualiza la disponibilidad (la IA no detecta fallas, RD11). */
  async cambiarDisponibilidad(equipoId: number, r: Responsable, estado: Exclude<EstadoEquipo, 'DADO_DE_BAJA'>) {
    const equipo = await tenant.equipo(equipoId, r.gimnasioId);
    if (equipo.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'La baja del inventario es definitiva');
    const actualizado = await prisma.equipo.update({ where: { id: equipoId }, data: { estado } });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'DISPONIBILIDAD_EQUIPO', entidad: 'equipo', entidadId: equipoId, detalle: { estado } });
    return actualizado;
  },

  /** RD22: baja definitiva del inventario con fecha; conserva incidencias y mantenimientos. */
  async darDeBaja(equipoId: number, r: Responsable, datos: { fechaBaja?: string; motivo: string }) {
    const equipo = await tenant.equipo(equipoId, r.gimnasioId);
    if (equipo.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'El equipo ya fue dado de baja');
    const fechaBaja = datos.fechaBaja ?? ahoraLocal().fecha;
    const actualizado = await prisma.equipo.update({
      where: { id: equipoId },
      data: { estado: 'DADO_DE_BAJA', fechaBaja: aFechaDb(fechaBaja) },
    });
    await registrarAuditoria({
      gimnasioId: r.gimnasioId,
      usuarioId: r.usuarioId,
      accion: 'BAJA_EQUIPO',
      entidad: 'equipo',
      entidadId: equipoId,
      detalle: { fechaBaja, motivo: datos.motivo },
    });
    return actualizado;
  },

  /** Ejercicios que utilizan el equipo (para disponibilidad y variantes de las rutinas). */
  async asignarEjercicios(equipoId: number, gimnasioId: number, ejercicioIds: number[]) {
    await tenant.equipo(equipoId, gimnasioId);
    await prisma.$transaction([
      prisma.ejercicioEquipo.deleteMany({ where: { equipoId } }),
      prisma.ejercicioEquipo.createMany({ data: ejercicioIds.map((ejercicioId) => ({ ejercicioId, equipoId })) }),
    ]);
    return prisma.ejercicioEquipo.findMany({ where: { equipoId }, include: { ejercicio: true } });
  },

  /** RF22: historial por máquina, aun después de la baja. */
  async historial(equipoId: number, gimnasioId: number) {
    const equipo = await tenant.equipo(equipoId, gimnasioId);
    const [incidencias, mantenimientos] = await Promise.all([
      prisma.incidencia.findMany({
        where: { equipoId },
        include: { archivos: true, reportante: { include: { usuario: { select: { nombre: true, apellido: true } } } } },
        orderBy: { fecha: 'desc' },
      }),
      prisma.mantenimiento.findMany({
        where: { equipoId },
        include: { responsable: { include: { usuario: { select: { nombre: true, apellido: true } } } } },
        orderBy: { inicioProgramado: 'desc' },
      }),
    ]);
    return { equipo, incidencias, mantenimientos };
  },

  /** RF8 / CU-003-006: disponibilidad del equipamiento de la sede del socio. */
  async disponibilidadSede(sedeId: number) {
    const ahora = new Date();
    const equipos = await prisma.equipo.findMany({
      where: { sedeId, estado: { not: 'DADO_DE_BAJA' } },
      include: { mantenimientos: { where: { estado: 'PROGRAMADO', finProgramado: { gte: ahora } }, orderBy: { inicioProgramado: 'asc' }, take: 1 } },
      orderBy: { nombre: 'asc' },
    });
    return equipos.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      categoria: e.categoria,
      estado: e.estado,
      disponible: equipoDisponible(e.estado),
      mantenimientoHasta: e.mantenimientos[0]?.finProgramado ?? null,
    }));
  },

  // ---------------- Incidencias (RF8, RF21) ----------------
  async reportarIncidencia(socio: { socioId: number; gimnasioId: number }, datos: { equipoId: number; descripcion: string }, archivos: ArchivoEntrante[]) {
    const equipo = await tenant.equipo(datos.equipoId, socio.gimnasioId);
    if (equipo.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'El equipo ya no forma parte del inventario');
    const invalido = archivos.find((a) => !TIPOS_PERMITIDOS[a.mime]);
    if (invalido) throw reglaNegocio('ARCHIVO_INVALIDO', 'Solo se admiten fotos (JPG, PNG, WEBP) o videos (MP4, WEBM, MOV)');
    const urls = await Promise.all(archivos.map(async (a) => ({ url: await almacenamiento.guardar('incidencias', a), tipo: TIPOS_PERMITIDOS[a.mime] })));
    return prisma.incidencia.create({
      data: {
        equipoId: datos.equipoId,
        reportanteId: socio.socioId,
        descripcion: datos.descripcion,
        archivos: { create: urls },
      },
      include: { archivos: true, equipo: true },
    });
  },

  misIncidencias(socioId: number) {
    return prisma.incidencia.findMany({
      where: { reportanteId: socioId },
      include: { equipo: { select: { nombre: true } }, archivos: true },
      orderBy: { fecha: 'desc' },
    });
  },

  listarIncidencias(gimnasioId: number, filtros: { sedeId?: number; estado?: EstadoIncidencia; equipoId?: number }) {
    return prisma.incidencia.findMany({
      where: {
        equipo: { sede: { gimnasioId }, ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}) },
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        ...(filtros.equipoId ? { equipoId: filtros.equipoId } : {}),
      },
      include: {
        equipo: { include: { sede: { select: { nombre: true } } } },
        archivos: true,
        reportante: { include: { usuario: { select: { nombre: true, apellido: true } } } },
        agrupadas: { select: { id: true } },
      },
      orderBy: [{ estado: 'asc' }, { fecha: 'desc' }],
    });
  },

  /** RNF13: cada cambio de estado registra al personal responsable. */
  async gestionarIncidencia(incidenciaId: number, r: Responsable, datos: { estado?: EstadoIncidencia; prioridad?: PrioridadIncidencia }) {
    const incidencia = await prisma.incidencia.findFirst({
      where: { id: incidenciaId, equipo: { sede: { gimnasioId: r.gimnasioId } } },
      include: { reportante: true, equipo: true },
    });
    if (!incidencia) throw noEncontrado('Incidencia');
    const actualizada = await prisma.incidencia.update({
      where: { id: incidenciaId },
      data: { ...datos, responsableId: r.personalId },
    });
    // Las incidencias agrupadas acompañan el estado de la principal.
    if (datos.estado) {
      await prisma.incidencia.updateMany({ where: { agrupadaEnId: incidenciaId }, data: { estado: datos.estado, responsableId: r.personalId } });
      await notificacionService.notificar({
        usuarioId: incidencia.reportante.usuarioId,
        tipo: 'EQUIPAMIENTO',
        mensaje: `Tu reporte sobre ${incidencia.equipo.nombre} pasó a ${datos.estado.replace('_', ' ').toLowerCase()}.`,
      });
    }
    return actualizada;
  },

  /** RF21: agrupa una incidencia coincidente dentro de otra principal del mismo equipo. */
  async agruparIncidencia(incidenciaId: number, principalId: number, r: Responsable) {
    if (incidenciaId === principalId) throw reglaNegocio('AGRUPACION_INVALIDA', 'Una incidencia no puede agruparse consigo misma');
    const [incidencia, principal] = await Promise.all(
      [incidenciaId, principalId].map((id) => prisma.incidencia.findFirst({ where: { id, equipo: { sede: { gimnasioId: r.gimnasioId } } } })),
    );
    if (!incidencia || !principal) throw noEncontrado('Incidencia');
    if (incidencia.equipoId !== principal.equipoId) throw reglaNegocio('EQUIPOS_DISTINTOS', 'Solo se agrupan incidencias del mismo equipo');
    if (principal.agrupadaEnId) throw reglaNegocio('PRINCIPAL_AGRUPADA', 'La incidencia principal ya está agrupada en otra');
    return prisma.$transaction(async (tx) => {
      // Las que dependían de la incidencia agrupada pasan a la nueva principal.
      await tx.incidencia.updateMany({ where: { agrupadaEnId: incidenciaId }, data: { agrupadaEnId: principalId } });
      return tx.incidencia.update({
        where: { id: incidenciaId },
        data: { agrupadaEnId: principalId, estado: principal.estado, responsableId: r.personalId },
      });
    });
  },

  // ---------------- Mantenimientos (RF22, RF34) ----------------
  async programarMantenimiento(
    r: Responsable,
    datos: { equipoId: number; tipo: TipoMantenimiento; inicioProgramado: string; finProgramado: string; intervencionPrevista?: string },
  ) {
    const equipo = await tenant.equipo(datos.equipoId, r.gimnasioId);
    if (equipo.estado === 'DADO_DE_BAJA') throw reglaNegocio('EQUIPO_DADO_DE_BAJA', 'El equipo fue dado de baja');
    const inicio = new Date(datos.inicioProgramado);
    const fin = new Date(datos.finProgramado);
    if (fin <= inicio) throw reglaNegocio('PERIODO_INVALIDO', 'El fin debe ser posterior al inicio');
    const mantenimiento = await prisma.$transaction(async (tx) => {
      const creado = await tx.mantenimiento.create({
        data: {
          equipoId: datos.equipoId,
          tipo: datos.tipo,
          inicioProgramado: inicio,
          finProgramado: fin,
          intervencionPrevista: datos.intervencionPrevista,
          responsableId: r.personalId,
        },
      });
      // Indisponibilidad temporal (RD22): el equipo operativo pasa a "Service programado".
      if (equipo.estado === 'OPERATIVO') await tx.equipo.update({ where: { id: equipo.id }, data: { estado: 'SERVICE_PROGRAMADO' } });
      return creado;
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'PROGRAMAR_MANTENIMIENTO', entidad: 'mantenimiento', entidadId: mantenimiento.id });
    const avisados = await avisarSociosAfectados(equipo.id, equipo.nombre, equipo.sedeId, inicio, fin);
    return { mantenimiento, sociosAvisados: avisados };
  },

  async registrarRealizado(mantenimientoId: number, r: Responsable, datos: { fechaRealizada?: string; detalleRealizado: string; proximoService?: string }) {
    const mantenimiento = await prisma.mantenimiento.findFirst({
      where: { id: mantenimientoId, equipo: { sede: { gimnasioId: r.gimnasioId } } },
      include: { equipo: true },
    });
    if (!mantenimiento) throw noEncontrado('Mantenimiento');
    if (mantenimiento.estado === 'REALIZADO') throw reglaNegocio('YA_REALIZADO', 'El mantenimiento ya fue registrado como realizado');
    const actualizado = await prisma.$transaction(async (tx) => {
      const registro = await tx.mantenimiento.update({
        where: { id: mantenimientoId },
        data: {
          estado: 'REALIZADO',
          fechaRealizada: datos.fechaRealizada ? new Date(datos.fechaRealizada) : new Date(),
          detalleRealizado: datos.detalleRealizado,
          responsableId: r.personalId,
        },
      });
      await tx.equipo.update({
        where: { id: mantenimiento.equipoId },
        data: {
          ...(mantenimiento.equipo.estado === 'SERVICE_PROGRAMADO' ? { estado: 'OPERATIVO' as const } : {}),
          ...(datos.proximoService ? { proximoService: aFechaDb(datos.proximoService) } : {}),
        },
      });
      return registro;
    });
    await registrarAuditoria({ gimnasioId: r.gimnasioId, usuarioId: r.usuarioId, accion: 'MANTENIMIENTO_REALIZADO', entidad: 'mantenimiento', entidadId: mantenimientoId });
    return actualizado;
  },

  listarMantenimientos(gimnasioId: number, filtros: { sedeId?: number; estado?: 'PROGRAMADO' | 'REALIZADO' }) {
    return prisma.mantenimiento.findMany({
      where: {
        equipo: { sede: { gimnasioId }, ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}) },
        ...(filtros.estado ? { estado: filtros.estado } : {}),
      },
      include: { equipo: { include: { sede: { select: { nombre: true } } } }, responsable: { include: { usuario: { select: { nombre: true, apellido: true } } } } },
      orderBy: { inicioProgramado: 'desc' },
    });
  },

  // ---------------- Alertas (RF23) ----------------
  async alertas(gimnasioId: number, hoy = ahoraLocal().fecha) {
    const equipos = await prisma.equipo.findMany({
      where: { sede: { gimnasioId }, estado: { not: 'DADO_DE_BAJA' } },
      include: { sede: { select: { nombre: true } } },
    });
    const limiteService = sumarDias(hoy, 7);
    const limiteRecambio = sumarDias(hoy, 90);
    const alertas: { equipoId: number; equipo: string; sede: string; tipo: 'SERVICE' | 'RECAMBIO'; fecha: string; vencida: boolean }[] = [];
    for (const e of equipos) {
      if (e.proximoService && fechaIso(e.proximoService) <= limiteService) {
        alertas.push({ equipoId: e.id, equipo: e.nombre, sede: e.sede.nombre, tipo: 'SERVICE', fecha: fechaIso(e.proximoService), vencida: fechaIso(e.proximoService) < hoy });
      }
      if (e.fechaCompra && e.vidaUtilAnios) {
        const finVida = fechaIso(e.fechaCompra).replace(/^\d{4}/, (a) => String(Number(a) + e.vidaUtilAnios!));
        if (finVida <= limiteRecambio) alertas.push({ equipoId: e.id, equipo: e.nombre, sede: e.sede.nombre, tipo: 'RECAMBIO', fecha: finVida, vencida: finVida < hoy });
      }
    }
    return alertas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  },

  /** Tarea diaria: notifica al personal con permiso sobre equipamiento. */
  async notificarAlertas() {
    const gimnasios = await prisma.gimnasio.findMany({ select: { id: true } });
    let enviadas = 0;
    for (const { id } of gimnasios) {
      const alertas = await this.alertas(id);
      if (alertas.length === 0) continue;
      const destinatarios = await prisma.personalAdministrativo.findMany({
        where: {
          gimnasioId: id,
          usuario: { activo: true },
          rol: { OR: [{ esPrincipal: true }, { permisos: { some: { permiso: { modulo: { codigo: 'EQUIPAMIENTO' } } } } }] },
        },
      });
      const mensaje = `Equipamiento: ${alertas.length} alerta(s) de service o recambio. Próxima: ${alertas[0].equipo} (${alertas[0].tipo.toLowerCase()}, ${alertas[0].fecha}).`;
      for (const p of destinatarios) {
        await notificacionService.notificar({ usuarioId: p.usuarioId, tipo: 'EQUIPAMIENTO', mensaje });
        enviadas++;
      }
    }
    return { enviadas };
  },
};

/**
 * RF34: avisa a los socios con un turno reservado durante el mantenimiento
 * cuya rutina vigente incluye un ejercicio que usa el equipo afectado.
 */
async function avisarSociosAfectados(equipoId: number, nombreEquipo: string, sedeId: number, inicio: Date, fin: Date) {
  const desde = ahoraLocal(inicio).fecha;
  const hasta = ahoraLocal(fin).fecha;
  const reservas = await prisma.reserva.findMany({
    where: {
      estado: 'RESERVADO',
      turno: { sedeId, fecha: { gte: aFechaDb(desde), lte: aFechaDb(hasta) } },
      socio: { rutinas: { some: { vigente: true, ejercicios: { some: { ejercicio: { equipos: { some: { equipoId } } } } } } } },
    },
    include: { turno: true, socio: true },
  });
  const avisados = new Set<number>();
  for (const r of reservas) {
    const fecha = fechaIso(r.turno.fecha);
    // Solapamiento del turno con la ventana del mantenimiento en hora local.
    const inicioTurno = minutosDeHora(r.turno.horaInicio);
    const finTurno = minutosDeHora(r.turno.horaFin);
    const ventanaInicio = fecha === desde ? ahoraLocal(inicio).minutos : 0;
    const ventanaFin = fecha === hasta ? ahoraLocal(fin).minutos : 24 * 60;
    if (inicioTurno >= ventanaFin || finTurno <= ventanaInicio || avisados.has(r.socioId)) continue;
    avisados.add(r.socioId);
    const mensaje = `El equipo ${nombreEquipo} estará en mantenimiento durante tu turno del ${fecha} a las ${horaTexto(r.turno.horaInicio)}. Podés consultar una variante en "Mi rutina".`;
    await notificacionService.notificar({ usuarioId: r.socio.usuarioId, tipo: 'EQUIPAMIENTO', mensaje });
    await notificacionService.enviarMensaje({ usuarioId: r.socio.usuarioId, telefono: r.socio.telefono, tipo: 'EQUIPAMIENTO', mensaje });
  }
  return avisados.size;
}
