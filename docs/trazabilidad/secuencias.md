# Trazabilidad: diagramas de secuencia (10.5.4) → código

Transcripción de los mensajes de cada diagrama de secuencia del TFI (Figuras 68 a 107)
para que el código use exactamente los mismos nombres. Formato: `Origen → Destino: mensaje`.

## Fig. 68 · CU-001-001 Consultar detalle de la cuota
- CuotasYPagos → CuotaController: GET /api/cuotas/actual
- CuotaController → CuotaService: obtenerDetalleCuota(socioId)
- CuotaService → CuotaRepository: buscarCuotaDelPeriodo(socioId) — SELECT cuota y adhesión
- Respuesta: 200 { detalle }

## Fig. 69 · CU-001-002 Seleccionar medio de pago
- CuotasYPagos → CuotaController: GET /api/cuotas/{id}/medios
- CuotaController → CuotaService: obtenerImportesPorMedio(cuotaId)
- CuotaService → CuotaRepository: obtenerPreciosVigentes(plan) — SELECT cuota base y adicional
- CuotaService: calcular el importe de cada medio
- Respuesta: 200 { medios e importes }

## Fig. 70 · CU-001-003 Pagar con pago único
- CuotasYPagos → CuotaController: POST /api/operaciones { pago único }
- CuotaController → CuotaService: iniciarOperacion(cuotaId, pago único)
- CuotaService → Mercado Pago: crear operación (importe)
- Respuesta: 201 { enlace de pago }

## Fig. 71 · CU-001-004 Adherirse al débito automático
- CuotasYPagos → CuotaController: GET /api/adhesiones/condiciones
- CuotaController → CuotaService: calcularDescuento(socioId)
- CuotaService → CuotaRepository: obtenerPreciosVigentes(plan)
- CuotaService: calcular 10 % sobre el total del plan → 200 { importes }
- CuotasYPagos → CuotaController: POST /api/operaciones { débito automático }
- CuotaController → CuotaService: iniciarOperacion(cuotaId, débito) → Mercado Pago: crear autorización de débito → 201 { enlace }
- Mercado Pago → CuotaController: POST /api/webhooks/mp { autorizada }
- CuotaController → CuotaService: registrarResultado(autorización)
- CuotaService → CuotaRepository: guardarAdhesion(activa) — INSERT adhesión

## Fig. 72 · CU-001-005 Aplicar descuento por débito automático
- CuotasYPagos → CuotaController: GET /api/adhesiones/condiciones
- CuotaController → CuotaService: calcularDescuento(socioId)
- CuotaService → CuotaRepository: obtenerPreciosVigentes(plan)
- Respuesta: 200 { importes } (base, adicional, descuento e importe mensual)

## Fig. 73 · CU-001-006 Procesar pago en Mercado Pago
- CuotasYPagos → CuotaController: POST /api/operaciones { medio }
- CuotaController → CuotaService: iniciarOperacion(cuotaId, medio) → Mercado Pago: crear operación (importe) → 201 { enlace de pago }
- Mercado Pago → CuotaController: POST /api/webhooks/mp { resultado }
- CuotaController → CuotaService: registrarResultado(operación)
- CuotaService → CuotaRepository: guardarResultado(operación) — INSERT resultado

## Fig. 74 · CU-001-007 Enviar comprobante por WhatsApp
- Mercado Pago → CuotaController: POST /api/webhooks/mp { pago aprobado }
- CuotaController → CuotaService: registrarResultado(operación aprobada)
- CuotaService → CuotaRepository: actualizarCuota(cuotaId, pagada) — UPDATE cuota
- CuotaService: generar comprobante (período, plan, importes, medio, fecha y referencia)
- CuotaService → CuotaRepository: guardarComprobante(comprobante) — INSERT comprobante
- CuotaService → Servicio de mensajería: enviar comprobante por WhatsApp (si falla: cuota pagada y comprobante en el historial)

## Fig. 75 · CU-001-008 Consultar historial de pagos
- CuotasYPagos → CuotaController: GET /api/pagos?filtros
- CuotaController → CuotaService: listarPagos(socioId, filtros)
- CuotaService → CuotaRepository: buscarPagos(socioId, filtros)
- Respuesta: 200 [ pagos ]

## Fig. 76 · CU-001-009 Consultar comprobante
- CuotasYPagos → CuotaController: GET /api/pagos/{id}/comprobante
- CuotaController → CuotaService: obtenerComprobante(pagoId)
- CuotaService → CuotaRepository: buscarComprobante(pagoId)
- Respuesta: 200 { comprobante }

## Fig. 77 · CU-001-010 Cancelar débito automático
- CuotasYPagos → CuotaController: DELETE /api/adhesiones/{id}
- CuotaController → CuotaService: cancelarAdhesion(adhesionId) → Mercado Pago: solicitar la baja
- CuotaService → CuotaRepository: actualizarAdhesion(cancelada) — UPDATE adhesión
- Respuesta: 200 { cancelada } · si Mercado Pago no confirma: 502 { error }

