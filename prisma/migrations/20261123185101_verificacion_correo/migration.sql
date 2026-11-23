-- Verificación del correo al registrarse y recuperación de la contraseña con un código enviado por correo.
-- Las cuentas existentes (y las que crea el personal) quedan verificadas: solo el autorregistro arranca sin verificar.

-- CreateEnum
CREATE TYPE "proposito_codigo" AS ENUM ('VERIFICACION_EMAIL', 'RECUPERACION_PASSWORD');

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "email_verificado" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "codigo_email" (
    "codigo_email_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "proposito" "proposito_codigo" NOT NULL,
    "codigo_hash" VARCHAR(64) NOT NULL,
    "vence" TIMESTAMP(6) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "fecha_alta" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigo_email_pkey" PRIMARY KEY ("codigo_email_id")
);

-- CreateIndex
CREATE INDEX "codigo_email_usuario_id_proposito_idx" ON "codigo_email"("usuario_id", "proposito");

-- AddForeignKey
ALTER TABLE "codigo_email" ADD CONSTRAINT "codigo_email_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE CASCADE ON UPDATE CASCADE;
