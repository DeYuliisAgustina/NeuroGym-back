# NeuroGym-back

API REST de **NeuroGym**, plataforma SaaS B2B multiempresa y multisede para la gestión de gimnasios: turnos, asistencia con QR, cuotas y pagos con Mercado Pago, rutinas con IA, equipamiento, retención de socios y marketplace de nutricionistas y deportólogos.

Trabajo Final de Ingeniería en Sistemas Informáticos — Universidad Abierta Interamericana (UAI). Autora: Agustina De Yuliis.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Lógica de negocio | Node.js 20+, Express 5, TypeScript 5.9 |
| Persistencia | PostgreSQL 18, Prisma ORM 6.19 |
| Seguridad | JWT (`jsonwebtoken`), contraseñas con `bcrypt`, `helmet`, CORS |
| Validación | Zod 4 |
| Integraciones | Mercado Pago (SDK oficial), WhatsApp Business Cloud API, Claude (`@anthropic-ai/sdk`), almacenamiento de objetos |
| Tareas programadas | `node-cron` (ETL, cuotas, vencimientos, alertas) |
| Reportes | `exceljs` (.xlsx) |
| Pruebas | Vitest, Supertest |

## Arquitectura

Cliente/servidor de **tres capas** con comunicación REST y JSON:

```
NeuroGym-front (presentación: React + Vite, PWA)
        │  HTTPS · JSON · JWT
        ▼
NeuroGym-back  (lógica de negocio)
  routes → middlewares (autenticación, permisos, validación) → controllers → services / patterns
        │
        ▼
  repositories / Prisma Client (procesamiento de datos) → PostgreSQL
```

Los controladores solo traducen HTTP: las reglas de negocio están en `services/` y `patterns/`. El aislamiento multiempresa (RNF4) se aplica en cada consulta con el gimnasio tomado del token, nunca de la solicitud.

## Organización de carpetas

```
NeuroGym-back/
├── prisma/
│   ├── schema.prisma            # Modelo de datos (DER y diccionario 10.5.8 del TFI)
│   ├── migrations/              # Migración inicial + restricciones de integridad (SQL)
│   └── seed.ts                  # Datos ficticios de desarrollo
├── src/
│   ├── config/                  # Variables de entorno y cliente Prisma
│   ├── controllers/             # Entrada HTTP por módulo
│   ├── routes/                  # Endpoints REST y permisos por ruta
│   ├── middlewares/             # JWT, permisos (Composite), errores, límite de intentos
│   ├── validations/             # Esquemas Zod de entrada
│   ├── services/                # Reglas de negocio por módulo
│   ├── repositories/            # Consultas de los flujos principales (CU-001 a CU-004)
│   ├── patterns/
│   │   ├── composite/           # Permisos administrativos
│   │   ├── facade/              # CuotaService
│   │   ├── observer/            # Notificaciones de turnos profesionales
│   │   └── strategy/            # Modalidades de cobro
│   ├── integrations/
│   │   ├── mercadopago/         # Gateway real + simulador
│   │   ├── mensajeria/          # WhatsApp Cloud API + simulación
│   │   ├── ia/                  # Claude + simulación
│   │   └── almacenamiento/      # Almacenamiento de objetos
│   ├── jobs/                    # ETL de asistencia, reglas de retención, tareas programadas, supresión de datos
│   ├── models/                  # Tipos de dominio (sesión, módulos)
│   ├── utils/                   # Fechas, errores, QR firmado, calendario .ics
│   ├── app.ts                   # Configuración de Express
│   └── index.ts                 # Arranque del servidor
├── tests/
│   ├── unit/                    # Patrones y reglas puras
│   └── integration/             # API + PostgreSQL
├── .env.example
└── SEGUIMIENTO.md               # Estado del desarrollo y decisiones
```

## Patrones de diseño implementados

