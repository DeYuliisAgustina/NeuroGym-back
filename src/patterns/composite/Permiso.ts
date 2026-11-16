import type { TipoAcceso } from '@prisma/client';
import type { ComponentePermiso } from './ComponentePermiso';

/**
 * Patrón Composite — hoja.
 * Permiso individual de CONSULTA o GESTION sobre un módulo.
 */
export class Permiso implements ComponentePermiso {
  constructor(
    private readonly modulo: string,
    private readonly acceso: TipoAcceso,
  ) {}

  getNombre(): string {
    return `${this.modulo}:${this.acceso}`;
  }

  // Quien puede gestionar un módulo también puede consultarlo.
  permite(modulo: string, acceso: TipoAcceso): boolean {
    return this.modulo === modulo && (this.acceso === acceso || this.acceso === 'GESTION');
  }
}
