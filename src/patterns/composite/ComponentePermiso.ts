import type { TipoAcceso } from '@prisma/client';

/**
 * Patrón Composite (estructural) — componente.
 * Interfaz común para permisos individuales (hojas) y agrupaciones de permisos
 * (compuestos), de modo que un rol evalúe su acceso sin distinguir entre ambos.
 */
export interface ComponentePermiso {
  getNombre(): string;
  permite(modulo: string, acceso: TipoAcceso): boolean;
}
