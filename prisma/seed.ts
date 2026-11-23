/**
 * Seed de DESARROLLO con datos ficticios (ningún dato personal real).
 * Crea dos gimnasios (para probar el aislamiento multiempresa), sedes, roles,
 * personal, socios con historial de asistencia, cuotas, equipamiento,
 * beneficios y profesionales del marketplace. Al final ejecuta el ETL.
 *
 * La contraseña de todas las cuentas de demostración es SEED_PASSWORD
 * (por defecto, el valor definido abajo). Solo para entornos locales.
 */
import bcrypt from 'bcrypt';
import { PrismaClient, type TipoPlanSocio } from '@prisma/client';
import { CODIGOS_MODULO, MODULOS } from '../src/models/modulos';
import { generarCuotaSocio, marcarCuotasVencidas } from '../src/services/cuotaGeneracion.service';
import { procesoEtl } from '../src/jobs/ProcesoETLAsistencia';
import { aFechaDb, aHoraDb, ahoraLocal, diaSemanaIso, sumarDias } from '../src/utils/fechas';
import { generarCodigoQr } from '../src/utils/codigoQr';

const prisma = new PrismaClient();
const PASSWORD_DEMO = process.env.SEED_PASSWORD ?? 'neurogym123';

// Generador pseudoaleatorio determinístico: el seed produce siempre los mismos datos.
let semilla = 20261116;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const elegir = <T>(lista: readonly T[]) => lista[Math.floor(azar() * lista.length)];

const NOMBRES = ['Lucía', 'Martín', 'Sofía', 'Mateo', 'Valentina', 'Benjamín', 'Camila', 'Joaquín', 'Martina', 'Tomás', 'Julieta', 'Santiago', 'Emilia', 'Facundo', 'Abril', 'Lautaro', 'Catalina', 'Nicolás', 'Pilar', 'Agustín'];
const APELLIDOS = ['Ficticio', 'Ejemplo', 'Prueba', 'Demostración', 'Modelo', 'Muestra', 'Simulado', 'Ensayo', 'Piloto', 'Maqueta'];

const EJERCICIOS: [string, string, string | null][] = [
  ['Sentadilla con barra', 'Piernas', 'Rack de sentadillas'],
  ['Prensa de piernas', 'Piernas', 'Prensa 45°'],
  ['Sillón de cuádriceps', 'Piernas', 'Sillón de cuádriceps'],
  ['Estocadas con mancuernas', 'Piernas', 'Mancuernas'],
  ['Sentadilla búlgara', 'Piernas', null],
  ['Press de banca plano', 'Pecho', 'Banco de press plano'],
  ['Press con mancuernas en banco inclinado', 'Pecho', 'Mancuernas'],
  ['Aperturas en máquina', 'Pecho', 'Máquina de aperturas'],
  ['Flexiones de brazos', 'Pecho', null],
  ['Dominadas asistidas', 'Espalda', 'Máquina de dominadas asistidas'],
  ['Jalón al pecho', 'Espalda', 'Polea alta'],
  ['Remo en polea baja', 'Espalda', 'Polea baja'],
  ['Remo con mancuerna', 'Espalda', 'Mancuernas'],
  ['Press militar con mancuernas', 'Hombros', 'Mancuernas'],
  ['Vuelos laterales', 'Hombros', 'Mancuernas'],
  ['Press de hombros en máquina', 'Hombros', 'Máquina de press de hombros'],
  ['Curl de bíceps con barra', 'Brazos', 'Barra olímpica'],
  ['Extensión de tríceps en polea', 'Brazos', 'Polea alta'],
  ['Fondos en banco', 'Brazos', null],
  ['Plancha abdominal', 'Core', null],
  ['Crunch en máquina', 'Core', 'Máquina de abdominales'],
  ['Elevación de piernas colgado', 'Core', 'Máquina de dominadas asistidas'],
  ['Cinta caminadora', 'Cardio', 'Cinta caminadora'],
  ['Bicicleta fija', 'Cardio', 'Bicicleta fija'],
  ['Remo ergómetro', 'Cardio', 'Remo ergómetro'],
  ['Movilidad de cadera', 'Movilidad', null],
  ['Movilidad torácica', 'Movilidad', null],
  ['Estiramiento de isquiotibiales', 'Movilidad', null],
];

