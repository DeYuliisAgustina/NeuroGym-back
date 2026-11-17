import { Router } from 'express';
import { administracionRoutes } from './administracion.routes';
import { authRoutes } from './auth.routes';
import { adminModulosRoutes, profesionalRoutes, publicoRoutes, socioModulosRoutes, turnosProfesionalesRoutes } from './modulos.routes';
import { notificacionRoutes } from './notificacion.routes';
import { operacionRoutes } from './operacion.routes';
import { socioRoutes } from './socio.routes';
import { whatsappRoutes } from './whatsapp.routes';

/** Punto de entrada de la API REST: agrupa las rutas de cada módulo. */
export const apiRoutes = Router();

apiRoutes.use('/publico', publicoRoutes);
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/admin', administracionRoutes, adminModulosRoutes);
apiRoutes.use('/socio', socioRoutes, socioModulosRoutes);
apiRoutes.use('/profesional', profesionalRoutes);
apiRoutes.use('/turnos-profesionales', turnosProfesionalesRoutes);
apiRoutes.use('/notificaciones', notificacionRoutes);
apiRoutes.use('/whatsapp', whatsappRoutes);
apiRoutes.use('/', operacionRoutes);