## Fig. 78 · CU-002-001 Consultar dashboards de constancia
- ConstanciaYRegreso → RetencionController: GET /api/indicadores
- RetencionController → RetencionService: obtenerIndicadores(gimnasioId)
- RetencionService → RetencionRepository: buscarIndicadores(gimnasioId) — SELECT asistencias confirmadas
- Respuesta: 200 { indicadores, suscripción }

## Fig. 79 · CU-002-002 Filtrar indicadores
- ConstanciaYRegreso → RetencionController: GET /api/indicadores?filtros
- RetencionController → RetencionService: obtenerIndicadores(filtros)
- RetencionService → RetencionRepository: buscarIndicadores(filtros)
- Respuesta: 200 { indicadores }

## Fig. 80 · CU-002-003 Revisar señales de posible abandono
- ConstanciaYRegreso → RetencionController: GET /api/senales
- RetencionController → RetencionService: obtenerSenales(gimnasioId)
- RetencionService → RetencionRepository: buscarSociosConSenal(gimnasioId)
- Respuesta: 200 [ socios ]
- ConstanciaYRegreso → RetencionController: GET /api/socios/{id}/asistencia
- RetencionController → RetencionService: obtenerAsistenciaReciente(socioId)
- RetencionService → RetencionRepository: buscarAsistencias(socioId)
- Respuesta: 200 { asistencia }

## Fig. 81 · CU-002-004 Definir incentivo de regreso
- ConstanciaYRegreso → RetencionController: POST /api/propuestas
- RetencionController → RetencionService: registrarPropuesta(datos)
- RetencionService → RetencionRepository: guardarPropuesta(preparada) — INSERT propuesta
- Respuesta: 201 { propuesta }
- (opt, aprobación: igual que la Fig. 82)

## Fig. 82 · CU-002-005 Notificar incentivo al socio
- ConstanciaYRegreso → RetencionController: POST /api/propuestas/{id}/aprobacion
- RetencionController → RetencionService: aprobarPropuesta(id, responsable)
- RetencionService → RetencionRepository: actualizarPropuesta(aprobada) — UPDATE propuesta
- RetencionService: generar notificación "Un incentivo para tu regreso"
- RetencionService → RetencionRepository: registrarNotificacion(socio, incentivo) — INSERT notificación
- Respuesta: 200 { comunicado }

## Fig. 83 · CU-002-006 Consultar analítica de NeuroGym Intelligence
- NeuroGymIntelligence → IntelligenceController: GET /api/analitica?sede&periodo
- IntelligenceController → AnaliticaService: obtenerAnalitica(sede, período)
- AnaliticaService → AnaliticaRepository: buscarHistorial(sede, período) — SELECT historial de asistencias
- AnaliticaService: calcular evolución, tendencias, comparación, riesgo y acción recomendada
- Respuesta: 200 { analítica } · 200 { sin historial }

## Fig. 84 · CU-002-007 Consultar estimación orientativa del riesgo
- NeuroGymIntelligence → IntelligenceController: GET /api/analitica/socios/{id}
- IntelligenceController → AnaliticaService: analizarSocio(socioId)
- AnaliticaService → AnaliticaRepository: buscarAsistencias(socioId)
- Respuesta: 200 { análisis } · 200 { sin historial }

## Fig. 85 · CU-002-008 Consultar recomendaciones de retención
- NeuroGymIntelligence → IntelligenceController: GET /api/analitica?sede&periodo
- IntelligenceController → AnaliticaService: obtenerAnalitica(sede, período)
- AnaliticaService → AnaliticaRepository: buscarHistorial(sede, período)
- NeuroGymIntelligence → IntelligenceController: POST /api/propuestas
- IntelligenceController → AnaliticaService: registrarPropuesta(datos)
- AnaliticaService → AnaliticaRepository: guardarPropuesta(borrador) — INSERT propuesta → 201 { propuesta }
- NeuroGymIntelligence → IntelligenceController: POST /api/decisiones
- IntelligenceController → AnaliticaService: registrarDecision(motivo, responsable)
- AnaliticaService → AnaliticaRepository: guardarDecision(observación, fecha) — INSERT decisión → 201 { decisión }

## Fig. 86 · CU-002-009 Exportar reporte avanzado
- NeuroGymIntelligence → IntelligenceController: GET /api/analitica/reporte
- IntelligenceController → AnaliticaService: generarReporte(sede, período)
- AnaliticaService → AnaliticaRepository: buscarAnalitica(sede, período) — SELECT datos del reporte
- AnaliticaService: generar archivo .xlsx → 200 (archivo .xlsx)

