import { del, put } from '@vercel/blob';
import { AlmacenamientoVercelBlob } from '../../src/integrations/almacenamiento/AlmacenamientoObjetos';
import { env } from '../../src/config/env';

// El servicio de Vercel Blob se simula: las pruebas nunca suben archivos reales.
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (ruta: string) => ({ url: `https://almacen.public.blob.vercel-storage.com/${ruta}` })),
  del: vi.fn(async () => undefined),
}));

/** RNF11: fotos y videos de incidencias en un almacenamiento de objetos persistente. */
describe('Almacenamiento de objetos con Vercel Blob', () => {
  afterEach(() => vi.clearAllMocks());

  it('guarda con nombre aleatorio (sin el nombre original) y devuelve la URL pública', async () => {
    const almacen = new AlmacenamientoVercelBlob('clave-de-prueba');
    const url = await almacen.guardar('incidencias', { buffer: Buffer.from('foto'), nombreOriginal: 'Foto de Juan Pérez.JPG', mime: 'image/jpeg' });

    expect(put).toHaveBeenCalledTimes(1);
    const [ruta, contenido, opciones] = vi.mocked(put).mock.calls[0];
    expect(ruta).toMatch(/^incidencias\/[0-9a-f-]{36}\.jpg$/);
    expect(ruta).not.toContain('Juan');
    expect(contenido).toEqual(Buffer.from('foto'));
    expect(opciones).toMatchObject({ access: 'public', contentType: 'image/jpeg', token: 'clave-de-prueba' });
    expect(url).toBe(`https://almacen.public.blob.vercel-storage.com/${ruta}`);
  });

  it('elimina por URL (supresión de datos del titular)', async () => {
    await new AlmacenamientoVercelBlob('clave-de-prueba').eliminar('https://almacen.public.blob.vercel-storage.com/incidencias/a.jpg');
    expect(del).toHaveBeenCalledWith('https://almacen.public.blob.vercel-storage.com/incidencias/a.jpg', { token: 'clave-de-prueba' });
  });

  it('en las pruebas automáticas siempre usa la carpeta local', () => {
    expect(env.almacenamiento.proveedor).toBe('LOCAL');
  });
});
