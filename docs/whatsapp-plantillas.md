# WhatsApp con Meta (Cloud API): plantillas y configuración

NeuroGym envía por WhatsApp tres avisos iniciados por el gimnasio:

1. **Comprobante de la cuota pagada**, con el PDF adjunto.
2. **Vencimiento de la cuota**: un recordatorio 3 días antes y un aviso si queda impaga.
3. **Recordatorio del turno** con el nutricionista o deportólogo, el día anterior a las 18 h.

Meta no permite mandar texto libre a un número que no le escribió a la empresa en las últimas 24 h. Por eso, con `WHATSAPP_PROVEEDOR=meta`, estos avisos se envían como **plantillas aprobadas** (`src/integrations/mensajeria/plantillas.ts`). El texto libre queda guardado en `envio_mensaje` como registro.

## Plantillas a crear en WhatsApp Manager

Para cada una: categoría **Utilidad**, idioma **Español (ARG)** (`es_AR`), y el nombre y el cuerpo **exactos**. Las variables `{{n}}` las completa el backend.

| Nombre | Encabezado | Cuerpo |
|---|---|---|
| `neurogym_comprobante_pago` | **Documento** | Hola {{1}}, registramos tu pago de {{2}} de la cuota {{3}}. Te enviamos adjunto el comprobante {{4}}. Gracias por entrenar en NeuroGym. |
| `neurogym_vencimiento_cuota` | Ninguno | Hola {{1}}, te recordamos que tu cuota {{2}} de NeuroGym por {{3}} vence el {{4}}. Podés pagarla desde la sección Cuotas y pagos de la aplicación. |
| `neurogym_cuota_impaga` | Ninguno | Hola {{1}}, tu cuota {{2}} de NeuroGym por {{3}} venció el {{4}} y figura impaga. Podés regularizarla desde la sección Cuotas y pagos de la aplicación. |
| `neurogym_recordatorio_turno` | Ninguno | Hola {{1}}, te recordamos tu turno de {{2}} con {{3}} el {{4}} a las {{5}} (modalidad {{6}}). Si no podés asistir, cancelalo o reprogramalo desde NeuroGym. |

Ejemplos para la revisión de Meta:
- Comprobante: Ana · $ 32.000 · Noviembre 2026 · NG-00000078
- Vencimiento e impaga: Ana · Noviembre 2026 · $ 32.000 · 10/11/2026
- Turno: Ana · nutrición · Laura Nutrición Demo · 21/11/2026 · 15:00 · presencial

## Variables de `.env`

Se cargan con `scripts/cargar-clave.ps1 NOMBRE`, que toma el valor del portapapeles sin mostrarlo:

- `WHATSAPP_PROVEEDOR=meta`
- `WHATSAPP_TOKEN`: token de acceso. El temporal de «API Setup» vence a las 24 h; el permanente es el de un usuario del sistema del portfolio.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador del número (no es el teléfono).
- `WHATSAPP_TEST_RECIPIENT`: el número propio habilitado como destinatario. Fuera de producción, todo se envía solo a ese número.
- `WHATSAPP_SOCIOS_PRUEBA`: correos de los socios de prueba que generan envíos reales.
- `WHATSAPP_URL_PUBLICA`: URL HTTPS del túnel, para que WhatsApp descargue el PDF del comprobante.

## Costos y requisitos de Meta (verificado en esta cuenta, 2026-11-17)

- La cuenta de WhatsApp Business quedó bloqueada con el error **141006**: Meta pide un **método de pago**, aunque su documentación diga que el número de prueba no lo necesita.
- Meta cobra cada plantilla iniciada por la empresa según la tarifa del país.
- El portfolio pedía completar el perfil del negocio (razón social, país y sitio web) y la verificación del negocio.
- Agregar la tarjeta y completar los datos reales del negocio lo hace la titular de la cuenta. No se cargan datos inventados.
