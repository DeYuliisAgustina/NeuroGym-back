import { Router } from 'express';
import { intelligenceController as intel } from '../controllers/intelligence.controller';
import { retencionController as ret } from '../controllers/retencion.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';
import { requierePermiso as permiso } from '../middlewares/permisos.middleware';

/**
 * CU-002 Gestionar retención de socios: rutas de los diagramas de secuencia
 * (Figuras 78 a 87). Solo para el personal del gimnasio, con los permisos de cada módulo.
 */
export const retencionRoutes = Router();
const personal = [autenticar, soloPerfiles('PERSONAL')];

// Constancia y regreso (RetencionController)
retencionRoutes.get('/indicadores', ...personal, permiso('RETENCION', 'CONSULTA'), ret.obtenerIndicadores); // Figs. 78 y 79
retencionRoutes.get('/senales', ...personal, permiso('RETENCION', 'CONSULTA'), ret.obtenerSenales); // Fig. 80
retencionRoutes.get('/socios/:id/asistencia', ...personal, permiso('RETENCION', 'CONSULTA'), ret.obtenerAsistenciaReciente); // Fig. 80
retencionRoutes.get('/propuestas', ...personal, permiso('RETENCION', 'CONSULTA'), ret.listarPropuestas);
retencionRoutes.post('/propuestas', ...personal, permiso('RETENCION', 'GESTION'), ret.registrarPropuesta); // Figs. 81 y 87
retencionRoutes.post('/propuestas/:id/aprobacion', ...personal, permiso('RETENCION', 'GESTION'), ret.aprobarPropuesta); // Figs. 82 y 87
retencionRoutes.patch('/propuestas/:id/pendiente', ...personal, permiso('RETENCION', 'GESTION'), ret.posponerPropuesta);

// NeuroGym Intelligence (IntelligenceController)
retencionRoutes.get('/analitica', ...personal, permiso('INTELLIGENCE', 'CONSULTA'), intel.obtenerAnalitica); // Figs. 83 y 85
retencionRoutes.get('/analitica/reporte', ...personal, permiso('INTELLIGENCE', 'CONSULTA'), intel.generarReporte); // Fig. 86
retencionRoutes.get('/analitica/socios/:id', ...personal, permiso('INTELLIGENCE', 'CONSULTA'), permiso('RETENCION', 'CONSULTA'), intel.analizarSocio); // Fig. 84
retencionRoutes.post('/decisiones', ...personal, permiso('INTELLIGENCE', 'CONSULTA'), permiso('RETENCION', 'GESTION'), intel.registrarDecision); // Fig. 85
