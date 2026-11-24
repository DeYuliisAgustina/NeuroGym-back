import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { del, put } from '@vercel/blob';
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
  /** Elimina un archivo guardado a partir de su URL (supresión de datos del titular). */
  eliminar(url: string): Promise<void>;
}

export const TIPOS_PERMITIDOS: Record<string, 'FOTO' | 'VIDEO'> = {
  'image/jpeg': 'FOTO',
  'image/png': 'FOTO',
  'image/webp': 'FOTO',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'video/quicktime': 'VIDEO',
};

/** Nombre aleatorio y sin datos personales, conservando la extensión del archivo. */
function nombreAleatorio(archivo: ArchivoEntrante): string {
  const extension = path.extname(archivo.nombreOriginal).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  return `${crypto.randomUUID()}${extension}`;
}

/**
 * Almacenamiento LOCAL de desarrollo con la misma interfaz que un servicio de
 * objetos: guarda con nombre aleatorio (sin datos personales) y devuelve la URL.
 * En la versión publicada se usa AlmacenamientoVercelBlob.
 */
export class AlmacenamientoLocal implements AlmacenamientoObjetos {
  readonly descripcion = 'local (desarrollo)';

  constructor(private readonly directorio = env.almacenamiento.directorioLocal) {}

  async guardar(carpeta: string, archivo: ArchivoEntrante): Promise<string> {
    const nombre = nombreAleatorio(archivo);
    const destino = path.join(this.directorio, carpeta);
    await fs.mkdir(destino, { recursive: true });
    await fs.writeFile(path.join(destino, nombre), archivo.buffer);
    return `${env.backendUrlPublica}/archivos/${carpeta}/${nombre}`;
  }

  async eliminar(url: string): Promise<void> {
    const relativo = url.split('/archivos/')[1];
    if (relativo) await fs.rm(path.join(this.directorio, relativo), { force: true });
  }
}

/**
 * Vercel Blob: almacenamiento de objetos persistente de la versión publicada (RNF11).
 * Los archivos quedan con nombre aleatorio y se sirven por la URL que devuelve el servicio.
 */
export class AlmacenamientoVercelBlob implements AlmacenamientoObjetos {
  readonly descripcion = 'Vercel Blob';

  constructor(private readonly token = env.almacenamiento.blobToken) {}

  async guardar(carpeta: string, archivo: ArchivoEntrante): Promise<string> {
    const blob = await put(`${carpeta}/${nombreAleatorio(archivo)}`, archivo.buffer, {
      access: 'public',
      contentType: archivo.mime,
      token: this.token,
    });
    return blob.url;
  }

  async eliminar(url: string): Promise<void> {
    await del(url, { token: this.token });
  }
}

/** Vercel Blob si está configurado; si no, la carpeta local. */
export const almacenamiento: AlmacenamientoObjetos =
  env.almacenamiento.proveedor === 'VERCEL_BLOB' ? new AlmacenamientoVercelBlob() : new AlmacenamientoLocal();
