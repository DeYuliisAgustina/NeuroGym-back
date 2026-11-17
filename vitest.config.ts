import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // Las pruebas de integración comparten la base de prueba: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/jobs/ejecutar-etl.ts', 'src/jobs/supresion-datos.ts', 'src/jobs/verificar-mercadopago.ts', 'src/jobs/probar-whatsapp.ts', 'src/jobs/conciliar-debitos.ts'],
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
