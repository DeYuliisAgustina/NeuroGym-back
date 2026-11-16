-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tipo_usuario" AS ENUM ('SOCIO', 'PERSONAL', 'PROFESIONAL');

-- CreateEnum
CREATE TYPE "tipo_suscripcion" AS ENUM ('STANDARD', 'INTELLIGENCE');

-- CreateEnum
CREATE TYPE "politica_cuota_pendiente" AS ENUM ('BLOQUEAR', 'AUTORIZAR');

-- CreateEnum
CREATE TYPE "tipo_acceso" AS ENUM ('CONSULTA', 'GESTION');

-- CreateEnum
CREATE TYPE "tipo_plan_socio" AS ENUM ('BASICO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "estado_reserva" AS ENUM ('RESERVADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "forma_registro" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "estado_equipo" AS ENUM ('OPERATIVO', 'FUERA_DE_SERVICIO', 'SERVICE_PROGRAMADO', 'DADO_DE_BAJA');

-- CreateEnum
CREATE TYPE "prioridad_incidencia" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "estado_incidencia" AS ENUM ('REPORTADA', 'EN_GESTION', 'RESUELTA');

-- CreateEnum
CREATE TYPE "tipo_archivo" AS ENUM ('FOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "tipo_mantenimiento" AS ENUM ('PREVENTIVO', 'CORRECTIVO');

-- CreateEnum
CREATE TYPE "estado_mantenimiento" AS ENUM ('PROGRAMADO', 'REALIZADO');

-- CreateEnum
CREATE TYPE "estado_propuesta" AS ENUM ('PREPARADA', 'PENDIENTE', 'APROBADA');

-- CreateEnum
CREATE TYPE "estado_cuota" AS ENUM ('PENDIENTE', 'PAGADA', 'IMPAGA');

-- CreateEnum
CREATE TYPE "medio_pago" AS ENUM ('PAGO_UNICO', 'DEBITO_AUTOMATICO', 'EFECTIVO');

-- CreateEnum
CREATE TYPE "estado_pago" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "estado_adhesion" AS ENUM ('ACTIVA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "tipo_plan_marketplace" AS ENUM ('BASICO', 'PROFESIONAL');

-- CreateEnum
CREATE TYPE "especialidad" AS ENUM ('NUTRICION', 'DEPORTOLOGIA');

-- CreateEnum
CREATE TYPE "modalidad_atencion" AS ENUM ('ONLINE', 'PRESENCIAL', 'ONLINE_Y_PRESENCIAL');

-- CreateEnum
CREATE TYPE "modalidad_consulta" AS ENUM ('ONLINE', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "dia_semana" AS ENUM ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO');

-- CreateEnum
CREATE TYPE "tipo_metodo_pago" AS ENUM ('OBRA_SOCIAL', 'PARTICULAR', 'ACUERDO_CONSULTA');

-- CreateEnum
CREATE TYPE "estado_turno_profesional" AS ENUM ('SOLICITADO', 'CONFIRMADO', 'RECHAZADO', 'CANCELADO', 'REPROGRAMADO', 'COMPLETADO');

-- CreateEnum
CREATE TYPE "tipo_evento_turno" AS ENUM ('CREADO', 'CANCELADO', 'REPROGRAMADO');

-- CreateEnum
CREATE TYPE "tipo_notificacion" AS ENUM ('TURNO_CLASE', 'TURNO_PROFESIONAL', 'PAGO', 'VENCIMIENTO', 'BENEFICIO', 'INCENTIVO', 'EQUIPAMIENTO');

-- CreateEnum
CREATE TYPE "canal_notificacion" AS ENUM ('PLATAFORMA', 'MENSAJERIA');

-- CreateTable
CREATE TABLE "gimnasio" (
    "gimnasio_id" SERIAL NOT NULL,
    "razon_social" VARCHAR(150) NOT NULL,
    "cuit" VARCHAR(13) NOT NULL,
    "tolerancia_antes_min" SMALLINT NOT NULL DEFAULT 15,
    "tolerancia_despues_min" SMALLINT NOT NULL DEFAULT 60,
    "politica_cuota_pendiente" "politica_cuota_pendiente" NOT NULL DEFAULT 'BLOQUEAR',
    "ultima_ejecucion_etl" TIMESTAMP(6),
    "fecha_alta" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gimnasio_pkey" PRIMARY KEY ("gimnasio_id")
);

-- CreateTable
CREATE TABLE "suscripcion_saas" (
    "suscripcion_id" SERIAL NOT NULL,
    "gimnasio_id" INTEGER NOT NULL,
    "tipo" "tipo_suscripcion" NOT NULL,
    "max_sedes" SMALLINT NOT NULL,
    "max_socios_activos" INTEGER NOT NULL,
    "fecha_inicio" DATE NOT NULL,

    CONSTRAINT "suscripcion_saas_pkey" PRIMARY KEY ("suscripcion_id")
);

-- CreateTable
CREATE TABLE "sede" (
    "sede_id" SERIAL NOT NULL,
    "gimnasio_id" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "direccion" VARCHAR(200) NOT NULL,
    "horarios" VARCHAR(200) NOT NULL,
    "habilitada" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sede_pkey" PRIMARY KEY ("sede_id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "usuario_id" SERIAL NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "apellido" VARCHAR(100) NOT NULL,
    "tipo" "tipo_usuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_alta" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "modulo" (
    "modulo_id" SERIAL NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,

    CONSTRAINT "modulo_pkey" PRIMARY KEY ("modulo_id")
);

-- CreateTable
CREATE TABLE "permiso" (
    "permiso_id" SERIAL NOT NULL,
    "modulo_id" INTEGER NOT NULL,
    "acceso" "tipo_acceso" NOT NULL,

    CONSTRAINT "permiso_pkey" PRIMARY KEY ("permiso_id")
);

-- CreateTable
CREATE TABLE "rol" (
    "rol_id" SERIAL NOT NULL,
    "gimnasio_id" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rol_pkey" PRIMARY KEY ("rol_id")
);

-- CreateTable
CREATE TABLE "rol_permiso" (
    "rol_id" INTEGER NOT NULL,
    "permiso_id" INTEGER NOT NULL,

    CONSTRAINT "rol_permiso_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "personal_administrativo" (
    "personal_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "gimnasio_id" INTEGER NOT NULL,
    "rol_id" INTEGER NOT NULL,

    CONSTRAINT "personal_administrativo_pkey" PRIMARY KEY ("personal_id")
);

-- CreateTable
CREATE TABLE "plan_socio" (
    "plan_socio_id" SERIAL NOT NULL,
    "gimnasio_id" INTEGER NOT NULL,
    "tipo" "tipo_plan_socio" NOT NULL,
    "importe_mensual" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "plan_socio_pkey" PRIMARY KEY ("plan_socio_id")
);

-- CreateTable
CREATE TABLE "actualizacion_precio" (
    "actualizacion_id" SERIAL NOT NULL,
    "plan_socio_id" INTEGER NOT NULL,
    "importe_anterior" DECIMAL(12,2) NOT NULL,
    "importe_nuevo" DECIMAL(12,2) NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "motivo" VARCHAR(255) NOT NULL,
    "responsable_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actualizacion_precio_pkey" PRIMARY KEY ("actualizacion_id")
);

-- CreateTable
CREATE TABLE "socio" (
    "socio_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "sede_id" INTEGER NOT NULL,
    "plan_socio_id" INTEGER NOT NULL,
    "telefono" VARCHAR(30) NOT NULL,
    "consentimiento_datos" BOOLEAN NOT NULL,
    "saldo_puntos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "socio_pkey" PRIMARY KEY ("socio_id")
);

-- CreateTable
CREATE TABLE "codigo_qr" (
    "codigo_qr_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "codigo" VARCHAR(128) NOT NULL,
    "emitido_en" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "codigo_qr_pkey" PRIMARY KEY ("codigo_qr_id")
);

-- CreateTable
CREATE TABLE "turno_clase" (
    "turno_clase_id" SERIAL NOT NULL,
    "sede_id" INTEGER NOT NULL,
    "actividad" VARCHAR(100) NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_inicio" TIME(0) NOT NULL,
    "hora_fin" TIME(0) NOT NULL,
    "cupo" SMALLINT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "turno_clase_pkey" PRIMARY KEY ("turno_clase_id")
);

-- CreateTable
CREATE TABLE "reserva" (
    "reserva_id" SERIAL NOT NULL,
    "turno_clase_id" INTEGER NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "estado" "estado_reserva" NOT NULL DEFAULT 'RESERVADO',
    "fecha_reserva" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_cancelacion" TIMESTAMP(6),

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("reserva_id")
);

-- CreateTable
CREATE TABLE "asistencia" (
    "asistencia_id" SERIAL NOT NULL,
    "reserva_id" INTEGER NOT NULL,
    "codigo_qr_id" INTEGER,
    "fecha_hora_real" TIMESTAMP(6) NOT NULL,
    "forma" "forma_registro" NOT NULL,
    "provisoria" BOOLEAN NOT NULL DEFAULT false,
    "motivo" VARCHAR(255),
    "responsable_id" INTEGER,

    CONSTRAINT "asistencia_pkey" PRIMARY KEY ("asistencia_id")
);

-- CreateTable
CREATE TABLE "autorizacion_excepcional" (
    "autorizacion_id" SERIAL NOT NULL,
    "asistencia_id" INTEGER NOT NULL,
    "motivo" VARCHAR(255) NOT NULL,
    "responsable_id" INTEGER NOT NULL,
    "fecha_hora" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autorizacion_excepcional_pkey" PRIMARY KEY ("autorizacion_id")
);

-- CreateTable
CREATE TABLE "rechazo_ingreso" (
    "rechazo_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "motivo" VARCHAR(255) NOT NULL,
    "responsable_id" INTEGER,
    "fecha_hora" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rechazo_ingreso_pkey" PRIMARY KEY ("rechazo_id")
);

-- CreateTable
CREATE TABLE "dia_constancia" (
    "dia_constancia_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "asistencia_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "puntos" SMALLINT NOT NULL,

    CONSTRAINT "dia_constancia_pkey" PRIMARY KEY ("dia_constancia_id")
);

-- CreateTable
CREATE TABLE "preferencia_rutina" (
    "preferencia_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "objetivo" VARCHAR(100) NOT NULL,
    "nivel" VARCHAR(50) NOT NULL,
    "dias_por_semana" SMALLINT NOT NULL,
    "fecha_actualizacion" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferencia_rutina_pkey" PRIMARY KEY ("preferencia_id")
);

-- CreateTable
CREATE TABLE "ejercicio" (
    "ejercicio_id" SERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "grupo_muscular" VARCHAR(50) NOT NULL,

    CONSTRAINT "ejercicio_pkey" PRIMARY KEY ("ejercicio_id")
);

-- CreateTable
CREATE TABLE "rutina" (
    "rutina_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "fecha_generacion" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rutina_pkey" PRIMARY KEY ("rutina_id")
);

-- CreateTable
CREATE TABLE "ejercicio_rutina" (
    "ejercicio_rutina_id" SERIAL NOT NULL,
    "rutina_id" INTEGER NOT NULL,
    "ejercicio_id" INTEGER NOT NULL,
    "dia" SMALLINT NOT NULL,
    "orden" SMALLINT NOT NULL,
    "series" SMALLINT NOT NULL,
    "repeticiones" SMALLINT NOT NULL,
    "peso_kg" DECIMAL(6,2),
    "descanso_seg" SMALLINT,

    CONSTRAINT "ejercicio_rutina_pkey" PRIMARY KEY ("ejercicio_rutina_id")
);

-- CreateTable
CREATE TABLE "entrenamiento" (
    "entrenamiento_id" SERIAL NOT NULL,
    "rutina_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "ejercicios_completados" SMALLINT NOT NULL,
    "ejercicios_totales" SMALLINT NOT NULL,

    CONSTRAINT "entrenamiento_pkey" PRIMARY KEY ("entrenamiento_id")
);

-- CreateTable
CREATE TABLE "ejercicio_equipo" (
    "ejercicio_id" INTEGER NOT NULL,
    "equipo_id" INTEGER NOT NULL,

    CONSTRAINT "ejercicio_equipo_pkey" PRIMARY KEY ("ejercicio_id","equipo_id")
);

-- CreateTable
CREATE TABLE "equipo" (
    "equipo_id" SERIAL NOT NULL,
    "sede_id" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "categoria" VARCHAR(50) NOT NULL,
    "estado" "estado_equipo" NOT NULL DEFAULT 'OPERATIVO',
    "fecha_compra" DATE,
    "vida_util_anios" SMALLINT,
    "proximo_service" DATE,
    "fecha_baja" DATE,

    CONSTRAINT "equipo_pkey" PRIMARY KEY ("equipo_id")
);

-- CreateTable
CREATE TABLE "incidencia" (
    "incidencia_id" SERIAL NOT NULL,
    "equipo_id" INTEGER NOT NULL,
    "reportante_id" INTEGER NOT NULL,
    "agrupada_en_id" INTEGER,
    "descripcion" TEXT NOT NULL,
    "prioridad" "prioridad_incidencia" NOT NULL DEFAULT 'MEDIA',
    "estado" "estado_incidencia" NOT NULL DEFAULT 'REPORTADA',
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsable_id" INTEGER,

    CONSTRAINT "incidencia_pkey" PRIMARY KEY ("incidencia_id")
);

-- CreateTable
CREATE TABLE "archivo_incidencia" (
    "archivo_id" SERIAL NOT NULL,
    "incidencia_id" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "tipo" "tipo_archivo" NOT NULL,
    "fecha_carga" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivo_incidencia_pkey" PRIMARY KEY ("archivo_id")
);

-- CreateTable
CREATE TABLE "mantenimiento" (
    "mantenimiento_id" SERIAL NOT NULL,
    "equipo_id" INTEGER NOT NULL,
    "tipo" "tipo_mantenimiento" NOT NULL,
    "estado" "estado_mantenimiento" NOT NULL DEFAULT 'PROGRAMADO',
    "inicio_programado" TIMESTAMP(6) NOT NULL,
    "fin_programado" TIMESTAMP(6) NOT NULL,
    "intervencion_prevista" TEXT,
    "fecha_realizada" TIMESTAMP(6),
    "detalle_realizado" TEXT,
    "responsable_id" INTEGER NOT NULL,

    CONSTRAINT "mantenimiento_pkey" PRIMARY KEY ("mantenimiento_id")
);

-- CreateTable
CREATE TABLE "beneficio" (
    "beneficio_id" SERIAL NOT NULL,
    "gimnasio_id" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(255) NOT NULL,
    "costo_puntos" INTEGER NOT NULL,
    "vigencia_dias" SMALLINT NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "beneficio_pkey" PRIMARY KEY ("beneficio_id")
);

-- CreateTable
CREATE TABLE "canje" (
    "canje_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "beneficio_id" INTEGER NOT NULL,
    "puntos_utilizados" INTEGER NOT NULL,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_el" DATE NOT NULL,

    CONSTRAINT "canje_pkey" PRIMARY KEY ("canje_id")
);

-- CreateTable
CREATE TABLE "bonificacion_premium" (
    "bonificacion_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "responsable_id" INTEGER NOT NULL,

    CONSTRAINT "bonificacion_premium_pkey" PRIMARY KEY ("bonificacion_id")
);

-- CreateTable
CREATE TABLE "senal_abandono" (
    "senal_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "nivel" VARCHAR(20) NOT NULL,
    "detalle" VARCHAR(255),
    "detectada_el" DATE NOT NULL,

    CONSTRAINT "senal_abandono_pkey" PRIMARY KEY ("senal_id")
);

-- CreateTable
CREATE TABLE "propuesta_incentivo" (
    "propuesta_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "senal_id" INTEGER,
    "incentivo" VARCHAR(100) NOT NULL,
    "mensaje" TEXT NOT NULL,
    "estado" "estado_propuesta" NOT NULL DEFAULT 'PREPARADA',
    "responsable_id" INTEGER NOT NULL,
    "fecha_creacion" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_aprobacion" TIMESTAMP(6),
    "premium_dias" SMALLINT,
    "premium_porcentaje" DECIMAL(5,2),

    CONSTRAINT "propuesta_incentivo_pkey" PRIMARY KEY ("propuesta_id")
);

-- CreateTable
CREATE TABLE "estimacion_riesgo" (
    "estimacion_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "nivel" VARCHAR(20) NOT NULL,
    "fundamento" TEXT NOT NULL,
    "recomendacion" TEXT NOT NULL,
    "fecha" DATE NOT NULL,

    CONSTRAINT "estimacion_riesgo_pkey" PRIMARY KEY ("estimacion_id")
);

-- CreateTable
CREATE TABLE "decision_retencion" (
    "decision_id" SERIAL NOT NULL,
    "estimacion_id" INTEGER NOT NULL,
    "decision" VARCHAR(100) NOT NULL,
    "motivo" VARCHAR(255) NOT NULL,
    "responsable_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_retencion_pkey" PRIMARY KEY ("decision_id")
);

-- CreateTable
CREATE TABLE "indicador_asistencia" (
    "indicador_id" SERIAL NOT NULL,
    "sede_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo_plan" "tipo_plan_socio" NOT NULL,
    "asistencias" INTEGER NOT NULL DEFAULT 0,
    "socios_con_asistencia" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "indicador_asistencia_pkey" PRIMARY KEY ("indicador_id")
);

-- CreateTable
CREATE TABLE "cuota" (
    "cuota_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "periodo" CHAR(7) NOT NULL,
    "cuota_base" DECIMAL(12,2) NOT NULL,
    "adicional_premium" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importe_final" DECIMAL(12,2) NOT NULL,
    "estado" "estado_cuota" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_vencimiento" DATE NOT NULL,

    CONSTRAINT "cuota_pkey" PRIMARY KEY ("cuota_id")
);

-- CreateTable
CREATE TABLE "adhesion_debito" (
    "adhesion_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "id_preaprobacion" VARCHAR(100) NOT NULL,
    "estado" "estado_adhesion" NOT NULL DEFAULT 'ACTIVA',
    "fecha_alta" DATE NOT NULL,
    "fecha_baja" DATE,

    CONSTRAINT "adhesion_debito_pkey" PRIMARY KEY ("adhesion_id")
);

-- CreateTable
CREATE TABLE "pago" (
    "pago_id" SERIAL NOT NULL,
    "cuota_id" INTEGER NOT NULL,
    "adhesion_id" INTEGER,
    "medio" "medio_pago" NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "estado" "estado_pago" NOT NULL DEFAULT 'PENDIENTE',
    "referencia_externa" VARCHAR(100),
    "responsable_id" INTEGER,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("pago_id")
);

-- CreateTable
CREATE TABLE "comprobante" (
    "comprobante_id" SERIAL NOT NULL,
    "pago_id" INTEGER NOT NULL,
    "numero" VARCHAR(30) NOT NULL,
    "fecha_emision" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_envio" TIMESTAMP(6),

    CONSTRAINT "comprobante_pkey" PRIMARY KEY ("comprobante_id")
);

-- CreateTable
CREATE TABLE "plan_marketplace" (
    "plan_marketplace_id" SERIAL NOT NULL,
    "tipo" "tipo_plan_marketplace" NOT NULL,
    "precio_mensual_usd" DECIMAL(8,2) NOT NULL,
    "porcentaje_comision" DECIMAL(5,2) NOT NULL,
    "perfil_promocionado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plan_marketplace_pkey" PRIMARY KEY ("plan_marketplace_id")
);

-- CreateTable
CREATE TABLE "profesional" (
    "profesional_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "plan_marketplace_id" INTEGER NOT NULL,
    "referido_por_id" INTEGER,
    "especialidad" "especialidad" NOT NULL,
    "modalidad_atencion" "modalidad_atencion" NOT NULL,
    "valor_consulta" DECIMAL(12,2) NOT NULL,
    "publicacion_pausada" BOOLEAN NOT NULL DEFAULT false,
    "consentimiento_datos" BOOLEAN NOT NULL,
    "codigo_referido" VARCHAR(30),
    "consultas_exentas" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "profesional_pkey" PRIMARY KEY ("profesional_id")
);

-- CreateTable
CREATE TABLE "servicio_profesional" (
    "servicio_id" SERIAL NOT NULL,
    "profesional_id" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "servicio_profesional_pkey" PRIMARY KEY ("servicio_id")
);

-- CreateTable
CREATE TABLE "disponibilidad" (
    "disponibilidad_id" SERIAL NOT NULL,
    "profesional_id" INTEGER NOT NULL,
    "dia_semana" "dia_semana" NOT NULL,
    "hora_inicio" TIME(0) NOT NULL,
    "hora_fin" TIME(0) NOT NULL,
    "duracion_consulta_min" SMALLINT NOT NULL DEFAULT 45,

    CONSTRAINT "disponibilidad_pkey" PRIMARY KEY ("disponibilidad_id")
);

-- CreateTable
CREATE TABLE "metodo_pago_consulta" (
    "metodo_pago_id" SERIAL NOT NULL,
    "profesional_id" INTEGER NOT NULL,
    "tipo" "tipo_metodo_pago" NOT NULL,
    "obra_social" VARCHAR(100),

    CONSTRAINT "metodo_pago_consulta_pkey" PRIMARY KEY ("metodo_pago_id")
);

-- CreateTable
CREATE TABLE "turno_profesional" (
    "turno_profesional_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "profesional_id" INTEGER NOT NULL,
    "metodo_pago_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_inicio" TIME(0) NOT NULL,
    "hora_fin" TIME(0) NOT NULL,
    "modalidad" "modalidad_consulta" NOT NULL,
    "estado" "estado_turno_profesional" NOT NULL DEFAULT 'SOLICITADO',
    "motivo" VARCHAR(255),
    "fecha_solicitud" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turno_profesional_pkey" PRIMARY KEY ("turno_profesional_id")
);

-- CreateTable
CREATE TABLE "comision" (
    "comision_id" SERIAL NOT NULL,
    "turno_profesional_id" INTEGER NOT NULL,
    "importe_declarado" DECIMAL(12,2) NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "importe_comision" DECIMAL(12,2) NOT NULL,
    "exenta" BOOLEAN NOT NULL DEFAULT false,
    "fecha_registro" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comision_pkey" PRIMARY KEY ("comision_id")
);

-- CreateTable
CREATE TABLE "evento_turno" (
    "evento_turno_id" SERIAL NOT NULL,
    "turno_profesional_id" INTEGER NOT NULL,
    "tipo" "tipo_evento_turno" NOT NULL,
    "realizado_por_id" INTEGER NOT NULL,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_turno_pkey" PRIMARY KEY ("evento_turno_id")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "notificacion_id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "evento_turno_id" INTEGER,
    "tipo" "tipo_notificacion" NOT NULL,
    "canal" "canal_notificacion" NOT NULL,
    "mensaje" TEXT NOT NULL,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("notificacion_id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "auditoria_id" SERIAL NOT NULL,
    "gimnasio_id" INTEGER,
    "usuario_id" INTEGER,
    "accion" VARCHAR(60) NOT NULL,
    "entidad" VARCHAR(60) NOT NULL,
    "entidad_id" INTEGER,
    "detalle" JSONB,
    "fecha" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("auditoria_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gimnasio_cuit_key" ON "gimnasio"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "suscripcion_saas_gimnasio_id_key" ON "suscripcion_saas"("gimnasio_id");

-- CreateIndex
CREATE INDEX "sede_gimnasio_id_idx" ON "sede"("gimnasio_id");

-- CreateIndex
CREATE UNIQUE INDEX "sede_gimnasio_id_nombre_key" ON "sede"("gimnasio_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "modulo_codigo_key" ON "modulo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "permiso_modulo_id_acceso_key" ON "permiso"("modulo_id", "acceso");

-- CreateIndex
CREATE UNIQUE INDEX "rol_gimnasio_id_nombre_key" ON "rol"("gimnasio_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "rol_rol_id_gimnasio_id_key" ON "rol"("rol_id", "gimnasio_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_administrativo_usuario_id_key" ON "personal_administrativo"("usuario_id");

-- CreateIndex
CREATE INDEX "personal_administrativo_gimnasio_id_idx" ON "personal_administrativo"("gimnasio_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_socio_gimnasio_id_tipo_key" ON "plan_socio"("gimnasio_id", "tipo");

-- CreateIndex
CREATE INDEX "actualizacion_precio_plan_socio_id_vigente_desde_idx" ON "actualizacion_precio"("plan_socio_id", "vigente_desde");

-- CreateIndex
CREATE UNIQUE INDEX "socio_usuario_id_key" ON "socio"("usuario_id");

-- CreateIndex
CREATE INDEX "socio_sede_id_idx" ON "socio"("sede_id");

-- CreateIndex
CREATE UNIQUE INDEX "codigo_qr_codigo_key" ON "codigo_qr"("codigo");

-- CreateIndex
CREATE INDEX "codigo_qr_socio_id_idx" ON "codigo_qr"("socio_id");

-- CreateIndex
CREATE INDEX "turno_clase_sede_id_fecha_idx" ON "turno_clase"("sede_id", "fecha");

-- CreateIndex
CREATE INDEX "reserva_socio_id_idx" ON "reserva"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_turno_clase_id_socio_id_key" ON "reserva"("turno_clase_id", "socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "asistencia_reserva_id_key" ON "asistencia"("reserva_id");

-- CreateIndex
CREATE INDEX "asistencia_fecha_hora_real_idx" ON "asistencia"("fecha_hora_real");

-- CreateIndex
CREATE UNIQUE INDEX "autorizacion_excepcional_asistencia_id_key" ON "autorizacion_excepcional"("asistencia_id");

-- CreateIndex
CREATE INDEX "rechazo_ingreso_socio_id_idx" ON "rechazo_ingreso"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "dia_constancia_asistencia_id_key" ON "dia_constancia"("asistencia_id");

-- CreateIndex
CREATE UNIQUE INDEX "dia_constancia_socio_id_fecha_key" ON "dia_constancia"("socio_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "preferencia_rutina_socio_id_key" ON "preferencia_rutina"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "ejercicio_nombre_key" ON "ejercicio"("nombre");

-- CreateIndex
CREATE INDEX "rutina_socio_id_idx" ON "rutina"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "ejercicio_rutina_rutina_id_dia_orden_key" ON "ejercicio_rutina"("rutina_id", "dia", "orden");

-- CreateIndex
CREATE INDEX "entrenamiento_rutina_id_idx" ON "entrenamiento"("rutina_id");

-- CreateIndex
CREATE INDEX "equipo_sede_id_idx" ON "equipo"("sede_id");

-- CreateIndex
CREATE INDEX "incidencia_equipo_id_idx" ON "incidencia"("equipo_id");

-- CreateIndex
CREATE INDEX "mantenimiento_equipo_id_idx" ON "mantenimiento"("equipo_id");

-- CreateIndex
CREATE INDEX "beneficio_gimnasio_id_idx" ON "beneficio"("gimnasio_id");

-- CreateIndex
CREATE INDEX "canje_socio_id_idx" ON "canje"("socio_id");

-- CreateIndex
CREATE INDEX "bonificacion_premium_socio_id_desde_hasta_idx" ON "bonificacion_premium"("socio_id", "desde", "hasta");

-- CreateIndex
CREATE INDEX "senal_abandono_socio_id_detectada_el_idx" ON "senal_abandono"("socio_id", "detectada_el");

-- CreateIndex
CREATE INDEX "propuesta_incentivo_socio_id_idx" ON "propuesta_incentivo"("socio_id");

-- CreateIndex
CREATE INDEX "estimacion_riesgo_socio_id_fecha_idx" ON "estimacion_riesgo"("socio_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "indicador_asistencia_sede_id_fecha_tipo_plan_key" ON "indicador_asistencia"("sede_id", "fecha", "tipo_plan");

-- CreateIndex
CREATE INDEX "cuota_estado_fecha_vencimiento_idx" ON "cuota"("estado", "fecha_vencimiento");

-- CreateIndex
CREATE UNIQUE INDEX "cuota_socio_id_periodo_key" ON "cuota"("socio_id", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "adhesion_debito_id_preaprobacion_key" ON "adhesion_debito"("id_preaprobacion");

-- CreateIndex
CREATE INDEX "adhesion_debito_socio_id_idx" ON "adhesion_debito"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "pago_referencia_externa_key" ON "pago"("referencia_externa");

-- CreateIndex
CREATE INDEX "pago_cuota_id_idx" ON "pago"("cuota_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_pago_id_key" ON "comprobante"("pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_numero_key" ON "comprobante"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "plan_marketplace_tipo_key" ON "plan_marketplace"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "profesional_usuario_id_key" ON "profesional"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "profesional_codigo_referido_key" ON "profesional"("codigo_referido");

-- CreateIndex
CREATE UNIQUE INDEX "metodo_pago_consulta_profesional_id_tipo_obra_social_key" ON "metodo_pago_consulta"("profesional_id", "tipo", "obra_social");

-- CreateIndex
CREATE UNIQUE INDEX "metodo_pago_consulta_metodo_pago_id_profesional_id_key" ON "metodo_pago_consulta"("metodo_pago_id", "profesional_id");

-- CreateIndex
CREATE INDEX "turno_profesional_profesional_id_fecha_idx" ON "turno_profesional"("profesional_id", "fecha");

-- CreateIndex
CREATE INDEX "turno_profesional_socio_id_idx" ON "turno_profesional"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "comision_turno_profesional_id_key" ON "comision"("turno_profesional_id");

-- CreateIndex
CREATE INDEX "evento_turno_turno_profesional_id_idx" ON "evento_turno"("turno_profesional_id");

-- CreateIndex
CREATE INDEX "notificacion_usuario_id_leida_idx" ON "notificacion"("usuario_id", "leida");

-- CreateIndex
CREATE INDEX "auditoria_gimnasio_id_fecha_idx" ON "auditoria"("gimnasio_id", "fecha");

-- AddForeignKey
ALTER TABLE "suscripcion_saas" ADD CONSTRAINT "suscripcion_saas_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sede" ADD CONSTRAINT "sede_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permiso" ADD CONSTRAINT "permiso_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "modulo"("modulo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol" ADD CONSTRAINT "rol_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permiso" ADD CONSTRAINT "rol_permiso_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "rol"("rol_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permiso" ADD CONSTRAINT "rol_permiso_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permiso"("permiso_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_administrativo" ADD CONSTRAINT "personal_administrativo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_administrativo" ADD CONSTRAINT "personal_administrativo_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_administrativo" ADD CONSTRAINT "personal_administrativo_rol_id_gimnasio_id_fkey" FOREIGN KEY ("rol_id", "gimnasio_id") REFERENCES "rol"("rol_id", "gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_socio" ADD CONSTRAINT "plan_socio_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actualizacion_precio" ADD CONSTRAINT "actualizacion_precio_plan_socio_id_fkey" FOREIGN KEY ("plan_socio_id") REFERENCES "plan_socio"("plan_socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actualizacion_precio" ADD CONSTRAINT "actualizacion_precio_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio" ADD CONSTRAINT "socio_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio" ADD CONSTRAINT "socio_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("sede_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio" ADD CONSTRAINT "socio_plan_socio_id_fkey" FOREIGN KEY ("plan_socio_id") REFERENCES "plan_socio"("plan_socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigo_qr" ADD CONSTRAINT "codigo_qr_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_clase" ADD CONSTRAINT "turno_clase_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("sede_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_turno_clase_id_fkey" FOREIGN KEY ("turno_clase_id") REFERENCES "turno_clase"("turno_clase_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("reserva_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_codigo_qr_id_fkey" FOREIGN KEY ("codigo_qr_id") REFERENCES "codigo_qr"("codigo_qr_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacion_excepcional" ADD CONSTRAINT "autorizacion_excepcional_asistencia_id_fkey" FOREIGN KEY ("asistencia_id") REFERENCES "asistencia"("asistencia_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacion_excepcional" ADD CONSTRAINT "autorizacion_excepcional_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rechazo_ingreso" ADD CONSTRAINT "rechazo_ingreso_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rechazo_ingreso" ADD CONSTRAINT "rechazo_ingreso_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dia_constancia" ADD CONSTRAINT "dia_constancia_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dia_constancia" ADD CONSTRAINT "dia_constancia_asistencia_id_fkey" FOREIGN KEY ("asistencia_id") REFERENCES "asistencia"("asistencia_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferencia_rutina" ADD CONSTRAINT "preferencia_rutina_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutina" ADD CONSTRAINT "rutina_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejercicio_rutina" ADD CONSTRAINT "ejercicio_rutina_rutina_id_fkey" FOREIGN KEY ("rutina_id") REFERENCES "rutina"("rutina_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejercicio_rutina" ADD CONSTRAINT "ejercicio_rutina_ejercicio_id_fkey" FOREIGN KEY ("ejercicio_id") REFERENCES "ejercicio"("ejercicio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrenamiento" ADD CONSTRAINT "entrenamiento_rutina_id_fkey" FOREIGN KEY ("rutina_id") REFERENCES "rutina"("rutina_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejercicio_equipo" ADD CONSTRAINT "ejercicio_equipo_ejercicio_id_fkey" FOREIGN KEY ("ejercicio_id") REFERENCES "ejercicio"("ejercicio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ejercicio_equipo" ADD CONSTRAINT "ejercicio_equipo_equipo_id_fkey" FOREIGN KEY ("equipo_id") REFERENCES "equipo"("equipo_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipo" ADD CONSTRAINT "equipo_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("sede_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencia" ADD CONSTRAINT "incidencia_equipo_id_fkey" FOREIGN KEY ("equipo_id") REFERENCES "equipo"("equipo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencia" ADD CONSTRAINT "incidencia_reportante_id_fkey" FOREIGN KEY ("reportante_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencia" ADD CONSTRAINT "incidencia_agrupada_en_id_fkey" FOREIGN KEY ("agrupada_en_id") REFERENCES "incidencia"("incidencia_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencia" ADD CONSTRAINT "incidencia_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivo_incidencia" ADD CONSTRAINT "archivo_incidencia_incidencia_id_fkey" FOREIGN KEY ("incidencia_id") REFERENCES "incidencia"("incidencia_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimiento" ADD CONSTRAINT "mantenimiento_equipo_id_fkey" FOREIGN KEY ("equipo_id") REFERENCES "equipo"("equipo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimiento" ADD CONSTRAINT "mantenimiento_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficio" ADD CONSTRAINT "beneficio_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canje" ADD CONSTRAINT "canje_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canje" ADD CONSTRAINT "canje_beneficio_id_fkey" FOREIGN KEY ("beneficio_id") REFERENCES "beneficio"("beneficio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacion_premium" ADD CONSTRAINT "bonificacion_premium_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificacion_premium" ADD CONSTRAINT "bonificacion_premium_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senal_abandono" ADD CONSTRAINT "senal_abandono_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propuesta_incentivo" ADD CONSTRAINT "propuesta_incentivo_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propuesta_incentivo" ADD CONSTRAINT "propuesta_incentivo_senal_id_fkey" FOREIGN KEY ("senal_id") REFERENCES "senal_abandono"("senal_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propuesta_incentivo" ADD CONSTRAINT "propuesta_incentivo_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimacion_riesgo" ADD CONSTRAINT "estimacion_riesgo_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_retencion" ADD CONSTRAINT "decision_retencion_estimacion_id_fkey" FOREIGN KEY ("estimacion_id") REFERENCES "estimacion_riesgo"("estimacion_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_retencion" ADD CONSTRAINT "decision_retencion_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicador_asistencia" ADD CONSTRAINT "indicador_asistencia_sede_id_fkey" FOREIGN KEY ("sede_id") REFERENCES "sede"("sede_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuota" ADD CONSTRAINT "cuota_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhesion_debito" ADD CONSTRAINT "adhesion_debito_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_cuota_id_fkey" FOREIGN KEY ("cuota_id") REFERENCES "cuota"("cuota_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_adhesion_id_fkey" FOREIGN KEY ("adhesion_id") REFERENCES "adhesion_debito"("adhesion_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "personal_administrativo"("personal_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago"("pago_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesional" ADD CONSTRAINT "profesional_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesional" ADD CONSTRAINT "profesional_plan_marketplace_id_fkey" FOREIGN KEY ("plan_marketplace_id") REFERENCES "plan_marketplace"("plan_marketplace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesional" ADD CONSTRAINT "profesional_referido_por_id_fkey" FOREIGN KEY ("referido_por_id") REFERENCES "profesional"("profesional_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_profesional" ADD CONSTRAINT "servicio_profesional_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("profesional_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidad" ADD CONSTRAINT "disponibilidad_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("profesional_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metodo_pago_consulta" ADD CONSTRAINT "metodo_pago_consulta_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("profesional_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_profesional" ADD CONSTRAINT "turno_profesional_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socio"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_profesional" ADD CONSTRAINT "turno_profesional_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "profesional"("profesional_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turno_profesional" ADD CONSTRAINT "turno_profesional_metodo_pago_id_profesional_id_fkey" FOREIGN KEY ("metodo_pago_id", "profesional_id") REFERENCES "metodo_pago_consulta"("metodo_pago_id", "profesional_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comision" ADD CONSTRAINT "comision_turno_profesional_id_fkey" FOREIGN KEY ("turno_profesional_id") REFERENCES "turno_profesional"("turno_profesional_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_turno" ADD CONSTRAINT "evento_turno_turno_profesional_id_fkey" FOREIGN KEY ("turno_profesional_id") REFERENCES "turno_profesional"("turno_profesional_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_turno" ADD CONSTRAINT "evento_turno_realizado_por_id_fkey" FOREIGN KEY ("realizado_por_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_evento_turno_id_fkey" FOREIGN KEY ("evento_turno_id") REFERENCES "evento_turno"("evento_turno_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_gimnasio_id_fkey" FOREIGN KEY ("gimnasio_id") REFERENCES "gimnasio"("gimnasio_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("usuario_id") ON DELETE SET NULL ON UPDATE CASCADE;

