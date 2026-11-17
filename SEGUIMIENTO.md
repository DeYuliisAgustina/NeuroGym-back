# Seguimiento del desarrollo de NeuroGym

Registro de avance para retomar el trabajo entre sesiones. Se actualiza en cada avance significativo.

## Estado actual (2026-11-17)

### Repositorios

| Repositorio | URL (privado) | Commits |
|---|---|---|
| NeuroGym-back | https://github.com/DeYuliisAgustina/NeuroGym-back | 20 (más este registro) |
| NeuroGym-front | https://github.com/DeYuliisAgustina/NeuroGym-front | 17 |

### Base de datos

- PostgreSQL 18 local, rol `neurogym`; bases `neurogym_dev` (desarrollo, con seed) y `neurogym_test` (pruebas, se vacía en cada ejecución).
- Migraciones aplicadas: `20261116120000_modelo_inicial` (51 tablas, 28 tipos ENUM) y `20261116120100_restricciones_integridad` (55 CHECK, 4 disparadores, 4 índices parciales). `prisma migrate diff` contra la base: sin diferencias.
- Seed: 2 gimnasios (Intelligence y Standard), 3 sedes, 36 socios, 621 turnos, 821 asistencias con QR, 108 cuotas, 48 equipos, 3 profesionales; ETL ejecutado.

### Módulos implementados y verificación

| Módulo | Verificado con |
|---|---|
| Seguridad (JWT, bcrypt, accesos separados, Composite, aislamiento multiempresa, auditoría) | `tests/integration/seguridad.test.ts` (12) + `tests/unit/composite.test.ts` (6) |
| Turnos y reservas (cupos concurrentes, RD18, RD21, RD23 con disparador) | `turnos-asistencia.test.ts` |
| Asistencia QR (CU-004: QR firmado y vencido, reserva/sede/horario, duplicado, cuota impaga con autorizar/bloquear, manual y provisoria, día de constancia) | `turnos-asistencia.test.ts` (13 en total) + `reglas.test.ts` |
| Cuotas y pagos (CU-001: Facade, Strategy, webhook idempotente, rechazo, falla de WhatsApp, débito con 10 %, efectivo, RD12) | `cuotas-pagos.test.ts` (11) + `strategy.test.ts` (9) + `mercadopago.test.ts` (4) + `mercadopago-orders.test.ts` (6). La API real de Mercado Pago todavía no se probó (ver Pendiente) |
| Entrenamiento (CU-003: rutina simulada, reemplazo, edición, variante, entrenamiento) y equipamiento (RD22) | `entrenamiento-retencion.test.ts` |
| Retención (CU-002: ETL, señales, estimaciones solo Intelligence, propuesta con aprobación y bonificación Premium, xlsx, canjes) | `entrenamiento-retencion.test.ts` (10 en total) + `reglas.test.ts` |
| Marketplace (Observer CREADO/REPROGRAMADO/CANCELADO, RD16, comisión 8 %, Fundadores, .ics) | `marketplace.test.ts` (8) + `observer.test.ts` (5) |
| Frontend (diseño de los prototipos) | `npm test` (18) y revisión en el navegador, en escritorio y en celular (375 px), de las tres áreas con datos del seed: sitio público, ingreso, registro y acceso interno; socio (resumen, rutina, turnos, QR, cuotas y pagos con comprobante, beneficios, profesionales, equipamiento, perfil); personal (los 14 módulos y los modales de efectivo, permisos y ficha del socio); profesional (agenda, solicitudes, servicio y horarios, perfil, plan Marketplace) |

### Pruebas ejecutadas (2026-11-17)

- Backend `npm test`: **133 pruebas aprobadas** (unitarias y de integración con PostgreSQL), incluidas las de la API de Orders (rechazo con reintento, firma con id en minúsculas, regreso del débito), la sincronización del primer cobro del débito, 5 del modo de prueba de WhatsApp y el reenvío del comprobante sin duplicar.
- Frontend `npm test`: **18 pruebas aprobadas**; `tsc` sin errores y `vite build` correcto (265 kB de JavaScript inicial; la lectura de QR se carga solo en Recepción).

### Errores detectados y corregidos

- La hoja de estilos copiada del prototipo incluía la regla `body{max-width:680px}` de su comprobante descargable y angostaba todas las páginas: se quitó.
- `tsx watch` no detectó cambios del backend en Windows y sirvió código anterior (precios en $0): se forzó la recarga. Si vuelve a pasar, reiniciar `npm run dev`.
- La prueba CU-004-010 crea un turno que empezó 30 minutos antes; ejecutada entre las 00:00 y las 00:30 el inicio cae en el día anterior y falla. No afecta la aplicación.
- **Pago único con Orders: "Ocurrió un error inesperado" (2026-11-17).** Al pagar desde el navegador, `POST /v1/orders` respondía **HTTP 400** con `property_value: '$.external_reference' - does not match pattern`: Orders no admite ":" en la referencia (`pago:{id}`), algo que Preferences sí aceptaba. El SDK devolvía el error sin detalle y el backend lo convertía en un 500 genérico. Corrección: referencia `pago-{id}`; los errores de la API ahora se registran con su código y causas (sin credenciales) y el socio recibe un 502 "Mercado Pago no pudo crear la orden de pago". Además, la búsqueda de órdenes no incluye los pagos de la orden, así que el regreso del checkout ahora consulta la orden completa por su id. Verificado contra el entorno de prueba: la orden se crea (HTTP 201, estado `created`) con `checkout_url` válida y la búsqueda por referencia la encuentra.

