# NeuroGym-back

API REST de **NeuroGym**, plataforma para la gestión de gimnasios: turnos, asistencia con QR, cuotas y pagos, rutinas con IA, equipamiento, retención de socios y marketplace de profesionales.

Trabajo Final de Ingeniería en Sistemas Informáticos — Universidad Abierta Interamericana (UAI). Autora: Agustina De Yuliis.

Frontend: [NeuroGym-front](https://github.com/DeYuliisAgustina/NeuroGym-front)

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

## Pruebas

```bash
npm run test:unit
```
