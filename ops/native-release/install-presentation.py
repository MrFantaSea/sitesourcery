#!/usr/bin/python3
"""Existing atomic updater for an unchanged schema. No migration, service start, or automatic rollback."""
import datetime,fcntl,hashlib,json,os,re,socket,stat,subprocess,sys,time
from pathlib import Path

# The profile is data; no native command runs while loading or validating it.
import importlib.util
_profile_spec=importlib.util.spec_from_file_location('sitesourcery_release_profile',Path(__file__).with_name('profile.py'))
_profile=importlib.util.module_from_spec(_profile_spec);_profile_spec.loader.exec_module(_profile)
_isolation_spec=importlib.util.spec_from_file_location('sitesourcery_release_isolation',Path(__file__).with_name('isolation.py'))
_isolation=importlib.util.module_from_spec(_isolation_spec);_isolation_spec.loader.exec_module(_isolation)
require_profile=_profile.require
require_profile(len(sys.argv)>=4,'PROFILE SHA256 ACTION required')
PROFILE_REF={'path':sys.argv[1],'sha256':sys.argv[2]}
PROFILE=_profile.load_profile(sys.argv[1],sys.argv[2],'presentation-only')
PATHS=_profile.derived(PROFILE);COUNT=PROFILE['expectedSchema']['afterCount'];BEFORE_COUNT=PROFILE['expectedSchema']['beforeCount']
TABLES=PROFILE['expectedSchema']['afterTableCount'];BEFORE_TABLES=PROFILE['expectedSchema']['beforeTableCount']
sys.argv=[sys.argv[0]]+sys.argv[3:]
if sys.argv[1:]==['validate']:
 print(json.dumps({'valid':True,'mode':PROFILE['mode'],'candidate':PROFILE['candidate'],'migrationCount':COUNT,'holdCount':len(PATHS['holdPaths']),'nativeEffects':False}));sys.exit(0)

BASE=Path('/home/mrfantasea/.local/share/sitesourcery-production');CONFIG=Path('/etc/sitesourcery')
HERE=Path(__file__).resolve().parent;NODE=PROFILE['runtime']['node']
PATH_FILES={
 '/etc/systemd/system/sitesourcery-hq-api.service':1,
 '/etc/systemd/system/sitesourcery-hq-tenant.service':1,
 '/etc/systemd/system/sitesourcery-hq-backup.service':2,
 '/etc/systemd/system/sitesourcery-hq-backup-recovery.service':1,
 '/etc/systemd/system/sitesourcery-hq-monitor.service':1,
 '/etc/systemd/system/sitesourcery-hq-backup.service.d/90-live-recovery-sources.conf':1,
 '/etc/systemd/system/sitesourcery-hq-backup.service.d/95-build-tool-link-view.conf':1}
AUTH={'final-release-epoch-v2.json':'SITESOURCERY_RELEASE_EPOCH_SHA256','origin-seal.json':'SITESOURCERY_ORIGIN_SEAL_FILE_SHA256','origin-installed-readback.json':'SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256'}
PRESERVE=['workers.env','WORKERS_APPROVED','WORKERS_HOLD','PUBLICATION_HOLD','RUNTIME_APPROVED','R4_STAGE_RELEASED','CLOUDFLARE_TUNNEL_APPROVED','backup.env','monitor.env','operations-state-approved.json','monitor-alert-approved.json']
SYSTEM_NAMES=['sitesourcery-hq-'+n+'.service' for n in ('api','tenant','workers','gateway','cloudflared','backup','backup-recovery','monitor')]
USER_NAMES=['sitesourcery-production-postgresql.service','client-profile-hub.service']
USER_ENV=['/usr/sbin/runuser','-u','mrfantasea','--','/usr/bin/env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus']
sha=lambda b:hashlib.sha256(b).hexdigest()
OUT=None

def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def raw(p):
 p=Path(p);s=p.lstat();require(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'Nonregular/shared input: '+str(p));return p.read_bytes()
