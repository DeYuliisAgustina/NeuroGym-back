-- CreateEnum
CREATE TYPE "estado_envio_mensaje" AS ENUM ('PREPARADO', 'ACEPTADO', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO', 'OMITIDO', 'SIMULADO');

-- CreateEnum
CREATE TYPE "tipo_envio_mensaje" AS ENUM ('COMPROBANTE', 'VENCIMIENTO', 'AVISO');

-- CreateTable
CREATE TABLE "envio_mensaje" (
    "envio_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tipo" "tipo_envio_mensaje" NOT NULL,
    "referencia" VARCHAR(150) NOT NULL,
    "proveedor" VARCHAR(40) NOT NULL,
    "destino" VARCHAR(30),
    "texto" TEXT NOT NULL,
    "estado" "estado_envio_mensaje" NOT NULL DEFAULT 'PREPARADO',
    "id_mensaje" VARCHAR(200),
    "detalle" VARCHAR(500),
    "comprobante_id" INTEGER,
    "cuota_id" INTEGER,
    "fecha_creacion" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_aceptado" TIMESTAMP(6),
    "fecha_enviado" TIMESTAMP(6),
    "fecha_entregado" TIMESTAMP(6),
    "fecha_leido" TIMESTAMP(6),
    "fecha_fallido" TIMESTAMP(6),

    CONSTRAINT "envio_mensaje_pkey" PRIMARY KEY ("envio_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "envio_mensaje_referencia_key" ON "envio_mensaje"("referencia");

-- CreateIndex
CREATE UNIQUE INDEX "envio_mensaje_id_mensaje_key" ON "envio_mensaje"("id_mensaje");

-- CreateIndex
CREATE INDEX "envio_mensaje_usuario_id_fecha_creacion_idx" ON "envio_mensaje"("usuario_id", "fecha_creacion");

-- CreateIndex
CREATE INDEX "envio_mensaje_comprobante_id_idx" ON "envio_mensaje"("comprobante_id");

-- AddForeignKey
ALTER TABLE "envio_mensaje" ADD CONSTRAINT "envio_mensaje_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envio_mensaje" ADD CONSTRAINT "envio_mensaje_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "comprobante"("comprobante_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envio_mensaje" ADD CONSTRAINT "envio_mensaje_cuota_id_fkey" FOREIGN KEY ("cuota_id") REFERENCES "cuota"("cuota_id") ON DELETE SET NULL ON UPDATE CASCADE;