async function catalogoSeguridad() {
  for (const codigo of CODIGOS_MODULO) {
    const modulo = await prisma.modulo.upsert({ where: { codigo }, update: { nombre: MODULOS[codigo] }, create: { codigo, nombre: MODULOS[codigo] } });
    for (const acceso of ['CONSULTA', 'GESTION'] as const) {
      await prisma.permiso.upsert({ where: { moduloId_acceso: { moduloId: modulo.id, acceso } }, update: {}, create: { moduloId: modulo.id, acceso } });
    }
  }
  await prisma.planMarketplace.createMany({
    data: [
      { tipo: 'BASICO', precioMensualUsd: 5, porcentajeComision: 8, perfilPromocionado: false },
      { tipo: 'PROFESIONAL', precioMensualUsd: 15, porcentajeComision: 2, perfilPromocionado: true },
    ],
    skipDuplicates: true,
  });
}

async function permisosDe(lista: [string, 'CONSULTA' | 'GESTION'][]) {
  const permisos = await prisma.permiso.findMany({ include: { modulo: true } });
  return lista.map(([modulo, acceso]) => ({ permisoId: permisos.find((p) => p.modulo.codigo === modulo && p.acceso === acceso)!.id }));
}

async function crearGimnasio(datos: {
  razonSocial: string;
  cuit: string;
  tipo: 'STANDARD' | 'INTELLIGENCE';
  dominio: string;
  sedes: { nombre: string; direccion: string; horarios: string }[];
  precios: Record<TipoPlanSocio, number>;
}) {
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10);
  const gimnasio = await prisma.gimnasio.create({
    data: {
      razonSocial: datos.razonSocial,
      cuit: datos.cuit,
      suscripcion: {
        create: {
          tipo: datos.tipo,
          maxSedes: datos.tipo === 'INTELLIGENCE' ? 6 : 3,
          maxSociosActivos: datos.tipo === 'INTELLIGENCE' ? 4000 : 1500,
          fechaInicio: aFechaDb('2026-11-01'),
        },
      },
      sedes: { create: datos.sedes },
      planes: { create: [{ tipo: 'BASICO', importeMensual: datos.precios.BASICO }, { tipo: 'PREMIUM', importeMensual: datos.precios.PREMIUM }] },
    },
    include: { sedes: true, planes: true },
  });

  const roles = {
    admin: await prisma.rol.create({ data: { gimnasioId: gimnasio.id, nombre: 'Administrador general', esPrincipal: true } }),
    recepcion: await prisma.rol.create({
      data: {
        gimnasioId: gimnasio.id,
        nombre: 'Recepción',
        permisos: { create: await permisosDe([['RECEPCION', 'GESTION'], ['SOCIOS', 'CONSULTA'], ['COBROS', 'CONSULTA'], ['SEDES', 'CONSULTA']]) },
      },
    }),
    cobranzas: await prisma.rol.create({
      data: { gimnasioId: gimnasio.id, nombre: 'Cobranzas', permisos: { create: await permisosDe([['COBROS', 'GESTION'], ['SOCIOS', 'CONSULTA'], ['PRECIOS', 'CONSULTA']]) } },
    }),
    mantenimiento: await prisma.rol.create({
      data: { gimnasioId: gimnasio.id, nombre: 'Mantenimiento', permisos: { create: await permisosDe([['EQUIPAMIENTO', 'GESTION'], ['SEDES', 'CONSULTA']]) } },
    }),
    analista: await prisma.rol.create({
      data: {
        gimnasioId: gimnasio.id,
        nombre: 'Analista de retención',
        permisos: { create: await permisosDe([['RETENCION', 'CONSULTA'], ['INTELLIGENCE', 'CONSULTA'], ['SOCIOS', 'CONSULTA']]) },
      },
    }),
  };

  const personal: Record<string, number> = {};
  for (const [clave, rol, nombre] of [
    ['admin', roles.admin, 'Ana'],
    ['recepcion', roles.recepcion, 'Ramiro'],
    ['cobranzas', roles.cobranzas, 'Carla'],
    ['mantenimiento', roles.mantenimiento, 'Marcos'],
    ['analista', roles.analista, 'Inés'],
  ] as const) {
    const p = await prisma.personalAdministrativo.create({
      data: {
        gimnasio: { connect: { id: gimnasio.id } },
        rol: { connect: { id_gimnasioId: { id: rol.id, gimnasioId: gimnasio.id } } },
        usuario: { create: { email: `${clave}@${datos.dominio}`, passwordHash: hash, nombre, apellido: 'Demo', tipo: 'PERSONAL' } },
      },
    });
    personal[clave] = p.id;
  }
  return { gimnasio, personal, hash };
}

