import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const port = 3127;
const origin = `http://127.0.0.1:${port}`;
const routes = [
  '/',
  '/products',
  '/products/reset-check',
  '/cart',
  '/checkout',
  '/account',
  '/account/profile',
  '/account/routine',
  '/routine/builder',
  '/orders/reset-check',
];
// Rebuilt in the approved design: must keep the RTL document contract and must not regress to the scaffold.
const implementedRoutes = ['/auth', '/auth/verify'];

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const server = spawn(
  process.execPath,
  [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let output = '';
server.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
server.stderr.on('data', (chunk) => {
  output += chunk;
  process.stderr.write(chunk);
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready.\n${output}`);
    }
    try {
      const response = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // The development server has not opened the port yet.
    }
    await delay(500);
  }
  throw new Error(`Next.js did not become ready.\n${output}`);
}

try {
  await waitForServer();

  for (const route of routes) {
    const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(20_000) });
    const html = await response.text();

    if (!response.ok) {
      throw new Error(`${route} returned HTTP ${response.status}.`);
    }
    if (!html.includes('lang="ar"') || !html.includes('dir="rtl"')) {
      throw new Error(`${route} did not render the Arabic-first RTL document contract.`);
    }
    if (!html.includes('data-ui-status="redesign-pending"')) {
      throw new Error(`${route} did not explicitly render the redesign-pending scaffold.`);
    }
    console.log(`pass ${route}`);
  }

  for (const route of implementedRoutes) {
    const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(20_000) });
    const html = await response.text();

    if (!response.ok) {
      throw new Error(`${route} returned HTTP ${response.status}.`);
    }
    if (!html.includes('lang="ar"') || !html.includes('dir="rtl"')) {
      throw new Error(`${route} did not render the Arabic-first RTL document contract.`);
    }
    if (html.includes('data-ui-status="redesign-pending"')) {
      throw new Error(`${route} regressed to the redesign-pending scaffold.`);
    }
    console.log(`pass ${route} (implemented)`);
  }

  console.log(`UI reset contract passed for ${routes.length} pending and ${implementedRoutes.length} implemented routes.`);
} finally {
  if (server.exitCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      server.kill('SIGTERM');
    }
  }
}
