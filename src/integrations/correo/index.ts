import { env } from '../../config/env';
import { CorreoGmail } from './CorreoGmail';
import { CorreoSimulado } from './CorreoSimulado';
import type { ServicioCorreo } from './ServicioCorreo';

export type * from './ServicioCorreo';
export { esDominioDePrueba } from './ServicioCorreo';
export { CorreoGmail, CorreoSimulado };

/** Instancia única: Gmail si está configurado; si no, la simulación (código en la consola). */
export const servicioCorreo: ServicioCorreo = env.correo.proveedor === 'GMAIL' ? new CorreoGmail() : new CorreoSimulado();
