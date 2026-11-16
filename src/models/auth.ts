import type { TipoUsuario } from '@prisma/client';
import type { Rol } from '../patterns/composite';

/** Contenido firmado en el JWT. Solo identificadores: sin datos personales. */
export interface PayloadToken {
  sub: number;
  tipo: TipoUsuario;
}

/** Contexto del usuario autenticado, recalculado en cada solicitud desde la base. */
export interface UsuarioAutenticado {
  usuarioId: number;
  tipo: TipoUsuario;
  nombre: string;
  // Aislamiento multiempresa (RNF4): gimnasio del socio o del personal.
  gimnasioId?: number;
  socioId?: number;
  sedeId?: number;
  personalId?: number;
  profesionalId?: number;
  rol?: Rol;
  esAdminGeneral?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}
