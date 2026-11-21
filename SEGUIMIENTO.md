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

- Backend `npm test`: **180 pruebas aprobadas** (2026-11-20; unitarias y de integración con PostgreSQL), incluidas las de Mercado Pago (Orders, débito, imputación al período y conciliación), las de WhatsApp (proveedores, webhooks de estado, idempotencia, fallos, modo de prueba y comprobante en PDF con enlace firmado), el test de caja blanca y las de errores HTTP de los middlewares (`tests/integration/errores-http.test.ts`).
- **Test de caja blanca (punto 10.5.10 del TFI):** `tests/unit/caja-blanca.test.ts` prueba `detectarSenal` (CU-002-003) con el criterio de cubrimiento de flechas. El grafo de flujo de control tiene 19 nodos y 21 flechas (7 decisiones); los 7 casos del set recorren las 21 flechas y una octava prueba lo verifica. Con `npx vitest run tests/unit/caja-blanca.test.ts --coverage --coverage.include=src/jobs/reglasRetencion.ts --coverage.reporter=text`, V8 informa 100 % de ramas (las líneas 71-87 sin cubrir son de `estimarRiesgo`, fuera del alcance). El texto del 10.5.10 (patrones con su implementación y el test de caja blanca) está en `DesktopTesisNeurogym.5.10 Casos de prueba`; el Word del TFI no se modificó.
- Frontend `npm test`: **24 pruebas aprobadas**; `tsc` sin errores y `vite build` correcto (265 kB de JavaScript inicial; la lectura de QR se carga solo en Recepción).

### Errores detectados y corregidos

- **Acceso al servidor local y revisión de rutas (2026-11-20).**
  - **"RUTA_INEXISTENTE" en `http://localhost:3000/` no era una falla del servidor.** `npm run dev` arranca bien en el puerto 3000 (`PORT`, por defecto 3000), con PostgreSQL conectado (`/api/salud` → 200). La API no tiene página en la raíz: todas las rutas están bajo el prefijo **`/api`** (`src/app.ts`: `app.use('/api', apiRoutes)`), y cualquier otra dirección responde 404 `RUTA_INEXISTENTE` por diseño. La URL correcta de los planes del marketplace es **`GET http://localhost:3000/api/publico/planes-marketplace`** (`src/routes/modulos.routes.ts`, `marketplaceController.planes`, pública), y responde 200 con los planes BASICO y PROFESIONAL. El frontend ya la usa bien (`VITE_API_URL=http://localhost:3000/api`). Las pantallas se abren desde `http://localhost:5173`.
  - **Inicio de la API (agregado a pedido de la autora).** Como al abrir `http://localhost:3000/` o `:3001/` el 404 se confundía con un servidor caído, `GET /` y `GET /api` ahora responden 200 con el estado del servicio y las direcciones útiles (`/api/salud`, `/api/publico/planes-marketplace` y el frontend en `http://localhost:5173`). No cambia ninguna otra ruta.
  - **Inventario y prueba de todas las rutas.** Hay 145 rutas registradas: 13 públicas y 132 autenticadas. No hay duplicadas, y las 186 llamadas del frontend tienen su ruta en el backend. Contra el servidor en ejecución y sin modificar datos, cada ruta protegida respondió 401 sin token y 403 con un perfil ajeno. Con el perfil correcto, los GET respondieron 200 con datos reales (incluidos los PDF de comprobantes, el Excel de Intelligence y el .ics). Las escrituras con datos inválidos o un id inexistente respondieron 400 o 404. Las rutas públicas devolvieron el código esperado: webhooks sin firma → 401/403, enlace de comprobante sin firma → 401 y retorno de adhesión → 302. CORS permite `http://localhost:5173`. Cuatro rutas que ejecutarían una acción real se probaron solo sin token: `DELETE /api/socio/debito`, `POST /api/socio/qr`, `POST /api/admin/retencion/etl` y `PATCH /api/notificaciones/leidas`.
  - **Errores corregidos (`src/middlewares/errores.middleware.ts`).** Cuatro errores del cliente respondían **500 "Ocurrió un error inesperado"** porque el manejador centralizado no reconocía los errores de los middlewares de Express:
    1. JSON mal formado → ahora 400 `JSON_INVALIDO`.
    2. Cuerpo mayor a 1 MB → ahora 413 `CUERPO_DEMASIADO_GRANDE`.
    3. Archivo inexistente en `/archivos/...` → ahora 404 `RUTA_INEXISTENTE`.
    4. Más de 5 archivos, o un archivo demasiado grande, en `POST /api/socio/incidencias` (multer) → ahora 400 `ARCHIVOS_INVALIDOS` o 413 `ARCHIVO_DEMASIADO_GRANDE`, sin registrar la incidencia.

    Solo se tratan como 4xx los errores marcados como del cliente por Express o multer: los demás siguen respondiendo 500, y no cambia ninguna regla de negocio ni ruta. Pruebas: `tests/integration/errores-http.test.ts` (6 pruebas).
  - **Sin cambios:** `GET /api/cuotas/:id/medios` responde 422 `CUOTA_PAGADA` para una cuota ya pagada, que es lo que dice la regla (con una cuota pendiente responde 200 con los tres medios). `GET /api/socio/rutina/ejercicios/:id/variante` no se probó contra la base de desarrollo porque la rutina del socio de prueba no tiene equipos fuera de servicio; la cubren las pruebas automáticas.
  - **Observación:** el repositorio local se reinició con `git reset` a `origin/main` y eso quitó de `main` el commit local `2f59f86` (test de caja blanca del punto 10.5.10 y su nota en este archivo), que no se había subido. El commit sigue en git y se puede recuperar con `git cherry-pick 2f59f86`.

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
| WhatsApp | Envío automático de comprobantes y avisos por el sandbox oficial de 360dialog, con estados por webhook e idempotencia (ver «WhatsApp real y gratuito») | Comprobantes #74 y #77 y aviso de vencimiento entregados y leídos en el teléfono propio; fallo real (401) y duplicados | Solo en las pruebas automáticas (`MensajeriaSimulada`, estado SIMULADO) | Cloud API de Meta: bloqueada (141006, 131031); el adaptador y su webhook firmado quedan listos | Producción con socios reales: Meta cobra por mensaje y exige método de pago; el sandbox es solo de prueba (25 mensajes, un destinatario) |
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

