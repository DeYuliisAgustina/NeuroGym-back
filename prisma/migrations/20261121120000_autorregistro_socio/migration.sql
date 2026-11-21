-- RF2: autorregistro del socio (pre-registro hasta que el gimnasio confirma el alta).
ALTER TABLE "socio" ADD COLUMN "pendiente_alta" BOOLEAN NOT NULL DEFAULT false;
