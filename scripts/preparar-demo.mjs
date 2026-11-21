// Prepara la demostración de WhatsApp con comprobante en PDF:
//   1. Abre un túnel HTTPS temporal y gratuito (Pinggy, por ssh, sin cuenta) hacia el backend.
//   2. Guarda la dirección en WHATSAPP_URL_PUBLICA (.env) y reinicia el backend en modo desarrollo.
//   3. Registra el webhook de estados del sandbox de 360dialog en esa dirección.
// El túnel queda abierto mientras esta ventana siga abierta (versión gratuita: 60 minutos).
// Al cerrarla (Ctrl+C), se vacía WHATSAPP_URL_PUBLICA. Uso: npm run demo
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivoEnv = path.join(raiz, '.env');
const indice = path.join(raiz, 'src', 'index.ts');

function guardarUrl(url) {
  const lineas = fs.readFileSync(archivoEnv, 'utf8').split(/\r?\n/);
  const i = lineas.findIndex((l) => l.startsWith('WHATSAPP_URL_PUBLICA='));
  if (i >= 0) lineas[i] = `WHATSAPP_URL_PUBLICA=${url}`;
  else lineas.push(`WHATSAPP_URL_PUBLICA=${url}`);
  fs.writeFileSync(archivoEnv, lineas.join('\n'));
  // tsx watch reinicia el backend al cambiar src/index.ts y vuelve a leer el .env.
  const ahora = new Date();
  fs.utimesSync(indice, ahora, ahora);
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hora = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

async function backendResponde(url) {
  try {
    return (await fetch(`${url}/api/salud`, { signal: AbortSignal.timeout(8000) })).ok;
  } catch {
    return false;
  }
}

console.log('Abriendo el túnel… (la primera vez puede tardar unos segundos)');
const ssh = spawn('ssh', ['-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-R0:localhost:3000', 'a.pinggy.io'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let configurado = false;
let salida = '';
async function alRecibir(texto) {
  salida += texto;
  const url = salida.match(/https:\/\/[a-z0-9-]+\.[a-z0-9.-]*pinggy[a-z0-9.-]*\.(?:link|net|online)/i)?.[0];
  if (!url || configurado) return;
  configurado = true;
  guardarUrl(url);
  console.log(`\nTúnel abierto: ${url}`);
  console.log('Reiniciando el backend…');
  for (let i = 0; i < 15 && !(await backendResponde(url)); i++) await esperar(2000);
  if (!(await backendResponde(url))) {
    console.log('El backend no responde por el túnel. ¿Está levantado NeuroGym (Run o "Levantar NeuroGym")?');
    return;
  }
  execFile(process.execPath, [path.join(raiz, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/jobs/probar-whatsapp.ts', '--webhook', url], { cwd: raiz }, (error, stdout) => {
    const linea = stdout.split('\n').find((l) => l.includes('Webhook') || l.includes('rechazó'));
    console.log(error ? 'No se pudo registrar el webhook de estados (los envíos funcionan igual).' : (linea ?? '').trim());
  });
  const vence = new Date(Date.now() + 60 * 60_000);
  console.log('\n================  LISTO PARA LA DEMO  ================');
  console.log(' 1. Mandá "hola" por WhatsApp al número del sandbox de 360dialog');
  console.log('    (WhatsApp solo deja escribirte si le escribiste en las últimas 24 h).');
  console.log(' 2. Pagá una cuota en NeuroGym: el comprobante en PDF llega por WhatsApp.');
  console.log(` 3. El túnel se cierra a las ${hora(vence)} o al cerrar esta ventana (Ctrl+C).`);
  console.log('======================================================\n');
  setTimeout(() => console.log('\nAviso: el túnel gratuito vence en 5 minutos. Volvé a ejecutar "Preparar demo" si seguís mostrando.'), 55 * 60_000);
}
ssh.stdout.on('data', (d) => void alRecibir(String(d)));
ssh.stderr.on('data', (d) => void alRecibir(String(d)));

let cerrando = false;
function cerrar() {
  if (cerrando) return;
  cerrando = true;
  guardarUrl('');
  console.log('\nTúnel cerrado. WHATSAPP_URL_PUBLICA quedó vacía (los pagos siguen funcionando; el PDF por WhatsApp no).');
  ssh.kill();
  process.exit(0);
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
ssh.on('exit', () => {
  if (!configurado) console.log('No se pudo abrir el túnel. Revisá la conexión a internet y volvé a intentar.\n' + salida.slice(-400));
  cerrar();
});
