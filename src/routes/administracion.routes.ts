import { Router } from 'express';
import { administracionController as c } from '../controllers/administracion.controller';
import { asistenciaController } from '../controllers/asistencia.controller';
import { cuotaController } from '../controllers/cuota.controller';
import { socioController } from '../controllers/socio.controller';
import { turnoController } from '../controllers/turno.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';
import { requierePermiso as permiso, soloAdminGeneral } from '../middlewares/permisos.middleware';

/** Rutas del acceso administrativo: todas exigen personal autenticado y permiso por módulo. */
export const administracionRoutes = Router();
administracionRoutes.use(autenticar, soloPerfiles('PERSONAL'));

// Gimnasio y políticas
administracionRoutes.get('/gimnasio', c.gimnasio);
administracionRoutes.put('/gimnasio/politicas', permiso('CONFIGURACION', 'GESTION'), c.actualizarPoliticas);

// Sedes (RF16, RD21)
administracionRoutes.get('/sedes', permiso('SEDES', 'CONSULTA'), c.listarSedes);
administracionRoutes.post('/sedes', permiso('SEDES', 'GESTION'), c.crearSede);
administracionRoutes.get('/sedes/:id', permiso('SEDES', 'CONSULTA'), c.obtenerSede);
administracionRoutes.put('/sedes/:id', permiso('SEDES', 'GESTION'), c.actualizarSede);
administracionRoutes.patch('/sedes/:id/habilitacion', permiso('SEDES', 'GESTION'), c.habilitacionSede);

// Cuentas administrativas, roles y permisos (RF15): solo el administrador general
administracionRoutes.get('/personal', soloAdminGeneral, c.listarPersonal);
administracionRoutes.post('/personal', soloAdminGeneral, c.crearPersonal);
administracionRoutes.put('/personal/:id', soloAdminGeneral, c.actualizarPersonal);
administracionRoutes.patch('/personal/:id/estado', soloAdminGeneral, c.estadoPersonal);
administracionRoutes.get('/roles', soloAdminGeneral, c.listarRoles);
administracionRoutes.post('/roles', soloAdminGeneral, c.crearRol);
administracionRoutes.put('/roles/:id', soloAdminGeneral, c.actualizarRol);
administracionRoutes.delete('/roles/:id', soloAdminGeneral, c.eliminarRol);
administracionRoutes.get('/modulos', soloAdminGeneral, c.catalogoModulos);

// Planes y precios (RF16, RF20)
administracionRoutes.get('/planes', permiso('PRECIOS', 'CONSULTA'), c.listarPlanes);
administracionRoutes.put('/planes/:tipo/precio', permiso('PRECIOS', 'GESTION'), c.actualizarPrecio);

// Socios (RF16, RD20)
administracionRoutes.get('/socios', permiso('SOCIOS', 'CONSULTA'), socioController.listar);
administracionRoutes.post('/socios', permiso('SOCIOS', 'GESTION'), socioController.crear);
administracionRoutes.get('/socios/:id', permiso('SOCIOS', 'CONSULTA'), socioController.obtener);
administracionRoutes.put('/socios/:id', permiso('SOCIOS', 'GESTION'), socioController.actualizar);
administracionRoutes.patch('/socios/:id/estado', permiso('SOCIOS', 'GESTION'), socioController.cambiarEstado);

// Horarios y cupos de turnos (RF16, RD23)
administracionRoutes.get('/turnos', permiso('SEDES', 'CONSULTA'), turnoController.listar);
administracionRoutes.post('/turnos', permiso('SEDES', 'GESTION'), turnoController.crear);
administracionRoutes.post('/turnos/serie', permiso('SEDES', 'GESTION'), turnoController.crearSerie);
administracionRoutes.put('/turnos/:id', permiso('SEDES', 'GESTION'), turnoController.actualizar);
administracionRoutes.patch('/turnos/:id/habilitacion', permiso('SEDES', 'GESTION'), turnoController.habilitacion);
administracionRoutes.get('/turnos/:id/reservas', permiso('SEDES', 'CONSULTA'), turnoController.reservasDelTurno);

// Asistencias y rechazos
administracionRoutes.get('/asistencias', permiso('RECEPCION', 'CONSULTA'), asistenciaController.listar);
administracionRoutes.get('/rechazos', permiso('RECEPCION', 'CONSULTA'), asistenciaController.rechazos);

// Cuotas y cobros (RF19)
administracionRoutes.get('/cuotas', permiso('COBROS', 'CONSULTA'), cuotaController.listar);
administracionRoutes.get('/cuotas/resumen', permiso('COBROS', 'CONSULTA'), cuotaController.resumen);
administracionRoutes.post('/cuotas/:id/efectivo', permiso('COBROS', 'GESTION'), cuotaController.registrarEfectivo);
administracionRoutes.get('/pagos/:id/comprobante', permiso('COBROS', 'CONSULTA'), cuotaController.comprobante);
administracionRoutes.get('/pagos/:id/comprobante.pdf', permiso('COBROS', 'CONSULTA'), cuotaController.comprobantePdf);
