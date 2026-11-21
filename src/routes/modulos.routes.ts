import { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { rutinaController as ent } from '../controllers/rutina.controller';
import { equipamientoController as eq } from '../controllers/equipamiento.controller';
import { marketplaceController as mk } from '../controllers/marketplace.controller';
import { retencionController as ret } from '../controllers/retencion.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';
import { requierePermiso as permiso } from '../middlewares/permisos.middleware';
import { limitarIntentos } from '../middlewares/limite.middleware';

// Fotos y videos de incidencias: en memoria hasta guardarlos en el almacenamiento de objetos.
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.almacenamiento.maxBytes, files: 5 } });

// ---------------- Personal administrativo ----------------
export const adminModulosRoutes = Router();
adminModulosRoutes.use(autenticar, soloPerfiles('PERSONAL'));

adminModulosRoutes.get('/equipos', permiso('EQUIPAMIENTO', 'CONSULTA'), eq.listar);
adminModulosRoutes.post('/equipos', permiso('EQUIPAMIENTO', 'GESTION'), eq.crear);
adminModulosRoutes.get('/equipos/alertas', permiso('EQUIPAMIENTO', 'CONSULTA'), eq.alertas);
adminModulosRoutes.put('/equipos/:id', permiso('EQUIPAMIENTO', 'GESTION'), eq.actualizar);
adminModulosRoutes.patch('/equipos/:id/disponibilidad', permiso('EQUIPAMIENTO', 'GESTION'), eq.disponibilidad);
adminModulosRoutes.patch('/equipos/:id/baja', permiso('EQUIPAMIENTO', 'GESTION'), eq.baja);
adminModulosRoutes.put('/equipos/:id/ejercicios', permiso('EQUIPAMIENTO', 'GESTION'), eq.ejercicios);
adminModulosRoutes.get('/equipos/:id/historial', permiso('EQUIPAMIENTO', 'CONSULTA'), eq.historial);
adminModulosRoutes.get('/incidencias', permiso('EQUIPAMIENTO', 'CONSULTA'), eq.listarIncidencias);
adminModulosRoutes.patch('/incidencias/:id', permiso('EQUIPAMIENTO', 'GESTION'), eq.gestionarIncidencia);
adminModulosRoutes.patch('/incidencias/:id/agrupacion', permiso('EQUIPAMIENTO', 'GESTION'), eq.agrupar);
adminModulosRoutes.get('/mantenimientos', permiso('EQUIPAMIENTO', 'CONSULTA'), eq.listarMantenimientos);
adminModulosRoutes.post('/mantenimientos', permiso('EQUIPAMIENTO', 'GESTION'), eq.programarMantenimiento);
adminModulosRoutes.patch('/mantenimientos/:id/realizado', permiso('EQUIPAMIENTO', 'GESTION'), eq.mantenimientoRealizado);

// Constancia y regreso (CU-002): ETL manual y beneficios. Las rutas de los diagramas de secuencia están en retencion.routes.ts.
adminModulosRoutes.post('/retencion/etl', permiso('RETENCION', 'GESTION'), ret.ejecutarEtl);
adminModulosRoutes.get('/beneficios', permiso('RETENCION', 'CONSULTA'), ret.listarBeneficios);
adminModulosRoutes.post('/beneficios', permiso('RETENCION', 'GESTION'), ret.crearBeneficio);
adminModulosRoutes.put('/beneficios/:id', permiso('RETENCION', 'GESTION'), ret.actualizarBeneficio);


// ---------------- Socio ----------------
export const socioModulosRoutes = Router();
socioModulosRoutes.use(autenticar, soloPerfiles('SOCIO'));

socioModulosRoutes.get('/incidencias', eq.misIncidencias);
socioModulosRoutes.post('/incidencias', subida.array('archivos', 5), eq.reportar);

socioModulosRoutes.get('/rutina/opciones', ent.opciones);
socioModulosRoutes.get('/rutina/catalogo', ent.catalogo);

socioModulosRoutes.get('/beneficios', ret.misBeneficios);
socioModulosRoutes.post('/beneficios/:id/canje', ret.canjear);

// Marketplace (RD5: el servicio verifica Plan Premium al solicitar)
socioModulosRoutes.get('/profesionales', mk.listarProfesionales);
socioModulosRoutes.get('/profesionales/:id', mk.perfilPublico);
socioModulosRoutes.get('/profesionales/:id/horarios', mk.horarios);
socioModulosRoutes.get('/turnos-profesionales', mk.misTurnos);
socioModulosRoutes.post('/turnos-profesionales', mk.solicitar);

// ---------------- Profesional ----------------
export const profesionalRoutes = Router();
profesionalRoutes.post('/registro', limitarIntentos, mk.registrar);
profesionalRoutes.use(autenticar, soloPerfiles('PROFESIONAL'));
profesionalRoutes.get('/perfil', mk.perfil);
profesionalRoutes.put('/perfil', mk.actualizarPerfil);
profesionalRoutes.put('/plan', mk.cambiarPlan);
profesionalRoutes.post('/servicios', mk.crearServicio);
profesionalRoutes.put('/servicios/:id', mk.actualizarServicio);
profesionalRoutes.delete('/servicios/:id', mk.eliminarServicio);
profesionalRoutes.post('/disponibilidad', mk.crearDisponibilidad);
profesionalRoutes.delete('/disponibilidad/:id', mk.eliminarDisponibilidad);
profesionalRoutes.post('/metodos-pago', mk.crearMetodoPago);
profesionalRoutes.delete('/metodos-pago/:id', mk.eliminarMetodoPago);
profesionalRoutes.get('/agenda', mk.agenda);
profesionalRoutes.get('/comisiones', mk.comisiones);
profesionalRoutes.get('/horarios', mk.misHorarios);
profesionalRoutes.patch('/turnos/:id/confirmacion', mk.confirmar);
profesionalRoutes.patch('/turnos/:id/rechazo', mk.rechazar);
profesionalRoutes.patch('/turnos/:id/completado', mk.completar);

// ---------------- Comunes a socio y profesional ----------------
export const turnosProfesionalesRoutes = Router();
turnosProfesionalesRoutes.use(autenticar, soloPerfiles('SOCIO', 'PROFESIONAL'));
turnosProfesionalesRoutes.patch('/:id/cancelacion', mk.cancelar);
turnosProfesionalesRoutes.patch('/:id/reprogramacion', mk.reprogramar);
turnosProfesionalesRoutes.get('/:id/eventos', mk.eventos);
turnosProfesionalesRoutes.get('/:id/calendario', mk.calendario);

// ---------------- Sitio público (RF1) ----------------
export const publicoRoutes = Router();
publicoRoutes.get('/planes-marketplace', mk.planes);
publicoRoutes.get('/suscripciones', (_req, res) => {
  // RD1–RD3: condiciones comerciales publicadas en el sitio.
  res.json([
    { tipo: 'STANDARD', nombre: 'NeuroGym Standard', precioMensualUsd: 249, maxSedes: 3, maxSociosActivos: 1500, analiticaAvanzada: false },
    { tipo: 'INTELLIGENCE', nombre: 'NeuroGym Intelligence', precioMensualUsd: 449, maxSedes: 6, maxSociosActivos: 4000, analiticaAvanzada: true },
  ]);
});
