/**
 * Genera eventos de calendario para consultas confirmadas (RF43): archivo .ics
 * (iCalendar, RFC 5545) y enlace de Google Calendar. No sincroniza calendarios
 * externos: el usuario decide guardar el evento.
 */
export interface DatosEventoCalendario {
  turnoId: number;
  fecha: string; // AAAA-MM-DD
  horaInicio: string; // HH:MM (hora de Argentina)
  horaFin: string;
  titulo: string;
  descripcion: string;
  ubicacion: string;
}

const ZONA = 'America/Argentina/Buenos_Aires';
const compacta = (fecha: string, hora: string) => `${fecha.replace(/-/g, '')}T${hora.replace(':', '')}00`;
const escapar = (texto: string) => texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export const GeneradorEventoCalendario = {
  generarIcs(e: DatosEventoCalendario): string {
    const ahora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NeuroGym//Marketplace//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:turno-profesional-${e.turnoId}@neurogym`,
      `DTSTAMP:${ahora}`,
      `DTSTART;TZID=${ZONA}:${compacta(e.fecha, e.horaInicio)}`,
      `DTEND;TZID=${ZONA}:${compacta(e.fecha, e.horaFin)}`,
      `SUMMARY:${escapar(e.titulo)}`,
      `DESCRIPTION:${escapar(e.descripcion)}`,
      `LOCATION:${escapar(e.ubicacion)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  },

  generarEnlace(e: DatosEventoCalendario): string {
    const parametros = new URLSearchParams({
      action: 'TEMPLATE',
      text: e.titulo,
      dates: `${compacta(e.fecha, e.horaInicio)}/${compacta(e.fecha, e.horaFin)}`,
      ctz: ZONA,
      details: e.descripcion,
      location: e.ubicacion,
    });
    return `https://calendar.google.com/calendar/render?${parametros.toString()}`;
  },
};
