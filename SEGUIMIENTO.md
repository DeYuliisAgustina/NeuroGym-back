# Seguimiento del desarrollo de NeuroGym

Registro de avance para retomar el trabajo entre sesiones. Se actualiza en cada avance significativo.

## Estado actual (2026-11-16)

### Implementado (backend, compila con `tsc --noEmit`)

| Módulo | Contenido | Verificado |
|---|---|---|
| Base de datos | `prisma/schema.prisma` con las 50 tablas del diccionario (10.5.8) + `auditoria`; SQL complementario de restricciones preparado | `prisma validate` OK. **Migraciones sin ejecutar** (falta acceso a PostgreSQL) |
| Seguridad | JWT, bcrypt, acceso público y administrativo separados, contexto recalculado por solicitud (bajas lógicas al instante), límite de intentos | Unitarias del Composite |
| Patrón Composite | `src/patterns/composite` + `middlewares/permisos.middleware.ts` | 6 pruebas unitarias |
| Administración | Gimnasio/políticas, sedes (RD2, RD21), personal y roles (RF15), planes y precios con historial (RF20, RD12), socios (RF16, RD20) | Pendiente integración |
| Turnos | Configuración de turnos y series (RD23), reservas con bloqueo de fila y disparador de cupo | Pendiente integración |
| Asistencia QR (CU-004) | QR firmado (RNF7), reserva/sede/horario/duplicado, cuota impaga con autorizar/bloquear, manual y provisoria (RD14), día de constancia (RD9) | 6 pruebas de CU-004-003 |
| Cuotas y pagos (CU-001) | Facade `CuotaService` + Strategy (pago único, débito 10 %, efectivo), webhook idempotente, simulador, comprobante y WhatsApp | 9 pruebas de Strategy |
| Entrenamiento (CU-003) | Preferencias, rutina con IA (Claude o simulación), edición, variantes, entrenamientos | Validación de rutina |
| Equipamiento | Inventario, baja definitiva (RD22), incidencias con archivos, agrupación, mantenimientos, alertas (RF23), aviso RF34 | Pendiente integración |
| Retención (CU-002) | ETL (`ProcesoETLAsistencia`), señales, propuestas con aprobación (RD10), bonificación Premium, Intelligence, exportación xlsx | Reglas de señal y riesgo |
| Marketplace | Registro de profesionales, perfil, servicios, disponibilidad, métodos de pago, turnos con Observer, comisiones (RD13), .ics | Observer y RD16 |
| Supresión de datos | `npm run supresion` (Ley 25.326, apartado 9.4) | Pendiente |

### Frontend (NeuroGym-front)

Pantallas de los tres perfiles conectadas a la API: sitio público, ingresos separados, registro de profesionales; socio (bienvenida de 3 pasos, rutina, turnos, QR dinámico, cuotas y pagos con comprobante, simulador de Mercado Pago, beneficios, equipamiento e incidencias, marketplace, perfil); personal (panel, recepción QR con cámara, socios, cobros, horarios, sedes, equipamiento, retención, Intelligence con gráficos, precios, usuarios y roles, políticas); profesional (agenda y perfil). Compila (`tsc` y `vite build`) con carga diferida por pantalla.

### Pruebas ejecutadas

- Backend `npm run test:unit`: **54 pruebas, todas aprobadas** (2026-11-16).
- Frontend `npm test`: **14 pruebas, todas aprobadas** (2026-11-16).
- Backend `tests/integration/` (5 archivos: seguridad y multiempresa, turnos y asistencia, cuotas y pagos, entrenamiento y retención, marketplace): **escritas y compilan; sin ejecutar** hasta tener PostgreSQL.

### Migraciones

- `20261116120000_modelo_inicial` (51 tablas, 28 tipos ENUM, generada con `prisma migrate diff`).
- `20261116120100_restricciones_integridad` (CHECK, índices parciales y disparadores).
- **Sin aplicar todavía.**

### Pendiente

1. Crear el rol y la base `neurogym_dev` (script `../crear_usuario_neurogym.sql`, a ejecutar en pgAdmin) y la base `neurogym_test`.
2. Aplicar las migraciones, ejecutar el seed y las pruebas de integración; corregir lo que falle.
3. Probar el frontend contra la API (flujos principales en el navegador).
4. Inicializar los repositorios Git, configurar la identidad y publicar en GitHub (falta completar `gh auth login`).
5. Credenciales de prueba de Mercado Pago, WhatsApp y Claude para verificar las integraciones reales.

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