**Segunda ronda de validaciones (2026-11-17)**

- **Ciclo de facturación de una factura de suscripción.** La referencia oficial de `GET /authorized_payments/{id}` documenta:
  - `date_created` («Invoice creation date»);
  - `debit_date` («Date on which we will try to make the payment»);
  - `retry_attempt`, `status` (`scheduled`, `processed`, `recycling`, `canceled`), `summarized`, `preapproval_id`, `external_reference` y `payment` (id, status, status_detail).
  - **No documenta un campo de período ni de número de ciclo.** El cobro real del entorno de prueba coincide con eso.
  - Para no depender solo del alta de la factura, el período se reconstruye con el **calendario de la suscripción**: `auto_recurring.start_date`, frecuencia mensual y `billing_day` si existe, tomados de la preaprobación. La factura se asigna al ciclo más cercano a su `date_created` (`periodoDelCiclo`).
  - Así, una factura creada horas antes del cambio de mes queda en su ciclo, y los reintentos (que mueven `debit_date`) no la cambian.
  - Sin calendario, con otra frecuencia o a más de 12 días de cualquier ciclo, el período queda sin identificar y el cobro, pendiente de conciliación.
  - Verificado con el cobro real de la adhesión 9: período 2026-11.
  - Además, una factura cancelada sin pago y un pago cancelado se toman como cobro no concretado.
- **El estado «Débito automático programado» no queda indefinido:**
  - Solo vale para la cuota del período en curso. Al terminar el mes deja de estarlo aunque el cobro nunca llegue, y la tarea diaria la marca impaga.
  - Si la suscripción figura **cancelada** en Mercado Pago (webhook, regreso o conciliación diaria), NeuroGym da de baja la adhesión (`BAJA_DEBITO_EN_MERCADO_PAGO`), pasa a impagas las cuotas vencidas y avisa al socio.
  - Si figura **pausada**, deja de considerarse programada (`ADHESION_PAUSADA_EN_MERCADO_PAGO`) y vuelve a estarlo al reanudarse.
  - El diccionario solo admite adhesiones ACTIVA o CANCELADA, por eso la pausa queda en auditoría y no en una columna.
  - Un webhook de una suscripción todavía pendiente ya no avisa un rechazo.
- **Errores de pago visibles:** «Cuotas y pagos» muestra un aviso destacado (`AvisoPago`) cuando Mercado Pago rechaza el pago o la operación no puede iniciarse.
  - Tiene título, explicación («No se realizó ningún cobro y tu cuota sigue pendiente») y botones «Intentar de nuevo» y «Elegir otro medio de pago».
  - Usa `role="alert"` y se lleva a la vista.
  - Revisado en el navegador, en escritorio y en celular.
