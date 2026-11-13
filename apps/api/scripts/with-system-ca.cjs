/* eslint-disable @typescript-eslint/no-var-requires -- Node CommonJS entry point. */
'use strict';
// Trust the OS-administered CA store as well as Node's bundled roots. Verification
// and hostname checks remain enabled. Older Node versions retain their normal
// trust configuration (including NODE_EXTRA_CA_CERTS, when configured).
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--nest') args[0] = require.resolve('@nestjs/cli/bin/nest.js');
const env = { ...process.env };
if (process.allowedNodeEnvironmentFlags.has('--use-system-ca')) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --use-system-ca`.trim();
}
const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
