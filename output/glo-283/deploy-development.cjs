'use strict';
const fs = require('fs');
const path = require('path');
const {createHash} = require('crypto');
const {spawnSync} = require('child_process');
const {PrismaClient} = require('@prisma/client');
const {developmentUrls, snapshot} = require('../../apps/api/scripts/verify-development-database.cjs');
const {assertLocalTestDatabase} = require('../../apps/api/scripts/local-test-database.cjs');
const root = process.cwd();
const dir = path.join(root, '.codex/qa-logs/glo-283-20261101/development-backup');
const sha = value => createHash('sha256').update(value).digest('hex');
(async () => {
  assertLocalTestDatabase(process.env);
  const [database,direct] = developmentUrls();
  const before = JSON.parse(fs.readFileSync(path.join(dir,'before-with-columns.json')));
  const archive = JSON.parse(fs.readFileSync(path.join(dir,'archive.json')));
  const restore = JSON.parse(fs.readFileSync(path.join(dir,'restore-verified.json')));
  const clone = JSON.parse(fs.readFileSync(path.join(dir,'clone-migration-verified.json')));
  if (before.project !== 'cluidtctwgxxhybzftft' || archive.project !== before.project ||
      !archive.consistentBeforeAfter || !restore.allTableCountsAndHashesMatch || !clone.allOriginalRowsAndColumnsPreserved ||
      clone.migrationCount !== 64 || before.pending.length !== 4 ||
      sha(fs.readFileSync(path.join(dir,'development-app-schemas.dump'))) !== archive.sha256) throw Error('Backup/restore gate failed');
  for (const migration of before.pending) {
    const sql = fs.readFileSync(path.join(root,'apps/api/prisma/migrations',migration.name,'migration.sql'));
    if (sha(sql) !== migration.sha256) throw Error('Verified migration changed');
    for (const statement of sql.toString().replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean)) {
      if (!(/^ALTER TYPE "sourcing"\."PurchaseOrderStatus" ADD VALUE 'expired'$/.test(statement) ||
          /^ALTER TABLE "sourcing"\."(suppliers|supplier_offers|supplier_purchase_orders)"\s+ADD (COLUMN|CONSTRAINT)\b/.test(statement) ||
          /^CREATE TABLE "sourcing"\."sourcing_decisions"\s*\(/.test(statement) ||
          /^CREATE INDEX "[a-z_]+"\s+ON "sourcing"\."(supplier_purchase_orders|sourcing_decisions|purchase_order_lines|source_allocations)"\s*\(/.test(statement))) throw Error('Unexpected migration DDL');
      if (/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/.test(statement)) throw Error('Non-additive migration refused');
    }
  }
  const remote = new PrismaClient({datasources:{db:{url:direct.href}},log:[]});
  try {
    const current = await snapshot(remote);
    if (JSON.stringify(current.data) !== JSON.stringify(before.data) || JSON.stringify(current.history) !== JSON.stringify(before.history)) throw Error('Development changed since verified backup; deployment refused');
    if (process.argv[2] !== 'deploy') { console.log('All Development deployment gates passed; no writes requested'); return; }
    const result = spawnSync(process.execPath, ['../../node_modules/prisma/build/index.js','migrate','deploy'], {
      cwd:path.join(root,'apps/api'), encoding:'utf8', windowsHide:true, timeout:120000,
      env:{...process.env,DATABASE_URL:database.href,DIRECT_URL:direct.href},maxBuffer:8e6});
    let output=(result.stdout||'')+'\n'+(result.stderr||'');
    for(const url of [database,direct])for(const value of [url.href,url.password,decodeURIComponent(url.password)])if(value)output=output.replaceAll(value,'[REDACTED]');
    fs.writeFileSync(path.join(root,'output/glo-283/development-migrate-deploy.log'),output);
    if(result.status!==0)throw Error('Development migration deployment failed; no rollback attempted');
    const after = await snapshot(remote,before.columns);
    for(const[name,stats]of Object.entries(before.data))if(name!=='public._prisma_migrations'&&JSON.stringify(after.data[name])!==JSON.stringify(stats))throw Error('Existing Development data changed: '+name);
    for(const old of before.history)if(!after.history.some(x=>JSON.stringify(x)===JSON.stringify(old)))throw Error('Original migration metadata changed');
    for(const migration of before.pending)if(!after.history.some(x=>x.migration_name===migration.name&&x.checksum===migration.sha256&&x.finished_at&&!x.rolled_back_at))throw Error('Migration verification incomplete');
    const compatible = await remote.$transaction(async tx=>{
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.supplier.findMany({take:1,select:{id:true,pickupLeadMinutes:true,closedDates:true}});
      await tx.supplierOffer.findMany({take:1,select:{id:true,minimumOrderUnits:true,orderMultipleUnits:true,shortageObservedAt:true}});
      await tx.supplierPurchaseOrder.findMany({take:1,select:{id:true,expedited:true,responseDeadlineAt:true}});
      await tx.sourcingDecision.count();
      const constraints=await tx.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace='sourcing'::regnamespace AND conname IN ('supplier_pickup_lead_nonnegative','supplier_offer_positive_order_terms') AND convalidated`;
      const indexes=await tx.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='sourcing' AND indexname IN ('supplier_purchase_orders_status_response_deadline_at_idx','sourcing_decisions_requirement_id_created_at_idx','sourcing_decisions_sku_id_created_at_idx','purchase_order_lines_distribution_required_created_at_idx','source_allocations_result_selected_at_idx')`;
      if(constraints.length!==2||indexes.length!==5)throw Error('Schema integrity check incomplete');
      return {validatedConstraints:constraints.length,indexes:indexes.length,apiPrismaReads:true};
    });
    const evidence={project:before.project,database:'postgres',migrateDeployExit:result.status,appliedMigrations:after.history.length,originalTablesPreserved:Object.keys(before.data).length-1,originalDataHashesPreserved:true,originalMigrationsPreserved:true,...compatible,verifiedAt:new Date()};
    fs.writeFileSync(path.join(dir,'deployment-verified.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));
  }finally{await remote.$disconnect()}
})().catch(error=>{console.error(/^(Backup|Verified migration|Unexpected migration|Non-additive|Development|Existing Development|Original migration|Migration verification|Schema integrity)/.test(error.message)?error.message:'Development deployment blocked ('+(error.code||error.name)+')');process.exitCode=1});
