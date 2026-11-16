import type { TipoAcceso } from '@prisma/client';
import type { ComponentePermiso } from './ComponentePermiso';

/**
 * Patrón Composite — compuesto.
 * Agrupa permisos (o subgrupos) y delega la evaluación en sus hijos.
 * Se usa para el grupo de cada módulo y para el acceso total del administrador general.
 */
export class GrupoPermisos implements ComponentePermiso {
  private readonly hijos: ComponentePermiso[] = [];

  constructor(private readonly modulo: string) {}

  agregar(componente: ComponentePermiso): this {
    this.hijos.push(componente);
    return this;
  }

  quitar(componente: ComponentePermiso): void {
    const indice = this.hijos.indexOf(componente);
    if (indice >= 0) this.hijos.splice(indice, 1);
  }

  getHijos(): readonly ComponentePermiso[] {
    return this.hijos;
  }

  getNombre(): string {
    return this.modulo;
  }

  permite(modulo: string, acceso: TipoAcceso): boolean {
    return this.hijos.some((hijo) => hijo.permite(modulo, acceso));
  }
}