| Patrón | Tipo | Módulo | Ruta | Clases e interfaces | Problema que resuelve |
|---|---|---|---|---|---|
| **Composite** | Estructural | Seguridad (roles y permisos) | `src/patterns/composite/` | `ComponentePermiso` (componente), `Permiso` (hoja), `GrupoPermisos` (compuesto), `Rol` (cliente) | Un rol combina permisos individuales y grupos de permisos por módulo; `requierePermiso()` (`src/middlewares/permisos.middleware.ts`) evalúa `rol.tienePermiso(modulo, acceso)` sin distinguir hojas de grupos. El administrador general recibe un grupo con todos los módulos. |
| **Facade** | Estructural | Cuotas y pagos (CU-001) | `src/patterns/facade/CuotaService.ts` | `CuotaService` | Ofrece una interfaz única (`obtenerDetalleCuota`, `obtenerImportesPorMedio`, `iniciarOperacion`, `registrarResultado`, `registrarEfectivo`, `cancelarAdhesion`…) que coordina estrategias de cobro, Mercado Pago, comprobantes, WhatsApp y persistencia. `CuotaController` solo habla con la fachada. |
| **Strategy** | Comportamiento | Cuotas y pagos | `src/patterns/strategy/` | `EstrategiaCobro` (interfaz), `CobroPagoUnico`, `CobroDebitoAutomatico`, `CobroEfectivo` | Cada modalidad calcula su importe (`calcularImporte`) y ejecuta su cobro (`cobrar`). El 10 % de descuento existe solo en `CobroDebitoAutomatico` (RD6). La fachada elige la estrategia con `seleccionarEstrategia(medio)`. |
| **Observer** | Comportamiento | Marketplace (turnos profesionales) | `src/patterns/observer/` | `GestorEventosTurno` (sujeto), `ObservadorTurno` (interfaz), `NotificadorPlataforma`, `NotificadorMensajeria` | Los eventos CREADO, CANCELADO y REPROGRAMADO (RD17) se guardan en `evento_turno` y se notifican a todos los canales suscriptos; agregar un canal no modifica el turno (RNF14). Lo usa `src/services/turnoProfesional.service.ts`. |

Pruebas que verifican cada patrón: `tests/unit/composite.test.ts`, `strategy.test.ts`, `observer.test.ts`, y los flujos completos en `tests/integration/` (seguridad, cuotas-pagos y marketplace).

## Base de datos

- `prisma/schema.prisma` reproduce las tablas del diccionario de datos del TFI (apartado 10.5.8): nombres en `snake_case` en la base y `camelCase` en el código, tipos ENUM de PostgreSQL, claves foráneas compuestas para garantizar que el rol y el método de pago pertenezcan al mismo gimnasio o profesional.
- `prisma/migrations/…_restricciones_integridad` agrega lo que Prisma no expresa: restricciones CHECK, índices parciales (una rutina vigente, una adhesión activa y un pago aprobado por cuota) y disparadores (control de cupos con bloqueo de fila, RD23, coherencia de gimnasio entre socio, plan y beneficio).
- Las diferencias con el diccionario están documentadas en [SEGUIMIENTO.md](SEGUIMIENTO.md).

## Instalación

Requisitos: Node.js 20.11 o superior y PostgreSQL 15 o superior.

```bash
npm install
cp .env.example .env        # completar DATABASE_URL, JWT_SECRET y QR_SECRET
npx prisma migrate deploy   # aplica las migraciones
npm run db:seed             # datos ficticios de demostración
npm run dev                 # http://localhost:3000/api
```

Las cuentas de demostración del seed usan la contraseña definida en `SEED_PASSWORD` (ver `prisma/seed.ts`). Correos: `admin@piloto.demo`, `recepcion@piloto.demo`, `cobranzas@piloto.demo`, `mantenimiento@piloto.demo`, `analista@piloto.demo`, `socio1@piloto.demo`… y `nutri1@profesional.demo`.

## Variables de entorno

Ver `.env.example`. Las obligatorias son `DATABASE_URL`, `JWT_SECRET` y `QR_SECRET`. Si faltan las credenciales de una integración, se usa su simulación (ver abajo).

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor en modo desarrollo |
| `npm run build` / `npm start` | Compilación y ejecución |
| `npm run typecheck` | Verificación de tipos |
| `npm run prisma:migrate` | Crea y aplica migraciones en desarrollo |
| `npm run prisma:deploy` | Aplica migraciones pendientes |
| `npm run db:seed` | Carga datos ficticios |
| `npm run etl` | Ejecuta el ETL de asistencia para todos los gimnasios |
| `npm run supresion -- --socio <id> --gimnasio <id> --confirmar` | Supresión o disociación de datos personales (Ley 25.326, apartado 9.4 del TFI) |
| `npm test` | Todas las pruebas |
| `npm run test:unit` / `npm run test:integration` | Pruebas unitarias o de integración |
| `npm run test:coverage` | Cobertura |

