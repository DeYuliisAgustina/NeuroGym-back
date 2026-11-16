import { Router } from 'express';
import { asistenciaController } from '../controllers/asistencia.controller';
import { cuotaController } from '../controllers/cuota.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';
import { requierePermiso as permiso } from '../middlewares/permisos.middleware';

/** Rutas con los nombres de recurso usados en los diagramas de secuencia (CU-001 y CU-004). */
export const operacionRoutes = Router();

// CU-001: /api/cuotas/{id}/medios y /api/cuotas/{id}/pagos
operacionRoutes.get('/cuotas/:id/medios', autenticar, soloPerfiles('SOCIO'), cuotaController.medios);
operacionRoutes.post('/cuotas/:id/pagos', autenticar, soloPerfiles('SOCIO'), cuotaController.pagar);

// Mercado Pago: el webhook es público y se autentica por firma (x-signature).
operacionRoutes.post('/pagos/webhook', cuotaController.webhook);
operacionRoutes.post('/pagos/confirmacion', autenticar, soloPerfiles('SOCIO'), cuotaController.confirmarRetorno);
operacionRoutes.get('/pagos/integracion', cuotaController.estadoIntegracion);

// CU-004: recepción QR del personal autorizado
const recepcion = [autenticar, soloPerfiles('PERSONAL'), permiso('RECEPCION', 'CONSULTA')];
operacionRoutes.post('/asistencias/qr', ...recepcion, asistenciaController.ingresoQr);
operacionRoutes.post('/asistencias/autorizaciones', ...recepcion, permiso('RECEPCION', 'GESTION'), asistenciaController.autorizar);
operacionRoutes.post('/asistencias/manual', ...recepcion, permiso('RECEPCION', 'GESTION'), asistenciaController.manual);
operacionRoutes.post('/rechazos', ...recepcion, asistenciaController.bloquear);
