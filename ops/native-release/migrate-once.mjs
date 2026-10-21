#!/usr/bin/env node
// Preparation only until an exact reviewed production effect authorization exists.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
// Bind only after the exact frozen migration and actual isolated proof are accepted.
import {unwrapMigration,assertMigrationDelta,assertRetainedSnapshot} from './migration-contract.mjs';
const profileRef={path:process.argv[2],sha256:process.argv[3]};
assert(path.isAbsolute(profileRef.path));assert.match(profileRef.sha256??'',/^[a-f0-9]{64}$/);
const directory=path.dirname(fileURLToPath(import.meta.url));
const profile=JSON.parse(execFileSync('/usr/bin/python3',['-I','-B',directory+'/profile.py',profileRef.path,profileRef.sha256],{encoding:'utf8',maxBuffer:1024*1024}));
assert.equal(profile.mode,'schema-changing');
const count=profile.expectedSchema.afterCount,beforeCount=profile.expectedSchema.beforeCount;
if(process.argv.slice(4).length===1&&process.argv[4]==='validate') {
 console.log(JSON.stringify({valid:true,mode:profile.mode,candidate:profile.candidate,nativeEffects:false}));process.exit(0);
}
const here=directory,E=here+'/evidence-'+profile.cohort;
const unit='sitesourcery-'+profile.cohort+'-production-upgrade.service';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const save=(n,v)=>fs.writeFile(E+'/'+n+'.json',JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const q=s=>'"'+s.replaceAll('"','""')+'"';
async function file(p,want) {
 const s=await fs.lstat(p);assert(s.isFile()&&!s.isSymbolicLink());
 const b=await fs.readFile(p);assert.equal(hash(b),want.sha256,p+' hash');
 if(want.byteCount!==undefined)assert.equal(b.length,want.byteCount);return b;
}
assert.deepEqual(process.argv.slice(4),['--apply-once',here+'/effect-authorization.APPROVED.json']);
assert.equal(process.platform,'linux');assert.equal(process.getuid(),1000);assert.equal(os.hostname(),'FantaSeaLand');
assert.match(process.env.INVOCATION_ID??'',/^[a-f0-9]{32}$/);
assert((await fs.readFile('/proc/self/cgroup','utf8')).includes(unit));
assert.deepEqual((await fs.readFile('/proc/net/dev','utf8')).trimEnd().split('\n').slice(2).map(l=>l.split(':',1)[0].trim()).sort(),['lo']);
const auth=await read(here+'/effect-authorization.APPROVED.json');
assert.equal(auth.authorized,true);assert.deepEqual(auth.profile,profileRef);
const bundleCheck="import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('ss_profile',sys.argv[1]+'/profile.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.verify_bundle(json.loads(Path(sys.argv[2]).read_text()),Path(sys.argv[1]));print('verified')";
assert.equal(execFileSync('/usr/bin/python3',['-I','-B','-c',bundleCheck,here,here+'/effect-authorization.APPROVED.json'],{encoding:'utf8'}).trim(),'verified');assert.equal(auth.scope,'native_additive_migration_once');
assert.equal(auth.scriptSha256,hash(await fs.readFile(fileURLToPath(import.meta.url))));
assert.equal(auth.inputsSha256,hash(await fs.readFile(here+'/inputs.json')));
assert.equal(auth.candidateCommit,profile.candidate);assert.equal(auth.candidateTree,profile.tree);
assert.match(auth.candidateTree??'',/^[a-f0-9]{40}$/);
assert.match(auth.workflowCommit??'',/^[a-f0-9]{40}$/);
assert.match(auth.workflowRun??'',/^[1-9][0-9]*$/);
assert.match(auth.workflowAttempt??'',/^[1-9][0-9]*$/);
assert.deepEqual(auth.reviewedFacts,{durableWriterHolds:true,coherentDatabaseAndCustomerFileBackup:true,backupCompletedBeforeMigration:true,noDatabaseOrCustomerFileWritesBetweenCoherentCaptureAndFinalWriterHold:true});
const times=['siteIngressAndRuntimeHoldsObservedAt','backupStartedAt','backupCompletedAt','writerHoldsObservedAt','issuedAt','expiresAt'].map(k=>Date.parse(auth[k]));
assert(times.every(Number.isFinite));assert(times.every((t,i)=>!i||t>=times[i-1]));assert(times[4]<times[5]&&times[5]-times[4]<=30*60*1000);
async function freshGates() {
 const now=Date.now();assert(now>=times[4]&&now<times[5],'Production effect authorization expired');
 for(const key of ['sourceReceipt','writerHoldReceipt','coherentBackupReceipt','heldDatabaseFingerprint','rollbackReservationReceipt','combinedSmokeReceipt','configurationBoundaryReceipt','ciReceipt']) {
  const receipt=auth[key];assert(receipt&&path.isAbsolute(receipt.path));await file(receipt.path,{sha256:receipt.sha256});
 }
}
await freshGates();
// Root pins genuine current source/CI/backup/hold receipts in this exact authorization.
assert.match(auth.sourceReceipt.sha256,/^[a-f0-9]{64}$/);assert.match(auth.ciReceipt.sha256,/^[a-f0-9]{64}$/);
const qualified=await read(auth.ciReceipt.path);
assert.equal(qualified.candidateSha,auth.candidateCommit);assert.equal(qualified.workflowSha,auth.workflowCommit);
assert.equal(qualified.runId,auth.workflowRun);assert.equal(qualified.runAttempt,auth.workflowAttempt);assert.equal(qualified.state,'verified_held');
const held=await read(auth.heldDatabaseFingerprint.path);
assert.equal(held.phase,'after-final-hold');assert.equal(held.readOnly,true);assert.equal(held.otherActiveClientCount,0);
assert.equal(held.hostname,'FantaSeaLand');assert.equal(held.identity.db,'sitesourcery_production');
assert.match(held.databaseMetadata.database[0].oid,/^[1-9][0-9]*$/);
assert(Date.parse(held.startedAt)>=times[3]&&Date.parse(held.at)<=times[4],'Fresh held fingerprint must precede authorization');
const input=await read(here+'/inputs.json'),source=input.release;
assert.equal(input.candidate.commitSha,auth.candidateCommit);assert.equal(input.candidate.treeSha,auth.candidateTree);
assert.equal(input.expectedDatabaseOid,held.databaseMetadata.database[0].oid);
assert(Array.isArray(input.preservedDatabases));assert(Array.isArray(input.expectedDatabaseCatalog));
assert.deepEqual(input.reservedRollbackNames,profile.migration.reservedRollbackNames);
for(const count of [String(beforeCount),String(profile.expectedSchema.afterCount)])assert.match(input.schemas[count]??'',/^[a-f0-9]{64}$/,'Genuine schema fingerprint required');
assert.equal(source,'/home/mrfantasea/.local/share/sitesourcery-production/releases/'+auth.candidateCommit);
assert.equal(await fs.realpath(source),source);
// The observed socket list is an identity assertion, never a connection address.
// Privileged maintenance retains the existing owner peer endpoint in either mode.
assert.deepEqual(input.database,{host:'/run/user/1000/sitesourcery-production-postgresql',port:Number(profile.databaseIdentity.port),user:profile.databaseIdentity.username,database:profile.databaseIdentity.db,dataDirectory:profile.databaseIdentity.directory});
await file(profile.runtime.node,{sha256:profile.migration.nodeSha256,byteCount:profile.migration.nodeBytes});
for(const [p,want] of Object.entries(input.runtimeFiles))await file(source+'/'+p,want);
assertMigrationDelta(input,profile);
assert.equal(input.migration.count,count);assert.match(input.migration.sha256,/^[a-f0-9]{64}$/);
assert.deepEqual((await fs.readdir(source+'/server/data-plane/supabase/migrations')).filter(n=>n.endsWith('.sql')).sort(),input.migration.files.map(e=>path.basename(e.path)));
for(const entry of input.migration.files)await file(source+'/'+entry.path,entry);
const bodies=[];
for(const entry of input.delta)bodies.push(unwrapMigration(entry,await file(source+'/'+entry.path,entry)));
const guard='/var/lib/sitesourcery-storage/guard.py',manifest='/var/lib/sitesourcery-storage/manifest.json';
for(const [p,sha256] of [[guard,profile.migration.storageGuardSha256],[manifest,profile.migration.storageManifestSha256]]) {
 const s=await fs.lstat(p);assert.equal(s.uid,0);assert.equal(s.mode&0o022,0);await file(p,{sha256});
}
const guardOutput=execFileSync('/usr/bin/python3',['-I','-B',guard,manifest,'all','--manifest-sha256',profile.migration.storageManifestSha256],{encoding:'utf8',timeout:20000,maxBuffer:65536});
const {collectFin008DatabaseSnapshot}=await import(pathToFileURL(source+'/ops/fin008-data-convergence.mjs'));
const {Client}=createRequire(source+'/package.json')('pg');
await fs.mkdir(E,{mode:0o700}); // Existing evidence prohibits an automatic second attempt.
await save('opening',{at:new Date().toISOString(),candidate:input.candidate,applied:input.delta,authorizationSha256:hash(await fs.readFile(here+'/effect-authorization.APPROVED.json')),guardOutput});
const db=new Client({...input.database,application_name:'sitesourcery-'+profile.cohort+'-production-upgrade',connectionTimeoutMillis:5000,options:'-c statement_timeout=15000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=30000'});
let transaction=false,verificationTransaction=false,commitState='not_attempted',rollbackConfirmed=false,verificationRollbackConfirmed=false,disconnected=false;
async function databaseBoundary() {
 const rows=(await db.query(`SELECT d.oid::text AS oid,d.datname AS name,d.datallowconn AS "allowConnections",r.rolname AS owner FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=ANY($1::text[]) ORDER BY d.oid`,[['sitesourcery_production',...input.preservedDatabases.map(e=>e.name),...input.reservedRollbackNames]])).rows;
 assert.deepEqual(rows,input.expectedDatabaseCatalog,'Actual canonical/preserved database catalog changed or rollback names exist');
 return rows;
}
async function noOtherActiveClients() {
 await db.query('SELECT pg_stat_clear_snapshot()');
 const result=await db.query("SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)");
 assert.deepEqual(result.rows,[{count:'0'}],'Other active database clients must be held');
}
async function snapshot() {
 const schema=await collectFin008DatabaseSnapshot(db,{requireDisposable:false}),content=[];
 for(const {relation} of schema.rowCounts) {
  const row='to_jsonb(t)'; // Compare every field of each retained relation; only one empty relation is added.
  const result=await db.query(`SELECT count(*)::text AS rows,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha COLLATE "C"),''),'UTF8')),'hex') AS sha256 FROM (SELECT encode(sha256(convert_to(${row}::text,'UTF8')),'hex') AS row_sha FROM ${relation.split('.').map(q).join('.')} t) hashed`);
  content.push({relation,...result.rows[0]});
 }
 const financial=(await db.query('SELECT purpose,currency,count(*)::text AS receipts,sum(charged_amount_minor)::text AS charged_minor FROM ss.accounting_purpose_source_projection_v1() GROUP BY purpose,currency ORDER BY purpose,currency')).rows;
 return {schema,content,contentSha256:hash(JSON.stringify(content)),financial};
}
const preserved=(before,after)=>assertRetainedSnapshot(before,after,profile);

try {
 await db.connect();
 const identity=(await db.query("SELECT current_database() AS db,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\",current_user AS username,current_setting('data_directory') AS directory,current_setting('port') AS port,current_setting('unix_socket_directories') AS sockets")).rows[0];
 assert.deepEqual(identity,profile.databaseIdentity);assert.equal(identity.databaseOid,input.expectedDatabaseOid);
 await databaseBoundary();await noOtherActiveClients();await freshGates();
 await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';SET LOCAL idle_in_transaction_session_timeout='30s';SET LOCAL TIME ZONE 'UTC';SET LOCAL DateStyle='ISO, MDY';SET LOCAL extra_float_digits=3");transaction=true;
 const initial=await collectFin008DatabaseSnapshot(db,{requireDisposable:false});
 assert.equal(initial.schemaSha256,input.schemas[String(beforeCount)]);assert.equal(initial.totalTableCount,profile.expectedSchema.beforeTableCount);
 const tables=initial.rowCounts.map(e=>e.relation.split('.').map(q).join('.')).join(',');
 await db.query('LOCK TABLE '+tables+' IN SHARE ROW EXCLUSIVE MODE');await noOtherActiveClients();
 const before=await snapshot();assert.equal(before.schema.schemaSha256,input.schemas[String(beforeCount)]);
 assert.deepEqual(before.schema,held.schema);assert.deepEqual(before.content,held.content);assert.equal(before.contentSha256,held.contentSha256);assert.deepEqual(before.financial,held.financial);
 await save('before',before);
 for(const body of bodies)await db.query(body);
 const after=await snapshot();assert.equal(after.schema.schemaSha256,input.schemas[String(count)]);preserved(before,after);
 await save('after-before-commit',{...after,allExistingFieldsCompared:true});
 await databaseBoundary();await noOtherActiveClients();await freshGates();
 await save('commit-intent',{at:new Date().toISOString(),outcome:'unknown_until_acknowledged',schemaSha256:after.schema.schemaSha256,applied:input.delta});
 commitState='sent_outcome_unknown';await db.query('COMMIT');transaction=false;commitState='confirmed';
 await save('commit-acknowledged',{at:new Date().toISOString(),committed:true});
 // COMMIT clears SET LOCAL. Reapply canonical formatting inside a new read-only
 // transaction before comparing durable content; never replay the migration.
 await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';SET LOCAL idle_in_transaction_session_timeout='30s';SET LOCAL TIME ZONE 'UTC';SET LOCAL DateStyle='ISO, MDY';SET LOCAL extra_float_digits=3");verificationTransaction=true;
 await databaseBoundary();await noOtherActiveClients();
 const durableSnapshot=await snapshot();assert.equal(durableSnapshot.schema.schemaSha256,input.schemas[String(count)]);preserved(before,durableSnapshot);assert.deepEqual(durableSnapshot,after);const durable=durableSnapshot.schema;
 await save('durable-verification',durableSnapshot);
 await db.query('COMMIT');verificationTransaction=false;
 await save('committed',{at:new Date().toISOString(),candidate:input.candidate,host:os.hostname(),databaseIdentity:identity,
  sourceMigrationInventory:{count:input.migration.count,latestMigration:input.migration.latest,manifestSha256:input.migration.sha256,domain:input.migration.domain,fileCount:input.migration.fileCount,byteCount:input.migration.byteCount},
  appliedMigrations:input.delta,authorityReceipts:{source:auth.sourceReceipt,writerHolds:auth.writerHoldReceipt,coherentBackup:auth.coherentBackupReceipt,heldDatabaseFingerprint:auth.heldDatabaseFingerprint,rollbackReservation:auth.rollbackReservationReceipt,combinedSmoke:auth.combinedSmokeReceipt,configurationBoundary:auth.configurationBoundaryReceipt,ci:auth.ciReceipt},
  migrationCount:count,tableCount:profile.expectedSchema.afterTableCount,schemaSha256:durable.schemaSha256,retainedOldFieldContentSha256:before.contentSha256,retainedRowsAndFinancialTotalsPreserved:true,allExistingFieldsCompared:true,addedRelationsEmpty:true,applicationStarted:false,postgresRestarted:false});
} catch(error) {
 if(verificationTransaction) {try {await db.query('ROLLBACK');verificationRollbackConfirmed=true;verificationTransaction=false;}catch{}}
 if(transaction&&commitState==='not_attempted') {
  try {await db.query('ROLLBACK');rollbackConfirmed=true;transaction=false;}catch{}
 }
 await save('failure',{at:new Date().toISOString(),name:error.name,code:error.code??null,commitState,rollbackConfirmed,verificationRollbackConfirmed,message:'Stop and review private evidence. No retry, downgrade, restore or service action is authorized.'}).catch(()=>{});
 process.exitCode=1;
} finally {
 try {await db.end();disconnected=true;}finally {
  await save('closeout',{at:new Date().toISOString(),commitState,rollbackConfirmed,verificationRollbackConfirmed,connectionClosed:disconnected,postgresStartedOrStopped:false,applicationOrProviderEffects:false});
 }
}
