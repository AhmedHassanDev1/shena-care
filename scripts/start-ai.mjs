import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const aiDir = resolve(rootDir, 'services/ai');

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
const mergedEnv = { ...process.env, ...apiEnv, ...aiEnv };

const isWin = process.platform === 'win32';
const winPython = resolve(aiDir, '.venv/Scripts/python.exe');
const unixPython = resolve(aiDir, '.venv/bin/python');

let python = 'python';
if (isWin && existsSync(winPython)) {
  python = winPython;
} else if (!isWin && existsSync(unixPython)) {
  python = unixPython;
} else if (!isWin) {
  python = 'python3';
}

const port = mergedEnv.AI_SERVICE_PORT || '8000';
const host = mergedEnv.BIND_HOST || '127.0.0.1';

console.log(`[ShenaCare AI] Starting service via ${python} on http://${host}:${port}`);

const proc = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', host, '--port', String(port)], {
  cwd: aiDir,
  env: mergedEnv,
  stdio: 'inherit',
});

proc.on('error', (err) => {
  console.error('[ShenaCare AI] Failed to start:', err);
  process.exit(1);
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
