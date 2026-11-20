import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { ErrorApp } from '../utils/errores';

/** Extrae el mensaje de un RAISE EXCEPTION o de un CHECK de PostgreSQL (SQLSTATE 23514). */
function violacionIntegridad(error: unknown): string | null {
  const mensaje = error instanceof Error ? error.message : '';
  if (!/23514|violates check constraint|viola la restricción/i.test(mensaje)) return null;
  const raise = /message: "([^"]+)"/.exec(mensaje) ?? /ERROR:\s*([^\n]+)/.exec(mensaje);
  return raise?.[1]?.trim() ?? 'La operación viola una regla de integridad de los datos';
}

/**
 * Manejo centralizado y seguro de errores: respuestas uniformes en JSON,
 * sin exponer trazas ni detalles internos de la base al cliente.
 */
export function manejarErrores(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ErrorApp) {
    return res.status(error.status).json({ error: error.codigo, mensaje: error.message, detalle: error.detalle });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'DATOS_INVALIDOS',
      mensaje: 'Revisá los datos ingresados',
      detalle: error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    });
  }
  if (error instanceof Error && error.name === 'IdInvalido') {
    return res.status(400).json({ error: 'ID_INVALIDO', mensaje: error.message });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'DUPLICADO', mensaje: 'Ya existe un registro con esos datos' });
    if (error.code === 'P2003') {
      return res.status(409).json({ error: 'REFERENCIA_INVALIDA', mensaje: 'El registro está relacionado con otros datos' });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Registro no encontrado' });
  }
  const integridad = violacionIntegridad(error);
  if (integridad) return res.status(422).json({ error: 'REGLA_INTEGRIDAD', mensaje: integridad });

  // Límites de la subida de fotos y videos de incidencias (multer): error del cliente, no del servidor.
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'ARCHIVO_DEMASIADO_GRANDE', mensaje: 'El archivo supera el tamaño permitido' });
    }
    return res.status(400).json({ error: 'ARCHIVOS_INVALIDOS', mensaje: 'Se pueden adjuntar hasta 5 fotos o videos en el campo «archivos»' });
  }

  // Errores 4xx de los middlewares de Express: JSON mal formado o cuerpo demasiado
  // grande (http-errors marca expose = true) y archivo estático inexistente en
  // /archivos (express.static informa 404 con el código ENOENT).
  const http = error as { status?: number; statusCode?: number; type?: string; expose?: boolean; code?: string };
  const estado = http?.status ?? http?.statusCode;
  const archivoInexistente = estado === 404 && (http?.code === 'ENOENT' || http?.code === 'ENOTDIR');
  if ((http?.expose === true || archivoInexistente) && typeof estado === 'number' && estado >= 400 && estado < 500) {
    if (http.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON_INVALIDO', mensaje: 'El cuerpo de la solicitud no es un JSON válido' });
    }
    if (http.type === 'entity.too.large') {
      return res.status(413).json({ error: 'CUERPO_DEMASIADO_GRANDE', mensaje: 'La solicitud supera el tamaño permitido' });
    }
    if (estado === 404) return res.status(404).json({ error: 'RUTA_INEXISTENTE', mensaje: 'Recurso no encontrado' });
    return res.status(estado).json({ error: 'SOLICITUD_INVALIDA', mensaje: 'La solicitud no es válida' });
  }

  if (process.env.NODE_ENV !== 'test') console.error(error);
  return res.status(500).json({ error: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' });
}
