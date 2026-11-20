import type { PlantillaWhatsApp } from './ServicioMensajeria';

/**
 * Plantillas de WhatsApp de NeuroGym (categoría «Utilidad», idioma es_AR). Se crean
 * en WhatsApp Manager con EXACTAMENTE este nombre, cuerpo y cantidad de variables;
 * Meta las revisa antes de permitir su envío. El texto de cada plantilla figura en
 * `cuerpo` para copiarlo al crearla (docs/whatsapp-plantillas.md).
 */
export const PLANTILLAS = {
  comprobante: {
    nombre: 'neurogym_comprobante_pago',
    encabezado: 'DOCUMENTO',
    cuerpo: 'Hola {{1}}, registramos tu pago de {{2}} de la cuota {{3}}. Te enviamos adjunto el comprobante {{4}}. Gracias por entrenar en NeuroGym.',
  },
  vencimientoProximo: {
    nombre: 'neurogym_vencimiento_cuota',
    encabezado: null,
    cuerpo: 'Hola {{1}}, te recordamos que tu cuota {{2}} de NeuroGym por {{3}} vence el {{4}}. Podés pagarla desde la sección Cuotas y pagos de la aplicación.',
  },
  cuotaImpaga: {
    nombre: 'neurogym_cuota_impaga',
    encabezado: null,
    cuerpo: 'Hola {{1}}, tu cuota {{2}} de NeuroGym por {{3}} venció el {{4}} y figura impaga. Podés regularizarla desde la sección Cuotas y pagos de la aplicación.',
  },
  recordatorioTurno: {
    nombre: 'neurogym_recordatorio_turno',
    encabezado: null,
    cuerpo: 'Hola {{1}}, te recordamos tu turno de {{2}} con {{3}} el {{4}} a las {{5}} (modalidad {{6}}). Si no podés asistir, cancelalo o reprogramalo desde NeuroGym.',
  },
} as const;

type Clave = keyof typeof PLANTILLAS;

/** Arma la plantilla a enviar con los valores de sus variables, en orden. */
export function plantilla(clave: Clave, ...parametros: string[]): PlantillaWhatsApp {
  return { nombre: PLANTILLAS[clave].nombre, parametros };
}

/** Cantidad de variables {{n}} del cuerpo de una plantilla. */
export const variablesDe = (clave: Clave) => PLANTILLAS[clave].cuerpo.match(/\{\{\d+\}\}/g)?.length ?? 0;
