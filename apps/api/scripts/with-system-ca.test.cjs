/* eslint-disable @typescript-eslint/no-var-requires -- Node CommonJS entry point. */
const {test}=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const path=require('node:path');
const launcher=path.join(__dirname,'with-system-ca.cjs');
test('preserves node arguments, exit status and existing runtime options',()=>{
 const r=spawnSync(process.execPath,[launcher,'-e','console.log(JSON.stringify({arg:process.argv[1],options:process.env.NODE_OPTIONS}));process.exit(7)','--','argument with spaces'],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--no-warnings'}});
 assert.equal(r.status,7);const value=JSON.parse(r.stdout);assert.equal(value.arg,'argument with spaces');assert.match(value.options,/--no-warnings/);
 if(process.allowedNodeEnvironmentFlags.has('--use-system-ca'))assert.match(value.options,/--use-system-ca/);
});
