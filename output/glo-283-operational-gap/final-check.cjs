const fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
const run=args=>{const r=cp.spawnSync('git',args);if(r.status!==0)throw new Error('Git check failed');return r.stdout;};
const paths=['apps/api/prisma/schema.prisma','apps/api/src/modules/sourcing/config/procurement-batch.config.ts','apps/api/src/modules/sourcing/services/procurement-policy.ts','apps/api/src/modules/sourcing/services/ranking.service.ts','apps/api/src/modules/sourcing/services/ranking.service.spec.ts','apps/api/test/unit/procurement-policy.spec.ts','apps/api/test/integration/glo-283-supplier-po-batching.e2e-spec.ts','apps/business/app/(workspace)/admin/sourcing/page.tsx'];
const hash=crypto.createHash('sha256').update(run(['diff','--cached','--binary','--','apps/web'])).digest('hex');
if(hash!==fs.readFileSync('output/glo-283-operational-gap/unrelated-staged.sha256','utf8'))throw new Error('Unrelated staging changed');
const texts=paths.map(p=>fs.readFileSync(p,'utf8')).join('\n');
let checked=0;
for(const p of ['apps/api/.env','apps/api/.env.local','apps/business/.env.local'])if(fs.existsSync(p))for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){
 const m=line.match(/^([A-Z_]*(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL|API_KEY)[A-Z_]*)\s*=\s*["']?(.+?)["']?\s*$/);
 if(m&&m[2].length>=12){checked++;if(texts.includes(m[2]))throw new Error('Sensitive configuration found in task paths');}
}
const schema=fs.readFileSync(paths[0],'utf8').replace(/\/\/[^\r\n]*/g,'').replace(/\r/g,'');
const original=run(['show','HEAD:'+paths[0]]).toString().replace(/\/\/[^\r\n]*/g,'').replace(/\r/g,'');
if(schema!==original)throw new Error('Unexpected functional schema change');
console.log(JSON.stringify({taskPaths:paths,unrelatedStagingPreserved:true,configurationSecretsChecked:checked,schemaCommentOnly:true},null,2));
if(fs.existsSync('output/glo-283-operational-gap/full.json')){
 const current=JSON.parse(fs.readFileSync('output/glo-283-operational-gap/full.json'));
 const baseline=JSON.parse(fs.readFileSync('output/glo-283/glo-283-baseline-results.json'));
 const failed=r=>r.testResults.flatMap(s=>s.assertionResults.filter(a=>a.status==='failed').map(a=>a.fullName)).sort();
 const a=failed(current),b=failed(baseline);
 const summary={suites:current.numTotalTestSuites,passed:current.numPassedTests,failed:current.numFailedTests,total:current.numTotalTests,newFailures:a.filter(n=>!b.includes(n)),existingFailures:a.filter(n=>b.includes(n)),resolvedBaselineFailures:b.filter(n=>!a.includes(n))};
 fs.writeFileSync('output/glo-283-operational-gap/comparison.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}
