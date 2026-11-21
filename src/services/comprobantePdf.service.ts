import path from 'node:path';
import PDFDocument from 'pdfkit';
import { cuotaRepository } from '../repositories/cuota.repository';
import { aNumero } from '../utils/dinero';

/**
 * Comprobante del gimnasio en PDF (CU-001-007, CU-001-009). Reproduce la tarjeta
 * «Comprobante del gimnasio» de NeuroGym (logo, «Pago registrado», período, socio,
 * plan, importe, desglose, medio, fecha y referencia) con los importes conservados
 * al momento del pago (RD12), sin botones ni datos de seguimiento.
 */

// Mismos formatos que la interfaz (NeuroGym-front/src/utils/formato.ts).
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const dinero = (n: number) => pesos.format(n);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesAnio = (periodo: string) => {
  const [anio, mes] = periodo.split('-').map(Number);
  const nombre = MESES[mes - 1];
  return nombre ? `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}` : periodo;
};
function fechaLarga(fecha: Date) {
  const partes = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).formatToParts(fecha);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${v('day')} de ${v('month')} de ${v('year')}`;
}
const MEDIO: Record<string, string> = { PAGO_UNICO: 'Mercado Pago', DEBITO_AUTOMATICO: 'Débito automático', EFECTIVO: 'Efectivo' };
const conSede = (nombre: string) => (/^sede\b/i.test(nombre) ? nombre : `Sede ${nombre}`);

// Colores de la hoja de estilos de la interfaz.
const COLOR = { tinta: '#07130e', apagado: '#657069', etiqueta: '#8b9781', borde: '#dde3dc', bordeRecibo: '#c6d6b5', fondoRecibo: '#fbfcf8', insignia: '#bfffd9', insigniaTexto: '#4c7440', descuento: '#245d38', nota: '#9cae8d' };
const FUENTES = path.resolve(process.cwd(), 'node_modules/@fontsource/inter/files');
const LOGO = path.resolve(process.cwd(), 'src/assets/logo-neurogym.jpg');

export interface DatosComprobante {
  numero: string;
  socio: string;
  sede: string;
  periodo: string;
  plan: 'Básico' | 'Premium';
  cuotaBase: number;
  adicionalPremium: number;
  descuento: number;
  importe: number;
  medio: string;
  fechaPago: Date;
  referencia: string;
}

/** Datos históricos del comprobante de un pago aprobado (los mismos que muestra la interfaz). */
export async function datosComprobante(pagoId: number): Promise<DatosComprobante | null> {
  const pago = await cuotaRepository.buscarComprobante(pagoId);
  if (!pago?.comprobante || pago.estado !== 'APROBADO') return null;
  const { cuota } = pago;
  return {
    numero: pago.comprobante.numero,
    socio: `${cuota.socio.usuario.nombre} ${cuota.socio.usuario.apellido}`,
    sede: cuota.socio.sede.nombre,
    periodo: cuota.periodo,
    plan: aNumero(cuota.adicionalPremium) > 0 ? 'Premium' : 'Básico',
    cuotaBase: aNumero(cuota.cuotaBase),
    adicionalPremium: aNumero(cuota.adicionalPremium),
    descuento: aNumero(cuota.descuento),
    importe: aNumero(pago.importe),
    medio: pago.medio,
    fechaPago: pago.fecha,
    referencia: pago.referenciaExterna ?? pago.comprobante.numero,
  };
}

/** Genera el PDF con el diseño de la tarjeta del comprobante (ancho A5, alto ajustado al contenido). */
export function generarPdfComprobante(c: DatosComprobante): Promise<Buffer> {
  const cantidadFilas = 4 + (c.adicionalPremium > 0 || c.plan === 'Premium' ? 1 : 0) + (c.descuento > 0 ? 1 : 0);
  const altoPagina = 40 + (20 + 72 + 16 + 18 + 10 + 18 + 14 + 14 + 36 + 14 + cantidadFilas * 25 + 14) + 64;
  const doc = new PDFDocument({
    size: [419.53, altoPagina],
    margin: 0,
    info: { Title: `Comprobante ${c.numero}`, Author: 'NeuroGym', Subject: `Cuota ${mesAnio(c.periodo)}` },
  });
  doc.registerFont('normal', path.join(FUENTES, 'inter-latin-400-normal.woff'));
  doc.registerFont('media', path.join(FUENTES, 'inter-latin-600-normal.woff'));
  doc.registerFont('negrita', path.join(FUENTES, 'inter-latin-700-normal.woff'));

  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fin = new Promise<Buffer>((ok, error) => {
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', error);
  });

  const ancho = doc.page.width; // 419,53 pt (ancho A5)
  const margen = 34;
  const x = margen;
  const w = ancho - margen * 2;
  const pad = 20;

  // Filas del recibo (mismo orden que la interfaz).
  const filas: { etiqueta: string; valor: string; color?: string }[] = [{ etiqueta: 'Cuota del gimnasio · Básico', valor: dinero(c.cuotaBase) }];
  if (c.adicionalPremium > 0 || c.plan === 'Premium') filas.push({ etiqueta: 'Adicional Premium', valor: dinero(c.adicionalPremium) });
  if (c.descuento > 0) filas.push({ etiqueta: '10% de descuento sobre el total del plan', valor: `−${dinero(c.descuento)}`, color: COLOR.descuento });
  filas.push({ etiqueta: 'Medio', valor: MEDIO[c.medio] ?? c.medio }, { etiqueta: 'Fecha', valor: fechaLarga(c.fechaPago) }, { etiqueta: 'Referencia', valor: c.referencia });

  const altoLogo = 72;
  const altoFila = 25;
  const altoTarjeta = pad + altoLogo + 16 + 18 + 10 + 18 + 14 + 14 + 36 + 14 + filas.length * altoFila + pad - 6;
  const y0 = 40;

  // Tarjeta con borde punteado.
  doc.save().roundedRect(x, y0, w, altoTarjeta, 11).fillColor(COLOR.fondoRecibo).fill().restore();
  doc.save().roundedRect(x, y0, w, altoTarjeta, 11).dash(3, { space: 2.5 }).lineWidth(0.8).strokeColor(COLOR.bordeRecibo).stroke().undash().restore();

  let y = y0 + pad;
  // Logo oficial (369 × 253 px).
  const anchoLogo = (altoLogo * 369) / 253;
  doc.image(LOGO, x + (w - anchoLogo) / 2, y, { width: anchoLogo, height: altoLogo });
  y += altoLogo + 16;

  // Insignia «Pago registrado».
  doc.font('negrita').fontSize(7.5);
  const textoInsignia = 'Pago registrado';
  const anchoInsignia = doc.widthOfString(textoInsignia) + 22;
  const xInsignia = x + (w - anchoInsignia) / 2;
  doc.save().roundedRect(xInsignia, y, anchoInsignia, 16, 5).fillColor(COLOR.insignia).fill().restore();
  doc.save().circle(xInsignia + 8, y + 8, 2).fillColor(COLOR.insigniaTexto).fill().restore();
  doc.fillColor(COLOR.insigniaTexto).text(textoInsignia, xInsignia + 14, y + 4.2, { lineBreak: false });
  y += 16 + 10;

  // Período, socio y plan, importe.
  doc.font('media').fontSize(12).fillColor(COLOR.tinta).text(`Cuota ${mesAnio(c.periodo)}`, x, y, { width: w, align: 'center' });
  y += 18;
  doc.font('normal').fontSize(8.5).fillColor(COLOR.apagado).text(`${c.socio} · Plan ${c.plan}`, x, y, { width: w, align: 'center' });
  y += 14 + 14;
  doc.font('media').fontSize(27).fillColor(COLOR.tinta).text(dinero(c.importe), x, y, { width: w, align: 'center', characterSpacing: -0.6 });
  y += 36 + 14;

  // Desglose.
  const xi = x + pad;
  const wi = w - pad * 2;
  filas.forEach((f, i) => {
    const yt = y + (altoFila - 9) / 2;
    doc.font('normal').fontSize(8.5).fillColor(COLOR.etiqueta).text(f.etiqueta, xi, yt, { width: wi * 0.6, lineBreak: false });
    doc.font('media').fontSize(8.5).fillColor(f.color ?? COLOR.tinta).text(f.valor, xi + wi * 0.35, yt, { width: wi * 0.65, align: 'right', lineBreak: false });
    if (i < filas.length - 1) doc.save().moveTo(xi, y + altoFila).lineTo(xi + wi, y + altoFila).lineWidth(0.6).strokeColor(COLOR.borde).stroke().restore();
    y += altoFila;
  });

  // Nota al pie (igual que en la interfaz).
  doc.font('normal').fontSize(7.5).fillColor(COLOR.nota).text(`Comprobante ${c.numero} · ${conSede(c.sede)}. No reemplaza una factura.`, x, y0 + altoTarjeta + 14, {
    width: w,
    align: 'center',
  });
  doc.font('normal').fontSize(6.5).fillColor(COLOR.nota).text('Importes conservados al momento del registro.', x, y0 + altoTarjeta + 27, { width: w, align: 'center' });

  doc.end();
  return fin;
}

/** PDF del comprobante de un pago aprobado, o null si no existe. */
export async function pdfDeComprobante(pagoId: number): Promise<{ nombre: string; contenido: Buffer } | null> {
  const datos = await datosComprobante(pagoId);
  if (!datos) return null;
  return { nombre: `comprobante-${datos.numero}.pdf`, contenido: await generarPdfComprobante(datos) };
}