## Fig. 87 · CU-002-010 Bonificar Plan Premium
- ConstanciaYRegreso → RetencionController: POST /api/propuestas
- RetencionController → RetencionService: registrarPropuesta(datos)
- RetencionService → RetencionRepository: guardarPropuesta(pendiente) — INSERT propuesta → 201 { propuesta }
- ConstanciaYRegreso → RetencionController: POST /api/propuestas/{id}/aprobacion
- RetencionController → RetencionService: aprobarBonificacion(id, responsable)
- RetencionService → RetencionRepository: registrarBonificacion(período) — UPDATE propuesta y plan del socio
- RetencionService → RetencionRepository: registrarNotificacion(socio, bonificación) — INSERT notificación
- Respuesta: 200 { aprobada }

## Fig. 88 · CU-003 Generar rutina personalizada con IA
- MiRutina → RutinaController: PUT /api/socios/preferencias
- RutinaController → RutinaService: registrarPreferencias(datos)
- RutinaService → RutinaRepository: guardarPreferencias(datos) — UPDATE preferencias del socio → 200 { preferencias }
- MiRutina → RutinaController: POST /api/rutinas
- RutinaController → RutinaService: generarRutina(preferencias) → Servicio de IA: solicitar rutina
- RutinaService → RutinaRepository: asignarRutina(ejercicios) — INSERT rutina (reemplaza la anterior)
- Respuesta: 201 { rutina } · 502 { error } (se conserva la rutina vigente)

## Fig. 89 · CU-003-001 Indicar objetivo y preferencias
- MiRutina → RutinaController: PUT /api/socios/preferencias
- RutinaController → RutinaService: registrarPreferencias(datos)
- RutinaService → RutinaRepository: guardarPreferencias(datos) — UPDATE preferencias del socio → 200 { preferencias }

## Fig. 90 · CU-003-002 Consultar rutina asignada
- MiRutina → RutinaController: GET /api/rutinas/actual
- RutinaController → RutinaService: obtenerRutina(socioId)
- RutinaService → RutinaRepository: buscarRutinaVigente(socioId) — SELECT rutina y ejercicios → 200 { rutina } · 404 { sin rutina }
- MiRutina → RutinaController: GET /api/equipos/disponibilidad
- RutinaController → RutinaService: obtenerDisponibilidad(equipos, sede)
- RutinaService → EquipamientoRepository: buscarDisponibilidad(equipos, sede) — SELECT estado y mantenimientos → 200 { disponibilidad }

## Fig. 91 · CU-003-003 Editar rutina
- MiRutina → RutinaController: PUT /api/ejercicios/{id}
- RutinaController → RutinaService: actualizarEjercicio(ejercicio) (valida nombre, series, repeticiones y peso)
- RutinaService → RutinaRepository: guardarRutina(rutina) — UPDATE ejercicio → 200 { rutina } · 422 { error }

## Fig. 92 · CU-003-004 Modificar ejercicios
- Solo frontera: MiRutina valida que el nombre no esté vacío (sin llamadas al backend).

## Fig. 93 · CU-003-005 Ajustar pesos y repeticiones
- Solo frontera: MiRutina valida los rangos admitidos (sin llamadas al backend).

## Fig. 94 · CU-003-006 Consultar disponibilidad del equipamiento
- MiRutina → RutinaController: GET /api/equipos/disponibilidad
- RutinaController → RutinaService: obtenerDisponibilidad(equipos, sede)
- RutinaService → EquipamientoRepository: buscarDisponibilidad(equipos, sede) → 200 { disponibilidad }

## Fig. 95 · CU-003-007 Consultar variante sugerida
- MiRutina → RutinaController: GET /api/ejercicios/{id}/variante
- RutinaController → RutinaService: sugerirVariante(ejercicioId) → Servicio de IA: solicitar variante → 200 { variante } · 200 { sin variante }
- MiRutina → RutinaController: GET /api/equipos/disponibilidad → obtenerDisponibilidad(equipo, sede) → EquipamientoRepository.buscarDisponibilidad(equipo, sede)

## Fig. 96 · CU-003-008 Aplicar variante de ejercicio
- MiRutina → RutinaController: PUT /api/ejercicios/{id} { variante }
- RutinaController → RutinaService: aplicarVariante(ejercicio, variante)
- RutinaService → RutinaRepository: reemplazarEjercicio(variante) — UPDATE ejercicio de la rutina → 200 { rutina }

## Fig. 97 · CU-003-009 Registrar entrenamiento realizado
- MiRutina → RutinaController: GET /api/rutinas/actual → obtenerRutina(socioId) → RutinaRepository.buscarRutinaVigente(socioId)
- MiRutina → RutinaController: GET /api/equipos/disponibilidad → obtenerDisponibilidad(equipos, sede) → EquipamientoRepository.buscarDisponibilidad(equipos, sede)
- MiRutina → RutinaController: POST /api/entrenamientos
- RutinaController → RutinaService: registrarEntrenamiento(ejercicios)
- RutinaService → RutinaRepository: guardarEntrenamiento(fecha, cantidad) — INSERT entrenamiento → 201 { entrenamiento }

