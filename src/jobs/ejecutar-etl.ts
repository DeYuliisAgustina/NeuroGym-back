import { prisma } from '../config/prisma';
import { ejecutarEtlTodos } from './ProcesoETLAsistencia';

/** Ejecución manual del ETL de asistencia: `npm run etl`. */
ejecutarEtlTodos()
  .then((resultado) => console.table(resultado))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
