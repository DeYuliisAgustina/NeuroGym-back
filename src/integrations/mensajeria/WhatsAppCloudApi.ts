import { env } from '../../config/env';
import type { DocumentoAdjunto, PlantillaWhatsApp, ResultadoEnvio, ServicioMensajeria } from './ServicioMensajeria';

/** Normaliza un teléfono argentino al formato internacional sin '+' que exige la API. */
export function normalizarTelefono(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '');
  return digitos.startsWith('54') ? digitos : `54${digitos.replace(/^0/, '')}`;
}

/** Oculta un teléfono para registros: solo quedan visibles los últimos 3 dígitos. */
export const enmascararTelefono = (telefono: string) => telefono.replace(/\D/g, '').replace(/\d(?=\d{3})/g, '•');

/** Explicación de los errores habituales del número de prueba de Meta. */
const AYUDA_ERRORES: Record<number, string> = {
  131031: 'la cuenta de WhatsApp Business está bloqueada por Meta (ver Health Status API)',
  141006: 'Meta exige un método de pago en la cuenta para conversaciones iniciadas por la empresa',
  131030: 'el destinatario no está en la lista de números habilitados del número de prueba',
  131047: 'pasaron más de 24 h desde el último mensaje del destinatario: escribile primero al número de prueba',
  190: 'el token de acceso venció o no es válido',
};

export interface OpcionesWhatsApp {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  /** Número habilitado en el entorno de prueba de Meta (obligatorio fuera de producción). */
  destinoPrueba: string;
  produccion: boolean;
  /** Código de idioma con el que se crearon las plantillas (por defecto es_AR). */
  idiomaPlantillas?: string;
}

/**
 * Integración con WhatsApp Business Cloud API (Meta Graph API).
 * Requiere WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID.
 *
 * Modo de prueba (todo entorno que no sea producción): los mensajes se envían
 * únicamente a WHATSAPP_TEST_RECIPIENT, el número propio habilitado en el número
 * de prueba gratuito de Meta; el teléfono del socio no se usa. Los textos libres
 * solo se entregan dentro de la ventana de 24 h abierta por un mensaje del
 * destinatario; fuera de ella Meta exige plantillas aprobadas.
 */
export class WhatsAppCloudApi implements ServicioMensajeria {
  readonly proveedor = 'META_CLOUD_API' as const;
  readonly simulado = false;

  constructor(
    private readonly opciones: OpcionesWhatsApp = {
      token: env.mensajeria.whatsappToken,
      phoneNumberId: env.mensajeria.whatsappPhoneNumberId,
      apiVersion: env.mensajeria.apiVersion,
      destinoPrueba: env.mensajeria.destinoPrueba,
      produccion: env.nodeEnv === 'production',
      idiomaPlantillas: env.mensajeria.idiomaPlantillas,
    },
  ) {}

  /** Destino real del mensaje: en prueba, siempre el número habilitado. */
  destinoDe(telefono: string): string | null {
    if (this.opciones.produccion) return normalizarTelefono(telefono);
    // La lista de destinatarios del número de prueba guarda los celulares argentinos
    // sin el 9 (54 + característica + número): con «549…» Meta responde 131030.
    const prueba = this.opciones.destinoPrueba.replace(/\D/g, '').replace(/^549/, '54');
    return prueba || null;
  }

  async enviar(telefono: string, texto: string): Promise<ResultadoEnvio> {
    return this.solicitar(telefono, { type: 'text', text: { body: texto } });
  }

  /** Documento por enlace HTTPS: Meta lo descarga y lo entrega como archivo adjunto con caption. */
  async enviarDocumento(telefono: string, documento: DocumentoAdjunto): Promise<ResultadoEnvio> {
    return this.solicitar(telefono, { type: 'document', document: { link: documento.url, filename: documento.nombreArchivo, caption: documento.texto } });
  }

  /**
   * Plantilla aprobada en WhatsApp Manager. Si lleva documento (comprobante), el PDF
   * va en el encabezado de la plantilla, que debe ser de tipo «Documento».
   */
  async enviarPlantilla(telefono: string, plantilla: PlantillaWhatsApp, documento?: Omit<DocumentoAdjunto, 'texto'>): Promise<ResultadoEnvio> {
    const componentes: Record<string, unknown>[] = [];
    if (documento) {
      componentes.push({ type: 'header', parameters: [{ type: 'document', document: { link: documento.url, filename: documento.nombreArchivo } }] });
    }
    if (plantilla.parametros.length) {
      // Meta rechaza parámetros vacíos o con saltos de línea.
      const texto = (p: string) => p.replace(/\s+/g, ' ').trim() || '-';
      componentes.push({ type: 'body', parameters: plantilla.parametros.map((p) => ({ type: 'text', text: texto(p) })) });
    }
    return this.solicitar(telefono, {
      type: 'template',
      template: { name: plantilla.nombre, language: { code: this.opciones.idiomaPlantillas ?? 'es_AR' }, components: componentes },
    });
  }

  private async solicitar(telefono: string, mensaje: Record<string, unknown>): Promise<ResultadoEnvio> {
    const destino = this.destinoDe(telefono);
    if (!destino) {
      return { aceptado: false, error: 'Falta WHATSAPP_TEST_RECIPIENT: en modo de prueba no se envían mensajes a teléfonos de socios' };
    }
    const { apiVersion, phoneNumberId, token } = this.opciones;
    try {
      const respuesta = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: destino, ...mensaje }),
      });
      const cuerpo = (await respuesta.json()) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (!respuesta.ok) {
        const codigo = cuerpo.error?.code;
        const ayuda = codigo ? AYUDA_ERRORES[codigo] : undefined;
        return { aceptado: false, error: `Meta ${codigo ?? `HTTP ${respuesta.status}`}: ${ayuda ?? cuerpo.error?.message ?? 'error desconocido'}` };
      }
      return { aceptado: true, idMensaje: cuerpo.messages?.[0]?.id, destino };
    } catch (error) {
      return { aceptado: false, error: (error as Error).message };
    }
  }
}
