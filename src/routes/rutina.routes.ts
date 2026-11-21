import { Router } from 'express';
import { rutinaController as rutina } from '../controllers/rutina.controller';
import { autenticar, soloPerfiles } from '../middlewares/autenticacion.middleware';

/** CU-003 Generar rutina personalizada con IA: rutas de los diagramas de secuencia (Figuras 88 a 97), solo para socios. */
export const rutinaRoutes = Router();
const socio = [autenticar, soloPerfiles('SOCIO')];

rutinaRoutes.put('/socios/preferencias', ...socio, rutina.registrarPreferencias); // Figs. 88 y 89
rutinaRoutes.post('/rutinas', ...socio, rutina.generarRutina); // Fig. 88
rutinaRoutes.get('/rutinas/actual', ...socio, rutina.obtenerRutina); // Figs. 90 y 97
rutinaRoutes.get('/equipos/disponibilidad', ...socio, rutina.obtenerDisponibilidad); // Figs. 90, 94, 95 y 97
rutinaRoutes.put('/ejercicios/:id', ...socio, rutina.actualizarEjercicio); // Figs. 91 y 96
rutinaRoutes.get('/ejercicios/:id/variante', ...socio, rutina.sugerirVariante); // Fig. 95
rutinaRoutes.post('/entrenamientos', ...socio, rutina.registrarEntrenamiento); // Fig. 97
rutinaRoutes.get('/entrenamientos', ...socio, rutina.historial);
