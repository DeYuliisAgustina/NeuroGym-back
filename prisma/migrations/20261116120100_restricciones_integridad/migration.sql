-- =====================================================================
-- NeuroGym — Restricciones de integridad complementarias
-- Prisma no expresa CHECK, índices parciales ni disparadores; se
-- versionan en esta migración para que se apliquen con `prisma migrate`.
-- Fuente: diccionario de datos del TFI (apartado 10.5.8) y RD7–RD23.
-- =====================================================================

-- ---------- Seguridad y multiempresa ----------
ALTER TABLE gimnasio
  ADD CONSTRAINT ck_gimnasio_tolerancias CHECK (tolerancia_antes_min >= 0 AND tolerancia_despues_min >= 0);

ALTER TABLE suscripcion_saas
  ADD CONSTRAINT ck_suscripcion_limites CHECK (max_sedes > 0 AND max_socios_activos > 0);

ALTER TABLE plan_socio
  ADD CONSTRAINT ck_plan_socio_importe CHECK (importe_mensual >= 0);

ALTER TABLE actualizacion_precio
  ADD CONSTRAINT ck_actualizacion_importe CHECK (importe_nuevo >= 0);

-- ---------- Socios ----------
ALTER TABLE socio
  ADD CONSTRAINT ck_socio_consentimiento CHECK (consentimiento_datos = TRUE),
  ADD CONSTRAINT ck_socio_saldo CHECK (saldo_puntos >= 0);

ALTER TABLE codigo_qr
  ADD CONSTRAINT ck_codigo_qr_vigencia CHECK (expira_en > emitido_en);

-- El plan del socio debe pertenecer al mismo gimnasio que su sede (RNF4).
CREATE OR REPLACE FUNCTION fn_socio_plan_mismo_gimnasio() RETURNS trigger AS $$
BEGIN
  IF (SELECT gimnasio_id FROM sede WHERE sede_id = NEW.sede_id)
     <> (SELECT gimnasio_id FROM plan_socio WHERE plan_socio_id = NEW.plan_socio_id) THEN
    RAISE EXCEPTION 'El plan del socio no pertenece al gimnasio de su sede' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_socio_plan_mismo_gimnasio
  BEFORE INSERT OR UPDATE OF sede_id, plan_socio_id ON socio
  FOR EACH ROW EXECUTE FUNCTION fn_socio_plan_mismo_gimnasio();

-- ---------- Turnos y asistencia ----------
ALTER TABLE turno_clase
  ADD CONSTRAINT ck_turno_clase_horario CHECK (hora_fin > hora_inicio),
  ADD CONSTRAINT ck_turno_clase_cupo CHECK (cupo > 0);

-- RD23 y control de cupos: bloquea la fila del turno y verifica que las
-- reservas activas no superen el cupo, incluso con solicitudes concurrentes.
CREATE OR REPLACE FUNCTION fn_reserva_controlar_cupo() RETURNS trigger AS $$
DECLARE
  v_cupo SMALLINT;
  v_reservadas INTEGER;
BEGIN
  IF NEW.estado = 'RESERVADO' AND (TG_OP = 'INSERT' OR OLD.estado <> 'RESERVADO') THEN
    SELECT cupo INTO v_cupo FROM turno_clase WHERE turno_clase_id = NEW.turno_clase_id FOR UPDATE;
    SELECT COUNT(*) INTO v_reservadas FROM reserva
      WHERE turno_clase_id = NEW.turno_clase_id AND estado = 'RESERVADO' AND reserva_id <> NEW.reserva_id;
    IF v_reservadas >= v_cupo THEN
      RAISE EXCEPTION 'No hay cupos disponibles para el turno %', NEW.turno_clase_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_reserva_controlar_cupo
  BEFORE INSERT OR UPDATE OF estado ON reserva
  FOR EACH ROW EXECUTE FUNCTION fn_reserva_controlar_cupo();

-- RD23: el cupo no puede ser menor que las reservas registradas, y la fecha
-- y el horario de un turno con reservas no se modifican.
CREATE OR REPLACE FUNCTION fn_turno_clase_proteger_reservas() RETURNS trigger AS $$
DECLARE
  v_reservadas INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_reservadas FROM reserva
    WHERE turno_clase_id = NEW.turno_clase_id AND estado = 'RESERVADO';
  IF NEW.cupo < v_reservadas THEN
    RAISE EXCEPTION 'El cupo no puede ser menor que las reservas registradas (%)', v_reservadas USING ERRCODE = '23514';
  END IF;
  IF v_reservadas > 0 AND (NEW.fecha <> OLD.fecha OR NEW.hora_inicio <> OLD.hora_inicio
                           OR NEW.hora_fin <> OLD.hora_fin OR NEW.sede_id <> OLD.sede_id) THEN
    RAISE EXCEPTION 'No se puede modificar la fecha, el horario ni la sede de un turno con reservas' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_turno_clase_proteger_reservas
  BEFORE UPDATE ON turno_clase
  FOR EACH ROW EXECUTE FUNCTION fn_turno_clase_proteger_reservas();

