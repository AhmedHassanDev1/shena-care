// Starts the dev server with Admin Overview demo data (development only; see lib/overview-source.ts).
// Extra arguments pass through to `next dev`, e.g. `npm run dev:demo -- -p 3100`.
import { spawn } from 'node:child_process'

const child = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_ADMIN_OVERVIEW_SOURCE: 'mock' },
})
child.on('exit', (code) => process.exit(code ?? 0))
