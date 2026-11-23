/**
 * Teléfonos de Argentina (WhatsApp, RNF10). Acepta las formas habituales de escribirlos
 * —«341 555-1234», «0341 15 555-1234», «+54 9 341 555-1234»— y las lleva al número
 * nacional de 10 dígitos (característica + número). No puede saber si la línea existe
 * (para eso haría falta enviar un código), pero rechaza lo que no puede ser un número
 * argentino: largo incorrecto, característica que no empieza con 11, 2 o 3, o todos
 * los dígitos iguales.
 */
export const MENSAJE_TELEFONO_INVALIDO = 'Ingresá característica y número, por ejemplo 341 555-1234';

export function telefonoNacional(texto: string): string | null {
  const limpio = texto.trim();
  if (!/^[+\d\s().-]+$/.test(limpio)) return null;
  let d = limpio.replace(/\D/g, '');

  if (d.startsWith('54') && d.length >= 12) {
    d = d.slice(2);
    if (d.startsWith('9') && d.length === 11) d = d.slice(1);
  } else if (d.startsWith('0')) {
    d = d.slice(1);
  }
  // Celular escrito con «15» después de la característica (2 a 4 dígitos).
  if (d.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (d.slice(largo, largo + 2) === '15') {
        d = d.slice(0, largo) + d.slice(largo + 2);
        break;
      }
    }
  }

  if (d.length !== 10) return null;
  if (!/^(11|[23])/.test(d)) return null;
  if (/^(\d)\1+$/.test(d)) return null;
  return d;
}

export const telefonoValido = (texto: string) => telefonoNacional(texto) !== null;
