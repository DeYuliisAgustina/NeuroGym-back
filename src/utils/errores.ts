/** Error de negocio con código HTTP y código interno estable para el frontend. */
export class ErrorApp extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalle?: unknown,
  ) {
    super(mensaje);
  }
}

export const noEncontrado = (recurso: string) => new ErrorApp(404, 'NO_ENCONTRADO', `${recurso} no encontrado`);
export const prohibido = (mensaje = 'No tenés permiso para realizar esta operación') =>
  new ErrorApp(403, 'PROHIBIDO', mensaje);
export const noAutenticado = (mensaje = 'Sesión inválida o vencida') => new ErrorApp(401, 'NO_AUTENTICADO', mensaje);
export const conflicto = (codigo: string, mensaje: string, detalle?: unknown) =>
  new ErrorApp(409, codigo, mensaje, detalle);
export const reglaNegocio = (codigo: string, mensaje: string, detalle?: unknown) =>
  new ErrorApp(422, codigo, mensaje, detalle);
