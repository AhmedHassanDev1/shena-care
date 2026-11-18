import { spawn, execSync } from 'node:child_process';
import readline from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const aiDir = resolve(rootDir, 'services/ai');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function loadEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...vals] = trimmed.split('=');
    const val = vals.join('=').trim().replace(/^["']|["']$/g, '');
    env[key.trim()] = val;
  }
  return env;
}

const apiEnv = loadEnv(resolve(rootDir, 'apps/api/.env'));
const aiEnv = loadEnv(resolve(aiDir, '.env'));
const mergedEnv = { ...process.env, ...apiEnv, ...aiEnv, FORCE_COLOR: '1' };

const winPython = resolve(aiDir, '.venv/Scripts/python.exe');
const unixPython = resolve(aiDir, '.venv/bin/python');
let pythonCmd = 'python';
if (isWin && existsSync(winPython)) {
  pythonCmd = winPython;
} else if (!isWin && existsSync(unixPython)) {
  pythonCmd = unixPython;
} else if (!isWin) {
  pythonCmd = 'python3';
}

const aiPort = mergedEnv.AI_SERVICE_PORT || '8000';
const aiHost = mergedEnv.BIND_HOST || '127.0.0.1';

const services = [
  {
    name: 'ai',
    title: `AI Service (FastAPI :${aiPort})`,
    color: '\x1b[33m', // Yellow
    cmd: pythonCmd,
    args: ['-m', 'uvicorn', 'app.main:app', '--host', aiHost, '--port', String(aiPort)],
    cwd: aiDir,
    port: parseInt(aiPort, 10),
    process: null,
    retries: 0,
    startedAt: 0,
  },
  {
    name: 'api',
    title: 'NestJS Backend API (:3001)',
    color: '\x1b[36m', // Cyan
    cmd: npmCmd,
    args: ['run', 'dev', '--workspace=api'],
    cwd: rootDir,
    port: 3001,
    process: null,
    retries: 0,
    startedAt: 0,
  },
  {
    name: 'web',
    title: 'Customer Storefront (:3000)',
    color: '\x1b[32m', // Green
    cmd: npmCmd,
    args: ['run', 'dev', '--workspace=web'],
    cwd: rootDir,
    port: 3000,
    process: null,
    retries: 0,
    startedAt: 0,
  },
  {
    name: 'business',
    title: 'Business Workspace (:3002)',
    color: '\x1b[35m', // Magenta
    cmd: npmCmd,
    args: ['--prefix', 'apps/business', 'run', 'dev'],
    cwd: rootDir,
    port: 3002,
    process: null,
    retries: 0,
    startedAt: 0,
  },
];

console.log('\x1b[1;34m=====================================================\x1b[0m');
console.log('\x1b[1;34m       ShenaCare Multi-Service Development Runner     \x1b[0m');
console.log('\x1b[1;34m=====================================================\x1b[0m');
console.log('Services to start:');
services.forEach((s) => {
  console.log(`  ${s.color}● ${s.title}\x1b[0m`);
});
console.log('\x1b[90m(If any service fails, the remaining services will continue running)\x1b[0m\n');

// Pre-flight: free ports from previous orphaned sessions
function freePort(port) {
  if (!isWin || !port) return;
  try {
    const output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    let killedAny = false;
    for (const line of output.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          try {
            execSync(`taskkill /pid ${pid} /f`, { stdio: 'ignore' });
            killedAny = true;
          } catch {}
        }
      }
    }
    if (killedAny) {
      execSync('timeout /t 1 /nobreak', { stdio: 'ignore' });
    }
  } catch {}
}

services.forEach((s) => {
  if (s.port) freePort(s.port);
});

// Pre-flight: ensure Prisma client is generated
try {
  process.stdout.write('\x1b[90m[shena-care] Syncing Prisma client...\x1b[0m ');
  execSync(`${npmCmd} run prisma:generate --workspace=api`, { cwd: rootDir, env: mergedEnv, stdio: 'ignore' });
  console.log('\x1b[32m✓ Ready\x1b[0m\n');
} catch {
  console.log('\x1b[33m(skipped)\x1b[0m\n');
}

let isShuttingDown = false;

function attachStream(stream, name, color, isError = false) {
  if (!stream) return;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim() && !line) return;
    const prefix = `${color}[${name}]\x1b[0m`;
    if (isError) {
      console.error(`${prefix} ${line}`);
    } else {
      console.log(`${prefix} ${line}`);
    }
  });
}

function checkAllExited() {
  if (isShuttingDown) return;
  const runningCount = services.filter((s) => s.process !== null).length;
  if (runningCount === 0) {
    console.log('\n\x1b[31;1m[shena-care] All services have stopped.\x1b[0m');
    process.exit(1);
  }
}

function startService(svc) {
  if (isShuttingDown) return;
  svc.startedAt = Date.now();

  try {
    const child = spawn(svc.cmd, svc.args, {
      cwd: svc.cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin && svc.cmd.endsWith('.cmd'),
    });

    svc.process = child;

    attachStream(child.stdout, svc.name, svc.color, false);
    attachStream(child.stderr, svc.name, svc.color, true);

    child.on('error', (err) => {
      svc.process = null;
      if (!isShuttingDown) {
        console.error(
          `\n\x1b[31;1m[!] [${svc.name}] Failed to start: ${err.message}\x1b[0m\n` +
          `\x1b[33m==> The other services will continue running.\x1b[0m\n`
        );
        checkAllExited();
      }
    });

    child.on('exit', (code, signal) => {
      svc.process = null;
      if (isShuttingDown) return;

      const lifetime = Date.now() - svc.startedAt;
      // If crashed quickly (< 4s) on first run, retry once after freeing port
      if (code !== 0 && svc.retries < 1 && lifetime < 4000) {
        svc.retries += 1;
        console.warn(
          `\n\x1b[33m[!] [${svc.name}] Exited early (code ${code}). Retrying in 1.5s (attempt ${svc.retries}/1)...\x1b[0m`
        );
        if (svc.port) freePort(svc.port);
        setTimeout(() => startService(svc), 1500);
        return;
      }

      if (code !== 0 && code !== null) {
        console.error(
          `\n\x1b[31;1m[!] [${svc.name}] Service exited with code ${code}.\x1b[0m\n` +
          `\x1b[33m==> The other services will continue running.\x1b[0m\n`
        );
      } else if (signal) {
        console.log(
          `\n\x1b[33m[!] [${svc.name}] Service terminated by signal ${signal}.\x1b[0m\n`
        );
      } else {
        console.log(
          `\n\x1b[32m[✓] [${svc.name}] Service finished cleanly (exit code 0).\x1b[0m\n`
        );
      }
      checkAllExited();
    });
  } catch (err) {
    svc.process = null;
    console.error(
      `\n\x1b[31;1m[!] [${svc.name}] Exception while starting: ${err.message}\x1b[0m\n` +
      `\x1b[33m==> The other services will continue running.\x1b[0m\n`
    );
    checkAllExited();
  }
}

// Start all services concurrently
services.forEach((s) => startService(s));

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[33m[shena-care] Gracefully shutting down all running services...\x1b[0m');

  for (const svc of services) {
    if (svc.process && svc.process.pid) {
      try {
        if (isWin) {
          spawn('taskkill', ['/pid', svc.process.pid.toString(), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          svc.process.kill('SIGINT');
        }
      } catch {
        // ignore errors during shutdown
      }
    }
  }
}

process.on('SIGINT', () => {
  shutdown();
  setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', () => {
  shutdown();
  setTimeout(() => process.exit(0), 1000);
});
