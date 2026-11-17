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
| Cuotas y pagos (CU-001: Facade, Strategy, webhook idempotente, rechazo, falla de WhatsApp, débito con 10 %, efectivo, RD12) | `cuotas-pagos.test.ts` (11) + `strategy.test.ts` (9) |
| Entrenamiento (CU-003: rutina simulada, reemplazo, edición, variante, entrenamiento) y equipamiento (RD22) | `entrenamiento-retencion.test.ts` |
| Retención (CU-002: ETL, señales, estimaciones solo Intelligence, propuesta con aprobación y bonificación Premium, xlsx, canjes) | `entrenamiento-retencion.test.ts` (10 en total) + `reglas.test.ts` |
| Marketplace (Observer CREADO/REPROGRAMADO/CANCELADO, RD16, comisión 8 %, Fundadores, .ics) | `marketplace.test.ts` (8) + `observer.test.ts` (5) |
| Frontend (diseño de los prototipos) | `npm test` (18) y revisión en el navegador, en escritorio y en celular (375 px), de las tres áreas con datos del seed: sitio público, ingreso, registro y acceso interno; socio (resumen, rutina, turnos, QR, cuotas y pagos con comprobante, beneficios, profesionales, equipamiento, perfil); personal (los 14 módulos y los modales de efectivo, permisos y ficha del socio); profesional (agenda, solicitudes, servicio y horarios, perfil, plan Marketplace) |

### Pruebas ejecutadas (2026-11-17)

- Backend `npm test`: **114 pruebas aprobadas** (unitarias y de integración con PostgreSQL).
- Frontend `npm test`: **18 pruebas aprobadas**; `tsc` sin errores y `vite build` correcto (265 kB de JavaScript inicial; la lectura de QR se carga solo en Recepción).

### Errores detectados y corregidos

- La hoja de estilos copiada del prototipo incluía la regla `body{max-width:680px}` de su comprobante descargable y angostaba todas las páginas: se quitó.
- `tsx watch` no detectó cambios del backend en Windows y sirvió código anterior (precios en $0): se forzó la recarga. Si vuelve a pasar, reiniciar `npm run dev`.
- La prueba CU-004-010 crea un turno que empezó 30 minutos antes; ejecutada entre las 00:00 y las 00:30 el inicio cae en el día anterior y falla. No afecta la aplicación.

- Las cuotas vencidas no pasaban a IMPAGA si el servidor no estaba encendido a la hora de la tarea diaria: se agregó `ponerAlDia()` al iniciar (con `CRON_ENABLED=true`) y en el seed.
- pgAdmin ejecuta el editor en una transacción y `CREATE DATABASE` no se admite: el script de rol quedó solo con `CREATE ROLE`; las bases las crea el rol `neurogym`.

### Pendiente

1. Credenciales de prueba de Mercado Pago (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y una URL pública para el webhook), WhatsApp Cloud API y Claude (`ANTHROPIC_API_KEY`) para verificar las integraciones reales; hoy funcionan sus simulaciones.
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
