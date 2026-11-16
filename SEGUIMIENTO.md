# Seguimiento del desarrollo de NeuroGym

Registro de avance para retomar el trabajo entre sesiones. Se actualiza en cada avance significativo.

## Estado actual (2026-11-16)

### Repositorios

| Repositorio | URL (privado) | Commits |
|---|---|---|
| NeuroGym-back | https://github.com/DeYuliisAgustina/NeuroGym-back | 17 (más este registro) |
| NeuroGym-front | https://github.com/DeYuliisAgustina/NeuroGym-front | 9 |

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
| Frontend | `npm test` (14) y prueba manual en el navegador: sitio público, ingreso del socio, bienvenida y rutina, pago con el simulador hasta el comprobante, ingreso administrativo, Intelligence, retención, recepción, cobros, equipamiento, usuarios y horarios sin errores de consola |

### Pruebas ejecutadas (2026-11-16)

- Backend `npm test`: **108 pruebas aprobadas** (54 unitarias + 54 de integración con PostgreSQL). Cobertura de líneas 71 %; patrones entre 89 % y 100 %.
- Frontend `npm test`: **14 pruebas aprobadas**. `vite build` correcto (249 kB de JavaScript inicial).

### Errores detectados y corregidos

- Las cuotas vencidas no pasaban a IMPAGA si el servidor no estaba encendido a la hora de la tarea diaria: se agregó `ponerAlDia()` al iniciar (con `CRON_ENABLED=true`) y en el seed.
- pgAdmin ejecuta el editor en una transacción y `CREATE DATABASE` no se admite: el script de rol quedó solo con `CREATE ROLE`; las bases las crea el rol `neurogym`.

### Pendiente

1. Credenciales de prueba de Mercado Pago (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y una URL pública para el webhook), WhatsApp Cloud API y Claude (`ANTHROPIC_API_KEY`) para verificar las integraciones reales; hoy funcionan sus simulaciones.
2. Almacenamiento de objetos en un proveedor S3 compatible (hoy, carpeta local).
3. Actualizar el monto de las preaprobaciones de débito cuando cambia un precio.
4. Apartado 10.5.10 del TFI (casos de prueba) a partir de las funciones reales: `verificarReservaVigente`, `CuotaService.registrarResultado`, `detectarSenal`/`estimarRiesgo`, `validarRutinaGenerada`.

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
