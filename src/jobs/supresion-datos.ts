/**
 * Procedimiento de supresión o disociación de datos personales (Ley 25.326,
 * art. 16; TFI apartado 9.4). NO es la desactivación de la interfaz (RD20):
 * se ejecuta fuera de la plataforma, por pedido del gimnasio responsable, una
 * vez evaluada la procedencia de la solicitud.
 *
 * Uso: npm run supresion -- --socio <id> --gimnasio <id> --confirmar
 *
 * Disocia los datos identificatorios y elimina los que no deben conservarse;
 * mantiene cuotas, pagos y comprobantes durante los plazos legales aplicables.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { registrarAuditoria } from '../services/auditoria.service';

function argumento(nombre: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function suprimirDatosSocio(socioId: number, gimnasioId: number) {
  const socio = await prisma.socio.findFirst({ where: { id: socioId, sede: { gimnasioId } }, include: { usuario: true } });
  if (!socio) throw new Error('El socio no existe en ese gimnasio');
  const archivos = await prisma.archivoIncidencia.findMany({ where: { incidencia: { reportanteId: socioId } } });

  await prisma.$transaction(async (tx) => {
    const marca = `suprimido-${socio.usuarioId}-${crypto.randomBytes(4).toString('hex')}`;
    await tx.usuario.update({
      where: { id: socio.usuarioId },
      data: {
        email: `${marca}@neurogym.invalid`,
        nombre: 'Dato',
        apellido: 'suprimido',
        activo: false,
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
      },
    });
    await tx.socio.update({ where: { id: socioId }, data: { telefono: '0000000000' } });
    // Datos que no deben conservarse: preferencias, notificaciones, fotos y videos.
    await tx.preferenciaRutina.deleteMany({ where: { socioId } });
    await tx.notificacion.deleteMany({ where: { usuarioId: socio.usuarioId } });
    await tx.archivoIncidencia.deleteMany({ where: { incidencia: { reportanteId: socioId } } });
    await tx.incidencia.updateMany({ where: { reportanteId: socioId }, data: { descripcion: '[Descripción suprimida a pedido del titular]' } });
    await registrarAuditoria({ gimnasioId, accion: 'SUPRESION_DATOS_PERSONALES', entidad: 'socio', entidadId: socioId }, tx);
  });

  // Elimina del almacenamiento local los archivos que identificaban al titular.
  for (const archivo of archivos) {
    const relativo = archivo.url.split('/archivos/')[1];
    if (relativo) await fs.rm(path.join(env.almacenamiento.directorioLocal, relativo), { force: true });
  }
  return { socioId, archivosEliminados: archivos.length };
}

if (require.main === module) {
  const socioId = Number(argumento('socio'));
  const gimnasioId = Number(argumento('gimnasio'));
  if (!socioId || !gimnasioId || !process.argv.includes('--confirmar')) {
    console.error('Uso: npm run supresion -- --socio <id> --gimnasio <id> --confirmar');
    process.exit(1);
  }
  suprimirDatosSocio(socioId, gimnasioId)
    .then((r) => console.log('Supresión realizada:', r))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
