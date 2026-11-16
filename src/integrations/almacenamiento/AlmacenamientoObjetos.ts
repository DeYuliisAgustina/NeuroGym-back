import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';

export interface ArchivoEntrante {
  buffer: Buffer;
  nombreOriginal: string;
  mime: string;
}

/** Puerto de almacenamiento de objetos para fotos y videos de incidencias (RNF11). */
export interface AlmacenamientoObjetos {
  readonly descripcion: string;
  guardar(carpeta: string, archivo: ArchivoEntrante): Promise<string>;
}

export const TIPOS_PERMITIDOS: Record<string, 'FOTO' | 'VIDEO'> = {
  'image/jpeg': 'FOTO',
  'image/png': 'FOTO',
  'image/webp': 'FOTO',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'video/quicktime': 'VIDEO',
};

/**
 * Almacenamiento LOCAL de desarrollo con la misma interfaz que un servicio de
 * objetos: guarda con nombre aleatorio (sin datos personales) y devuelve la URL.
 * Para producción se reemplaza por un proveedor S3 compatible (pendiente de credenciales).
 */
export class AlmacenamientoLocal implements AlmacenamientoObjetos {
  readonly descripcion = 'local (desarrollo)';

  constructor(private readonly directorio = env.almacenamiento.directorioLocal) {}

  async guardar(carpeta: string, archivo: ArchivoEntrante): Promise<string> {
    const extension = path.extname(archivo.nombreOriginal).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
    const nombre = `${crypto.randomUUID()}${extension}`;
    const destino = path.join(this.directorio, carpeta);
    await fs.mkdir(destino, { recursive: true });
    await fs.writeFile(path.join(destino, nombre), archivo.buffer);
    return `${env.backendUrlPublica}/archivos/${carpeta}/${nombre}`;
  }
}

export const almacenamiento: AlmacenamientoObjetos = new AlmacenamientoLocal();