## Fig. 98 · CU-004-001 Escanear QR personal
- Solo fronteras: MiQRDeIngreso muestra/actualiza el código; RecepcionQR activa la cámara y lee el código (o se ingresa a mano).

## Fig. 99 · CU-004-002 Validar QR en el servidor
- RecepcionQR → AsistenciaController: POST /api/qr/validacion
- AsistenciaController → AsistenciaService: validarCodigo(código)
- AsistenciaService → SocioRepository: buscarQrEmitido(código) — SELECT código QR y socio
- AsistenciaService: verificar vigencia, socio y gimnasio → 200 { socio }
- Inválido: AsistenciaService → AsistenciaRepository: registrarRechazo(QR inválido) — INSERT rechazo → 422 { QR vencido o inválido }

## Fig. 100 · CU-004-003 Verificar reserva vigente
- RecepcionQR → AsistenciaController: GET /api/reservas/vigente
- AsistenciaController → AsistenciaService: verificarReserva(socio, sede)
- AsistenciaService → AsistenciaRepository: buscarReservas(socio, fecha) — SELECT reservas RESERVADO del día
- AsistenciaService: verificar sede, horario y asistencia previa → 200 { turno } · 422 { motivo }

## Fig. 101 · CU-004-004 Verificar estado de la cuota
- RecepcionQR → AsistenciaController: GET /api/cuotas/{socioId}/estado
- AsistenciaController → AsistenciaService: verificarCuota(socioId, período)
- AsistenciaService → SocioRepository: consultarCuota(socio, período) — SELECT cuota del período → 200 { estado }

## Fig. 102 · CU-004-005 Advertir cuota impaga
- Solo frontera: RecepcionQR muestra "Cuota pendiente" y el personal elige autorizar o bloquear.

## Fig. 103 · CU-004-006 Autorizar ingreso excepcional
- RecepcionQR → AsistenciaController: POST /api/autorizaciones { motivo }
- AsistenciaController → AsistenciaService: autorizarIngreso(motivo, responsable)
- AsistenciaService → AsistenciaRepository: registrarAutorizacion(datos) — INSERT autorización → 201 { autorización }
- RecepcionQR → AsistenciaController: POST /api/asistencias
- AsistenciaController → AsistenciaService: confirmarAsistencia(reserva, autorizada)
- AsistenciaService → AsistenciaRepository: registrarAsistencia(fechaHora, forma) — INSERT asistencia → 201 { asistencia }

## Fig. 104 · CU-004-007 Bloquear ingreso
- RecepcionQR → AsistenciaController: POST /api/rechazos { reservaId }
- AsistenciaController → AsistenciaService: bloquearIngreso(responsable)
- AsistenciaService → AsistenciaRepository: registrarRechazo(cuota pendiente) — INSERT rechazo → 200 { bloqueado }

## Fig. 105 · CU-004-008 Confirmar asistencia
- RecepcionQR → AsistenciaController: POST /api/asistencias
- AsistenciaController → AsistenciaService: confirmarAsistencia(reserva, forma)
- AsistenciaService → AsistenciaRepository: registrarAsistencia(fechaHora, forma) — INSERT asistencia
- opt primera asistencia del día: AsistenciaService → SocioRepository: registrarDiaConstancia(fecha); sumarPuntos(socio)
- Respuesta: 201 { asistencia }

## Fig. 106 · CU-004-009 Acumular día de constancia
- RecepcionQR → AsistenciaController: POST /api/asistencias
- AsistenciaController → AsistenciaService: confirmarAsistencia(reserva, forma) (verifica que sea la primera asistencia confirmada del día)
- AsistenciaService → SocioRepository: registrarDiaConstancia(fecha) — INSERT día de constancia
- AsistenciaService → SocioRepository: sumarPuntos(socio) — UPDATE saldo de puntos → 201 { asistencia }

## Fig. 107 · CU-004-010 Registrar asistencia manual
- RecepcionQR → AsistenciaController: POST /api/asistencias/manual
- AsistenciaController → AsistenciaService: registrarManual(datos, responsable)
- AsistenciaService → AsistenciaRepository: buscarReserva(socio, fecha) — SELECT reserva y asistencias
- AsistenciaService → SocioRepository: consultarCuota(socio, período)
- AsistenciaService → AsistenciaRepository: registrarAsistencia(manual, motivo) → 201 { asistencia } · 422 { motivo } · 200 { cuota pendiente }
- Con autorización: POST /api/asistencias/manual { autorización } → registrarManual(datos, autorización) → registrarAsistencia(manual, autorización)