def meta(p):
 p=Path(p)
 if not os.path.lexists(p):return None
 s=p.lstat();return {'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size,'sha256':sha(raw(p))}
def run(args):
 try:return subprocess.check_output(args,stderr=subprocess.PIPE,timeout=45)
 except subprocess.CalledProcessError as e:
  if OUT and OUT.exists():save('command-failure.json',{'argv':args,'exitCode':e.returncode,'stdout':e.output.decode(errors='replace'),'stderr':e.stderr.decode(errors='replace')})
  raise
def states(names,user=False,timer=False):
 props='Id,LoadState,ActiveState,SubState,UnitFileState' if timer else 'Id,LoadState,ActiveState,SubState,MainPID,NRestarts,UnitFileState,WorkingDirectory'
 args=(USER_ENV+['/usr/bin/systemctl','--user'] if user else ['/usr/bin/systemctl'])+['show','-p',props]+names
 b=run(args).decode();r={r['Id']:r for r in [dict(x.split('=',1) for x in part.splitlines() if '=' in x) for part in b.strip().split('\n\n')]}
 require(set(r)==set(names),'Unit observation incomplete');return r
def hold_path(p):
 mutable=set(PATH_FILES)|{str(CONFIG/n) for n in AUTH}|{str(CONFIG/n) for n in ('hosted.env','tenant.env')}
 return isinstance(p,str) and str(Path(p))==p and p.startswith(('/etc/sitesourcery/','/etc/systemd/system/sitesourcery-')) and '..' not in Path(p).parts and p not in mutable and Path(p).suffix!='.env'

def observation(a):
 prior=BASE/'releases'/a['priorCandidate'];old_links=CONFIG/'recovery'/('build-tool-links-c'+a['priorCandidate'][:8]+'.json')
 isolation=_isolation.observe(PROFILE,verify=False)
 extra=([str(_isolation.POLICY),str(_isolation.MARKER),*_isolation.native_context(PROFILE)[1]['files']] if isolation else [])
 paths=list(dict.fromkeys(extra+list(PATH_FILES)+[str(CONFIG/n) for n in list(AUTH)+['hosted.env','tenant.env']+PRESERVE]+[str(old_links)]+a['holdPaths']))
 require(all(hold_path(p) for p in a['holdPaths']),'Unexpected hold path')
 env=raw(CONFIG/'workers.env').decode();m=re.search(r'^SITESOURCERY_WORKER_CONFIG=(.+)$',env,re.M);require(m,'Worker config absent');worker=json.loads(json.loads(m[1]))
 require(worker['purposes']==PROFILE['workerPurposes'],'Accepted configured-purpose worker configuration required')
 api=raw(CONFIG/'hosted.env').decode();m=re.search(r'^SITESOURCERY_CARE_MODE=(.+)$',api,re.M)
 require(m is not None and json.loads(m[1])==PROFILE['careMode'],'Existing Care activation must be preserved')
 return {'at':now(),'readOnly':True,'currentTarget':str((BASE/'current').resolve()),'ready':None,'files':{p:meta(p) for p in paths},
  'units':states(SYSTEM_NAMES),'userUnits':states(USER_NAMES,True),'timers':states(['sitesourcery-hq-backup.timer','sitesourcery-hq-monitor.timer'],timer=True),
  'userTimers':states(['client-profile-hub-backup.timer'],True,True),'workerPurposes':worker['purposes'],'workerActivation':worker['activation'],**({'isolation':isolation} if isolation else {})}
def held(o,a):
 require(o['currentTarget']==str(BASE/'releases'/a['priorCandidate']),'Current release changed')
 require(o['workerPurposes']==a['baseline']['workerPurposes'] and o['workerActivation']==a['baseline']['workerActivation'],'Worker purpose drift')
 require('export' in o['workerPurposes'],'Export baseline missing')
 for n in ('api','tenant','workers','cloudflared','backup','backup-recovery','monitor'):
  u=o['units']['sitesourcery-hq-'+n+'.service'];require(u['LoadState']=='loaded' and u['ActiveState']=='inactive' and u['MainPID']=='0','Writer/operation not held: '+n)
 require(o['units']['sitesourcery-hq-gateway.service']['ActiveState']==('inactive' if _isolation.enabled(PROFILE) else 'active'),'Gateway state changed')
 if _isolation.enabled(PROFILE):require(o['units']['sitesourcery-hq-gateway.service']['MainPID']=='0','Gateway not held')
 require(o['userUnits']['sitesourcery-production-postgresql.service']==a['baseline']['postgresql'],'PostgreSQL identity/state changed')
 require(a['baseline']['postgresql']['ActiveState']=='active' and int(a['baseline']['postgresql']['MainPID'])>0,'PostgreSQL unavailable')
 h=o['userUnits']['client-profile-hub.service'];require(h==a['baseline']['privateHq'] and h['ActiveState']=='active' and int(h['MainPID'])>0,'Independent private HQ changed or stopped')
 require(o['userTimers']==a['baseline']['privateHqTimers'],'Independent private HQ timers changed')
 for n,u in o['timers'].items():require(u['LoadState']=='loaded' and u['ActiveState']=='inactive','Site timer not held: '+n)
 require(a['baseline']['holdFiles'] and set(a['holdPaths'])==set(a['baseline']['holdFiles']),'Exact durable hold files required')
 for p,v in a['baseline']['holdFiles'].items():require(o['files'][p]==v,'Durable hold changed: '+p)

def atomic(p,b,metadata,effect_gate=None):
 p=Path(p);temp=p.with_name(p.name+'.native-release-update-'+sha(b)+'.tmp');fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,metadata['mode'])
 with os.fdopen(fd,'wb') as f:os.fchown(f.fileno(),metadata['uid'],metadata['gid']);os.fchmod(f.fileno(),metadata['mode']);f.write(b);f.flush();os.fsync(f.fileno())
 if effect_gate:effect_gate()
 os.replace(temp,p);fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def save(name,value):atomic(OUT/name,(json.dumps(value,indent=2)+'\n').encode(),{'mode':0o600,'uid':0,'gid':0})
