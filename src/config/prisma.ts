import { PrismaClient } from '@prisma/client';
import { env } from './env';

/** Cliente Prisma compartido: capa de acceso a datos de la arquitectura de tres capas. */
export const prisma = new PrismaClient({
  datasourceUrl: env.databaseUrl,
  // En pruebas no se registran los rechazos esperados de restricciones y disparadores.
  log: env.nodeEnv === 'development' ? ['warn', 'error'] : env.nodeEnv === 'test' ? [] : ['error'],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
