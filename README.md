# NeuroGym-back

API REST de **NeuroGym**, plataforma para la gestión de gimnasios: turnos, asistencia con QR, cuotas y pagos, rutinas con IA, equipamiento, retención de socios y marketplace de profesionales.

Trabajo Final de Ingeniería en Sistemas Informáticos — Universidad Abierta Interamericana (UAI). Autora: Agustina De Yuliis.

Frontend: [NeuroGym-front](https://github.com/DeYuliisAgustina/NeuroGym-front)

## Versión online

- Web: https://neurogym-front.vercel.app
- API: https://neurogym-back.vercel.app/api

Se puede probar sin instalar nada, con las cuentas de prueba de abajo.

## Tecnologías

Node.js · Express · TypeScript · PostgreSQL · Prisma · Vitest

Integraciones: Mercado Pago (pagos), WhatsApp (comprobantes y avisos) y Gemini (rutinas con IA). Si no se configuran sus claves, funcionan en modo simulado.

## Requisitos

- Node.js 20.11 o superior
- PostgreSQL 15 o superior

## Instalación

```bash
npm install
npm run env:crear           # crea el archivo .env
```

Abrir `.env` y completar `DATABASE_URL` con el usuario, la clave y el nombre de la base de PostgreSQL. Después:

```bash
npx prisma migrate deploy   # crea las tablas
npm run db:seed             # carga datos de prueba
npm run dev                 # API en http://localhost:3000/api
```

## Cuentas de prueba

Contraseña de todas: `neurogym123`

- Administrador: `admin@neurogym.test`
- Socio: `socio1@neurogym.test`
- Profesional: `nutri1@neurogym.test`

## Probar un pago (Mercado Pago en modo prueba)

No se cobra dinero real.

1. Abrir una ventana de incógnito.
2. Ingresar como `socio1@neurogym.test`, ir a **Cuotas y pagos** y pagar.
3. En Mercado Pago, usar el mail del comprador de prueba: `test_user_2022586958666032656@testuser.com`
4. Pagar con esta tarjeta de prueba de Mercado Pago:

   | Dato | Valor |
   |---|---|
   | Número | `5031 7557 3453 0604` |
   | Titular | `APRO` (pago aprobado) u `OTHE` (pago rechazado) |
   | Documento | `12345678` |
   | Vencimiento | `11/30` |
   | Código de seguridad | `123` |

   Más tarjetas de prueba: [documentación de Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/integration-test/test-cards).

## Pruebas

```bash
npm run test:unit
```
