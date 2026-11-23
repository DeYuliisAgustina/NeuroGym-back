import { telefonoNacional } from '../../src/utils/telefono';

/** RNF10: teléfonos argentinos para WhatsApp (caja negra: clases válidas e inválidas). */
describe('Teléfono argentino', () => {
  it.each([
    ['341 555-1234', '3415551234'],
    ['(0341) 155-551234', '3415551234'],
    ['0341 15 555-1234', '3415551234'],
    ['+54 9 341 555-1234', '3415551234'],
    ['+54 341 555-1234', '3415551234'],
    ['11 4567-8901', '1145678901'],
    ['011 15 4567-8901', '1145678901'],
    ['+5491100000000', '1100000000'],
    ['2944 12-3456', '2944123456'],
  ])('acepta %s', (texto, nacional) => {
    expect(telefonoNacional(texto)).toBe(nacional);
  });

  it.each([
    ['123', 'muy corto'],
    ['341 555-12345678', 'muy largo'],
    ['441 555-1234', 'característica inexistente (no empieza con 11, 2 o 3)'],
    ['1234567890', 'empieza con 1 pero no es 11'],
    ['3333333333', 'todos los dígitos iguales'],
    ['341-ABC-1234', 'tiene letras'],
    ['', 'vacío'],
  ])('rechaza %s (%s)', (texto) => {
    expect(telefonoNacional(texto)).toBeNull();
  });
});