- Las cuotas vencidas no pasaban a IMPAGA si el servidor no estaba encendido a la hora de la tarea diaria: se agregó `ponerAlDia()` al iniciar (con `CRON_ENABLED=true`) y en el seed.
- pgAdmin ejecuta el editor en una transacción y `CREATE DATABASE` no se admite: el script de rol quedó solo con `CREATE ROLE`; las bases las crea el rol `neurogym`.

### Mercado Pago: pago único con la API de Orders (2026-11-17)

Mercado Pago marca la API de Preferences como camino no recomendado (sin fecha de baja publicada) y las funciones nuevas salen solo en la API de Orders. Como NeuroGym no tiene pagos reales, el pago único se adaptó a **Checkout Pro vía Orders** con el mismo SDK (`mercadopago` 3.6.1, cliente `Order`).

- **Cambió:** `MercadoPagoApiGateway` crea la orden (`POST /v1/orders`, `type: online`, `processing_mode: manual`, `external_reference: pago-{id}`, clave de idempotencia) y redirige con `checkout_url`; el webhook atiende el evento `order` y consulta `GET /v1/orders/{id}`; el retorno llega a `/socio/pagos?resultado=...&pago={id}` y el backend busca la orden por su referencia (verificando que el pago sea del socio). Estados: `processed`/`accredited` = aprobado; `failed`, `canceled` y `action_required/waiting_retry` con el último intento `failed` = rechazado (reintentable); `created`, `processing` y el resto de `action_required` = todavía sin registrar. Se guarda como referencia el id del último pago de la orden.
- **No cambió:** reglas de negocio, importes (pago único a precio de lista, 10 % solo por débito automático), `CobroPagoUnico` (Strategy), `registrarResultado` (Facade), comprobantes, WhatsApp, idempotencia, efectivo y el **débito automático con Suscripciones (PreApproval)**, que sigue independiente.
- **Configuración en Mercado Pago Developers (la hace la autora):** aplicación **NeuroGym** con Checkout Pro y **API de Orders**. Al crearla, Mercado Pago genera la cuenta vendedora de prueba y sus credenciales de prueba, cuyo Access Token empieza con `APP_USR` (igual que el productivo). Ese token va en `MP_ACCESS_TOKEN`; el backend lo acepta solo si pertenece a una cuenta de prueba (etiqueta `test_user`, apodo `TESTUSER…` o correo `@testuser.com`) y rechaza las productivas. `npm run mp:verificar` lo comprueba sin mostrar secretos. Webhooks en modo Prueba con los eventos **Order (Mercado Pago)** y **Planes y suscripciones** en `/api/pagos/webhook`; clave en `MP_WEBHOOK_SECRET`. Las credenciales quedan solo en `.env`, que Git ignora.
- **Cuentas de prueba:** hace falta una cuenta **compradora** de prueba del mismo país (MLA), creada en Mercado Pago Developers → Cuentas de prueba. **Pago único:** si en el checkout se usa el correo de una cuenta real de Mercado Pago, la API responde el error 145 ("Una de las partes con la que intentás hacer el pago es de prueba"), y la orden queda `created` sin pagos. Hay que pagar como invitado con el **correo de la compradora de prueba**, tarjeta de prueba y titular APRO u OTHE. **Débito automático:** su correo va en `MP_TEST_PAYER_EMAIL` y se inicia sesión con esa cuenta para autorizar la adhesión.

### Integraciones externas con servicios gratuitos (2026-11-17)

Regla de trabajo: solo herramientas y entornos gratuitos para desarrolladores (Mercado Pago Developers en modo prueba, número de prueba de Meta, PostgreSQL y almacenamiento locales, túneles temporales gratuitos solo para webhooks). Sin planes pagos, cobros reales ni producción.

