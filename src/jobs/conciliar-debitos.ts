import { prisma } from '../config/prisma';
import { cuotaService } from '../patterns/facade';

/**
 * Conciliación manual de débitos automáticos: `npm run mp:conciliar`.
 * Es la misma tarea que corre todos los días a las 6:30. Consulta en Mercado Pago
 * los cobros de las adhesiones y registra los que no llegaron por webhook, sin
 * duplicar. Muestra solo el resumen (sin datos personales ni credenciales).
 */
cuotaService
  .conciliarDebitos()
  .then((resumen) => console.log('Conciliación de débitos:', resumen))
  .catch((error) => console.error('Error:', (error as Error).message))
  .finally(() => prisma.$disconnect());