def pointer(target,metadata,effect_gate=None):
 require(re.fullmatch('[a-f0-9]{40}',target.name),'Invalid pointer candidate')
 p=BASE/'current';temp=BASE/('current.native-release-update-'+target.name+'.tmp');os.symlink(target,temp);os.lchown(temp,metadata['uid'],metadata['gid'])
 if effect_gate:effect_gate()
 os.replace(temp,p)
 fd=os.open(BASE,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def pinned(ref):
 require(isinstance(ref,dict) and isinstance(ref.get('path'),str) and Path(ref['path']).is_absolute() and re.fullmatch('[a-f0-9]{64}',ref.get('sha256') or ''),'Missing pinned receipt')
 b=raw(ref['path']);require(sha(b)==ref['sha256'],'Pinned receipt changed');return json.loads(b)
def validate_authority(directory,digests,new):
 args=[NODE,str(new/'ops/verify-final-release-epoch-v2.mjs')]
 for name,key in [('final-release-epoch-v2.json','epoch'),('origin-seal.json','origin-seal'),('origin-installed-readback.json','installed-readback')]:args+=['--'+key,str(directory/name),'--'+key+'-sha256',digests[name]]
 v=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--']+args));require(v.get('valid') is True and v['candidateCommitSha']==new.name and v['migrationCount']==COUNT,'Canonical authority verification failed');return v

def validate_staged_authority(directory,digests,new,prior_worker,worker_delta):
 for parent in (HERE,directory):
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_gid==1000 and stat.S_IMODE(st.st_mode)==0o750,'Staged authority directory custody changed')
 for name in AUTH:
  p=directory/name;st=p.lstat();require(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==0 and st.st_gid==1000 and stat.S_IMODE(st.st_mode)==0o640,'Staged authority file custody changed')
  require(sha(raw(p))==digests[name],'Staged authority digest mismatch')
 script="""import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [release,directory,pinnedDigests,priorWorker,workerDelta]=process.argv.slice(1);
const digests=JSON.parse(pinnedDigests);
const read=name=>{const bytes=fs.readFileSync(path.join(directory,name));assert.equal(createHash('sha256').update(bytes).digest('hex'),digests[name]);return JSON.parse(bytes);};
const {validateInstalledFinalReleaseEpochV2Chain}=await import(pathToFileURL(path.join(release,'ops/final-release-epoch-v2.mjs')).href);
const seal=read('origin-seal.json');
const epoch=validateInstalledFinalReleaseEpochV2Chain({epoch:read('final-release-epoch-v2.json'),originSeal:seal,installedReadback:read('origin-installed-readback.json')});
const {assertSameSchemaWorkerChange}=await import(pathToFileURL(path.join(release,'ops/native-release-authority.mjs')).href);
assertSameSchemaWorkerChange(JSON.parse(priorWorker),seal.worker,JSON.parse(workerDelta) ?? undefined);
console.log(JSON.stringify({valid:true,candidateCommitSha:epoch.identity.sourceCommitSha,migrationCount:epoch.identity.migrationCount}));"""
 v=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--',NODE,'--input-type=module','-e',script,str(new),str(directory),json.dumps(digests),json.dumps(prior_worker),json.dumps(worker_delta)]))
 require(v.get('valid') is True and v['candidateCommitSha']==new.name and v['migrationCount']==COUNT,'Canonical staged authority verification failed');return v

def schema_observation(a,rollback_originals=None):
 prior=BASE/'releases'/a['priorCandidate']
 if rollback_originals is None:
  require((BASE/'current').resolve()==prior,'Schema observation source is not current')
  seal=json.loads(raw(CONFIG/'origin-seal.json'))
  validate_authority(CONFIG,{n:sha(raw(CONFIG/n)) for n in AUTH},prior)
 else:
  # Current anchors may be mixed after partial installation. Validate only the
  # exact saved originals already checked against the finite pinned journal.
  require(set(rollback_originals)==set(AUTH),'Original authority set incomplete')
  seal=pinned(rollback_originals['origin-seal.json'])
  for ref in rollback_originals.values():pinned(ref)
  # The installed-path CLI accepts /etc only. Reuse its canonical in-memory
  # validator, as the existing staged-authority check does, for saved originals.
  script="""import fs from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const [source,rawRefs]=process.argv.slice(1),refs=JSON.parse(rawRefs);
const read=name=>{const r=refs[name],b=fs.readFileSync(r.path);assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256);return JSON.parse(b);};
const {validateInstalledFinalReleaseEpochV2Chain}=await import(pathToFileURL(source+'/ops/final-release-epoch-v2.mjs').href);
const epoch=validateInstalledFinalReleaseEpochV2Chain({epoch:read('final-release-epoch-v2.json'),originSeal:read('origin-seal.json'),installedReadback:read('origin-installed-readback.json')});
console.log(JSON.stringify({valid:true,candidateCommitSha:epoch.identity.sourceCommitSha,candidateTreeSha:epoch.identity.sourceTreeSha,migrationCount:epoch.identity.migrationCount}));"""
  # Root reads its0600 original JSON; the database connection below remains UID1000.
  v=json.loads(run([NODE,'--input-type=module','-e',script,str(prior),json.dumps(rollback_originals)]));require(v.get('valid') is True and v['candidateCommitSha']==prior.name and v['candidateTreeSha']==a['priorTree'] and v['migrationCount']==COUNT,'Saved original authority invalid')
 require(seal['source']=={'commitSha':a['priorCandidate'],'treeSha':a['priorTree']} and seal['migration']['count']==COUNT and seal['migration']['sha256']==PROFILE['expectedSchema']['manifestSha256'],'Prior source changed')
 for name,digest in PROFILE['collectorFiles'].items():require(sha(raw(prior/name))==digest,'Existing schema collector changed')
 script="""import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const [source,expected,rawSchema]=process.argv.slice(1),identity=JSON.parse(expected),schema=JSON.parse(rawSchema);
const {Client}=createRequire(source+'/package.json')('pg');
const {collectFin008DatabaseSnapshot}=await import(pathToFileURL(source+'/ops/fin008-data-convergence.mjs').href);
const db=new Client({host:'/run/user/1000/sitesourcery-production-postgresql',port:55433,user:'mrfantasea',database:'sitesourcery_production',connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000',application_name:'sitesourcery-same-schema-readonly'});
try{await db.connect();await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL TIME ZONE 'UTC';SET LOCAL DateStyle='ISO, MDY';SET LOCAL extra_float_digits=3");
const actual=(await db.query(`SELECT current_database() AS db,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\",current_user AS username,current_setting('data_directory') AS directory,current_setting('port') AS port,current_setting('unix_socket_directories') AS sockets`)).rows[0];assert.deepEqual(actual,identity);
assert.equal((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
const snapshot=await collectFin008DatabaseSnapshot(db,{requireDisposable:false});assert.equal(snapshot.totalTableCount,schema.afterTableCount);assert.equal(snapshot.schemaSha256,schema.schemaSha256);
console.log(JSON.stringify({databaseIdentity:actual,schemaSha256:snapshot.schemaSha256,tableCount:snapshot.totalTableCount}));
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}"""
 started=now();v=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--',NODE,'--input-type=module','-e',script,str(prior),json.dumps(a['databaseIdentity']),json.dumps(PROFILE['expectedSchema'])]))
 require(v['databaseIdentity']['db']=='sitesourcery_production' and v['databaseIdentity']['databaseOid']==PROFILE['databaseIdentity']['databaseOid'],'Unexpected production database')
 return {'schema':'sitesourcery.same-schema-readback/v1','host':'FantaSeaLand','startedAt':started,'at':now(),'readOnly':True,'databaseWrites':False,'source':seal['source'],'migrationCount':COUNT,'migrationManifestSha256':seal['migration']['sha256'],**v}

