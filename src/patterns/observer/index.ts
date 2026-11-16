import { servicioMensajeria } from '../../integrations/mensajeria';
import { GestorEventosTurno } from './GestorEventosTurno';
import { NotificadorMensajeria } from './NotificadorMensajeria';
import { NotificadorPlataforma } from './NotificadorPlataforma';

export type * from './ObservadorTurno';
export { GestorEventosTurno, NotificadorPlataforma, NotificadorMensajeria };

/** Gestor compartido con los canales suscriptos al iniciar la aplicación. */
export const gestorEventosTurno = new GestorEventosTurno();
gestorEventosTurno.suscribir(new NotificadorPlataforma());
gestorEventosTurno.suscribir(new NotificadorMensajeria(servicioMensajeria));
