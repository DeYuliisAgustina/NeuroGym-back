/** Catálogo de módulos administrativos (tabla modulo). El seed los inserta con estos códigos. */
export const MODULOS = {
  SOCIOS: 'Socios',
  SEDES: 'Sedes, horarios y cupos',
  RECEPCION: 'Recepción QR y asistencias',
  COBROS: 'Cuotas y cobros',
  PRECIOS: 'Planes y precios',
  EQUIPAMIENTO: 'Equipamiento e incidencias',
  RETENCION: 'Constancia y regreso',
  INTELLIGENCE: 'NeuroGym Intelligence',
  USUARIOS: 'Usuarios, roles y permisos',
  CONFIGURACION: 'Políticas y suscripción',
} as const;

export type CodigoModulo = keyof typeof MODULOS;
export const CODIGOS_MODULO = Object.keys(MODULOS) as CodigoModulo[];
