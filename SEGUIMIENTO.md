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

- Backend `npm test`: **125 pruebas aprobadas** (unitarias y de integración con PostgreSQL), incluidas 11 de la API de Orders, credenciales `APP_USR` de prueba y errores de la API.
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

- **Cambió:** `MercadoPagoApiGateway` crea la orden (`POST /v1/orders`, `type: online`, `processing_mode: manual`, `external_reference: pago-{id}`, clave de idempotencia) y redirige con `checkout_url`; el webhook atiende el evento `order` y consulta `GET /v1/orders/{id}`; el retorno llega a `/socio/pagos?resultado=...&pago={id}` y el backend busca la orden por su referencia (verificando que el pago sea del socio). Estados: `processed`/`accredited` = aprobado; `failed` y `canceled` = rechazado; `created`, `processing` y `action_required` = todavía sin registrar. Se guarda como referencia el id del último pago de la orden.
- **No cambió:** reglas de negocio, importes (pago único a precio de lista, 10 % solo por débito automático), `CobroPagoUnico` (Strategy), `registrarResultado` (Facade), comprobantes, WhatsApp, idempotencia, efectivo y el **débito automático con Suscripciones (PreApproval)**, que sigue independiente.
- **Configuración en Mercado Pago Developers (la hace la autora):** aplicación **NeuroGym** con Checkout Pro y **API de Orders**. Al crearla, Mercado Pago genera la cuenta vendedora de prueba y sus credenciales de prueba, cuyo Access Token empieza con `APP_USR` (igual que el productivo). Ese token va en `MP_ACCESS_TOKEN`; el backend lo acepta solo si pertenece a una cuenta de prueba (etiqueta `test_user`, apodo `TESTUSER…` o correo `@testuser.com`) y rechaza las productivas. `npm run mp:verificar` lo comprueba sin mostrar secretos. Webhooks en modo Prueba con los eventos **Order (Mercado Pago)** y **Planes y suscripciones** en `/api/pagos/webhook`; clave en `MP_WEBHOOK_SECRET`. Las credenciales quedan solo en `.env`, que Git ignora.
- **Cuentas de prueba:** el **pago único** con tarjeta se prueba sin cuenta compradora (ventana de incógnito, sin sesión de Mercado Pago, tarjetas de prueba y titular APRO u OTHE). Solo el **débito automático** (Suscripciones) necesita una cuenta **compradora** de prueba del mismo país: su correo va en `MP_TEST_PAYER_EMAIL` y se inicia sesión con ella para autorizar la adhesión.

### Pendiente

1. **Probar Mercado Pago con credenciales de prueba.** Nada de esto está verificado contra la API real:
   - pago único aprobado (titular APRO) y rechazado (OTHE) desde el navegador: retorno, confirmación de la orden, estado de la cuota y comprobante. **Ya verificado:** creación de la orden y `checkout_url` en el entorno de prueba, y búsqueda por referencia;
   - débito automático: su referencia `socio:{id}` usa la API de Suscripciones (otra API); verificar si la acepta al probarlo;
   - webhook `order` firmado y reenviado sin duplicar, y que la búsqueda por `external_reference` responda en el entorno de prueba;
   - débito automático: adhesión con la cuenta compradora, importe con 10 % y baja. Mercado Pago no garantiza cobros mensuales en prueba; si no se generan, queda documentado como no verificado;
   - URL HTTPS para el webhook (túnel de desarrollo).
   - WhatsApp Cloud API y Claude (`ANTHROPIC_API_KEY`) solo funcionan simulados; falta verificarlos con credenciales.
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
- **Alta de socios:** el gimnasio entrega una contraseña temporal que el socio puede cambiar (el TFI no define el mecanismo de primer acceso).
