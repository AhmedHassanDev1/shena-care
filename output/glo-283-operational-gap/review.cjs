const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');
const run = (args) => { const r = cp.spawnSync('git', args, {encoding:'utf8'}); if(r.status!==0) throw new Error('Git read failed'); return r.stdout; };
const paths = ['apps/api/prisma/schema.prisma','apps/api/src/modules/sourcing/config/procurement-batch.config.ts','apps/api/src/modules/sourcing/services/procurement-policy.ts','apps/api/src/modules/sourcing/services/ranking.service.ts','apps/api/src/modules/sourcing/services/ranking.service.spec.ts','apps/api/test/unit/procurement-policy.spec.ts','apps/api/test/integration/glo-283-supplier-po-batching.e2e-spec.ts','apps/business/app/(workspace)/admin/sourcing/page.tsx'];
const staged = cp.spawnSync('git',['diff','--cached','--binary','--','apps/web']);
if(staged.status!==0) throw new Error('Staged preservation read failed');
fs.writeFileSync('output/glo-283-operational-gap/unrelated-staged.sha256',crypto.createHash('sha256').update(staged.stdout).digest('hex'));
const lint = JSON.parse(fs.readFileSync('output/glo-283-operational-gap/api-lint.json','utf8'));
const {ESLint} = require('../../node_modules/eslint');
(async()=>{
 const eslint = new ESLint({cwd:process.cwd()+'/apps/api'});
 const baseline=[];
 for(const p of paths.filter(p=>p.startsWith('apps/api/')&&p.endsWith('.ts'))) {
  const results=await eslint.lintText(run(['show','HEAD:'+p]),{filePath:process.cwd()+'/'+p});
  baseline.push(...results.map(r=>({file:p,errors:r.errorCount,warnings:r.warningCount,messages:r.messages})));
 }
 fs.writeFileSync('output/glo-283-operational-gap/lint-baseline.json',JSON.stringify(baseline,null,2));
 console.log(JSON.stringify({lintCurrentErrors:lint.reduce((n,r)=>n+r.errorCount,0),lintBaselineErrors:baseline.reduce((n,r)=>n+r.errors,0),currentMessages:lint.flatMap(r=>r.messages.map(m=>({file:r.filePath.split('sourcing/').pop(),line:m.line,rule:m.ruleId})))},null,2));
 const credential=cp.spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
 const token=credential.stdout?.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);
 if(credential.status!==0||!token)throw new Error('Cannot inspect repository deployment hooks');
 const result={};
 for(const resource of ['hooks','deployments','actions/workflows','commits/'+run(['rev-parse','HEAD']).trim()+'/check-runs']) {
  const response=await fetch('https://api.github.com/repos/AhmedHassanDev1/shena-care/'+resource,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});
  if(!response.ok) throw new Error('GitHub inspection failed: '+response.status);
  const data=await response.json();
  result[resource]=resource==='hooks'?data.map(h=>({active:h.active,events:h.events,name:h.name})):resource==='deployments'?data.map(d=>({environment:d.environment,ref:d.ref})):resource==='actions/workflows'?data.workflows.map(w=>({name:w.name,path:w.path,state:w.state})):data.check_runs.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion}));
 }
 fs.writeFileSync('output/glo-283-operational-gap/remote-automation.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
})();