async function crearEquipamiento(sedeId: number, responsableId: number) {
  const nombres = [...new Set(EJERCICIOS.map(([, , equipo]) => equipo).filter(Boolean))] as string[];
  const equipos = new Map<string, number>();
  for (const nombre of nombres) {
    const categoria = /Cinta|Bicicleta|Remo erg/.test(nombre) ? 'Cardio' : /Mancuernas|Barra/.test(nombre) ? 'Peso libre' : 'Máquina';
    const e = await prisma.equipo.create({
      data: {
        sedeId,
        nombre,
        categoria,
        fechaCompra: aFechaDb('2021-03-15'),
        vidaUtilAnios: categoria === 'Cardio' ? 6 : 10,
        proximoService: aFechaDb(sumarDias(ahoraLocal().fecha, Math.floor(azar() * 40) + 3)),
      },
    });
    equipos.set(nombre, e.id);
  }
  for (const [nombre, , equipo] of EJERCICIOS) {
    if (!equipo) continue;
    const ejercicio = await prisma.ejercicio.findUniqueOrThrow({ where: { nombre } });
    await prisma.ejercicioEquipo.create({ data: { ejercicioId: ejercicio.id, equipoId: equipos.get(equipo)! } });
  }
  // Casos de demostración: equipo fuera de servicio y equipo retirado del inventario (RD22).
  await prisma.equipo.update({ where: { id: equipos.get('Prensa 45°')! }, data: { estado: 'FUERA_DE_SERVICIO' } });
  const retirado = await prisma.equipo.create({
    data: { sedeId, nombre: 'Escalador antiguo', categoria: 'Cardio', estado: 'DADO_DE_BAJA', fechaBaja: aFechaDb(sumarDias(ahoraLocal().fecha, -20)), fechaCompra: aFechaDb('2014-06-01'), vidaUtilAnios: 8 },
  });
  await prisma.mantenimiento.create({
    data: {
      equipoId: retirado.id,
      tipo: 'CORRECTIVO',
      estado: 'REALIZADO',
      inicioProgramado: new Date(Date.now() - 90 * 86400000),
      finProgramado: new Date(Date.now() - 89 * 86400000),
      fechaRealizada: new Date(Date.now() - 89 * 86400000),
      detalleRealizado: 'Cambio de correa. Se recomienda recambio por fin de vida útil.',
      responsableId,
    },
  });
  return equipos;
}

