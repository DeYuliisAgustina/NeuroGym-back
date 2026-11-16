import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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

  if (process.env.NODE_ENV !== 'test') console.error(error);
  return res.status(500).json({ error: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' });
}
