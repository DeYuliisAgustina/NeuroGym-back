export type ProveedorCorreo = 'GMAIL' | 'SIMULADO';

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

/**
 * Puerto del servicio de correo (códigos de verificación y de recuperación de la
 * contraseña). El proveedor se cambia sin tocar la lógica de negocio.
 */
export interface ServicioCorreo {
  readonly proveedor: ProveedorCorreo;
  /** Lanza un error si el proveedor no acepta el envío. */
  enviar(correo: Correo): Promise<void>;
}

/** Dominios reservados que no existen en internet (cuentas de prueba del seed): nunca se envían. */
export const esDominioDePrueba = (email: string) => /\.(test|example|invalid|localhost)$/i.test(email.trim());
