#!/usr/bin/env node
// Consolidates the accepted October 20 same-schema and schema-changing binders.
// This command emits local HELD authority only; it never performs a cutover.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const BASE = '/home/mrfantasea/.local/share/sitesourcery-production/releases/';
const SYSTEM = ['tenant', 'workers', 'cloudflared', 'backup.timer', 'monitor.timer',
  'monitor', 'api', 'backup', 'backup-recovery'].map(n =>
  'sitesourcery-hq-' + n + (n.endsWith('.timer') ? '' : '.service'));
const PRIVATE_SERVICES = ['client-profile-hub.service', 'client-profile-hub-backup.service',
  'client-profile-hub-morning-research.service'];
const PRIVATE_TIMERS = ['client-profile-hub-backup.timer', 'client-profile-hub-morning-research.timer'];
const COMMON_EVIDENCE = ['successorInput', 'ciFinalReceipt', 'githubRun', 'githubRawLog',
  'linuxStageReceipt', 'priorOriginSeal', 'priorInstalledReadback', 'priorEpoch',
  'nativeObservation', 'productionReceipt', 'productionMigrationInputs', 'configurationObservation'];
const MODE_EVIDENCE = {
  'presentation-only': ['priorInstallationReceipt', 'schemaObservation'],
  'schema-changing': ['coherentBackupReceipt', 'finalHoldsReceipt', 'combinedSmokeReceipt',
    'heldDatabaseFingerprint', 'rollbackReservationReceipt', 'configurationBoundaryReceipt'],
};
const hash = b => createHash('sha256').update(b).digest('hex');
const execute = promisify(execFile);
function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), label + ' has missing or unknown fields');
}
function hex(value, length, label) { assert.match(value ?? '', new RegExp(`^[a-f0-9]{${length}}$`), label); }
function absolute(value, label) {
  assert(typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value, label);
}
function positive(value, label) { assert(Number.isSafeInteger(value) && value > 0, label); }
function reference(ref, label) {
  exactKeys(ref, ['path', 'sha256'], label); absolute(ref.path, label + '.path'); hex(ref.sha256, 64, label + '.sha256');
}
export function validateNativeReleaseInput(a, now = Date.now()) {
  exactKeys(a, ['schema', 'mode', 'candidate', 'tree', 'priorCandidate', 'priorTree',
    'workflowCommit', 'workflowRun', 'workflowAttempt', 'emissionApproved', 'activationAllowed',
    'issuedAt', 'expiresAt', 'helperRepository', 'outputDirectory', 'databaseIdentity',
    'expectedSchema', 'holdMarker', 'holdDropin', 'baseline', 'evidence'], 'input');
  assert.equal(a.schema, 'sitesourcery.native-release-authority-input/v1');
  assert(Object.hasOwn(MODE_EVIDENCE, a.mode), 'Unknown release mode');
  for (const k of ['candidate', 'tree', 'priorCandidate', 'priorTree', 'workflowCommit']) hex(a[k], 40, k);
  assert.notEqual(a.candidate, a.priorCandidate, 'Candidate must be a successor');
  for (const k of ['workflowRun', 'workflowAttempt']) assert.match(a[k] ?? '', /^[1-9][0-9]*$/, k);
  assert.equal(a.emissionApproved, true); assert.equal(a.activationAllowed, false);
  const issued = Date.parse(a.issuedAt), expires = Date.parse(a.expiresAt);
  assert(Number.isFinite(now) && Number.isFinite(issued) && Number.isFinite(expires) &&
    issued <= now && now < expires && expires - issued <= 30 * 60 * 1000,
  'Emission authority must be current and no longer than 30 minutes');
  absolute(a.helperRepository, 'helperRepository'); absolute(a.outputDirectory, 'outputDirectory');
  assert.notEqual(a.outputDirectory, a.helperRepository);
  exactKeys(a.databaseIdentity, ['db', 'databaseOid', 'username', 'directory', 'port', 'sockets'], 'databaseIdentity');
  assert.equal(a.databaseIdentity.db, 'sitesourcery_production');
  assert.equal(a.databaseIdentity.username, 'mrfantasea');
  assert.match(a.databaseIdentity.databaseOid ?? '', /^[1-9][0-9]*$/);
  assert.match(a.databaseIdentity.port ?? '', /^[1-9][0-9]{0,4}$/);
  absolute(a.databaseIdentity.directory, 'database directory'); absolute(a.databaseIdentity.sockets, 'database sockets');
  exactKeys(a.expectedSchema, ['beforeCount', 'afterCount', 'manifestSha256', 'schemaSha256', 'tableCount'], 'expectedSchema');
  for (const k of ['beforeCount', 'afterCount', 'tableCount']) positive(a.expectedSchema[k], k);
  hex(a.expectedSchema.manifestSha256, 64, 'manifestSha256'); hex(a.expectedSchema.schemaSha256, 64, 'schemaSha256');
  if (a.mode === 'presentation-only') assert.equal(a.expectedSchema.beforeCount, a.expectedSchema.afterCount);
  else assert(a.expectedSchema.afterCount > a.expectedSchema.beforeCount, 'Schema mode requires appended migrations');
  assert.match(a.holdMarker ?? '', /^\/etc\/sitesourcery\/[A-Z0-9_]+_HOLD$/);
  assert.match(a.holdDropin ?? '', /^zz-[a-z0-9-]+-handoff-hold\.conf$/);
  const baseKeys = ['workerPurposes', 'workerActivation', 'postgresql', 'privateHqTimers', 'holdFiles'];
  exactKeys(a.baseline, [...baseKeys, ...(a.mode === 'presentation-only' ? ['privateHq'] : ['privateHqServices', 'careMode', 'workerCareMode'])], 'baseline');
  const purposes = a.baseline.workerPurposes;
  assert(Array.isArray(purposes) && purposes.includes('export') && purposes.every(p => typeof p === 'string' && /^[a-z][a-z-]*$/.test(p)));
  assert.equal(new Set(purposes).size, purposes.length, 'Duplicate worker purpose');
  assert.equal(a.baseline.workerActivation, 'owner-approved');
  const holds = [a.holdMarker, ...SYSTEM.map(n => `/etc/systemd/system/${n}.d/${a.holdDropin}`)];
  if (a.mode === 'schema-changing') holds.push(...[...PRIVATE_SERVICES, ...PRIVATE_TIMERS]
    .map(n => `/home/mrfantasea/.config/systemd/user/${n}.d/${a.holdDropin}`));
  exactKeys(a.baseline.holdFiles, holds, 'durable hold inventory');
  for (const [name, m] of Object.entries(a.baseline.holdFiles)) {
    exactKeys(m, ['sha256', 'uid', 'gid', 'mode', 'bytes'], 'hold metadata');
    hex(m.sha256, 64, 'hold sha256'); positive(m.bytes, 'hold bytes');
    assert.equal(m.uid, 0); assert.equal(m.gid, 0);
    assert.equal(m.mode, name === a.holdMarker ? (a.mode === 'schema-changing' ? 0o644 : 0o600) : 0o644);
  }
  exactKeys(a.evidence, [...COMMON_EVIDENCE, ...MODE_EVIDENCE[a.mode]], 'evidence');
  for (const [k, ref] of Object.entries(a.evidence)) reference(ref, k);
  return a;
}
async function anchored(ref) {
  reference(ref, 'receipt');
  const st = await fs.lstat(ref.path);
  assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size > 0 && st.size <= 32 * 1024 * 1024, 'Invalid receipt file');
  const raw = await fs.readFile(ref.path);
  assert.equal(hash(raw), ref.sha256, 'Anchored input drift: ' + ref.path);
  return raw;
}
function held(o, a, now) {
  const expected = a.baseline;
  assert.equal(o.readOnly, true); assert.equal(o.currentTarget, BASE + a.priorCandidate);
  assert.equal(o.ready, null, 'Held observation cannot claim live readiness');
  assert.deepEqual(o.workerPurposes, expected.workerPurposes); assert.equal(o.workerActivation, expected.workerActivation);
  for (const name of SYSTEM.filter(n => n.endsWith('.service'))) {
    assert.equal(o.units[name].ActiveState, 'inactive'); assert.equal(o.units[name].MainPID, '0');
  }
  assert.equal(o.units['sitesourcery-hq-gateway.service'].ActiveState, 'active');
  assert.deepEqual(o.userUnits['sitesourcery-production-postgresql.service'], expected.postgresql);
  assert.equal(expected.postgresql.ActiveState, 'active'); assert(Number(expected.postgresql.MainPID) > 0);
  assert.deepEqual(o.userTimers, expected.privateHqTimers);
  if (a.mode === 'presentation-only') {
    assert.deepEqual(o.userUnits['client-profile-hub.service'], expected.privateHq);
    assert.equal(expected.privateHq.ActiveState, 'active'); assert(Number(expected.privateHq.MainPID) > 0);
  } else {
    assert.equal(o.careMode, expected.careMode); assert.equal(o.workerCareMode, expected.workerCareMode);
    exactKeys(expected.privateHqServices, PRIVATE_SERVICES, 'private HQ services');
    exactKeys(expected.privateHqTimers, PRIVATE_TIMERS, 'private HQ timers');
    for (const name of PRIVATE_SERVICES) {
      assert.deepEqual(o.userUnits[name], expected.privateHqServices[name]);
      assert.equal(o.userUnits[name].LoadState, 'loaded'); assert.equal(o.userUnits[name].ActiveState, 'inactive');
      assert.equal(o.userUnits[name].MainPID, '0');
    }
    for (const u of Object.values(o.userTimers)) { assert.equal(u.LoadState, 'loaded'); assert.equal(u.ActiveState, 'inactive'); }
    assert.equal(o.userTimers['client-profile-hub-morning-research.timer'].UnitFileState, 'disabled');
  }
  for (const u of Object.values(o.timers)) assert.equal(u.ActiveState, 'inactive');
  for (const name of ['backup', 'monitor']) assert.equal(o.timers[`sitesourcery-hq-${name}.timer`].ActiveState, 'inactive');
  for (const [p, want] of Object.entries(expected.holdFiles)) assert.deepEqual(o.files[p], want, 'Durable hold drift: ' + p);
  const observed = Date.parse(o.at);
  assert(Number.isFinite(observed) && observed <= now && now - observed <= 30 * 60 * 1000, 'Fresh held observation required');
}