- **Selector de cuotas en el navegador (socio4, octubre y noviembre impagas):** muestra el período en curso y la cuota vencida, con el aviso de que se pagan por separado. Al elegir octubre, el encabezado pasa a «Venció el 10 de octubre» y solo se ofrecen Efectivo y Mercado Pago. No se pagó nada.
- **Recepción real de webhooks** (túnel Pinggy, panel de prueba):
  - La primera tanda falló porque la clave del panel ya no coincidía con `MP_WEBHOOK_SECRET`. El diagnóstico sin secretos lo mostró: `SignatureMismatch`, también con un id en minúsculas. La autora actualizó la clave.
  - Con la clave actualizada, `order` (orden del pago #74) llegó con firma válida y duplicado sin cambios.
  - `subscription_preapproval` (suscripción de la adhesión 9) llegó con firma válida; el backend consultó la suscripción real y respondió duplicado sin cambios.
  - Una `subscription_preapproval` enviada con el id de un cobro también tuvo firma válida y respondió `RECURSO_INEXISTENTE`, como corresponde.
  - El simulador **no ofrece el evento de cobro de suscripción** (`subscription_authorized_payment`); «Pagos (legacy)» es otro tópico. Ese camino del webhook quedó verificado solo con pruebas automáticas. El mismo recurso (`authorized_payments`) sí se consultó contra la API real, desde la conciliación y desde una consulta de solo lectura.
  - El túnel se cerró al terminar.
- **Conciliación contra la API real:** con el calendario y el estado de la suscripción, encontró el cobro de la adhesión 9 y lo contó como duplicado, sin crear nada.
- **Pruebas:** backend 148, con 4 nuevas de suscripciones (calendario y período) y 4 de pausa, baja en Mercado Pago, límite mensual y suscripción pendiente. Frontend 22, con 2 nuevas del aviso de error.

**Estado final de Mercado Pago**

| | Qué incluye |
|---|---|
| **Probado de punta a punta en el entorno de prueba** | Pago único aprobado (#74) y rechazado con reintento (#75). Webhooks firmados de `order` (real y simulado) y de `subscription_preapproval` (simulado). Adhesión con primer débito (#76) y baja desde la app. Conciliación contra la API real, sin duplicar. Clave del webhook rotada y verificada. Selector de cuotas y aviso de error en el navegador. Cálculo del período con el calendario real de una suscripción. |
| **Probado solo con pruebas automáticas (doble de prueba)** | Débito imputado al período facturado con deuda anterior; cuota generada al recibir un débito; período no identificable; débito sobre una cuota ya pagada. Débito programado: bloqueo de otros medios, rechazo que habilita otros medios y reintento aprobado del mismo cobro. Suscripción pausada, reanudada y cancelada en Mercado Pago. Límite mensual del estado programado. Webhook `subscription_authorized_payment`. Inicio diferido de la suscripción (`fechaInicio`) cuando la cuota del período está pagada. |
| **Requiere validación real con Mercado Pago (cobro real o fecha futura; no se ejecuta sin autorización)** | Que Mercado Pago respete `start_date` y no cobre en el acto con la cuota del período pagada: requiere una adhesión nueva. Un débito mensual del ciclo siguiente: hay que esperar un mes con una suscripción activa. Un débito rechazado con reintentos reales y el mismo `authorized_payment`. Una pausa o baja hecha desde la cuenta de Mercado Pago del comprador. Webhooks reales de suscripciones generados por un cobro, no por el simulador. |

- **Dato histórico:** el pago #76 (adhesión 9) quedó imputado a octubre por la regla anterior. No se modificó, porque su comprobante `NG-00000076` ya fue emitido (RD12).

### WhatsApp real y gratuito (2026-11-17)

**Alcance definido por la autora:** demostrar en desarrollo que NeuroGym envía mensajes de WhatsApp **reales, automáticos y sin intervención manual** al número propio, con costo cero. No se configura producción ni se escribe a socios reales.

**Reversión de la bandeja manual (interrumpida y descartada):**
- La migración `20261117180000_envio_whatsapp` llegó a crear la tabla `envio_whatsapp` en `neurogym_dev` y `neurogym_test`.
- Antes de eliminarla, con autorización, se verificó:
  - que las dos tablas tenían 0 filas;
  - que solo las creó esa migración (15:34);
  - que ninguna clave foránea, vista, tipo ni archivo de código dependía de ellas.
- Se hizo un respaldo completo con `pg_dump` de ambas bases en `C:\Users\PC\Desktop\Tesis\Neurogym\respaldos\` (fuera de los repositorios).
- En una transacción por base se eliminaron la tabla, sus dos tipos y el registro de esa migración, sin tocar nada más.
- `schema.prisma` volvió a su versión anterior y se borró la carpeta de la migración. `prisma migrate status`: «Database schema is up to date».

**Meta (WhatsApp Cloud API): no se puede destrabar gratis**, con evidencia de la API (consulta de solo lectura):
- **La configuración es correcta:** el token ve la cuenta WABA `1116161897698484`, que contiene el número configurado `1479738001890560` («Test Number»). `account_review_status: APPROVED` y hay plantillas de prueba aprobadas.
- **Bloqueos en el estado de salud:**
  - Cuenta WABA bloqueada por **141006**: «There is an error with the payment method… Please add a new payment method».
  - Portfolio bloqueado por **141010** (negocio no verificado) y **131000** (perfil incompleto: razón social, país y sitio web).
- **El envío del panel falló** con **131031** («Business Account locked»).
- **El asistente de soporte de Meta** indica «Falta método de pago».
- **Contradicción con la documentación:** según Meta, los números de prueba *«don't require a payment method on file in order to send template messages»*, pero esta cuenta lo exige igual.
- **Regla de precios:** desde el 1/10/2026, sin método de pago Meta deja de entregar incluso los mensajes de servicio.
- **Por qué no se avanzó:**
  - Agregar una tarjeta está prohibido por la regla de costo cero.
  - Completar el perfil o verificar el negocio requiere datos de una empresa constituida, que no se inventan.
- Además, la app no estaba suscripta a los webhooks de la cuenta (solo figuraba la app interna de Meta).
- El adaptador de Meta y su webhook firmado quedan implementados por si la cuenta se habilita.

**Proveedor elegido: sandbox oficial de 360dialog** (proveedor de soluciones de WhatsApp Business de Meta), según su [documentación](https://docs.360dialog.com/docs/get-started/sandbox):
- **Cómo se obtiene la clave:** enviando START desde el WhatsApp propio. No hay registro ni tarjeta, y no existe una relación de facturación que pueda generar cargos.
- **Límites:**
  - un solo destinatario: el número que envió START;
  - 25 mensajes por clave; después responde 429 y se obtiene otra con START;
  - texto libre; solo plantillas predefinidas; no admite multimedia por id.
- **Estados:** sent, delivered y read por webhook HTTPS. La documentación no menciona «failed».
- **Avisos que cubre:** comprobantes y avisos de vencimiento (y los demás avisos por mensajería) como texto libre.

**Implementación:**
- **Puerto de mensajería con proveedores intercambiables** (`WHATSAPP_PROVEEDOR`): `Dialog360Sandbox`, `WhatsAppCloudApi` (Meta) y `MensajeriaSimulada`, esta última solo para las pruebas automáticas. El resultado inmediato se llama `aceptado`: un HTTP 200 nunca cuenta como enviado.
- **Tabla `envio_mensaje`** (agregado al diccionario de datos):
  - Cada mensaje tiene una **referencia única**: `comprobante:{id}`, `vencimiento:{cuota}:impaga|recordatorio`, `turno-evento:{id}` o `mantenimiento:…`. Un evento repetido nunca genera otro mensaje.
  - Estados: `PREPARADO`, `ACEPTADO`, `ENVIADO`, `ENTREGADO`, `LEIDO`, `FALLIDO`, `OMITIDO` y `SIMULADO`, cada uno con su fecha.
- **Webhooks oficiales:**
  - `POST /api/whatsapp/webhook/360dialog/:token`, con token secreto en la ruta.
  - `GET` y `POST /api/whatsapp/webhook/meta`, con verificación de la suscripción y firma `X-Hub-Signature-256`.
  - Los estados no retroceden, y un `failed` tardío no pisa una entrega confirmada.
  - `comprobante.fecha_envio` se completa solo cuando el proveedor confirma el envío.
- **Eventos conectados:**
  - pago aprobado (Mercado Pago, débito o efectivo) → comprobante → envío (CU-001-007);
  - cuota vencida e impaga, y recordatorio 3 días antes (RNF10);
  - avisos de turnos profesionales (Observer, RF42) y de mantenimiento (RF34), que ya existían.
  - Un fallo de comunicación queda en el envío y no afecta el pago (CU-001-007 3.1).
- **Modo de prueba (protección de desarrollo, no regla de negocio):**
  - Solo los socios de `WHATSAPP_SOCIOS_PRUEBA` generan envíos reales, siempre al número autorizado (`WHATSAPP_TEST_RECIPIENT`, formato `549…`).
  - El resto queda `OMITIDO`.
  - Así no se escribe a nadie más y no se agotan los 25 mensajes.
- **Interfaz:** el comprobante muestra el estado real («WhatsApp: leído · fecha», «enviado, entrega sin confirmar», «no se pudo enviar», «sin envío confirmado»…).
- **Comprobantes anteriores:** tienen `fecha_envio` cargada por la simulación y no se modificaron. Como no tienen un envío confirmado, se muestran «sin envío confirmado».
- **Comandos:** `npm run whatsapp:probar` muestra la configuración. Con `-- --webhook <URL https>` registra el webhook en el sandbox, y con `-- <pagoId>` reenvía un comprobante y sigue su estado.

**Pruebas reales con el teléfono de la autora** (sandbox de 360dialog, túnel Pinggy temporal, cerrado al terminar):

| Escenario | Resultado real |
|---|---|
| 1 · Reenvío del comprobante del pago #74 | `ACEPTADO` → webhook `ENVIADO`, `ENTREGADO`, `LEIDO` en 3 s |
| 1 · Flujo completo: pago en efectivo registrado por el personal (#77, cuota 2026-10 de `socio4`) | Comprobante `NG-00000077` → envío automático → `ENTREGADO` → `LEIDO`; cuota `PAGADA`. En el navegador: «WhatsApp: leído · 17 de noviembre» |
| 2 · Aviso de vencimiento por regla | Se generó la cuota 2026-12 de `socio3` (la tarea mensual la crea igual el 1/12) y se ejecutó la regla «3 días antes» con fecha 7/12: aviso `ENTREGADO` → `LEIDO`. Repetir la regla no generó otro aviso |
| 3 · Pago rechazado (#75) | Sin comprobante y sin envío |
| 4 · Falla de WhatsApp | Con una clave inválida, solo para esa ejecución, 360dialog respondió 401 y el envío quedó `FALLIDO` con el motivo; el pago #74 y su cuota no cambiaron |
| 5 · Duplicados | Webhook `ENTREGADO` real recibido dos veces (el segundo, sin cambios). Regreso de Mercado Pago del #74 repetido: `duplicado`, 1 comprobante y ningún envío nuevo |

- **Pruebas automáticas:** backend 161 (7 de integración de envíos, 6 de proveedores y webhooks) y frontend 23.

**Limitaciones:**
- El sandbox solo escribe al número que envió START y admite 25 mensajes por clave.
- No documenta el estado `failed`: un fallo se ve en la respuesta de la API (401, 403 o 429).
- Recibir los estados requiere una URL HTTPS pública (túnel temporal en desarrollo).
- Para producción con socios reales, WhatsApp exige un número propio verificado y cobra por mensaje (plantillas fuera de la ventana de 24 h), con un método de pago. Eso queda fuera del alcance académico definido.

### Comprobante completo en PDF por WhatsApp (2026-11-17)

**Pedido de la autora:** que el socio reciba automáticamente en WhatsApp el **comprobante completo como PDF adjunto**, con el mismo diseño del comprobante de la aplicación (logo, «Pago registrado», período, socio, plan, importe, desglose, medio, fecha y número NG), generado con los datos históricos del pago. Sin botones ni datos de seguimiento, y sin reemplazar el archivo por un texto.

**Generación del PDF** (`src/services/comprobantePdf.service.ts`):
- **Herramientas:** `pdfkit` 0.20.2 (licencia MIT) y la fuente Inter de la interfaz (`@fontsource/inter` 5.3.0, licencia OFL). Ambas son gratuitas y de código abierto, y no requieren navegador.
- **Diseño:** reproduce la tarjeta del comprobante de la aplicación:
  - borde punteado y fondo `#fbfcf8`;
  - logo oficial (`src/assets/logo-neurogym.jpg`, copiado del frontend);
  - insignia «Pago registrado», «Cuota {período}» y «{socio} · Plan {plan}»;
  - importe grande y filas de «Cuota del gimnasio · Básico», «Adicional Premium» (si corresponde), descuento del 10 % en verde (débito), medio, fecha y referencia;
  - la nota «Comprobante NG-… · Sede …. No reemplaza una factura.»
- **Formato:** mismos formatos que la interfaz (pesos es-AR, «Octubre 2026», «17 de noviembre de 2026»). Página de ancho A5 con el alto ajustado al contenido. El texto es seleccionable, no una imagen.
- **Datos:** salen del comprobante registrado: la composición conservada en la cuota (RD12) y el importe del pago, nunca de los precios actuales.

**Envío como adjunto:**
- **Formato del mensaje:** `document` con `link` HTTPS, `filename` y `caption`; el texto acompaña al archivo. Es el mismo formato para 360dialog y para Meta.
- **El sandbox de 360dialog lo admite:** su documentación solo prohíbe subir y recuperar archivos por media ID y no menciona los documentos por enlace, así que se verificó en la práctica: aceptó el documento y WhatsApp lo entregó como archivo adjunto.
- **Enlace protegido, no permanente ni público:**
  - `GET /api/whatsapp/comprobantes/{envío}.pdf?vence=…&firma=…`;
  - firma HMAC-SHA256 derivada del secreto del servidor, vigente **15 minutos**;
  - responde 401 sin firma o con la firma alterada, y 410 si venció;
  - identifica el envío, no el pago ni el socio;
  - el PDF se genera al momento: no se guarda ningún archivo;
  - encabezados `Cache-Control: no-store, private` y `X-Robots-Tag: noindex`.
- **URL pública:** la base es `WHATSAPP_URL_PUBLICA` (el túnel HTTPS en desarrollo). Sin ella, el comprobante **no se envía** y queda `FALLIDO` con el motivo: nunca se reemplaza por solo texto.
- **Registro:** la columna nueva `envio_mensaje.adjunto` guarda el nombre del archivo enviado (migración `20261117210000_envio_mensaje_adjunto`, solo agrega una columna).
- **Flujo:** pago confirmado → comprobante → PDF → envío automático → estados por webhook. Es el mismo camino idempotente de siempre: un evento repetido no genera otro mensaje.

**Pruebas reales** (sandbox de 360dialog, túnel Pinggy temporal, cerrado al terminar):
- **NG-00000077, sin registrar ningún pago:**
  - El primer intento quedó `OMITIDO`, porque `socio4` no estaba habilitado en `WHATSAPP_SOCIOS_PRUEBA`: la protección de pruebas funcionó.
  - Habilitado solo para esa ejecución: `ACEPTADO` → `ENVIADO` → `ENTREGADO`, con el adjunto `comprobante-NG-00000077.pdf`.
  - Antes y después: 70 pagos y 67 comprobantes; el comprobante NG-00000077 y su cuota quedaron idénticos.
- **Pago nuevo:** el personal registró en efectivo la cuota 2026-11 de `socio4` (pago #78). Se generó el comprobante NG-00000078 y se envió automáticamente `comprobante-NG-00000078.pdf`: `ACEPTADO` → `LEIDO`. La cuota quedó `PAGADA`.
- **Seguridad:** el enlace sin firma respondió 401 a través del túnel.
- **Confirmación de la autora:** los dos PDF (NG-00000077 y NG-00000078) llegaron como archivo adjunto a su WhatsApp y se abren correctamente.
- **Pruebas automáticas:** backend 166 (PDF, enlace firmado válido, alterado y vencido, documento en 360dialog, envío sin URL pública).

**Limitaciones:**
- El PDF solo se puede enviar mientras haya una URL HTTPS pública que WhatsApp pueda descargar (túnel en desarrollo). Al cerrar el túnel se vacía `WHATSAPP_URL_PUBLICA`.
- El enlace vence a los 15 minutos. WhatsApp lo descarga al enviar y después el archivo queda en la conversación.
- Cada documento cuenta para el límite de 25 mensajes de la clave del sandbox.
- **Descarga unificada (pedido de la autora, 2026-11-17):** el botón «Descargar comprobante» ahora baja **el mismo PDF** que se envía por WhatsApp. Las rutas son `GET /api/socio/pagos/{id}/comprobante.pdf` (socio titular) y `GET /api/admin/pagos/{id}/comprobante.pdf` (personal con permiso COBROS, consulta), con el mismo control de acceso que el comprobante. Reemplaza al archivo HTML anterior. Verificado contra el backend en ejecución: socio4 descarga `comprobante-NG-00000077.pdf`; otro socio recibe 404 y sin sesión, 401. Pruebas automáticas: backend 166 y frontend 24. **Confirmado por la autora en el navegador:** como `socio4` descargó `comprobante-NG-00000078.pdf` desde «Cuotas y pagos».

### IA de rutinas real con Gemini (2026-11-20)

- La autora pidió que la IA de rutinas no esté simulada. Se agregó `ServicioIAGemini` (API de Gemini de Google AI Studio, por REST, sin dependencias nuevas). Implementa el mismo puerto `ServicioIA` que Claude y la simulación: mismos pedidos, salida JSON restringida al esquema Zod y la misma validación (solo ejercicios disponibles del catálogo).
- **Costo cero:** clave del nivel gratuito de AI Studio (proyecto «Default Gemini Project», sin facturación configurada). La suscripción Gemini Pro de la autora no da acceso a la API; la clave de AI Studio sí y es gratuita.
- **Selección del proveedor** (`env.ia.proveedor`): `IA_PROVEEDOR` = gemini | claude | simulado; vacío → el que tenga clave (primero Gemini). En los tests, siempre simulado.
- **Modelos:** `GEMINI_MODELO=gemini-3.5-flash` y respaldo `GEMINI_MODELOS_RESPALDO=gemini-flash-lite-latest`. El 20/11 `gemini-flash-latest` y `gemini-3.8-flash` respondían 503 (saturados); ante 429/5xx o falta de respuesta se prueba el modelo de respaldo.
- La clave se carga con `scripts/cargar-clave-gemini.ps1`: la toma del portapapeles, la guarda en `.env` sin mostrarla y vacía el portapapeles. Va en el encabezado `x-goog-api-key`, nunca en la URL.
- Verificado: llamada real con 14 ejercicios de prueba → rutina de 3 días con 13 ejercicios en ~19 s y variante coherente (Sentadilla → Prensa). El backend en ejecución informa `generador: Gemini (gemini-3.5-flash)`. Pruebas: 4 unitarias nuevas (`tests/unit/ia-gemini.test.ts`); suite completa 185.
- VS Code: la tarea «Levantar NeuroGym» se ejecuta sola al abrir la carpeta (`runOptions.runOn: folderOpen`), porque una actualización de VS Code había cerrado el backend y el frontend. VS Code puede pedir una vez permiso para las tareas automáticas.

### Recordatorio de turnos por WhatsApp y direcciones sin /api (2026-11-20)

- **Pedido de la autora:** por WhatsApp deben llegar el comprobante de la cuota pagada, el aviso antes del vencimiento y el recordatorio del turno con el nutricionista o deportólogo. Los dos primeros ya existían; faltaba el tercero.
- **Recordatorio de turnos (nuevo):** `recordarTurnosProfesionales`, todos los días a las 18 h. Avisa por la plataforma y por WhatsApp (sandbox de 360dialog) de las consultas CONFIRMADO o REPROGRAMADO del día siguiente. Es idempotente, con referencia `turno-recordatorio:{turno}:{fecha}`.
- **Direcciones sin `/api`:** un GET o HEAD sin el prefijo redirige con 308 a la misma ruta bajo `/api` (por ejemplo, `/publico/planes-marketplace`). Los POST y demás métodos siguen respondiendo 404.
- **WhatsApp con Meta: descartado a pedido de la autora.** Se probó el número de prueba de Meta: con la información del negocio y una tarjeta cargadas, la API acepta los envíos, pero Meta no los entrega (error 131031 «Business Account locked») porque el portfolio no pasó la verificación del negocio (141010), que exige documentación de un negocio real. Se abrió un caso en el soporte de Meta. La autora decidió seguir con el **sandbox de 360dialog**; se quitaron las plantillas de Meta del código. El adaptador `WhatsAppCloudApi` anterior queda sin cambios.
- **Pruebas:** recordatorio (una sola vez y sin los cancelados) y redirección.

### Cuentas de demostración más fáciles de recordar (2026-11-20)

- A pedido de la autora, los correos del seed pasan de `@piloto.demo` y `@profesional.demo` a **`@neurogym.test`**, y los del segundo gimnasio de `@otro.demo` a **`@otrogym.test`** (`.test` es un dominio reservado que no existe en internet). La contraseña de todas pasa a **`neurogym123`** (`SEED_PASSWORD` en `.env`).
- Se actualizaron en el lugar las 49 cuentas de la base de desarrollo (correo y contraseña), sin borrar ni regenerar datos: pagos, rutinas y turnos quedan igual. `prisma/seed.ts` crea los mismos correos. `WHATSAPP_SOCIOS_PRUEBA` pasa a `socio3@neurogym.test`.
- Verificado contra el backend en ejecución: ingresan socio1, socio3, admin de ambos gimnasios, nutri1 y socio29; el correo anterior responde 401.

### Generar rutina: zonas a evitar, IA visible y generación en segundo plano (2026-11-20)

- **Zonas o movimientos a evitar (opcional):** casillas Espalda baja, Rodillas, Hombros, Muñecas y Saltos e impacto. La autora pidió poder indicar molestias; se descartó el texto libre porque serían datos de salud (sensibles según la Ley 25.326; el TFI dice que no se solicitan datos biométricos), se enviarían a un tercero (Google) y abren la puerta a instrucciones inyectadas. Con la lista cerrada es una preferencia de entrenamiento: **no se guarda** (`preferencia_rutina` no cambia), se valida con un enum (400 si llega otro valor) y los ejercicios que exigen esas zonas **se quitan del catálogo** antes de llamar a la IA (`exigeZonaEvitada`), además de indicárselo en el pedido aclarando que no es un diagnóstico. Verificado con Gemini: rutina sin ejercicios de rodilla ni zona lumbar.
- **IA visible:** «Con tecnología de Gemini · Google» en el modal, «Gemini está preparando…» en el progreso e insignia «Generada con Gemini»; sin IA configurada se muestra «Modo simulación».
- **Segundo plano (frontend):** el modal se cierra al confirmar; tarjeta de progreso en Mi rutina; el socio puede navegar; aviso al terminar y notificación del sistema (Notification API) si está en otra pestaña o ventana.
- Pruebas: backend 190, frontend 24.

### Pago único: confirmación sin depender de «Volver al sitio» (2026-11-20)

- **Problema real (socio5, pago #79):** sin URL pública HTTPS, Mercado Pago no vuelve solo a NeuroGym (`auto_return` exige HTTPS). La autora pagó y no tocó «Volver al sitio»: Mercado Pago aprobó la orden, pero el pago quedó PENDIENTE en NeuroGym, sin comprobante. Se confirmó por el endpoint de retorno (`POST /api/pagos/confirmacion`): cuota 2026-11 PAGADA y comprobante NG-00000079. El WhatsApp con el PDF quedó FALLIDO porque no había túnel (`WHATSAPP_URL_PUBLICA` vacía).
- **Solución:** `POST /api/socio/pagos/verificacion` (`CuotaService.verificarPagosPendientes`). Al abrir «Cuotas y pagos», el frontend la llama; el backend consulta a Mercado Pago los pagos únicos PENDIENTES del socio de los últimos 7 días (hasta 3, con 8 s de límite cada uno) y registra el resultado por el mismo camino idempotente (`registrarResultado`, origen CONCILIACION). Si confirma uno, se muestra «Pago registrado».
- Pruebas: integración (sin resultado no registra; pago ajeno no se toca; aprobado → PAGADA y un comprobante; repetir no duplica). Backend 191, frontend 24.

### WhatsApp del comprobante en la demo: túnel con un clic (2026-11-20)

- Comprobantes de los pagos #79 (socio5) y #80 (socio6) reenviados por WhatsApp con el PDF: **ENTREGADO**. Primer intento del #80: FALLIDO 131047, porque pasaron más de 24 h desde el último mensaje de la autora al número del sandbox (regla de WhatsApp). Se resolvió mandándole «hola».
- `npm run demo` (`scripts/preparar-demo.mjs`), también como tarea de VS Code **«Preparar demo (WhatsApp)»**: abre un túnel de Pinggy por ssh (gratis, sin cuenta, 60 minutos), guarda la URL en `WHATSAPP_URL_PUBLICA`, reinicia el backend y registra el webhook de estados de 360dialog. Con Ctrl+C se cierra y la URL queda vacía. Probado: túnel abierto, backend accesible por HTTPS y webhook registrado.
- La tarea «Levantar NeuroGym» ya no se ejecuta sola al abrir la carpeta, para no chocar con Run > «NeuroGym (backend + frontend)».
- Para la defensa: 1) mandar «hola» al número del sandbox; 2) ejecutar «Preparar demo»; 3) pagar una cuota con un socio habilitado (`WHATSAPP_SOCIOS_PRUEBA`: socio3, socio5 y socio6).

### IA de rutinas: solo Gemini (2026-11-21)

- A pedido de la autora, que usa únicamente Gemini, se quitó el proveedor Claude: `ServicioIAClaude`, la dependencia `@anthropic-ai/sdk` y las variables `ANTHROPIC_API_KEY` e `IA_MODELO`. Quedan `ServicioIAGemini` (con clave) y `ServicioIASimulado` (sin clave y en las pruebas). `IA_PROVEEDOR=simulado` sigue forzando la simulación.
- Verificado: backend 191 pruebas, frontend 24; rutina real con Gemini (17 ejercicios, 11 s). El diagrama de clases (10.5.7) se actualizó para mostrar solo las dos implementaciones.

### Autorregistro del socio con alta del gimnasio (2026-11-21)

- A pedido de la autora, el socio se registra solo desde «Registrarse» (perfil Socio): nombre, apellido, correo, contraseña propia, teléfono, gimnasio y sede, y consentimiento. Es un **pre-registro** (la pantalla no lo llama así): la cuenta queda inactiva con `socio.pendiente_alta = true`, con Plan Básico y sin cuota.
- El ingreso responde `403 ALTA_PENDIENTE` («Tu registro está pendiente…») hasta que el personal con `SOCIOS:GESTION` lo resuelve en Socios → «Pendientes de alta»: **Dar de alta** (verifica el cupo de la suscripción, activa la cuenta, genera la cuota del período, audita `ALTA_SOCIO` y avisa por WhatsApp) o **Rechazar** (la cuenta queda desactivada; audita `RECHAZO_SOCIO`). Mientras está pendiente no se puede activar por «Reactivar socio».
- El alta hecha por el personal (con contraseña temporal) sigue igual.
- API: `GET /api/auth/registro/opciones` (gimnasios con sedes habilitadas), `POST /api/auth/registro`, `PATCH /api/admin/socios/:id/alta` `{ aprobar }`, filtro `?pendiente=true|false` en `GET /api/admin/socios`. Migración `20261121120000_autorregistro_socio` (solo agrega la columna).
- Corrección en el frontend: `useAccion` devolvía `undefined` también ante respuestas 204 (sin cuerpo), y las pantallas lo tomaban como error (no cerraban el modal ni recargaban). Ahora devuelve `true` en el éxito.
- Verificado: backend 198 pruebas (7 nuevas de autorregistro), frontend 27 (registro del socio y confirmación del alta); en el navegador, registro, ingreso bloqueado y alta confirmada.
- TFI: se actualizan RF2, el diccionario (`socio.pendiente_alta`), el DER y el diagrama de clases (`Socio.pendienteAlta`).

### Pendiente

1. **Pruebas que necesitan a la autora (cuentas y paneles personales):**
   - Mercado Pago: **completado el 2026-11-17** (aprobado, rechazado, webhook, adhesión, primer débito y baja). Queda opcional regenerar la clave del webhook en el panel de prueba, porque apareció en una captura, y actualizar `MP_WEBHOOK_SECRET`. Para volver a recibir webhooks hay que abrir otro túnel y actualizar la URL en el panel.
   - WhatsApp: **completado el 2026-11-17 con el sandbox de 360dialog** (ver «WhatsApp real y gratuito»). Para repetir las pruebas: clave nueva con START si se agotan los 25 mensajes, túnel HTTPS y `npm run whatsapp:probar -- --webhook <URL>`.
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
- **Alta de socios:** el gimnasio entrega una contraseña temporal que el socio puede cambiar (el TFI no define el mecanismo de primer acceso). Desde el 2026-11-21 el socio también puede registrarse solo y el gimnasio confirma el alta (ver «Autorregistro del socio»).
