import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma';
import { aFechaDb, ahoraLocal, fechaIso, sumarDias } from '../utils/fechas';
import { detectarSenal, estimarRiesgo, type HistorialAsistencia } from './reglasRetencion';

const VENTANA_HISTORIAL_DIAS = 70;

/**
 * Proceso ETL de asistencia (RF35). Extrae las asistencias confirmadas, las
 * transforma en indicadores diarios por sede y plan, detecta señales de posible
 * abandono y, solo con NeuroGym Intelligence, estima el riesgo (RD3).
 * Ninguna acción se ejecuta automáticamente sobre los socios (RD10).
 */
export class ProcesoETLAsistencia {
  /** Instante de la última ejecución (la de cada gimnasio queda además en gimnasio.ultima_ejecucion_etl). */
  ultimaEjecucion: Date | null = null;

  async ejecutar(gimnasioId: number, hoy = ahoraLocal().fecha) {
    const gimnasio = await prisma.gimnasio.findUniqueOrThrow({ where: { id: gimnasioId }, include: { suscripcion: true } });
    const desde = gimnasio.ultimaEjecucionEtl ? sumarDias(ahoraLocal(gimnasio.ultimaEjecucionEtl).fecha, -1) : sumarDias(hoy, -VENTANA_HISTORIAL_DIAS);
    const indicadores = await this.cargarIndicadores(gimnasioId, desde, hoy);
    const historiales = await this.historiales(gimnasioId, hoy);
    const senales = await this.detectarSenales(gimnasioId, historiales, hoy);
    const estimaciones = gimnasio.suscripcion?.tipo === 'INTELLIGENCE' ? await this.estimarRiesgo(gimnasioId, historiales, hoy) : 0;
    this.ultimaEjecucion = new Date();
    await prisma.gimnasio.update({ where: { id: gimnasioId }, data: { ultimaEjecucionEtl: this.ultimaEjecucion } });
    return { gimnasioId, desde, hasta: hoy, indicadores, senales, estimaciones };
  }

  /** Transformación y carga: indicador_asistencia por sede, fecha y tipo de plan (idempotente). */
  private async cargarIndicadores(gimnasioId: number, desde: string, hasta: string) {
    const filas = await prisma.$queryRaw<{ sede_id: number; fecha: Date; tipo_plan: 'BASICO' | 'PREMIUM'; asistencias: bigint; socios: bigint }[]>`
      SELECT tc.sede_id, tc.fecha, ps.tipo AS tipo_plan,
             COUNT(a.asistencia_id) AS asistencias, COUNT(DISTINCT r.socio_id) AS socios
      FROM asistencia a
      JOIN reserva r ON r.reserva_id = a.reserva_id
      JOIN turno_clase tc ON tc.turno_clase_id = r.turno_clase_id
      JOIN sede s ON s.sede_id = tc.sede_id
      JOIN socio so ON so.socio_id = r.socio_id
      JOIN plan_socio ps ON ps.plan_socio_id = so.plan_socio_id
      WHERE s.gimnasio_id = ${gimnasioId} AND tc.fecha BETWEEN ${aFechaDb(desde)} AND ${aFechaDb(hasta)}
      GROUP BY tc.sede_id, tc.fecha, ps.tipo`;
    for (const f of filas) {
      await prisma.indicadorAsistencia.upsert({
        where: { sedeId_fecha_tipoPlan: { sedeId: f.sede_id, fecha: f.fecha, tipoPlan: f.tipo_plan } },
        create: { sedeId: f.sede_id, fecha: f.fecha, tipoPlan: f.tipo_plan, asistencias: Number(f.asistencias), sociosConAsistencia: Number(f.socios) },
        update: { asistencias: Number(f.asistencias), sociosConAsistencia: Number(f.socios) },
      });
    }
    return filas.length;
  }

  /** Historial de asistencia confirmada de cada socio activo en las últimas 10 semanas. */
  private async historiales(gimnasioId: number, hoy: string) {
    const filas = await prisma.$queryRaw<{ socio_id: number; recientes: bigint; previas: bigint; ultima: Date | null }[]>`
      SELECT so.socio_id,
        COUNT(a.asistencia_id) FILTER (WHERE tc.fecha > ${aFechaDb(sumarDias(hoy, -14))}) AS recientes,
        COUNT(a.asistencia_id) FILTER (WHERE tc.fecha <= ${aFechaDb(sumarDias(hoy, -14))}) AS previas,
        MAX(tc.fecha) AS ultima
      FROM socio so
      JOIN usuario u ON u.usuario_id = so.usuario_id AND u.activo
      JOIN sede s ON s.sede_id = so.sede_id AND s.gimnasio_id = ${gimnasioId}
      LEFT JOIN reserva r ON r.socio_id = so.socio_id
      LEFT JOIN asistencia a ON a.reserva_id = r.reserva_id
      LEFT JOIN turno_clase tc ON tc.turno_clase_id = r.turno_clase_id
        AND tc.fecha > ${aFechaDb(sumarDias(hoy, -VENTANA_HISTORIAL_DIAS))} AND tc.fecha <= ${aFechaDb(hoy)}
      GROUP BY so.socio_id`;
    const hoyMs = aFechaDb(hoy).getTime();
    return new Map<number, HistorialAsistencia>(
      filas.map((f) => [
        f.socio_id,
        {
          recientes: Number(f.recientes),
          previas: Number(f.previas),
          diasDesdeUltima: f.ultima ? Math.round((hoyMs - f.ultima.getTime()) / 86_400_000) : null,
        },
      ]),
    );
  }