**Primer pago único aprobado con Orders: verificado (2026-11-17).** Socio de prueba `socio3`, cuota 2026-11, compradora de prueba y tarjeta APRO. Se comprobó lo siguiente en PostgreSQL y en la API de Orders del entorno de prueba (consulta de solo lectura):
- Pago #74 `APROBADO`, $32.000, referencia = id del pago de Mercado Pago (`PAY01…`). La orden quedó en `processed/accredited`, total 32000.00, con un solo pago `processed/accredited` de 32000.
- Cuota 2026-11 en `PAGADA`, con un único pago aprobado. Comprobante `NG-00000074` emitido y marcado como enviado, por mensajería **simulada** (WhatsApp sin credenciales).
- Sin duplicados en toda la base: 0 referencias externas repetidas, 0 cuotas con más de un pago aprobado, 0 pagos con más de un comprobante.
- Los pagos #72 y #73 (mismo socio) son los intentos con error 145: quedaron `PENDIENTE` y sus órdenes en `created`, sin pagos. No se tocaron. Si alguien pagara ahora una de esas órdenes, `registrarPagoUnico` lo detecta (la cuota ya está `PAGADA`), no aprueba un segundo pago y deja auditoría `PAGO_SOBRE_CUOTA_PAGADA` para la devolución manual.
- No se repite: queda como la prueba de pago único aprobado.

**Débito automático (Suscripciones): verificación del lado del servidor, sin cobro.** Una sonda creó una suscripción `pending`, sin tarjeta, para `socio5`. Resultado: importe 28.800 ARS (cuota de $32.000 con 10 % de descuento), mensual, referencia `socio:5` (Suscripciones sí admite ":") y pagador = compradora de prueba. Después se canceló por API y quedó `cancelled`. **Error encontrado:** Suscripciones rechaza `back_url` con host `localhost` (HTTP 400 "Invalid value for back_url"), pero acepta `127.0.0.1`, y Vite solo escucha en `localhost`. Corrección: sin URL pública, el `back_url` es `http://127.0.0.1:3000/api/pagos/retorno-adhesion`, que solo redirige a `localhost:5173/socio/pagos?resultado=adhesion&preapproval_id=…` (no registra nada, valida el id). La adhesión se confirma con el mismo camino que antes.

