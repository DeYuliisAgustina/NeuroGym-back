import type { TipoAcceso } from '@prisma/client';
import type { ComponentePermiso } from './ComponentePermiso';
import { GrupoPermisos } from './GrupoPermisos';
import { Permiso } from './Permiso';

/** Datos mínimos de un rol persistido, con sus permisos y módulos. */
export interface RolPersistido {
  nombre: string;
  esPrincipal: boolean;
  permisos: { permiso: { acceso: TipoAcceso; modulo: { codigo: string } } }[];
}

/**
 * Patrón Composite — cliente.
 * El rol administrativo mantiene una lista de componentes (permisos o grupos)
 * y responde si habilita una acción sobre un módulo.
 */
export class Rol {
  private readonly componentes: ComponentePermiso[] = [];

  constructor(public readonly nombre: string) {}

  agregar(componente: ComponentePermiso): void {
    this.componentes.push(componente);
  }

  quitar(componente: ComponentePermiso): void {
    const indice = this.componentes.indexOf(componente);
    if (indice >= 0) this.componentes.splice(indice, 1);
  }

  getComponentes(): readonly ComponentePermiso[] {
    return this.componentes;
  }

  tienePermiso(modulo: string, acceso: TipoAcceso): boolean {
    return this.componentes.some((c) => c.permite(modulo, acceso));
  }

  /**
   * Arma el árbol Composite a partir del rol guardado: un GrupoPermisos por módulo
   * con sus permisos como hojas. El rol principal (administrador general) recibe
   * un grupo con todos los módulos del catálogo.
   */
  static desdePersistencia(rol: RolPersistido, catalogoModulos: string[] = []): Rol {
    const resultado = new Rol(rol.nombre);
    if (rol.esPrincipal) {
      const total = new GrupoPermisos('ADMINISTRACION_GENERAL');
      for (const modulo of catalogoModulos) {
        total.agregar(new GrupoPermisos(modulo).agregar(new Permiso(modulo, 'GESTION')));
      }
      resultado.agregar(total);
      return resultado;
    }
    const grupos = new Map<string, GrupoPermisos>();
    for (const { permiso } of rol.permisos) {
      const codigo = permiso.modulo.codigo;
      if (!grupos.has(codigo)) grupos.set(codigo, new GrupoPermisos(codigo));
      grupos.get(codigo)!.agregar(new Permiso(codigo, permiso.acceso));
    }
    grupos.forEach((grupo) => resultado.agregar(grupo));
    return resultado;
  }
}
