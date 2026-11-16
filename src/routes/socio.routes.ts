import { Router } from 'express';
import { asistenciaController } from '../controllers/asistencia.controller';
import { cuotaController } from '../controllers/cuota.controller';
import { socioController } from '../controllers/socio.controller';
import { turnoController } from '../controllers/turno.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';

/** Autogestión del socio: perfil, turnos, QR de ingreso y pagos. */
export const socioRoutes = Router();
socioRoutes.use(autenticar, soloPerfiles('SOCIO'));

socioRoutes.get('/perfil', socioController.perfil);
socioRoutes.put('/perfil', socioController.actualizarPerfil);
socioRoutes.put('/plan', socioController.cambiarPlan);
socioRoutes.get('/sedes', socioController.sedes);

// Turnos (RF3)
socioRoutes.get('/turnos/disponibles', turnoController.disponibles);
socioRoutes.get('/reservas', turnoController.misReservas);
socioRoutes.post('/reservas', turnoController.reservar);
socioRoutes.patch('/reservas/:id/cancelacion', turnoController.cancelarReserva);

// QR de ingreso (RF4) y asistencias
socioRoutes.post('/qr', asistenciaController.miQr);
socioRoutes.get('/asistencias', asistenciaController.misAsistencias);

// Cuotas y pagos (CU-001)
socioRoutes.get('/cuota', cuotaController.detalle);
socioRoutes.get('/debito/descuento', cuotaController.descuentoDebito);
socioRoutes.delete('/debito', cuotaController.cancelarDebito);
socioRoutes.get('/pagos', cuotaController.historial);
socioRoutes.get('/pagos/:id/comprobante', cuotaController.comprobante);
