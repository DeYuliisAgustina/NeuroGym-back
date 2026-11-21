import { Router } from 'express';
import { asistenciaController } from '../controllers/asistencia.controller';
import { cuotaController } from '../controllers/cuota.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';
import { requierePermiso as permiso } from '../middlewares/permisos.middleware';

/** Rutas con los nombres de recurso usados en los diagramas de secuencia (CU-001 y CU-004). */
export const operacionRoutes = Router();

// CU-001: rutas de los diagramas de secuencia (Figuras 68 a 77).
const socio = [autenticar, soloPerfiles('SOCIO')];
operacionRoutes.get('/cuotas/actual', ...socio, cuotaController.detalle); // Fig. 68
operacionRoutes.get('/cuotas/:id/medios', ...socio, cuotaController.medios); // Fig. 69
operacionRoutes.post('/operaciones', ...socio, cuotaController.pagar); // Figs. 70, 71 y 73
operacionRoutes.get('/adhesiones/condiciones', ...socio, cuotaController.descuentoDebito); // Figs. 71 y 72
operacionRoutes.delete('/adhesiones/:id', ...socio, cuotaController.cancelarDebito); // Fig. 77
operacionRoutes.get('/pagos', ...socio, cuotaController.historial); // Fig. 75
operacionRoutes.get('/pagos/:id/comprobante', ...socio, cuotaController.comprobante); // Fig. 76
operacionRoutes.get('/pagos/:id/comprobante.pdf', ...socio, cuotaController.comprobantePdf);
// Al abrir «Cuotas y pagos» se confirman con Mercado Pago los pagos únicos pendientes.
operacionRoutes.post('/pagos/verificacion', ...socio, cuotaController.verificarPendientes);

// Mercado Pago: el webhook es público y se autentica por firma (x-signature) (Figs. 71, 73 y 74).
operacionRoutes.post('/webhooks/mp', cuotaController.webhook);
// Misma notificación en la dirección anterior, que puede seguir configurada en el panel de Mercado Pago.
operacionRoutes.post('/pagos/webhook', cuotaController.webhook);
operacionRoutes.post('/pagos/confirmacion', autenticar, soloPerfiles('SOCIO'), cuotaController.confirmarRetorno);
operacionRoutes.get('/pagos/integracion', cuotaController.estadoIntegracion);
// Regreso local de la autorización del débito automático (Mercado Pago no admite "localhost").
operacionRoutes.get('/pagos/retorno-adhesion', cuotaController.retornoAdhesion);

// CU-004: recepción QR del personal autorizado
const recepcion = [autenticar, soloPerfiles('PERSONAL'), permiso('RECEPCION', 'CONSULTA')];
operacionRoutes.post('/asistencias/qr', ...recepcion, asistenciaController.ingresoQr);
operacionRoutes.post('/asistencias/autorizaciones', ...recepcion, permiso('RECEPCION', 'GESTION'), asistenciaController.autorizar);
operacionRoutes.post('/asistencias/manual', ...recepcion, permiso('RECEPCION', 'GESTION'), asistenciaController.manual);
operacionRoutes.post('/rechazos', ...recepcion, asistenciaController.bloquear);