## API REST

Prefijo `/api`. Respuestas JSON; errores con `{ error, mensaje, detalle }`.

| Recurso | Perfil | Principales operaciones |
|---|---|---|
| `/auth` | Todos | `POST /login` (socios y profesionales), `POST /admin/login` (personal), `GET /sesion`, `PUT /password` |
| `/publico` | Público | Suscripciones SaaS y planes Marketplace (RF1) |
| `/admin/*` | Personal (según permisos) | Gimnasio y políticas, sedes, personal y roles, planes y precios, socios, turnos, asistencias, cuotas, equipamiento, incidencias, mantenimientos, retención, beneficios, Intelligence |
| `/socio/*` | Socio | Perfil y plan, turnos y reservas, QR, cuota y pagos, rutina, entrenamientos, equipamiento e incidencias, beneficios, marketplace |
| `/cuotas/:id/medios`, `/cuotas/:id/pagos` | Socio | CU-001 |
| `/asistencias/qr`, `/asistencias/autorizaciones`, `/asistencias/manual`, `/rechazos` | Personal de recepción | CU-004 |
| `/pagos/webhook` | Mercado Pago | Notificaciones firmadas (idempotentes) |
| `/profesional/*` | Profesional | Registro, perfil, servicios, disponibilidad, métodos de pago, agenda, comisiones |
| `/turnos-profesionales/:id/*` | Socio y profesional | Cancelación, reprogramación, eventos, `.ics` |
| `/notificaciones` | Todos | Notificaciones internas |

## Integraciones externas

| Integración | Implementación real | Estado | Sin credenciales |
|---|---|---|---|
| Mercado Pago | `integrations/mercadopago/MercadoPagoApiGateway.ts`: pago único con órdenes de Checkout Pro (**API de Orders**, `POST /v1/orders`), débito automático con Suscripciones (PreApproval), baja del débito, validación `x-signature` y consulta de órdenes y preaprobaciones. Solo cuotas de socios y solo entorno de prueba | **Pendiente de prueba con credenciales de Mercado Pago Developers** (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_TEST_PAYER_EMAIL`) y de una URL HTTPS para el webhook | Sin credenciales el pago en línea queda deshabilitado (no hay simulador); las pruebas automatizadas usan un doble de prueba |
| WhatsApp | `integrations/mensajeria/WhatsAppCloudApi.ts` (Meta Graph API) | Modo de prueba con el número gratuito de Meta: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_TEST_RECIPIENT` (fuera de producción solo se envía a ese número). `npm run whatsapp:probar [-- <pagoId>]` verifica y reenvía un comprobante. Fuera de la ventana de 24 h Meta exige plantillas aprobadas | `MensajeriaSimulada` (no envía mensajes) |
| IA | `integrations/ia/ServicioIAClaude.ts` (salidas estructuradas validadas con Zod) | **Pendiente de credencial** (`ANTHROPIC_API_KEY`) | `ServicioIASimulado` (reglas determinísticas) |
| Almacenamiento de objetos | `integrations/almacenamiento/AlmacenamientoObjetos.ts` | Almacenamiento local de desarrollo; proveedor S3 compatible pendiente | — |

Ninguna integración real fue verificada todavía contra el servicio externo.

## Pruebas

```bash
npm run test:unit
```

Las pruebas de integración necesitan una base exclusiva cuyo nombre termine en `_test` (se vacía en cada ejecución). Crear `.env.test` con:

```
DATABASE_URL="postgresql://USUARIO:CLAVE@localhost:5432/neurogym_test?schema=public"
```

y luego:

```bash
npm run test:preparar      # aplica las migraciones en la base de pruebas
npm run test:integration
```

## Seguridad y datos personales

- Contraseñas con bcrypt; JWT sin datos personales; contexto recalculado en cada solicitud (las bajas lógicas rigen de inmediato).
- QR temporal y firmado con HMAC, sin datos legibles (RNF7).
- Bajas lógicas reversibles de socios, sedes y cuentas (RD20, RD21); el procedimiento de supresión de la Ley 25.326 es independiente (`npm run supresion`).
- Auditoría de operaciones relevantes en la tabla `auditoria`.
- Nunca se versionan `.env`, credenciales ni datos reales.