-- RD18: la cancelación registra su fecha; una reserva activa no la tiene.
ALTER TABLE reserva
  ADD CONSTRAINT ck_reserva_cancelacion CHECK (
    (estado = 'CANCELADO' AND fecha_cancelacion IS NOT NULL) OR
    (estado = 'RESERVADO' AND fecha_cancelacion IS NULL));

-- RD7 y RF18: QR exige código; el registro manual exige motivo y responsable.
ALTER TABLE asistencia
  ADD CONSTRAINT ck_asistencia_forma CHECK (
    (forma = 'QR' AND codigo_qr_id IS NOT NULL) OR
    (forma = 'MANUAL' AND motivo IS NOT NULL AND responsable_id IS NOT NULL));

ALTER TABLE dia_constancia
  ADD CONSTRAINT ck_dia_constancia_puntos CHECK (puntos > 0);

-- ---------- Entrenamiento ----------
ALTER TABLE preferencia_rutina
  ADD CONSTRAINT ck_preferencia_dias CHECK (dias_por_semana BETWEEN 1 AND 7);

-- Una sola rutina vigente por socio.
CREATE UNIQUE INDEX ux_rutina_vigente_por_socio ON rutina (socio_id) WHERE vigente;

ALTER TABLE ejercicio_rutina
  ADD CONSTRAINT ck_ejercicio_rutina_dia CHECK (dia BETWEEN 1 AND 7),
  ADD CONSTRAINT ck_ejercicio_rutina_series CHECK (series > 0),
  ADD CONSTRAINT ck_ejercicio_rutina_repeticiones CHECK (repeticiones > 0),
  ADD CONSTRAINT ck_ejercicio_rutina_peso CHECK (peso_kg IS NULL OR peso_kg >= 0),
  ADD CONSTRAINT ck_ejercicio_rutina_descanso CHECK (descanso_seg IS NULL OR descanso_seg >= 0);

ALTER TABLE entrenamiento
  ADD CONSTRAINT ck_entrenamiento_totales CHECK (ejercicios_totales > 0),
  ADD CONSTRAINT ck_entrenamiento_completados CHECK (ejercicios_completados >= 0 AND ejercicios_completados <= ejercicios_totales);

-- ---------- Equipamiento ----------
-- RD22: solo un equipo dado de baja tiene fecha de baja (y viceversa).
ALTER TABLE equipo
  ADD CONSTRAINT ck_equipo_baja CHECK ((estado = 'DADO_DE_BAJA') = (fecha_baja IS NOT NULL)),
  ADD CONSTRAINT ck_equipo_vida_util CHECK (vida_util_anios IS NULL OR vida_util_anios > 0);

ALTER TABLE incidencia
  ADD CONSTRAINT ck_incidencia_agrupada CHECK (agrupada_en_id IS NULL OR agrupada_en_id <> incidencia_id);

ALTER TABLE mantenimiento
  ADD CONSTRAINT ck_mantenimiento_periodo CHECK (fin_programado > inicio_programado),
  ADD CONSTRAINT ck_mantenimiento_realizado CHECK (estado <> 'REALIZADO' OR fecha_realizada IS NOT NULL);

-- ---------- Retención y analítica ----------
ALTER TABLE beneficio
  ADD CONSTRAINT ck_beneficio_costo CHECK (costo_puntos > 0),
  ADD CONSTRAINT ck_beneficio_vigencia CHECK (vigencia_dias > 0);

ALTER TABLE canje
  ADD CONSTRAINT ck_canje_puntos CHECK (puntos_utilizados > 0);

-- El beneficio canjeado debe ser del mismo gimnasio que el socio (RNF4).
CREATE OR REPLACE FUNCTION fn_canje_mismo_gimnasio() RETURNS trigger AS $$
BEGIN
  IF (SELECT s.gimnasio_id FROM socio so JOIN sede s ON s.sede_id = so.sede_id WHERE so.socio_id = NEW.socio_id)
     <> (SELECT gimnasio_id FROM beneficio WHERE beneficio_id = NEW.beneficio_id) THEN
    RAISE EXCEPTION 'El beneficio no pertenece al gimnasio del socio' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_canje_mismo_gimnasio
  BEFORE INSERT ON canje
  FOR EACH ROW EXECUTE FUNCTION fn_canje_mismo_gimnasio();