**Pruebas de Mercado Pago con la autora (2026-11-17, entorno de prueba, sin dinero real).** Túnel HTTPS gratuito y temporal hacia el backend: primero localhost.run, cuya dirección cambió a los pocos minutos; después Pinggy, por `ssh` y sin cuenta ni descargas, con dirección fija unos 60 minutos. Se cerró al terminar. Webhook configurado en el panel de prueba con los eventos Order y Planes y suscripciones, y clave en `MP_WEBHOOK_SECRET`.
- **Webhook simulado desde el panel** (Order, con el id de la orden del pago #74): firma válida; el backend consultó la orden real y respondió `duplicado: true`, sin crear pagos, comprobantes ni mensajes.
- **Pago rechazado** (`socio5`, cuota 2026-10, titular OTHE, compradora de prueba como invitada). Hubo dos hallazgos:
  1. **Un intento rechazado no cierra la orden de Orders.** Queda `action_required/waiting_retry`, con el intento `failed/rejected_by_issuer`, para que el comprador reintente. NeuroGym lo tomaba como «sin resultado» y el pago #75 seguía `PENDIENTE`, sin aviso. Corrección: ese estado se registra como `RECHAZADO` (aviso al socio, cuota pendiente); un reintento aprobado en la misma orden se acepta, y un aviso viejo ya no cambia nada.
  2. **Los webhooks reales de Orders se firman con el `data.id` en minúsculas.** La simulación del panel usa el id tal cual. Las dos primeras notificaciones reales dieron `SignatureMismatch`. Corrección: se valida el id tal cual y, si no coincide, en minúsculas. Si ninguna variante coincide, se registra un diagnóstico sin secretos.
  - Resultado con un segundo intento OTHE: llegó el webhook `order.transaction_attempt_failed` (firma válida en minúsculas) y el pago #75 quedó `RECHAZADO` **solo por el webhook**, con la referencia del segundo intento. La cuota sigue `IMPAGA`, sin comprobante, y el socio recibió el aviso. Al volver a la app se vio «Mercado Pago no aprobó el pago…», sin duplicar.
- **Adhesión al débito** (`socio5`, iniciando sesión con la compradora de prueba y tarjeta APRO): la suscripción quedó `authorized` por 28.800 ARS mensuales. **Mercado Pago cobró el primer mes en el acto** (`authorized_payment` `processed`, pago `approved/accredited`, próximo cobro el 17/12). El regreso registró la adhesión 9 `ACTIVA`, pero **no llegó ningún webhook de Planes y suscripciones** y la cuota seguía impaga. Corrección: al confirmar una adhesión autorizada se consultan sus cobros (`GET /authorized_payments/search`) y se registran por el mismo camino idempotente del webhook. Resultado: cuota 2026-10 `PAGADA`, con $3.200 de descuento; pago #76 `DEBITO_AUTOMATICO` `APROBADO` por $28.800 (referencia `ap-…`); comprobante `NG-00000076`. Regreso repetido y webhook tardío: sin duplicados.
- **Baja desde la app:** la suscripción quedó `cancelled` en Mercado Pago, con un solo cobro (el inicial) y nada pendiente. En NeuroGym, la adhesión 9 quedó `CANCELADA` con fecha de baja.
- **Control final de la base:** 0 referencias repetidas, 0 cuotas con más de un pago aprobado, 0 pagos con más de un comprobante, 0 socios con más de una adhesión activa y 0 cuotas `PAGADA` sin pago aprobado.
- **Clave del webhook regenerada (2026-11-17).** La autora la regeneró en el panel y la actualizó en `.env`; se reinició el backend. `npm run mp:verificar` indica todo cargado y cuenta de prueba. Prueba local contra el backend en ejecución: una notificación firmada con la clave del `.env` se aceptó (200; el id de prueba no existe en Mercado Pago, así que no registró nada) y una firmada con otra clave se rechazó (401). Falta repetir la recepción **real** cuando haya una URL pública: hay que abrir otro túnel y actualizar la URL en el panel.
- **Sin verificar en Mercado Pago (pendiente):**
  1. **Webhooks de suscripciones** (`subscription_preapproval` y `subscription_authorized_payment`, evento «Planes y suscripciones»). No llegó ninguno durante la adhesión, el primer cobro ni la baja, aunque el evento estaba marcado en el panel de prueba y los webhooks de Order sí llegaron por el mismo túnel. No se sabe si Mercado Pago no los envía en prueba o si hace falta otra configuración. Su firma e interpretación solo tienen pruebas automáticas.
  2. **Cobros mensuales posteriores al primero.** La suscripción se dio de baja antes del 17/12, así que no se vio ningún débito mensual. Hoy, NeuroGym registra esos cobros **solo por webhook**: la sincronización corre únicamente al confirmar la adhesión. Si el webhook no llega (como pasó en prueba), un débito mensual cobrado quedaría sin registrar y la cuota figuraría impaga. Para validarlo hace falta una suscripción activa durante un ciclo y una URL pública estable en esa fecha. Alternativa técnica para decidir con la autora: una conciliación periódica que consulte los cobros de las adhesiones activas, por el mismo camino idempotente.
  3. **Rechazo de un débito mensual** (aviso al socio y cuota pendiente): solo con pruebas automáticas.

**WhatsApp Business Cloud API: preparado para el número de prueba gratuito de Meta.**
- Fuera de producción, cada mensaje va **solo** a `WHATSAPP_TEST_RECIPIENT` (el número propio, habilitado en el número de prueba). Si esa variable falta, no se envía nada: nunca a teléfonos de socios.
- Graph API configurable (`WHATSAPP_API_VERSION`, v23.0 por defecto, la que usa la documentación oficial). Los errores frecuentes se informan con su código y sin el token: 131030 destinatario no habilitado, 131047 fuera de la ventana de 24 h, 190 token vencido.
- `npm run whatsapp:probar` verifica la configuración y el número emisor. `npm run whatsapp:probar -- 74` reenvía el comprobante del pago #74 (`CuotaService.reenviarComprobante`, solo pagos aprobados): no crea pagos ni comprobantes ni consulta a Mercado Pago.
- Limitación de Meta: un texto libre (el comprobante) solo se entrega dentro de las 24 h siguientes a un mensaje del destinatario. Por eso, antes de la prueba hay que escribirle al número de prueba desde el WhatsApp propio. Fuera de esa ventana se exigen plantillas aprobadas, y la única disponible sin trámite es `hello_world`, que no lleva el comprobante.

**Estado por integración**

| Integración | Funciona de verdad | Verificado con servicios gratuitos de prueba | Solo simulado | Pendiente de validar | Requeriría servicio pago en producción |
|---|---|---|---|---|---|
| Mercado Pago, pago único (Orders) | Creación de la orden, checkout, regreso, confirmación por API, aprobación, rechazo con reintento, cuota PAGADA, comprobante, idempotencia | Pago aprobado #74 y rechazado #75 de punta a punta, por regreso y por webhook | — | — | Credenciales productivas y cuenta real del gimnasio; Mercado Pago cobra comisión por cada pago real (sin abono mensual) |
| Mercado Pago, débito automático (Suscripciones) | Adhesión con 10 %, primer cobro registrado, comprobante, baja | Adhesión autorizada, cobro de $28.800 (pago #76), baja `cancelled` | — | Cobros mensuales siguientes (no se esperaron) | Igual que el pago único (comisión por débito real) |
| Webhooks de Mercado Pago | Firma (SDK oficial; Orders con id en minúsculas) e interpretación | Webhook simulado del panel y webhook real `order.transaction_attempt_failed` por túnel gratuito | — | Webhooks de suscripciones: no llegaron en prueba (los cubre la sincronización) | URL pública HTTPS (hosting) |
| WhatsApp Cloud API | Adaptador real, destinatario de prueba obligatorio, reenvío del comprobante | — (faltan las credenciales de Meta) | Hoy todos los envíos (`MensajeriaSimulada`) | Envío real del comprobante #74 al número propio | Número propio verificado y cobro por plantilla según las tarifas de Meta (los mensajes de servicio dentro de las 24 h no se cobran) |
| IA (Claude) | Integración con el SDK oficial y validación de la respuesta (código conservado) | — | Generación de rutinas y variantes (`ServicioIASimulado`) | Respuesta real del modelo | La API de Claude se paga por uso (créditos prepagos): no se activa |
| Almacenamiento | Fotos y videos de incidencias en carpeta local | Local | — | Proveedor S3 compatible | Almacenamiento en la nube |
| Base de datos y servidores | PostgreSQL 18, backend y frontend locales | Local | — | — | Hosting |

### Imputación de cuotas y conciliación de débitos (2026-11-17: análisis, decisiones e implementación)

**Pedido de la autora:**
1. El débito automático paga la cuota del **período facturado**, no la deuda más antigua.
2. Las cuotas vencidas anteriores siguen pendientes y se regularizan por separado.
3. En el pago único y el efectivo se identifica qué cuota se abona.
4. El 10 % se aplica solo al débito automático (RD6).
5. Pagar una cuota posterior no cambia el estado de las anteriores.

**Revisión del TFI (Word leído en modo solo lectura, sin modificarlo):**
- **Lo que el TFI respalda:** CU-001 y CU-001-003 hablan de «la cuota del período» (precondición «tiene una cuota pendiente del período»). CU-001-001 muestra «el período, el estado de la cuota y la fecha de vencimiento». CU-001-007 genera el comprobante «con período». El diccionario define `cuota.periodo` ('AAAA-MM', «mes al que corresponde») con `UNIQUE (socio_id, periodo)`, y `pago.cuota_id` como «cuota abonada». RD6: el 10 % es exclusivo del débito. RD12: los nuevos precios rigen para pagos posteriores. CU-004-004 consulta «la cuota del período» y CU-004-005 advierte «con el período adeudado».
- **Contradicciones con el pedido:** ninguna. Los puntos 1 a 5 son compatibles con el TFI.
- **Diferencias de la implementación actual:**
  - `cuotaRepository.cuotaActual` (la impaga más antigua) decide la cuota que ve el socio y la que cubre cada débito. Contradice los puntos 1 y 2.
  - El socio solo ve una cuota y no puede elegir otra (punto 3). El backend ya recibe el id de la cuota en el pago único y en el efectivo, y la pantalla de Cobros del personal ya elige una cuota concreta.
  - El punto 5 ya se cumple: ningún pago cambia otras cuotas.
  - El punto 4 ya se cumple: la estrategia calcula el 10 % solo en `CobroDebitoAutomatico`.
- **Situaciones que el TFI no define (se consultaron a la autora; sus decisiones están más abajo):**
  1. **Cómo se determina el período facturado de un débito.** Mercado Pago no informa un período: solo la fecha del débito (`debit_date`). Propuesta: el mes de esa fecha, en hora de Argentina.
  2. **Fecha del débito y vencimiento.** Hoy Mercado Pago debita el mismo día del mes en que se autorizó (17/11 → 17/12), y las cuotas vencen el día 10 (decisión técnica previa). Un socio adherido el 17 quedaría `IMPAGA` del 10 al 17 de cada mes, con advertencia en el ingreso (RD8). Opciones: fijar el día de cobro de la suscripción (`billing_day` de Mercado Pago), no marcar `IMPAGA` a un socio adherido hasta que el débito falle, o aceptar la diferencia.
  3. **Primer cobro al adherirse.** Mercado Pago cobra el primer mes en el acto (verificado). Si la cuota del período ya está pagada por otro medio, ese cobro no tiene cuota. Opción: iniciar la suscripción el mes siguiente (`start_date`) cuando la cuota del período ya esté pagada.
  4. **Débito sobre una cuota ya pagada por otro medio** (doble cobro). Hoy queda en auditoría para devolución manual, como el pago único (`PAGO_SOBRE_CUOTA_PAGADA` / `DEBITO_SIN_CUOTA_PENDIENTE`). Falta definir también si, con la adhesión activa, el socio puede pagar la cuota del período por otro medio antes del débito.
  5. **Débito antes de que exista la cuota del período.** Las cuotas se generan el día 1 a las 00:05. Propuesta técnica: generar la cuota del período al registrar el débito si todavía no existe (`generarCuotaSocio` ya es idempotente).
  6. **Importe cobrado distinto del calculado.** El monto de la suscripción es fijo y Mercado Pago no lo actualiza solo (pendiente 3: actualizar el monto de la preaprobación cuando cambia un precio o el plan). Hoy `registrarDebito` guarda el importe calculado con los precios vigentes, no el que cobró Mercado Pago. Propuesta: guardar el importe realmente cobrado y dejar en auditoría la diferencia, sin ajustes automáticos.
  7. **Cuota que se muestra por defecto** en «Cuotas y pagos»: propuesta, la del período en curso, con la lista de cuotas vencidas para elegir.
  8. **Advertencia en el ingreso:** hoy advierte si hay cualquier cuota vencida impaga y lista los períodos. CU-004-004 menciona solo «la cuota del período». Propuesta: mantener la advertencia por cualquier período adeudado.
  9. **Datos de prueba existentes:** el pago #76 (débito) quedó imputado a octubre. Propuesta: no tocarlo, porque su comprobante `NG-00000076` ya fue emitido (RD12) y se documenta como resultado de la regla anterior.

**Conciliación periódica de débitos (evaluación):**
- **Fuente:** `GET /authorized_payments/search?preapproval_id=…` (verificado en el entorno de prueba). Devuelve cada cobro con `id`, `status`, `debit_date`, `transaction_amount`, `retry_attempt` y `payment.status/status_detail`. Ya se usa al confirmar la adhesión (`consultarCobrosDeAdhesion`).
- **Cuándo correría:**
  - una tarea diaria en el programador existente (`node-cron`);
  - al confirmar la adhesión (ya existe);
  - a mano, con un script `npm run mp:conciliar` para pruebas y para la defensa.
- **Alcance:** adhesiones `ACTIVA` y las `CANCELADA` en los últimos 35 días, porque puede haber un cobro anterior a la baja.
- **Sin duplicados:**
  - mismo camino que el webhook (`registrarResultado`);
  - `referencia_externa` única `ap-{id}`;
  - transacción con bloqueo de la cuota;
  - captura de la colisión P2002 si un webhook y la conciliación llegan juntos.
- **Error a corregir en el mismo cambio:** Mercado Pago reintenta un débito rechazado con el **mismo** `authorized_payment` (`retry_attempt`). Hoy, si el primer intento quedó `RECHAZADO` con la referencia `ap-{id}`, la aprobación del reintento se tomaría como duplicado y se perdería. Hay que permitir RECHAZADO → APROBADO para la misma referencia, como ya se hizo con las órdenes.
- **Trazabilidad:**
  - cada débito registrado deja en `auditoria` el origen (`WEBHOOK`, `RETORNO` o `CONCILIACION`), el id del cobro y del pago de Mercado Pago, el importe cobrado, la fecha del débito y el período imputado;
  - cada corrida deja un resumen (adhesiones revisadas, registrados, duplicados, anomalías);
  - las anomalías (cobro sin cuota del período o importe distinto) quedan en auditoría para revisión manual, sin cambios automáticos.
- **Verificación posible en prueba:** con la adhesión 9 (cancelada, un cobro ya registrado), la conciliación tiene que encontrar el cobro y no duplicarlo. Un débito mensual real no se puede verificar sin esperar un ciclo: queda pendiente.

**Decisiones de la autora (2026-11-17):**
- **Imputación del débito:** a la cuota del período de facturación, nunca a la impaga más antigua.
  - Si Mercado Pago informa el período o ciclo, se prioriza sobre la fecha efectiva del cobro.
  - Si la cuota no existe, se genera con las reglas de facturación de NeuroGym.
  - Si la cuota ya está pagada, no hay segundo pago ni segundo comprobante.
  - Si el período no puede identificarse con seguridad, el cobro queda pendiente de conciliación, sin imputarlo.
  - Se conserva el identificador de Mercado Pago de cada operación.
- **Fecha del débito posterior al vencimiento:** la cuota se muestra como «Débito automático programado» hasta conocer el resultado, sin marcarla pagada antes de la confirmación.
  - Aprobado: pasa a «Pagada».
  - Rechazado: «Impaga», con los medios alternativos habilitados.
  - La fecha de vencimiento original se conserva.
- **Primer cobro con la cuota del período ya pagada:** la suscripción empieza el mes siguiente.
- **Débito activo:** la cuota del período no se puede pagar por otro medio antes del débito. Las cuotas anteriores, sí.

**Verificación del período en Mercado Pago:** el cobro real (`GET /authorized_payments/7034076181`) trae `date_created`, `debit_date`, `retry_attempt`, `type`, `transaction_amount` y `payment` (id y estado), pero **ningún campo de período o ciclo**. Según la documentación, un débito rechazado se reintenta hasta 10 días con una nueva `debit_date`; `date_created` (alta del cobro del ciclo) no cambia. Decisión técnica: período facturado = mes de `date_created` en hora de Argentina. Así un débito demorado por reintentos sigue imputándose a su ciclo. Sin `date_created`, el cobro queda pendiente de conciliación.

**Implementación (backend):**
- **Cobro de la suscripción:** `interpretarCobroRecurrente` arma un `CobroDeSuscripcion` con el período, el importe cobrado, el id del pago de Mercado Pago, la fecha del débito y el intento.
- **`registrarDebito`:**
  - Imputa a `cuota(socio, período)` y la genera con `generarCuotaSocio` si no existe.
  - Guarda el importe que cobró Mercado Pago; si difiere del calculado, deja `DIFERENCIA_IMPORTE_DEBITO` en auditoría.
  - Con la cuota ya pagada, o sin período identificable, deja `DEBITO_SOBRE_CUOTA_PAGADA` o `DEBITO_PENDIENTE_CONCILIACION`, una sola vez por cobro.
  - Un reintento aprobado del mismo cobro pasa de `RECHAZADO` a `APROBADO`.
  - Cada débito deja `DEBITO_REGISTRADO` con el origen (`WEBHOOK`, `RETORNO` o `CONCILIACION`) y los ids de Mercado Pago.
- **Débito programado (`cuotaRepository.debitoProgramado`):** aplica a la cuota del período en curso de un socio con adhesión activa (desde el período de alta), sin pagar y sin débito rechazado.
  - La tarea de vencimientos no la marca `IMPAGA`.
  - El pago único y el efectivo (socio y personal) responden `DEBITO_PROGRAMADO`.
  - Un débito rechazado la deja `IMPAGA` si ya venció.
  - La baja de la adhesión devuelve a `IMPAGA` las cuotas vencidas.
- **Elección de la cuota (`iniciarOperacion`):** el pago único y el efectivo abonan la cuota elegida, también una vencida. El débito solo acepta la cuota del período en curso (`DEBITO_SOLO_PERIODO`). Con esa cuota ya pagada, la suscripción se crea con `start_date` el mismo día del mes siguiente (máximo 28).
- **Detalle de la cuota (`obtenerDetalleCuota`):** devuelve la cuota del período, las adeudadas anteriores y, por cuota, `debitoProgramado` y `mediosHabilitados`. Se eliminó `cuotaActual` (la regla anterior).
- **Conciliación:**
  - `CuotaService.conciliarDebitos()`: tarea diaria a las 6:30 y `npm run mp:conciliar`.
  - Recorre las adhesiones activas y las canceladas en los últimos 35 días.
  - Consulta `authorized_payments/search` paginado. El máximo es `limit=12`; un valor mayor responde «Invalid value for limit».
  - Deja el resumen `CONCILIACION_DEBITOS` en auditoría.
- **Interfaz:** «Cuotas y pagos» muestra un selector «Cuota a abonar» (período en curso más las vencidas), avisa que cada cuota se paga por separado y ofrece solo los medios habilitados. También muestra el estado «Débito automático programado» y, al adherirse con la cuota del período pagada, avisa que el primer débito será el mes siguiente.

**Verificado (2026-11-17):**
- Pruebas automáticas: backend 142 (7 nuevas de imputación y conciliación, 2 de períodos de cobro) y frontend 20 (2 nuevas del selector y del débito programado).
- **Conciliación contra el entorno de prueba real:** encontró el cobro de la adhesión 9 y lo contó como duplicado (ya era el pago #76), sin crear nada. Las 8 adhesiones del seed tienen ids ficticios que Mercado Pago rechaza («Invalid value for id») y figuran como «sin consultar».
- **Navegador (socio3, cuota del período pagada):** el modal de adhesión avisa que el primer débito será el mes siguiente. Se cerró sin confirmar.

**Pruebas pendientes:**
- Una adhesión real con la cuota del período ya pagada: confirmar que Mercado Pago respeta `start_date` y no cobra en el acto.
- Un débito mensual real (siguiente ciclo) y un rechazo con reintento real, para confirmar que `date_created` se conserva entre reintentos.
- El selector de cuotas en el navegador con un socio que deba cuotas anteriores (por ejemplo, socio4).
- Recepción real de webhooks de suscripciones (túnel cerrado).
- **Dato histórico:** el pago #76 (adhesión 9) quedó imputado a octubre por la regla anterior. No se modificó, porque su comprobante `NG-00000076` ya fue emitido (RD12).

### Pendiente

1. **Pruebas que necesitan a la autora (cuentas y paneles personales):**
   - Mercado Pago: **completado el 2026-11-17** (aprobado, rechazado, webhook, adhesión, primer débito y baja). Queda opcional regenerar la clave del webhook en el panel de prueba, porque apareció en una captura, y actualizar `MP_WEBHOOK_SECRET`. Para volver a recibir webhooks hay que abrir otro túnel y actualizar la URL en el panel.
   - WhatsApp: crear la app gratuita en Meta for Developers con el producto WhatsApp, habilitar el número propio como destinatario y cargar en `.env` el token temporal, el id del número de prueba y `WHATSAPP_TEST_RECIPIENT`. Después, escribirle al número de prueba y ejecutar `npm run whatsapp:probar -- 74`.
   - Claude queda simulado, porque requiere créditos pagos.
   - **Funcionalidades no verificadas por completo (no se dan por terminadas):**
     - NeuroGym Intelligence: la estimación de riesgo es un puntaje por reglas (caída de frecuencia, ausencia, cuota impaga), no un modelo entrenado; revisar contra el TFI. La retención mensual en porcentaje no se calcula. ETL, señales, Excel y propuestas tienen pruebas automáticas; en el navegador no se guardó ninguna decisión.
     - Consultas profesionales: solicitud, confirmación, rechazo, reprogramación, cancelación, comisión y .ics probados en el backend; no ejercitados en el navegador (el profesional del seed no tiene consultas). El profesional recibe avisos solo en la plataforma.
     - Interfaz: selector de medios de pago con cuota pendiente, lectura de QR con cámara real e instalación como PWA, sin verificar en el navegador. La recuperación de contraseña no está implementada.
2. Almacenamiento de objetos en un proveedor S3 compatible (hoy, carpeta local).
3. Actualizar el monto de las preaprobaciones de débito cuando cambia un precio.
4. Apartado 10.5.10 del TFI (casos de prueba) a partir de las funciones reales: `verificarReservaVigente`, `CuotaService.registrarResultado`, `detectarSenal`/`estimarRiesgo`, `validarRutinaGenerada`.

### Interfaz: prototipos y figuras 32 a 67

- El frontend reproduce `NeuroGym_Prototipo_Interactivo.html` y `NeuroGym_Admin.html`: su CSS se usa sin cambios (`src/assets/styles/neurogym.css`) y `complementos.css` agrega solo lo que aparece en las figuras y no en los prototipos (ficha del socio, Fig. 63 c).
- Rutas con los nombres del prototipo: `/socio/pagos`, `/socio/marketplace`, `/socio/incidencias`, `/admin/recepcion`, `/admin/pagos`, `/admin/analitica`, `/admin/accesos`, `/admin/suscripcion`, `/profesional/solicitudes`, etc. Mercado Pago vuelve a `/socio/pagos` (`/socio/cuotas` redirige).
- Contrato ampliado solo con datos de lectura: perfil del socio (gimnasio, ventana de ingreso, precios vigentes de ambos planes) y listado de socios (estado de cuota, asistencias del mes, última visita).
- Elementos del prototipo que no tienen respaldo en el backend y se reemplazaron por su equivalente real: selector de perfil y herramientas de demostración (omitidos), recuperación de contraseña (indica cómo pedirla), cambio de suscripción SaaS (pedido a ventas), mensualidades y registro de acciones (no se muestran), cancelación de reservas por el personal (la hace el socio), prioridad informada por el socio (la define el gimnasio).
- Intelligence muestra asistencias y estimaciones del backend; los indicadores usan el último mes completo. La retención mensual en porcentaje del prototipo requiere un cálculo que el backend no tiene.

### Decisiones y diferencias con el TFI (para revisar con la autora)

- **Prisma 6.19** (no 7): mantiene el flujo clásico de `schema.prisma` + `.env`. TypeScript 5.9.
- **Agregados al diccionario de datos:** tabla `auditoria`; `ejercicio_rutina.descanso_seg` (CU-003 muestra y edita el descanso); `propuesta_incentivo.premium_dias` y `premium_porcentaje` (CU-002-010 necesita el período y el porcentaje antes de aprobar).
- **Índices agregados:** un solo pago APROBADO por cuota; `metodo_pago_consulta` sin duplicados cuando `obra_social` es nula.
- **Tolerancia de ingreso:** CU-004-003 dice que no está definida en el TFI, pero el diccionario incluye `tolerancia_antes_min`/`tolerancia_despues_min`; se usan esas columnas (15/60 por defecto).
- **Rechazo por QR inválido:** `rechazo_ingreso.socio_id` es obligatorio, por eso solo se registra cuando el código identifica a un socio (vencido); un código falsificado se rechaza sin registro.
- **Bonificación Premium:** reduce el adicional de un socio Premium; a un socio Básico le habilita Premium sin sumar cargos.
- **Mensajería a profesionales:** el modelo no guarda su teléfono; reciben las notificaciones en la plataforma.
- **GESTION incluye CONSULTA** en la evaluación de permisos.
- **Vencimiento de cuotas:** día 10 (`CUOTA_DIA_VENCIMIENTO`), no definido en el TFI.
- **A qué cuota se imputa un pago (2026-11-17; la autora pidió imputar el débito al período facturado: ver «Imputación de cuotas y conciliación de débitos»).** El TFI habla siempre de «la cuota del período» (CU-001: precondición «tiene una cuota pendiente del período», paso 2 «la cuota del período»; CU-001-003 «la cuota del período está pendiente») y no define qué pasa con cuotas **anteriores** vencidas e impagas. La implementación (`cuotaRepository.cuotaActual`) toma la cuota **pendiente o impaga más antigua**, y si no hay ninguna, la más reciente. Esa misma cuota es la que muestra «Cuotas y pagos» y la que cubren el pago único, el efectivo y cada débito automático (`registrarDebito`). Por eso, en la prueba del 17/11, `socio5` (octubre y noviembre impagas) vio y pagó primero octubre, y el primer débito de la adhesión ($28.800, con 10 %) se imputó a **octubre de 2026**, no a noviembre. Consecuencias de esa regla: con dos cuotas atrasadas, el débito queda siempre un mes atrás (el próximo débito, 17/12, cubriría noviembre), y el 10 % se aplica también a una cuota vencida. No se cambió nada: hay que decidir si se mantiene, si todos los medios pagan la cuota del período en curso, o si solo el débito automático se imputa a la cuota del período.
- **Alta de socios:** el gimnasio entrega una contraseña temporal que el socio puede cambiar (el TFI no define el mecanismo de primer acceso).
