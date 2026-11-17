import crypto from 'node:crypto';

/** Estado informado por el proveedor para un mensaje ya aceptado. */
export interface EstadoInformado {
  idMensaje: string;
  estado: 'ENVIADO' | 'ENTREGADO' | 'LEIDO' | 'FALLIDO';
  fecha: Date;
  error?: string;
}

const MAPA: Record<string, EstadoInformado['estado']> = { sent: 'ENVIADO', delivered: 'ENTREGADO', read: 'LEIDO', failed: 'FALLIDO' };

interface Estado {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

/**
 * Lee los estados de un webhook de WhatsApp. Meta (Cloud API) y el sandbox de
 * 360dialog usan la misma estructura: entry[].changes[].value.statuses[].
 * Los mensajes entrantes (value.messages) se ignoran.
 */
export function interpretarEstadosWhatsapp(cuerpo: unknown): EstadoInformado[] {
  const entradas = (cuerpo as { entry?: { changes?: { value?: { statuses?: Estado[] } }[] }[] })?.entry ?? [];
  const estados = entradas.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.statuses ?? []);
  return estados.flatMap((s) => {
    const estado = s.status ? MAPA[s.status] : undefined;
    if (!s.id || !estado) return [];
    const segundos = Number(s.timestamp);
    const error = s.errors?.[0];
    return [
      {
        idMensaje: s.id,
        estado,
        fecha: Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date(),
        ...(error ? { error: `${error.code ?? ''} ${error.title ?? error.message ?? ''}${error.error_data?.details ? ` · ${error.error_data.details}` : ''}`.trim() } : {}),
      },
    ];
  });
}

/** Firma de Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo crudo, clave secreta de la app). */
export function firmaMetaValida(cuerpoCrudo: Buffer | undefined, firma: string | undefined, claveApp: string): boolean {
  if (!cuerpoCrudo || !firma || !claveApp || !firma.startsWith('sha256=')) return false;
  const esperada = Buffer.from(`sha256=${crypto.createHmac('sha256', claveApp).update(cuerpoCrudo).digest('hex')}`);
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

/** Comparación en tiempo constante del token de la ruta del webhook de 360dialog. */
export function tokenValido(recibido: string | undefined, esperado: string): boolean {
  if (!recibido || !esperado) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