// Clock injection is for offline historical rehearsals. The CLI always uses actual time.
// This function returns bytes only; it cannot install files or invoke native service/SQL commands.
export async function constructNativeReleaseAuthority(inputRef, { now = Date.now() } = {}) {
  const a = validateNativeReleaseInput(JSON.parse(await anchored(inputRef)), now);
  const C = a.candidate, T = a.tree, OLD = a.priorCandidate, target = a.expectedSchema;
  const git = async args => (await execute('/usr/bin/git', ['--no-optional-locks', '-C', a.helperRepository, ...args], {maxBuffer: 4 * 1024 * 1024})).stdout.trim();
  assert.equal(await git(['status', '--porcelain']), '', 'Helper repository must be clean');
  assert.equal(await git(['rev-parse', C + '^{tree}']), T);
  assert(['', `ops/releases/ci-successor-inputs/${C}.json`].includes(await git(['diff', '--name-only', C])), 'Noncandidate helper source');
  const mod = name => import(pathToFileURL(path.join(a.helperRepository, 'ops', name)).href);
  const {validateCiReleaseSuccessorInput, validateCiReleaseFinalReceipt} = await mod('ci-release-proof-runtime.mjs');
  const {validateOriginSeal, originFileManifestSha256, originEnvironmentClassificationSha256,
    originWorkerContractSha256, createOriginInstalledReadback, compareOriginInstalledReadback, ORIGIN_HELD_AUTHORITY} = await mod('origin-seal-runtime.mjs');
  const {createHeldFinalReleaseEpochV2, validateInstalledFinalReleaseEpochV2Chain} = await mod('final-release-epoch-v2.mjs');
  const bytes = {}, v = {};
  for (const [name, ref] of Object.entries(a.evidence)) {
    bytes[name] = await anchored(ref); if (name !== 'githubRawLog') v[name] = JSON.parse(bytes[name]);
  }
 const input=validateCiReleaseSuccessorInput(v.successorInput),ci=validateCiReleaseFinalReceipt(v.ciFinalReceipt),stage=v.linuxStageReceipt,seal=validateOriginSeal(stage.validation.seal);
 assert.equal(ci.candidateSha,C);assert.equal(ci.successorInputDigest,input.digest);
 assert.equal(ci.workflowSha,a.workflowCommit);assert.equal(ci.runId,a.workflowRun);assert.equal(ci.runAttempt,a.workflowAttempt);
 const run=v.githubRun;assert.equal(String(run.id),ci.runId);assert.equal(String(run.run_attempt),ci.runAttempt);assert.equal(run.head_sha,ci.workflowSha);assert.equal(run.conclusion,'success');assert.equal(run.status,'completed');assert.equal(run.event,'workflow_dispatch');assert.equal(run.repository.full_name,'MrFantaSea/sitesourcery');
 const originals=[];for(const line of bytes.githubRawLog.toString().split(/\r?\n/)){const i=line.indexOf('{');if(i<0)continue;try{const raw=line.slice(i).trimEnd();if(JSON.parse(raw).schema===ci.schema)originals.push(raw);}catch{}}
 assert.deepEqual(originals,[bytes.ciFinalReceipt.toString().trimEnd()],'Final receipt must be the actual original logged receipt');
 assert.equal(stage.status,'staged_inert');assert.deepEqual(stage.validation.checkout,{projectRoot:BASE+C,head:C,tree:T,status:''});assert.deepEqual(seal.source,{commitSha:C,treeSha:T});assert.equal(seal.deploymentProfile,'hq-local-v1');
 assert.equal(seal.releaseInputDigest,input.originReleaseInput.digest);assert.equal(seal.artifact.sha256,input.originReleaseInput.epoch.artifact.manifestSha256);
 const actual=new Map(stage.inventory.entries.filter(e=>e.type==='file').map(e=>[e.path,e]));
 const measured={};for(const key of ['artifact','units','environmentSchema','worker','migration','legal','ingress']) {
  const source=seal[key],files=source.files.map(e=>{const observed=actual.get(e.path);assert(observed,'Missing staged '+e.path);assert.equal(observed.sha256,e.sha256);assert.equal(observed.byteCount,e.byteCount);return {path:e.path,byteCount:observed.byteCount,sha256:observed.sha256};});
  measured[key]=originFileManifestSha256({domain:source.domain,files});assert.equal(measured[key],source.sha256);
 }

 const prior=validateOriginSeal(v.priorOriginSeal);
 assert.deepEqual(prior.source,{commitSha:OLD,treeSha:a.priorTree});
 assert.equal(prior.migration.count,target.beforeCount);
 validateInstalledFinalReleaseEpochV2Chain({epoch:v.priorEpoch,originSeal:prior,installedReadback:v.priorInstalledReadback});
 assert.equal(seal.migration.count,target.afterCount);
 assert.equal(seal.migration.sha256,target.manifestSha256);
 if(a.mode==='presentation-only') assert.deepEqual(seal.migration,prior.migration,'Presentation mode cannot change any migration bytes');
 else assert.deepEqual(seal.migration.files.slice(0,target.beforeCount),prior.migration.files,'Only appended migrations allowed');
 for(const key of a.mode==='presentation-only'?['units','environmentSchema','worker','legal','ingress']:['units','legal','ingress'])
   assert.equal(seal[key].sha256,prior[key].sha256,'Unexpected source template change '+key);
 const native=v.nativeObservation;held(native,a,now);
 for(const [name,key]of [['origin-seal.json','priorOriginSeal'],['origin-installed-readback.json','priorInstalledReadback'],['final-release-epoch-v2.json','priorEpoch']])
   assert.equal(native.files['/etc/sitesourcery/'+name].sha256,hash(bytes[key]));
 const prod=v.productionReceipt,migrationInput=v.productionMigrationInputs;
 assert.equal(prod.host,'FantaSeaLand');assert.deepEqual(prod.databaseIdentity,a.databaseIdentity);
 assert.deepEqual(migrationInput.candidate,prod.candidate);
 assert.equal(migrationInput.expectedDatabaseOid,prod.databaseIdentity.databaseOid);
 assert.equal(migrationInput.migration.sha256,measured.migration);
 assert.equal(prod.migrationCount,target.afterCount);assert.equal(prod.tableCount,target.tableCount);
 assert.equal(prod.schemaSha256,migrationInput.schemas[String(target.afterCount)]);
 assert.equal(prod.schemaSha256,target.schemaSha256);
 for(const k of ['retainedRowsAndFinancialTotalsPreserved','allExistingFieldsCompared'])assert.equal(prod[k],true);
 assert.equal(prod.postgresRestarted,false);
 assert.deepEqual(prod.appliedMigrations,migrationInput.delta);
 assert(prod.appliedMigrations.length>0);
 assert.deepEqual(prod.appliedMigrations.map(f=>({path:f.path,sha256:f.sha256,byteCount:f.byteCount})),
   seal.migration.files.slice(-prod.appliedMigrations.length)
     .map(f=>({path:f.path,sha256:f.sha256,byteCount:f.byteCount})),'Committed migration delta must match source');
 assert.deepEqual(prod.sourceMigrationInventory,{count:seal.migration.count,latestMigration:seal.migration.latest,
   manifestSha256:measured.migration,domain:seal.migration.domain,fileCount:seal.migration.fileCount,byteCount:seal.migration.byteCount});
 if(a.mode==='schema-changing') {
   assert.deepEqual(prod.candidate,{commitSha:C,treeSha:T});assert.equal(prod.applicationStarted,false);
   assert.equal(prod.appliedMigrations.length,target.afterCount-target.beforeCount);
   for(const [actual,expected]of [['coherentBackup','coherentBackupReceipt'],['writerHolds','finalHoldsReceipt'],
     ['source','linuxStageReceipt'],['ci','ciFinalReceipt'],['combinedSmoke','combinedSmokeReceipt'],
     ['heldDatabaseFingerprint','heldDatabaseFingerprint'],['rollbackReservation','rollbackReservationReceipt'],
     ['configurationBoundary','configurationBoundaryReceipt']])
     assert.equal(prod.authorityReceipts[actual].sha256,a.evidence[expected].sha256,'Production authority mismatch: '+actual);
   assert(Number.isFinite(Date.parse(prod.at))&&Date.parse(prod.at)<=Date.parse(native.at),'Observation must follow confirmed commit');
 } else {
   const installed=v.priorInstallationReceipt;
   assert.equal(installed.state,'installed_held');assert.equal(installed.candidate,OLD);
   assert.equal(installed.tree,a.priorTree);assert.equal(installed.migrationCount,target.beforeCount);
   assert(Number.isFinite(Date.parse(prod.at)) && Date.parse(prod.at) <= Date.parse(installed.at),
     'Historical migration must precede the accepted prior installation');
   // Accepted legacy receipts retain their original names and bytes. A later presentation
   // release may inherit a genuine migration receipt from an earlier candidate.
   const provenance=Object.entries(installed).filter(([k])=>/^(?:historicalProduction|production)(?:[0-9]+)?Receipt$/.test(k));
   assert.equal(provenance.length,1,'One prior installation migration provenance link required');
   assert.equal(provenance[0][1].sha256,a.evidence.productionReceipt.sha256);
   for(const [name,key]of [['origin-seal.json','priorOriginSeal'],['origin-installed-readback.json','priorInstalledReadback'],['final-release-epoch-v2.json','priorEpoch']])
     assert.equal(installed.nativeFiles['/etc/sitesourcery/'+name].sha256,a.evidence[key].sha256);
   const observed=v.schemaObservation;
   assert([`sitesourcery-same-schema${target.afterCount}-readback-v1`,
     'sitesourcery.same-schema-readback/v1'].includes(observed.schema), 'Unknown schema observation contract');
   assert.equal(observed.host,'FantaSeaLand');assert.equal(observed.readOnly,true);assert.equal(observed.databaseWrites,false);
   assert.deepEqual(observed.source,{commitSha:OLD,treeSha:a.priorTree});assert.deepEqual(observed.databaseIdentity,a.databaseIdentity);
   assert.equal(observed.schemaSha256,target.schemaSha256);assert.equal(observed.tableCount,target.tableCount);
   assert.equal(observed.migrationCount,target.afterCount);assert.equal(observed.migrationManifestSha256,measured.migration);
   const at=Date.parse(observed.at);
   assert(Number.isFinite(at)&&Date.parse(installed.at)<=at&&at<=now&&now-at<=30*60*1000,'Fresh schema observation required');
 }
 const config=v.configurationObservation;
 assert.equal(config.freshInputsReviewed,true);assert.equal(config.providerModesPreserved,true);
 if(a.mode==='presentation-only') {
   assert.equal(config.siteCodeWritersHeld,true);assert.equal(config.independentServicesPreserved,true);
   assert.equal(config.careMode,'approved_live');
 } else {
   assert.equal(config.careMode,a.baseline.careMode);assert.equal(config.workerCareMode,a.baseline.workerCareMode);
   assert.equal(config.careMode,native.careMode);assert.equal(config.workerCareMode,native.workerCareMode);
   assert.equal(config.noNewApplicationWrites,true);
 }
 assert.deepEqual(config.workerPurposes,a.baseline.workerPurposes);assert.deepEqual(config.listeners,seal.ingress.expectations);
 assert.deepEqual(config.files,native.files,'Current observed configuration changed');
 const identity={sourceCommitSha:C,sourceTreeSha:T,artifactManifestSha256:measured.artifact,unitManifestSha256:measured.units,
   environmentSchemaManifestSha256:measured.environmentSchema,environmentClassificationSha256:originEnvironmentClassificationSha256(seal.environmentSchema),
   workerManifestSha256:measured.worker,workerContractSha256:originWorkerContractSha256(seal.worker.contract),
   migrationCount:target.afterCount,latestMigration:seal.migration.latest,migrationManifestSha256:measured.migration,
   legalAuthorityDigest:seal.legal.authorityDigest,legalManifestSha256:measured.legal,ingressManifestSha256:measured.ingress};
 const readback=createOriginInstalledReadback({seal,
   observedAt:a.mode==='presentation-only'?new Date(native.at).toISOString():prod.at,identity,
   worker:structuredClone(seal.worker.contract),listeners:config.listeners,authority:ORIGIN_HELD_AUTHORITY});
 assert.equal(compareOriginInstalledReadback({seal,readback}).state,'verified');
 const epoch=createHeldFinalReleaseEpochV2({successorInput:input,ciFinalReceipt:ci,originSeal:seal,installedReadback:readback});
 validateInstalledFinalReleaseEpochV2Chain({epoch,originSeal:seal,installedReadback:readback});
 const binding={candidate:C,tree:T,priorInstalledCandidate:OLD,mode:a.mode,nativeInstallationPending:true,activationAllowed:false,
   productionReceipt:a.evidence.productionReceipt,productionSchemaSha256:prod.schemaSha256,
   actualHeldObservation:a.evidence.nativeObservation,actualNativeFiles:native.files,actualWorkerPurposes:native.workerPurposes,
   canonicalIdentityBasis:'Measured staged manifests, genuine production migration provenance and fresh held native observations.',
   nativeIdentityBasis:'Prior native files remain installed; this local emitted packet is not proof of installation or activation.',
   canonicalReadbackDigest:readback.digest,finalEpochBindingSha256:epoch.bindingSha256};
 // Keep compatibility with the accepted finite native installers. Their frozen source
 // and original receipts are not rewritten by this consolidation.
 const productionKey=`production${target.afterCount}Receipt`;
 if(a.mode==='presentation-only') {
   binding[`historicalProduction${target.afterCount}Receipt`]=a.evidence.productionReceipt;
   binding.actualSchemaObservation=a.evidence.schemaObservation;
 } else binding[productionKey]=a.evidence.productionReceipt;
 const output={};
 for(const [name,value]of Object.entries({'origin-seal.json':seal,'origin-installed-readback.json':readback,
   'final-release-epoch-v2.json':epoch,'native-observation-binding.json':binding}))
   output[name]=Buffer.from(JSON.stringify(value,null,2)+'\n');
 const receipt={schema:'sitesourcery.native-release-authority-result/v1',mode:a.mode,
   state:a.mode==='presentation-only'?'held_same_schema_successor_authority_constructed':'held_migration_successor_authority_constructed',
   candidate:C,tree:T,priorCandidate:OLD,migrationCount:target.afterCount,activationAllowed:false,nativeInstallationPending:true,
   databaseMigrationPerformedByThisCommand:false,providerRequests:0,serviceCommands:0,input:inputRef,
   evidence:a.evidence,files:Object.fromEntries(Object.entries(output).map(([name,b])=>[name,{sha256:hash(b),bytes:b.length}]))};
 Object.assign(receipt,{[productionKey]:a.evidence.productionReceipt,
   productionMigrationInputs:a.evidence.productionMigrationInputs,
   actualNativeObservation:a.evidence.nativeObservation,configurationObservation:a.evidence.configurationObservation});
 for(const key of MODE_EVIDENCE[a.mode]) receipt[key]=a.evidence[key];
 output['authority-receipt.json']=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
 return {input:a,receipt,output};
}

export async function emitNativeReleaseAuthority(inputRef) {
 const built=await constructNativeReleaseAuthority(inputRef);
 const parent=path.dirname(built.input.outputDirectory);
 assert.equal(await fs.realpath(parent),parent,'Output parent must not traverse symlinks');
 validateNativeReleaseInput(built.input); // Recheck expiry after potentially slow disk/Git reads.
 await fs.mkdir(built.input.outputDirectory,{mode:0o700}); // Exclusive: never replace an earlier attempt.
 for(const [name,bytes]of Object.entries(built.output))
   await fs.writeFile(path.join(built.input.outputDirectory,name),bytes,{flag:'wx',mode:0o600});
 return built.receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 process.umask(0o077);
 const [inputPath,inputHash,...extra]=process.argv.slice(2);
 if(!inputPath||!inputHash||extra.length) {console.error('Usage: node ops/native-release-authority.mjs INPUT.json INPUT_SHA256');process.exitCode=1;}
 else emitNativeReleaseAuthority({path:inputPath,sha256:inputHash})
   .then(r=>console.log(JSON.stringify(r)))
   .catch(e=>{console.error('Authority not emitted: '+e.message);process.exitCode=1;});
}