def links_manifest(old,new,old_links):
 v=json.loads(raw(old_links));require(v['candidate']==old.name,'Unexpected prior link manifest');d=new/'node_modules/.bin'
 require(sorted(os.listdir(d))==['html-validate','semver'],'Unexpected build-tool entries')
 v=json.loads(json.dumps(v).replace(old.name,new.name).replace('c'+old.name[:8],'c'+new.name[:8]))
 def m(p,hashed=False):
  s=p.lstat();x={'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'inode':s.st_ino,'size':s.st_size}
  if hashed:x.pop('inode');x['sha256']=sha(raw(p))
  return x
 original=d.lstat();v['originalBinDirectory'].update(path=str(d),mode=stat.S_IMODE(original.st_mode),uid=original.st_uid,gid=original.st_gid,inode=original.st_ino)
 for e in v['omittedLinks']:
  p=new/e['path'];require(p.is_symlink() and os.readlink(p)==e['linkTarget'],'Build-tool link drift');target=p.resolve(strict=True)
  require(target==new/e['targetPath'] and target.is_relative_to(new),'Escaping build-tool link');require(m(target,True)==e['target'],'Build-tool target drift');e['symlink']=m(p)
 v['originalReadbackAt']=now();return (json.dumps(v,indent=2)+'\n').encode()

def rollback_held(a,new,prior,new_links):
 # Reuse the earlier code-only updater's digest-pinned journal/original-byte restore.
 # No service start/stop, data restore, automatic retry, or authority fabrication.
 global OUT
 OUT=Path(PATHS['installation'])
 require(not os.path.lexists(OUT/'rollback-result.json') and not os.path.lexists(OUT/'rollback-intent.json'),'Rollback attempt already exists')
 journal=pinned({'path':str(OUT/'journal.json'),'sha256':a['journalSha256']})
 require(journal['candidate']==a['candidate'] and journal['priorCandidate']==a['priorCandidate'] and journal['state'] in ('prepared_held','installed_held','failed_install_held'),'Unknown rollback point')
 before=observation(a);expected=pinned(a['rollbackObservation'])
 for key in ('currentTarget','files','units','userUnits','timers','userTimers','workerPurposes','workerActivation'):require(before[key]==expected[key],'Rollback observation drift: '+key)
 current=Path(before['currentTarget']);require(current in (new,prior),'Unrelated current release')
 current_args=dict(a,priorCandidate=current.name,priorTree=a['tree'] if current==new else a['priorTree']);held(before,current_args)
 require(before['userUnits']==journal['before']['userUnits'] and before['userTimers']==journal['before']['userTimers'],'Independent service drift')
 expected_paths=({str(_isolation.MARKER),_isolation.API_ENV,*[_isolation.drop_path(u) for u in _isolation.UNITS]} if _isolation.enabled(PROFILE) else set())|set(PATH_FILES)|{str(CONFIG/n) for n in AUTH}|{str(CONFIG/n) for n in ('hosted.env','tenant.env')}|{str(new_links)}
 require({e['path'] for e in journal['files']}==expected_paths,'Rollback journal path set changed')
 for name,u in before['units'].items():
  allowed=[journal['before']['units'][name],journal['expectedSystemUnitsAfter'][name]]
  require(u in allowed,'Unexpected unit state before rollback: '+name)
 for name in PRESERVE:require(before['files'][str(CONFIG/name)]==journal['before']['files'][str(CONFIG/name)],'Unrelated configuration drift')
 payloads={}
 for e in journal['files']:
  original=e['original'];old=None
  if original is not None:
   require(re.fullmatch('[0-9]+',original) is not None,'Invalid original index');old=raw(OUT/'originals'/original)
   require(sha(old)==journal['before']['files'][e['path']]['sha256'],'Saved original drift');payloads[e['path']]=old
  else:require(e['path']==str(new_links),'Unexpected new file in rollback')
  m=meta(e['path'])
  if m is not None:
   require(m['sha256'] in ([e['afterSha256']]+([sha(old)] if old is not None else [])),'Post-install bytes changed')
   for k in ('uid','gid','mode'):require(m[k]==e['metadata'][k],'Rollback file custody drift')
  else:require(old is None,'Original native file missing')
 originals={Path(e['path']).name:{'path':str(OUT/'originals'/e['original']),'sha256':journal['before']['files'][e['path']]['sha256']} for e in journal['files'] if e['path'] in {str(CONFIG/n) for n in AUTH}}
 if _isolation.enabled(PROFILE):
  require('isolationPlan' in journal,'Missing isolation rollback custody')
  plan=journal['isolationPlan']
  current_custody=_isolation.collect_custody(new)
  require(_isolation.valid_partial_custody(current_custody,plan['before'],plan['after']),'Unknown candidate ACL state')
  prior_binding=pinned({'path':str(OUT/'originals'/next(e['original'] for e in journal['files'] if e['path']==str(_isolation.MARKER))),'sha256':journal['before']['files'][str(_isolation.MARKER)]['sha256']})
  require(_isolation.collect_custody(prior)==prior_binding['custody'],'Prior isolated source changed')
 actual_schema=schema_observation(a,rollback_originals=originals)
 require(actual_schema['schemaSha256']==journal['actualSchemaBeforeApply']['schemaSha256'],'Rollback schema changed')
 _profile.current_window(a);save('rollback-intent.json',{'at':now(),'journalSha256':a['journalSha256'],'actualSchema':actual_schema,'savedOriginalAuthority':originals,'automatic':False})
 try:
  for e in journal['files']:
   if e['path'] in payloads:_profile.current_window(a);atomic(e['path'],payloads[e['path']],e['metadata'],lambda:_profile.current_window(a))
   elif os.path.lexists(e['path']):_profile.current_window(a);Path(e['path']).unlink()
  _profile.current_window(a);pointer(prior,journal['pointer'],lambda:_profile.current_window(a));run(['/usr/bin/systemctl','daemon-reload'])
  verifier=validate_authority(CONFIG,{name:sha(raw(CONFIG/name)) for name in AUTH},prior)
  after=observation(a)
  for key in ('currentTarget','files','units','userUnits','timers','userTimers','workerPurposes','workerActivation'):require(after[key]==journal['before'][key],'Restored baseline differs: '+key)
  require(not os.path.lexists(new_links),'Owned new link manifest still present')
  if _isolation.enabled(PROFILE):require(_isolation.observe(PROFILE,PROFILE['runtime']['isolation']['priorAcceptanceSha256'])==after['isolation'],'Restored isolation drift')
  result={'state':'rolled_back_held','candidate':a['priorCandidate'],'tree':a['priorTree'],'at':now(),'migrationCount':COUNT,'schemaUnchanged':True,'databaseEffectsThisOperation':False,'serviceStartsOrStops':False,'providerModesChanged':False,'activationAllowed':False,'actualInstalledVerifier':verifier,'after':after}
  if _isolation.enabled(PROFILE):result['isolationBinding']=after['isolation']['binding']
  save('rollback-result.json',result);print(json.dumps(result))
 except Exception as e:
  save('rollback-failure.json',{'at':now(),'exception':type(e).__name__,'reason':str(e) if isinstance(e,RuntimeError) else 'Command failed; inspect original evidence','automaticRetry':False});raise

def migration_link(installed):
 links=[v for k,v in installed.items() if re.fullmatch(r'(?:historicalProduction|production)(?:[0-9]+)?Receipt',k)]
 require(len(links)==1,'One genuine prior migration link required')
 return links[0]

def assert_historical_production_database_identity(historical,current,mode,runtime_isolation=None):
 # Caller retains current held isolation/marker checks before validate_receipts.
 # Only historical provenance may use the exact old maintenance-only endpoint.
 fields={'db','databaseOid','username','directory','port','sockets'}
 require(type(historical) is dict and set(historical)==fields,'Historical database identity fields changed')
 require(type(current) is dict and set(current)==fields,'Current database identity fields changed')
 require(mode in ('presentation-only','schema-changing'),'Unknown release mode')
 legacy='/run/user/1000/sitesourcery-production-postgresql';dual=legacy+',/run/sitesourcery-database'
 isolated=runtime_isolation is not None
 if isolated:
  require(type(runtime_isolation) is dict and set(runtime_isolation)=={'policySha256','priorAcceptanceSha256'} and all(type(v) is str and re.fullmatch('[a-f0-9]{64}',v) for v in runtime_isolation.values()),'Current accepted isolation binding required')
 require(current['sockets']==(dual if isolated else legacy),'Current exact socket identity required')
 require(all(historical[k]==current[k] for k in fields-{'sockets'}),'Historical database core identity changed')
 if historical['sockets']==current['sockets']:return
 require(mode=='presentation-only' and isolated,'Historical socket bridge requires isolated presentation-only mode')
 require(historical['sockets']==legacy and current['sockets']==dual,'Only exact historical maintenance and current isolated dual sockets are bridgeable')

def validate_receipts(a,before,expected,n):
 prod=pinned(a['productionReceipt']);mi=pinned(a['productionMigrationInputs']);installed=pinned(a['priorInstallationReceipt']);schema=pinned(a['schemaObservation']);authority=pinned(a['authorityReceipt']);binding=pinned(a['nativeObservationBinding'])
 require(prod['migrationCount']==COUNT and prod['tableCount']==TABLES,'Wrong historical prior receipt')
 assert_historical_production_database_identity(prod['databaseIdentity'],a['databaseIdentity'],PROFILE['mode'],PROFILE['runtime'].get('isolation'))
 require(prod['schemaSha256']==mi['schemas'][str(COUNT)],'Historical schema mismatch')
 require(prod['retainedRowsAndFinancialTotalsPreserved'] is True and prod['allExistingFieldsCompared'] is True and prod['postgresRestarted'] is False,'Historical provenance invalid')
 require(mi['candidate']==prod['candidate'] and prod['appliedMigrations']==mi['delta'] and len(mi['delta'])>0,'Historical migration mismatch')
 require(mi['migration']['sha256']==PROFILE['expectedSchema']['manifestSha256'],'Inventory changed')
 require(installed['state']=='installed_held' and installed['candidate']==a['priorCandidate'] and installed['tree']==a['priorTree'] and installed['migrationCount']==COUNT and migration_link(installed)['sha256']==a['productionReceipt']['sha256'],'Prior installation provenance mismatch')
 for name in AUTH:require(installed['nativeFiles'][str(CONFIG/name)]['sha256']==before['files'][str(CONFIG/name)]['sha256'],'Prior installed anchor changed')
 require(schema['schema'] in ['sitesourcery.same-schema-readback/v1','sitesourcery-same-schema'+str(COUNT)+'-readback-v1'] and schema['host']=='FantaSeaLand' and schema['readOnly'] is True and schema['databaseWrites'] is False,'Actual read-only schema receipt required')
 require(schema['source']=={'commitSha':a['priorCandidate'],'treeSha':a['priorTree']} and schema['databaseIdentity']==a['databaseIdentity'] and schema['schemaSha256']==prod['schemaSha256'] and schema['tableCount']==TABLES and schema['migrationCount']==COUNT and schema['migrationManifestSha256']==mi['migration']['sha256'],'Actual schema/identity mismatch')
 observed=datetime.datetime.fromisoformat(schema['at'].replace('Z','+00:00'));require(datetime.timedelta(0)<=n-observed<=datetime.timedelta(minutes=30),'Fresh actual schema required')
 require(authority['state']=='held_same_schema_successor_authority_constructed' and authority['candidate']==a['candidate'] and authority['tree']==a['tree'] and authority['priorCandidate']==a['priorCandidate'],'Authority receipt identity mismatch')
 for key in ('productionReceipt','productionMigrationInputs','priorInstallationReceipt','schemaObservation','actualNativeObservation'):require(_profile.authority_reference(authority,key)['sha256']==a[{'actualNativeObservation':'nativeObservation'}.get(key,key)]['sha256'],'Authority receipt bytes mismatch: '+key)
 require(authority['activationAllowed'] is False and authority['nativeInstallationPending'] is True and authority['migrationCount']==COUNT and authority['databaseMigrationPerformedByThisCommand'] is False,'Authority boundary invalid')
 require(binding['candidate']==a['candidate'] and binding['actualNativeFiles']==expected['files'] and binding['productionReceipt']['sha256']==a['productionReceipt']['sha256'] and binding['actualSchemaObservation']['sha256']==a['schemaObservation']['sha256'] and binding['nativeInstallationPending'] is True,'Native sidecar mismatch')
 require(authority.get('runtimeIsolation')==PROFILE['runtime'].get('isolation'),'Typed isolation authority/profile mismatch')
 return authority,schema

def main():
 global OUT
 require(os.geteuid()==0 and socket.gethostname()=='FantaSeaLand','Expected root on HQ')
 require(len(sys.argv)==4 and sys.argv[1] in ('observe','observe-schema','apply','rollback'),'Use observe|observe-schema|apply|rollback BINDINGS SHA256')
 action=sys.argv[1];approvalraw=raw(sys.argv[2]);require(sha(approvalraw)==sys.argv[3],'Binding bytes changed');a=json.loads(approvalraw);_profile.bind_operation(a,PROFILE,PROFILE_REF)
 for key in ('candidate','tree','priorCandidate','priorTree'):require(isinstance(a.get(key),str) and re.fullmatch('[a-f0-9]{40}',a[key]),'Unbound '+key)
 require(a['candidate']!=a['priorCandidate'],'Candidate equals prior');new=BASE/'releases'/a['candidate'];prior=BASE/'releases'/a['priorCandidate']
 old_links=CONFIG/'recovery'/('build-tool-links-c'+a['priorCandidate'][:8]+'.json');new_links=CONFIG/'recovery'/('build-tool-links-c'+a['candidate'][:8]+'.json')
 if action=='observe':print(json.dumps(observation(a),indent=2));return
 if action=='observe-schema':
  require(a.get('schemaReadApproved') is True,'Explicit read-only schema authorization required')
  issued=datetime.datetime.fromisoformat(a['issuedAt'].replace('Z','+00:00'));expiry=datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'));n=datetime.datetime.now(datetime.timezone.utc)
  require(issued<=n<expiry<=issued+datetime.timedelta(minutes=30),'Finite schema observation authority required')
  print(json.dumps(schema_observation(a),indent=2));return
 require(a['authorized'] is True and a['action']==('apply_presentation_held' if action=='apply' else 'rollback_presentation_held') and a['activationAllowed'] is False,'Explicit install-only approval required')
 require(a['reviewedFacts']=={'unchangedSchema':True,'siteCodeWritersHeld':True,'historicalProvenanceVerified':True,'independentServicesPreserved':True,'noDatabaseMutation':True},'Same-schema review missing')
 require(HERE.stat().st_uid==0 and HERE.stat().st_mode&0o022==0,'Packet must be root custody')
 _profile.verify_bundle(a,HERE)
 issued=datetime.datetime.fromisoformat(a['issuedAt'].replace('Z','+00:00'));expiry=datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'));n=datetime.datetime.now(datetime.timezone.utc);require(issued<=n<expiry<=issued+datetime.timedelta(minutes=30),'Finite current approval required')
 locks=[]
 for p in ['/run/sitesourcery-monitor/monitor.lock','/srv/sitesourcery-storage/production/backup-control/operations.lock']:
  fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW);st=os.fstat(fd);require(stat.S_ISREG(st.st_mode) and st.st_uid==1000 and stat.S_IMODE(st.st_mode)==0o600 and st.st_nlink==1,'Lock custody drift')
  deadline=time.monotonic()+(10 if p.startswith('/run/') else 0)
  while True:
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
   except BlockingIOError:require(time.monotonic()<deadline,'Operations lock busy; no effects');time.sleep(0.1)
  locks.append(fd)
 for name in ['BACKUP_QUIESCE','BACKUP_CYCLE_STATE.json']:require(not os.path.lexists('/srv/sitesourcery-storage/production/backup-control/'+name),'Outstanding backup state')
 if action=='rollback':rollback_held(a,new,prior,new_links);return
 _isolation.check_mode(PROFILE)
 before=observation(a);held(before,a);expected=pinned(a['nativeObservation'])
 if _isolation.enabled(PROFILE):require(before['isolation']==expected['isolation'],'Held isolation changed')
 for key in ('currentTarget','files','units','userUnits','timers','userTimers','workerPurposes','workerActivation'):require(before[key]==expected[key],'Held baseline drift: '+key)
 authority,schema=validate_receipts(a,before,expected,n)
 actual_schema=schema_observation(a)
 for key in ('source','databaseIdentity','schemaSha256','tableCount','migrationCount','migrationManifestSha256'):require(actual_schema[key]==schema[key],'Apply-time schema drift: '+key)
 stage=pinned(a['linuxStageReceipt']);require(stage['status']=='staged_inert' and stage['validation']['checkout']=={'projectRoot':str(new),'head':a['candidate'],'tree':a['tree'],'status':''},'Wrong staging receipt')
 measured=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--','/usr/bin/python3',str(HERE/'inventory.py'),a['candidate'],a['tree']]))
 require(measured['inventorySha256']==stage['inventory']['inventorySha256'],'Staged bytes/modes drifted')
 isolation_plan=_isolation.before_install(PROFILE,stage) if _isolation.enabled(PROFILE) else None
 payloads={};digests={}
 for name in AUTH:
  b=raw(HERE/'authority'/name);require(sha(b)==a['authorityFiles'][name]==authority['files'][name]['sha256'],'Authority payload mismatch');digests[name]=sha(b);payloads[str(CONFIG/name)]=b
 require(sha(raw(a['nativeObservationBinding']['path']))==authority['files']['native-observation-binding.json']['sha256'],'Authority sidecar bytes mismatch')
 old_seal=json.loads(raw(CONFIG/'origin-seal.json'));new_seal=json.loads(raw(HERE/'authority'/'origin-seal.json'))
 validate_staged_authority(HERE/'authority',digests,new,old_seal['worker'],authority.get('workerSourceDelta'))
 require(old_seal['migration']==new_seal['migration'],'Candidate changes migration inventory')
 for key in ('units','environmentSchema','legal','ingress'):require(old_seal[key]['sha256']==new_seal[key]['sha256'],'Unexpected runtime contract change: '+key)
 for name in ['hosted.env','tenant.env']:
  b=raw(CONFIG/name)
  for auth,key in AUTH.items():b,count=re.subn(rb'(?m)^'+key.encode()+rb'="[a-f0-9]{64}"$',key.encode()+b'="'+digests[auth].encode()+b'"',b);require(count==1,'Missing exact anchor field')
  payloads[str(CONFIG/name)]=b
 if isolation_plan:
  payloads.update(_isolation.install_payloads(PROFILE,{AUTH[name]:digests[name] for name in AUTH}))
 expected_units=json.loads(json.dumps(before['units']))
 for name,count in PATH_FILES.items():
  b=raw(name);require(b.count(str(prior).encode())==count,'Unexpected native source operand count: '+name);payloads[name]=b.replace(str(prior).encode(),str(new).encode())
  # Only a changed literal WorkingDirectory in an approved base unit may differ.
  # Drop-ins and every other reported field/PID/restart count remain exact.
  unit=Path(name).name
  if Path(name).parent==Path('/etc/systemd/system') and unit in expected_units:
   before_wd=re.findall(rb'(?m)^WorkingDirectory=(.*)$',b);after_wd=re.findall(rb'(?m)^WorkingDirectory=(.*)$',payloads[name])
   require(len(before_wd)<=1 and len(after_wd)==len(before_wd),'Ambiguous WorkingDirectory declaration: '+unit)
   if before_wd!=after_wd:
    old_wd=before_wd[0].decode();new_wd=after_wd[0].decode()
    require(old_wd==str(prior) or old_wd.startswith(str(prior)+'/'),'WorkingDirectory is not within prior source: '+unit)
    require(new_wd==str(new)+old_wd[len(str(prior)):],'Unexpected new WorkingDirectory: '+unit)
    require(before['units'][unit]['WorkingDirectory']==old_wd,'WorkingDirectory override changed: '+unit)
    expected_units[unit]['WorkingDirectory']=new_wd
 if isolation_plan:
  for unit in _isolation.UNITS[:3]:
   require(expected_units[unit]['WorkingDirectory'] in (str(prior),str(new)),'Isolated working directory drift')
   expected_units[unit]['WorkingDirectory']=str(new)
  binding=_isolation.successor_binding(PROFILE,a['linuxStageReceipt'],isolation_plan,payloads)
  payloads[str(_isolation.MARKER)]=_isolation.encoded(binding)
 payloads[str(new_links)]=links_manifest(prior,new,old_links)
 OUT=Path(PATHS['installation']);require(not os.path.lexists(OUT) and not os.path.lexists(new_links),'Prior attempt evidence exists; no replay')
 _profile.current_window(a);os.umask(0o077);OUT.mkdir(mode=0o700);(OUT/'originals').mkdir(mode=0o700)
 ps=(BASE/'current').lstat();require(stat.S_ISLNK(ps.st_mode),'Current pointer is not a symlink')
 journal={'state':'prepared_held','candidate':a['candidate'],'priorCandidate':a['priorCandidate'],'startedAt':now(),'before':before,'historicalProductionReceipt':a['productionReceipt'],'actualSchemaBeforeApply':actual_schema,'pointer':{'uid':ps.st_uid,'gid':ps.st_gid},'files':[],'expectedSystemUnitsAfter':expected_units,'codeOnlyRollbackAllowed':True,'activationAllowed':False}
 for i,(p,b) in enumerate(payloads.items()):
  existing=before['files'].get(p);m=existing if existing is not None else {'mode':0o640,'uid':0,'gid':1000};old=raw(p) if existing else None
  if old is not None:atomic(OUT/'originals'/str(i),old,{'mode':0o600,'uid':0,'gid':0})
  journal['files'].append({'path':p,'original':str(i) if existing else None,'metadata':m,'afterSha256':sha(b)})
 if isolation_plan:journal['isolationPlan']=isolation_plan
 save('journal.json',journal)
 try:
  if isolation_plan:_isolation.apply_custody(new,isolation_plan['before'],isolation_plan['after'],lambda:_profile.current_window(a))
  for e in journal['files']:_profile.current_window(a);atomic(e['path'],payloads[e['path']],e['metadata'],lambda:_profile.current_window(a))
  _profile.current_window(a);pointer(new,journal['pointer'],lambda:_profile.current_window(a));run(['/usr/bin/systemctl','daemon-reload'])
  verifier=validate_authority(CONFIG,{name:sha(raw(CONFIG/name)) for name in AUTH},new)
  after=observation(a);require(after['currentTarget']==str(new),'Installed pointer mismatch')
  if isolation_plan:require(_isolation.observe(PROFILE,sha(payloads[str(_isolation.MARKER)]))==after['isolation'],'Installed isolation readback drift')
  require(after['units']==expected_units,'System unit readback differs beyond exact approved WorkingDirectory substitution')
  for key in ('userUnits','timers','userTimers','workerPurposes','workerActivation'):require(after[key]==before[key],'Runtime/hold changed during installation: '+key)
  for n in PRESERVE:require(after['files'][str(CONFIG/n)]==before['files'][str(CONFIG/n)],'Unrelated/hold configuration changed: '+n)
  for p in a['holdPaths']:require(after['files'][p]==before['files'][p],'Durable hold changed')
  for e in journal['files']:require(meta(e['path'])['sha256']==e['afterSha256'],'Installed file drift')
  journal['state']='installed_held';journal['installedAt']=now();journal['actualInstalledVerifier']=verifier;save('journal.json',journal)
  result={'state':'installed_held','candidate':a['candidate'],'tree':a['tree'],'migrationCount':COUNT,'at':now(),'historicalProductionReceipt':a['productionReceipt'],'actualSchemaBeforeApply':actual_schema,'databaseEffectsThisOperation':False,'schemaUnchanged':True,'customerDataRestored':False,'serviceStartsOrStops':False,'providerModesChanged':False,'activationAllowed':False,'codeOnlyRollbackAllowed':True,'siteCodeWritersRemainHeld':True,'independentPrivateHqPreserved':True,'nativeFiles':{e['path']:meta(e['path']) for e in journal['files']},'actualInstalledVerifier':verifier,'actualWorkerPurposes':after['workerPurposes'],'after':after}
  if isolation_plan:
   result['isolationBinding']=after['isolation']['binding']
   result['actualInstalledInventory']=binding['inventory']
   result['actualInstalledCustody']=binding['custody']
  save('result.json',result);print(json.dumps(result))
 except Exception as e:
  journal['state']='failed_install_held';journal['failureAt']=now();save('journal.json',journal)
  save('failure.json',{'at':now(),'exception':type(e).__name__,'reason':str(e) if isinstance(e,RuntimeError) else 'Command failed; inspect journal','automaticRollback':False,'codeOnlyRollbackAllowed':True,'serviceStartsOrStops':False});raise
if __name__=='__main__':main()