  /** Señales de posible abandono (ambas suscripciones). Reemplaza las del mismo día. */
  async detectarSenales(gimnasioId: number, historiales: Map<number, HistorialAsistencia>, hoy: string) {
    const fecha = aFechaDb(hoy);
    const datos = [...historiales].flatMap(([socioId, h]) => {
      const senal = detectarSenal(h);
      return senal ? [{ socioId, ...senal, detectadaEl: fecha }] : [];
    });
    await prisma.$transaction([
      prisma.senalAbandono.deleteMany({ where: { detectadaEl: fecha, socio: { sede: { gimnasioId } }, propuestas: { none: {} } } }),
      prisma.senalAbandono.createMany({ data: datos }),
    ]);
    return datos.length;
  }

  /** Estimación orientativa del riesgo (solo NeuroGym Intelligence). */
  async estimarRiesgo(gimnasioId: number, historiales: Map<number, HistorialAsistencia>, hoy: string) {
    const impagas = new Set(
      (await prisma.cuota.findMany({ where: { estado: 'IMPAGA', socio: { sede: { gimnasioId } } }, select: { socioId: true } })).map((c) => c.socioId),
    );
    const fecha = aFechaDb(hoy);
    const datos = [...historiales].flatMap(([socioId, h]) => {
      const e = estimarRiesgo(h, impagas.has(socioId));
      return e ? [{ socioId, nivel: e.nivel, fundamento: e.fundamento, recomendacion: e.recomendacion, fecha }] : [];
    });
    await prisma.$transaction([
      prisma.estimacionRiesgo.deleteMany({ where: { fecha, socio: { sede: { gimnasioId } }, decisiones: { none: {} } } }),
      prisma.estimacionRiesgo.createMany({ data: datos }),
    ]);
    return datos.length;
  }

  /** CU-002-009: reporte avanzado en Excel según sede y período. */
  async exportarXlsx(gimnasioId: number, filtros: { sedeId?: number; desde: string; hasta: string }): Promise<Buffer> {
    const indicadores = await prisma.indicadorAsistencia.findMany({
      where: { sede: { gimnasioId }, ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}), fecha: { gte: aFechaDb(filtros.desde), lte: aFechaDb(filtros.hasta) } },
      include: { sede: { select: { nombre: true } } },
      orderBy: [{ fecha: 'asc' }],
    });
    const estimaciones = await prisma.estimacionRiesgo.findMany({
      where: { socio: { sede: { gimnasioId }, ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}) } },
      include: { socio: { include: { usuario: { select: { nombre: true, apellido: true } }, sede: { select: { nombre: true } } } } },
      orderBy: [{ fecha: 'desc' }],
    });
    const libro = new ExcelJS.Workbook();
    libro.creator = 'NeuroGym Intelligence';
    const hoja1 = libro.addWorksheet('Asistencia diaria');
    hoja1.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Sede', key: 'sede', width: 24 },
      { header: 'Plan', key: 'plan', width: 10 },
      { header: 'Asistencias', key: 'asistencias', width: 13 },
      { header: 'Socios con asistencia', key: 'socios', width: 22 },
    ];
    indicadores.forEach((i) =>
      hoja1.addRow({ fecha: fechaIso(i.fecha), sede: i.sede.nombre, plan: i.tipoPlan, asistencias: i.asistencias, socios: i.sociosConAsistencia }),
    );
    const hoja2 = libro.addWorksheet('Riesgo por socio');
    hoja2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Socio', key: 'socio', width: 28 },
      { header: 'Sede', key: 'sede', width: 22 },
      { header: 'Riesgo', key: 'nivel', width: 10 },
      { header: 'Fundamento', key: 'fundamento', width: 60 },
      { header: 'Recomendación', key: 'recomendacion', width: 60 },
    ];
    const ultimas = new Map<number, (typeof estimaciones)[number]>();
    estimaciones.forEach((e) => ultimas.has(e.socioId) || ultimas.set(e.socioId, e));
    [...ultimas.values()].forEach((e) =>
      hoja2.addRow({
        fecha: fechaIso(e.fecha),
        socio: `${e.socio.usuario.apellido}, ${e.socio.usuario.nombre}`,
        sede: e.socio.sede.nombre,
        nivel: e.nivel,
        fundamento: e.fundamento,
        recomendacion: e.recomendacion,
      }),
    );
    [hoja1, hoja2].forEach((h) => (h.getRow(1).font = { bold: true }));
    return Buffer.from(await libro.xlsx.writeBuffer());
  }
}

export const procesoEtl = new ProcesoETLAsistencia();

/** Ejecuta el ETL para todos los gimnasios (tarea programada nocturna). */
export async function ejecutarEtlTodos() {
  const gimnasios = await prisma.gimnasio.findMany({ select: { id: true } });
  const resultados = [];
  for (const { id } of gimnasios) resultados.push(await procesoEtl.ejecutar(id));
  return resultados;
}