ALTER TABLE bonificacion_premium
  ADD CONSTRAINT ck_bonificacion_periodo CHECK (hasta >= desde),
  ADD CONSTRAINT ck_bonificacion_porcentaje CHECK (porcentaje > 0 AND porcentaje <= 100);

ALTER TABLE propuesta_incentivo
  ADD CONSTRAINT ck_propuesta_aprobacion CHECK ((estado = 'APROBADA') = (fecha_aprobacion IS NOT NULL)),
  ADD CONSTRAINT ck_propuesta_premium CHECK (
    (premium_dias IS NULL AND premium_porcentaje IS NULL) OR
    (premium_dias > 0 AND premium_porcentaje > 0 AND premium_porcentaje <= 100));

ALTER TABLE indicador_asistencia
  ADD CONSTRAINT ck_indicador_valores CHECK (asistencias >= 0 AND socios_con_asistencia >= 0);

-- ---------- Cuotas y pagos ----------
ALTER TABLE cuota
  ADD CONSTRAINT ck_cuota_periodo CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT ck_cuota_importes CHECK (cuota_base >= 0 AND adicional_premium >= 0 AND descuento >= 0),
  ADD CONSTRAINT ck_cuota_importe_final CHECK (importe_final = cuota_base + adicional_premium - descuento);

-- Una sola adhesión ACTIVA por socio.
CREATE UNIQUE INDEX ux_adhesion_activa_por_socio ON adhesion_debito (socio_id) WHERE estado = 'ACTIVA';

ALTER TABLE adhesion_debito
  ADD CONSTRAINT ck_adhesion_baja CHECK ((estado = 'CANCELADA') = (fecha_baja IS NOT NULL));

ALTER TABLE pago
  ADD CONSTRAINT ck_pago_importe CHECK (importe > 0),
  ADD CONSTRAINT ck_pago_debito CHECK (medio <> 'DEBITO_AUTOMATICO' OR adhesion_id IS NOT NULL),
  ADD CONSTRAINT ck_pago_efectivo CHECK (medio <> 'EFECTIVO' OR responsable_id IS NOT NULL);

-- Una cuota admite como máximo un pago aprobado (evita cobros duplicados).
CREATE UNIQUE INDEX ux_pago_aprobado_por_cuota ON pago (cuota_id) WHERE estado = 'APROBADO';

-- ---------- Marketplace ----------
ALTER TABLE plan_marketplace
  ADD CONSTRAINT ck_plan_marketplace_precio CHECK (precio_mensual_usd >= 0),
  ADD CONSTRAINT ck_plan_marketplace_comision CHECK (porcentaje_comision BETWEEN 0 AND 100);

ALTER TABLE profesional
  ADD CONSTRAINT ck_profesional_valor CHECK (valor_consulta >= 0),
  ADD CONSTRAINT ck_profesional_consentimiento CHECK (consentimiento_datos = TRUE),
  ADD CONSTRAINT ck_profesional_referido CHECK (referido_por_id IS NULL OR referido_por_id <> profesional_id),
  ADD CONSTRAINT ck_profesional_exentas CHECK (consultas_exentas >= 0);

ALTER TABLE disponibilidad
  ADD CONSTRAINT ck_disponibilidad_horario CHECK (hora_fin > hora_inicio),
  ADD CONSTRAINT ck_disponibilidad_duracion CHECK (duracion_consulta_min > 0);

ALTER TABLE metodo_pago_consulta
  ADD CONSTRAINT ck_metodo_obra_social CHECK (tipo <> 'OBRA_SOCIAL' OR obra_social IS NOT NULL);

ALTER TABLE turno_profesional
  ADD CONSTRAINT ck_turno_profesional_horario CHECK (hora_fin > hora_inicio),
  ADD CONSTRAINT ck_turno_profesional_motivo CHECK (estado NOT IN ('RECHAZADO', 'CANCELADO') OR motivo IS NOT NULL);

ALTER TABLE comision
  ADD CONSTRAINT ck_comision_importes CHECK (importe_declarado > 0 AND importe_comision >= 0),
  ADD CONSTRAINT ck_comision_porcentaje CHECK (porcentaje BETWEEN 0 AND 100);

-- UNIQUE (profesional_id, tipo, obra_social) no impide duplicar PARTICULAR o
-- ACUERDO_CONSULTA porque NULL se considera distinto: se completa con este índice.
CREATE UNIQUE INDEX ux_metodo_pago_sin_obra_social ON metodo_pago_consulta (profesional_id, tipo) WHERE obra_social IS NULL;