async function main() {
  const hoy = ahoraLocal().fecha;
  console.log(`Seed de desarrollo NeuroGym (${hoy})`);
  await catalogoSeguridad();
  await prisma.ejercicio.createMany({ data: EJERCICIOS.map(([nombre, grupoMuscular]) => ({ nombre, grupoMuscular })), skipDuplicates: true });

  const piloto = await crearGimnasio({
    razonSocial: 'Gimnasio Piloto Demo S.A.',
    cuit: '30-00000000-1',
    tipo: 'INTELLIGENCE',
    dominio: 'neurogym.test',
    sedes: [
      { nombre: 'Sede Centro', direccion: 'Calle Ficticia 100, Rosario', horarios: 'Lun a vie 7 a 23 h; sáb 9 a 18 h' },
      { nombre: 'Sede Norte', direccion: 'Avenida Ejemplo 2500, Rosario', horarios: 'Lun a vie 8 a 22 h' },
    ],
    precios: { BASICO: 32000, PREMIUM: 12000 },
  });
  const otro = await crearGimnasio({
    razonSocial: 'Otro Gimnasio Demo S.R.L.',
    cuit: '30-00000000-2',
    tipo: 'STANDARD',
    dominio: 'otrogym.test',
    sedes: [{ nombre: 'Sede Única', direccion: 'Pasaje Prueba 50, Rosario', horarios: 'Lun a sáb 8 a 22 h' }],
    precios: { BASICO: 28000, PREMIUM: 10000 },
  });

  // Historial de precios (RD12): actualización aplicada hace 40 días.
  const basico = piloto.gimnasio.planes.find((p) => p.tipo === 'BASICO')!;
  await prisma.actualizacionPrecio.create({
    data: { planSocioId: basico.id, importeAnterior: 29000, importeNuevo: 32000, vigenteDesde: aFechaDb(sumarDias(hoy, -40)), motivo: 'Actualización por inflación (dato ficticio)', responsableId: piloto.personal.admin },
  });

  const equiposPorSede = new Map<number, Map<string, number>>();
  for (const sede of [...piloto.gimnasio.sedes, ...otro.gimnasio.sedes]) {
    const responsable = piloto.gimnasio.sedes.includes(sede) ? piloto.personal.mantenimiento : otro.personal.mantenimiento;
    equiposPorSede.set(sede.id, await crearEquipamiento(sede.id, responsable));
  }

  // Turnos: 70 días hacia atrás y 14 hacia adelante (musculación y clases).
  const turnosPorSedeFecha = new Map<string, number[]>();
  for (const sede of [...piloto.gimnasio.sedes, ...otro.gimnasio.sedes]) {
    for (let d = -70; d <= 14; d++) {
      const fecha = sumarDias(hoy, d);
      const dia = diaSemanaIso(fecha);
      if (dia === 7) continue;
      const franjas: [string, string, string, number][] = [
        ['Musculación', '07:00', '08:30', 30],
        ['Musculación', '18:00', '19:30', 30],
      ];
      if ([1, 3, 5].includes(dia)) franjas.push(['Funcional', '19:30', '20:30', 15]);
      if ([2, 4].includes(dia)) franjas.push(['Yoga', '09:00', '10:00', 12]);
      const ids: number[] = [];
      for (const [actividad, inicio, fin, cupo] of franjas) {
        const t = await prisma.turnoClase.create({
          data: { sedeId: sede.id, actividad, fecha: aFechaDb(fecha), horaInicio: aHoraDb(inicio), horaFin: aHoraDb(fin), cupo },
        });
        ids.push(t.id);
      }
      turnosPorSedeFecha.set(`${sede.id}|${fecha}`, ids);
    }
  }

  // Socios con perfiles de asistencia: regular, en descenso, ausente y nuevo.
  type Perfil = 'REGULAR' | 'DESCENSO' | 'AUSENTE' | 'NUEVO';
  const perfiles: Perfil[] = ['REGULAR', 'REGULAR', 'REGULAR', 'DESCENSO', 'AUSENTE', 'NUEVO'];
  let n = 0;
  for (const { gimnasio, hash, cantidad } of [
    { ...piloto, cantidad: 28 },
    { ...otro, cantidad: 8 },
  ]) {
    for (let i = 0; i < cantidad; i++) {
      n++;
      const sede = gimnasio.sedes[i % gimnasio.sedes.length];
      const plan = gimnasio.planes.find((p) => p.tipo === (i % 3 === 0 ? 'PREMIUM' : 'BASICO'))!;
      const perfil = perfiles[i % perfiles.length];
      const socio = await prisma.socio.create({
        data: {
          sede: { connect: { id: sede.id } },
          plan: { connect: { id: plan.id } },
          telefono: `341 555-${String(1000 + n)}`,
          consentimientoDatos: true,
          usuario: {
            create: {
              email: `socio${n}@${gimnasio.id === piloto.gimnasio.id ? 'neurogym.test' : 'otrogym.test'}`,
              passwordHash: hash,
              nombre: elegir(NOMBRES),
              apellido: elegir(APELLIDOS),
              tipo: 'SOCIO',
              fechaAlta: new Date(Date.now() - 120 * 86400000),
            },
          },
        },
      });

      // Asistencias pasadas con QR válido y día de constancia (RD7, RD9).
      const inicioHist = perfil === 'NUEVO' ? 0 : -70;
      const finHist = perfil === 'DESCENSO' ? -16 : perfil === 'AUSENTE' ? -26 : -1;
      for (let d = inicioHist; d <= finHist && perfil !== 'NUEVO'; d++) {
        const fecha = sumarDias(hoy, d);
        const turnos = turnosPorSedeFecha.get(`${sede.id}|${fecha}`);
        if (!turnos || azar() > (perfil === 'REGULAR' ? 0.5 : 0.45)) continue;
        const turnoId = elegir(turnos);
        const turno = await prisma.turnoClase.findUniqueOrThrow({ where: { id: turnoId } });
        const ingreso = new Date(`${fecha}T${turno.horaInicio.toISOString().slice(11, 16)}:00-03:00`);
        ingreso.setMinutes(ingreso.getMinutes() - 5);
        const reserva = await prisma.reserva.create({ data: { turnoClaseId: turnoId, socioId: socio.id, fechaReserva: new Date(ingreso.getTime() - 86400000) } });
        const qr = await prisma.codigoQr.create({
          data: { socioId: socio.id, codigo: generarCodigoQr(), emitidoEn: new Date(ingreso.getTime() - 60000), expiraEn: new Date(ingreso.getTime() + 60000) },
        });
        const asistencia = await prisma.asistencia.create({ data: { reservaId: reserva.id, codigoQrId: qr.id, fechaHoraReal: ingreso, forma: 'QR' } });
        const yaComputado = await prisma.diaConstancia.findUnique({ where: { socioId_fecha: { socioId: socio.id, fecha: aFechaDb(fecha) } } });
        if (!yaComputado) {
          await prisma.diaConstancia.create({ data: { socioId: socio.id, asistenciaId: asistencia.id, fecha: aFechaDb(fecha), puntos: 10 } });
          await prisma.socio.update({ where: { id: socio.id }, data: { saldoPuntos: { increment: 10 } } });
        }
      }
      // Una reserva próxima (todavía sin asistencia).
      if (perfil !== 'AUSENTE') {
        const proximos = turnosPorSedeFecha.get(`${sede.id}|${sumarDias(hoy, 1)}`) ?? turnosPorSedeFecha.get(`${sede.id}|${sumarDias(hoy, 2)}`);
        if (proximos) await prisma.reserva.create({ data: { turnoClaseId: proximos[0], socioId: socio.id } });
      }

      // Cuotas: dos períodos anteriores y el actual (con una impaga para RD8).
      const periodoActual = hoy.slice(0, 7);
      const periodos = [sumarDias(`${periodoActual}-01`, -40).slice(0, 7), sumarDias(`${periodoActual}-01`, -10).slice(0, 7)];
      if (i % 5 === 1) {
        await prisma.adhesionDebito.create({ data: { socioId: socio.id, idPreaprobacion: `SEED-PRE-${n}`, fechaAlta: aFechaDb(sumarDias(hoy, -80)) } });
      }
      const adhesion = await prisma.adhesionDebito.findFirst({ where: { socioId: socio.id, estado: 'ACTIVA' } });
      for (const [k, periodo] of periodos.entries()) {
        const { cuota } = await generarCuotaSocio(socio.id, periodo);
        const impaga = k === 1 && (perfil === 'AUSENTE' || i % 7 === 3);
        if (impaga) {
          await prisma.cuota.update({ where: { id: cuota.id }, data: { estado: 'IMPAGA' } });
          continue;
        }
        const medio = adhesion ? 'DEBITO_AUTOMATICO' : i % 2 === 0 ? 'PAGO_UNICO' : 'EFECTIVO';
        const pago = await prisma.pago.create({
          data: {
            cuotaId: cuota.id,
            medio,
            importe: cuota.importeFinal,
            estado: 'APROBADO',
            adhesionId: medio === 'DEBITO_AUTOMATICO' ? adhesion!.id : null,
            responsableId: medio === 'EFECTIVO' ? (gimnasio.id === piloto.gimnasio.id ? piloto.personal.cobranzas : otro.personal.cobranzas) : null,
            referenciaExterna: medio === 'EFECTIVO' ? null : `SEED-${periodo}-${n}`,
            fecha: new Date(`${periodo}-05T13:00:00Z`),
          },
        });
        await prisma.cuota.update({ where: { id: cuota.id }, data: { estado: 'PAGADA' } });
        await prisma.comprobante.create({ data: { pagoId: pago.id, numero: `NG-${String(pago.id).padStart(8, '0')}`, fechaEmision: pago.fecha, fechaEnvio: pago.fecha } });
      }
      await generarCuotaSocio(socio.id, periodoActual);
    }
  }

  // Beneficios por constancia (RF11).
  for (const g of [piloto.gimnasio, otro.gimnasio]) {
    await prisma.beneficio.createMany({
      data: [
        { gimnasioId: g.id, nombre: 'Botella NeuroGym', descripcion: 'Retiro en recepción', costoPuntos: 100, vigenciaDias: 30 },
        { gimnasioId: g.id, nombre: 'Clase de prueba para un invitado', descripcion: 'Válida de lunes a viernes', costoPuntos: 150, vigenciaDias: 30 },
        { gimnasioId: g.id, nombre: 'Evaluación con entrenador', descripcion: 'Sesión de 30 minutos', costoPuntos: 250, vigenciaDias: 45 },
      ],
    });
  }

  // Incidencia reportada por un socio sobre el equipo fuera de servicio.
  const socioReportante = await prisma.socio.findFirstOrThrow({ where: { sedeId: piloto.gimnasio.sedes[0].id } });
  await prisma.incidencia.create({
    data: {
      equipoId: equiposPorSede.get(piloto.gimnasio.sedes[0].id)!.get('Prensa 45°')!,
      reportanteId: socioReportante.id,
      descripcion: 'El seguro del carro no traba correctamente.',
      prioridad: 'ALTA',
      estado: 'EN_GESTION',
      responsableId: piloto.personal.mantenimiento,
    },
  });

  // Profesionales del marketplace (independientes de los gimnasios).
  const hashProf = await bcrypt.hash(PASSWORD_DEMO, 10);
  const planes = await prisma.planMarketplace.findMany();
  const profesionales = [
    { email: 'nutri1@neurogym.test', nombre: 'Laura', apellido: 'Nutrición Demo', especialidad: 'NUTRICION' as const, plan: 'PROFESIONAL', exentas: 5, modalidad: 'ONLINE_Y_PRESENCIAL' as const },
    { email: 'nutri2@neurogym.test', nombre: 'Diego', apellido: 'Alimentación Demo', especialidad: 'NUTRICION' as const, plan: 'BASICO', exentas: 0, modalidad: 'ONLINE' as const },
    { email: 'deporte1@neurogym.test', nombre: 'Paula', apellido: 'Deportología Demo', especialidad: 'DEPORTOLOGIA' as const, plan: 'BASICO', exentas: 5, modalidad: 'PRESENCIAL' as const },
  ];
  for (const [k, p] of profesionales.entries()) {
    await prisma.profesional.create({
      data: {
        especialidad: p.especialidad,
        modalidadAtencion: p.modalidad,
        valorConsulta: 25000 + k * 5000,
        consentimientoDatos: true,
        codigoReferido: `REF-DEMO${k + 1}`,
        consultasExentas: p.exentas,
        plan: { connect: { id: planes.find((x) => x.tipo === p.plan)!.id } },
        usuario: { create: { email: p.email, passwordHash: hashProf, nombre: p.nombre, apellido: p.apellido, tipo: 'PROFESIONAL' } },
        servicios: {
          create: [
            { nombre: p.especialidad === 'NUTRICION' ? 'Plan alimentario personalizado' : 'Evaluación deportiva', descripcion: 'Consulta inicial con seguimiento (servicio ficticio).' },
            { nombre: 'Control mensual', descripcion: 'Seguimiento de objetivos.' },
          ],
        },
        disponibilidad: {
          create: ['LUNES', 'MIERCOLES', 'VIERNES'].map((dia) => ({ diaSemana: dia as 'LUNES', horaInicio: aHoraDb('09:00'), horaFin: aHoraDb('13:00'), duracionConsultaMin: 45 })),
        },
        metodosPago: {
          create: [{ tipo: 'PARTICULAR' }, { tipo: 'ACUERDO_CONSULTA' }, ...(k === 0 ? [{ tipo: 'OBRA_SOCIAL' as const, obraSocial: 'Obra Social Ficticia' }] : [])],
        },
      },
    });
  }

  // Cuotas del período ya vencidas pasan a IMPAGA (como lo haría la tarea diaria).
  console.log('Cuotas vencidas', await marcarCuotasVencidas());

  // ETL inicial: indicadores, señales y estimaciones (Intelligence).
  for (const g of [piloto.gimnasio, otro.gimnasio]) console.log('ETL', await procesoEtl.ejecutar(g.id));
  const totales = {
    gimnasios: await prisma.gimnasio.count(),
    sedes: await prisma.sede.count(),
    socios: await prisma.socio.count(),
    turnos: await prisma.turnoClase.count(),
    asistencias: await prisma.asistencia.count(),
    cuotas: await prisma.cuota.count(),
    pagos: await prisma.pago.count(),
    equipos: await prisma.equipo.count(),
    profesionales: await prisma.profesional.count(),
  };
  console.table(totales);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
