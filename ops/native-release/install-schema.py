#!/usr/bin/python3
"""Existing atomic native updater adapted for confirmed and held writers. No startup or code-only rollback."""
import datetime,fcntl,hashlib,json,os,re,socket,stat,subprocess,sys,time
from pathlib import Path

# The profile is data; no native command runs while loading or validating it.
import importlib.util
_profile_spec=importlib.util.spec_from_file_location('sitesourcery_release_profile',Path(__file__).with_name('profile.py'))
_profile=importlib.util.module_from_spec(_profile_spec);_profile_spec.loader.exec_module(_profile)
require_profile=_profile.require
require_profile(len(sys.argv)>=4,'PROFILE SHA256 ACTION required')
PROFILE_REF={'path':sys.argv[1],'sha256':sys.argv[2]}
PROFILE=_profile.load_profile(sys.argv[1],sys.argv[2],'schema-changing')
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
PRIVATE_HQ_SERVICES=['client-profile-hub.service', 'client-profile-hub-backup.service', 'client-profile-hub-morning-research.service']
PRIVATE_HQ_TIMERS=['client-profile-hub-backup.timer', 'client-profile-hub-morning-research.timer']
EXPECTED_HOLD_PATHS=PATHS['holdPaths']
USER_NAMES=['sitesourcery-production-postgresql.service']+PRIVATE_HQ_SERVICES
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
 return isinstance(p,str) and str(Path(p))==p and p.startswith(('/etc/sitesourcery/','/etc/systemd/system/sitesourcery-','/home/mrfantasea/.config/systemd/user/client-profile-hub')) and '..' not in Path(p).parts and p not in mutable and Path(p).suffix!='.env'

def observation(a):
 prior=BASE/'releases'/a['priorCandidate'];old_links=CONFIG/'recovery'/('build-tool-links-c'+a['priorCandidate'][:8]+'.json')
 paths=list(dict.fromkeys(list(PATH_FILES)+[str(CONFIG/n) for n in list(AUTH)+['hosted.env','tenant.env']+PRESERVE]+[str(old_links)]+a['holdPaths']))
 require(set(a['holdPaths'])==set(EXPECTED_HOLD_PATHS) and len(a['holdPaths'])==15 and all(hold_path(p) for p in a['holdPaths']),'Exact fifteen current hold paths required')
 env=raw(CONFIG/'workers.env').decode();m=re.search(r'^SITESOURCERY_WORKER_CONFIG=(.+)$',env,re.M);require(m,'Worker config absent');worker=json.loads(json.loads(m[1]))
 require(worker['activation']=='owner-approved' and worker['purposes']==PROFILE['workerPurposes'],'Current configured-purpose Care baseline required')
 api=raw(CONFIG/'hosted.env').decode();m=re.search(r'^SITESOURCERY_CARE_MODE=(.+)$',api,re.M)
 care_mode=json.loads(m[1]) if m else 'held'
 wm=re.search(r'^SITESOURCERY_CARE_MODE=(.+)$',env,re.M);worker_care_mode=json.loads(wm[1]) if wm else 'held'
 return {'at':now(),'readOnly':True,'currentTarget':str((BASE/'current').resolve()),'ready':None,'files':{p:meta(p) for p in paths},
  'units':states(SYSTEM_NAMES),'userUnits':states(USER_NAMES,True),'timers':states(['sitesourcery-hq-backup.timer','sitesourcery-hq-monitor.timer'],timer=True),
  'userTimers':states(PRIVATE_HQ_TIMERS,True,True),'workerPurposes':worker['purposes'],'workerActivation':worker['activation'],'careMode':care_mode,'workerCareMode':worker_care_mode}
def held(o,a):
 require(o['currentTarget']==str(BASE/'releases'/a['priorCandidate']),'Current release changed')
 require(o['workerPurposes']==a['baseline']['workerPurposes'] and o['workerActivation']==a['baseline']['workerActivation'],'Worker purpose drift')
 require(o['workerPurposes']==PROFILE['workerPurposes'],'Current configured worker purposes required')
 require(o['careMode']==a['baseline']['careMode'] and o['workerCareMode']==a['baseline']['workerCareMode'],'Care configuration drift')
 for n in ('api','tenant','workers','cloudflared','backup','backup-recovery','monitor'):
  u=o['units']['sitesourcery-hq-'+n+'.service'];require(u['LoadState']=='loaded' and u['ActiveState']=='inactive' and u['MainPID']=='0','Writer/operation not held: '+n)
 require(o['units']['sitesourcery-hq-gateway.service']['ActiveState']=='active','Local gateway not active')
 require(o['userUnits']['sitesourcery-production-postgresql.service']==a['baseline']['postgresql'],'PostgreSQL identity/state changed')
 require(a['baseline']['postgresql']['ActiveState']=='active' and int(a['baseline']['postgresql']['MainPID'])>0,'PostgreSQL unavailable')
 expected_hq=a['baseline']['privateHqServices'];require(set(expected_hq)==set(PRIVATE_HQ_SERVICES),'Exact held private HQ service baseline required')
 for name in PRIVATE_HQ_SERVICES:
  h=o['userUnits'][name];require(h==expected_hq[name] and h['LoadState']=='loaded' and h['ActiveState']=='inactive' and h['MainPID']=='0','Private HQ writer not held or changed: '+name)
 require(set(a['baseline']['privateHqTimers'])==set(PRIVATE_HQ_TIMERS) and o['userTimers']==a['baseline']['privateHqTimers'],'Held private HQ timers or original enablement changed')
 for name,u in o['userTimers'].items():require(u['LoadState']=='loaded' and u['ActiveState']=='inactive','Private HQ timer not held: '+name)
 require(o['userTimers']['client-profile-hub-morning-research.timer']['UnitFileState']=='disabled','Morning research must remain disabled')
 for n,u in o['timers'].items():require(u['LoadState']=='loaded' and u['ActiveState']=='inactive','Site timer not held: '+n)
 require(a['baseline']['holdFiles'] and set(a['holdPaths'])==set(a['baseline']['holdFiles'])==set(EXPECTED_HOLD_PATHS),'Exact fifteen durable hold files required')
 for p,v in a['baseline']['holdFiles'].items():require(o['files'][p]==v,'Durable hold changed: '+p)

def atomic(p,b,metadata):
 p=Path(p);temp=p.with_name(p.name+'.native-release-update-tmp');fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,metadata['mode'])
 with os.fdopen(fd,'wb') as f:os.fchown(f.fileno(),metadata['uid'],metadata['gid']);os.fchmod(f.fileno(),metadata['mode']);f.write(b);f.flush();os.fsync(f.fileno())
 os.replace(temp,p);fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def save(name,value):atomic(OUT/name,(json.dumps(value,indent=2)+'\n').encode(),{'mode':0o600,'uid':0,'gid':0})
def pointer(target,metadata):
 p=BASE/'current';temp=BASE/'current.native-release-update-tmp';os.symlink(target,temp);os.lchown(temp,metadata['uid'],metadata['gid']);os.replace(temp,p)
 fd=os.open(BASE,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def pinned(ref):
 require(isinstance(ref,dict) and isinstance(ref.get('path'),str) and Path(ref['path']).is_absolute() and re.fullmatch('[a-f0-9]{64}',ref.get('sha256') or ''),'Missing pinned receipt')
 b=raw(ref['path']);require(sha(b)==ref['sha256'],'Pinned receipt changed');return json.loads(b)
def validate_authority(directory,digests,new):
 args=[NODE,str(new/'ops/verify-final-release-epoch-v2.mjs')]
 for name,key in [('final-release-epoch-v2.json','epoch'),('origin-seal.json','origin-seal'),('origin-installed-readback.json','installed-readback')]:args+=['--'+key,str(directory/name),'--'+key+'-sha256',digests[name]]
 v=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--']+args));require(v.get('valid') is True and v['candidateCommitSha']==new.name and v['migrationCount']==COUNT,'Canonical authority verification failed');return v

def validate_staged_authority(directory,digests,new):
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
const [release,directory,pinnedDigests]=process.argv.slice(1);
const digests=JSON.parse(pinnedDigests);
const read=name=>{const bytes=fs.readFileSync(path.join(directory,name));assert.equal(createHash('sha256').update(bytes).digest('hex'),digests[name]);return JSON.parse(bytes);};
const {validateInstalledFinalReleaseEpochV2Chain}=await import(pathToFileURL(path.join(release,'ops/final-release-epoch-v2.mjs')).href);
const epoch=validateInstalledFinalReleaseEpochV2Chain({epoch:read('final-release-epoch-v2.json'),originSeal:read('origin-seal.json'),installedReadback:read('origin-installed-readback.json')});
console.log(JSON.stringify({valid:true,candidateCommitSha:epoch.identity.sourceCommitSha,migrationCount:epoch.identity.migrationCount}));"""
 v=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--',NODE,'--input-type=module','-e',script,str(new),str(directory),json.dumps(digests)]))
 require(v.get('valid') is True and v['candidateCommitSha']==new.name and v['migrationCount']==COUNT,'Canonical staged authority verification failed');return v

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

def validate_receipts(a,before,expected,n):
 prod=pinned(a['productionReceipt']);mi=pinned(a['productionMigrationInputs']);authority=pinned(a['authorityReceipt']);binding=pinned(a['nativeObservationBinding'])
 require(prod['candidate']=={'commitSha':a['candidate'],'treeSha':a['tree']} and prod['migrationCount']==COUNT and prod['tableCount']==TABLES,'Wrong production receipt')
 require(prod['databaseIdentity']==a['databaseIdentity'] and prod['schemaSha256']==mi['schemas'][str(COUNT)],'Production identity/schema mismatch')
 require(prod['retainedRowsAndFinancialTotalsPreserved'] is True and prod['allExistingFieldsCompared'] is True and prod['applicationStarted'] is False and prod['postgresRestarted'] is False,'Production migration boundary invalid')
 require(mi['candidate']==prod['candidate'] and prod['appliedMigrations']==mi['delta'] and len(mi['delta'])==(COUNT-BEFORE_COUNT),'Applied migration mismatch')
 require(mi['migration']['sha256']==PROFILE['expectedSchema']['manifestSha256'],'Inventory changed')
 require(authority['state']=='held_migration_successor_authority_constructed' and authority['candidate']==a['candidate'] and authority['tree']==a['tree'] and authority['priorCandidate']==a['priorCandidate'],'Authority receipt identity mismatch')
 for key in ('productionReceipt','productionMigrationInputs','actualNativeObservation'):require(_profile.authority_reference(authority,key)['sha256']==a[{'actualNativeObservation':'nativeObservation'}.get(key,key)]['sha256'],'Authority receipt bytes mismatch: '+key)
 require(authority['activationAllowed'] is False and authority['nativeInstallationPending'] is True and authority['migrationCount']==COUNT,'Authority activation boundary invalid')
 require(binding['candidate']==a['candidate'] and binding['actualNativeFiles']==expected['files'] and binding['productionReceipt']['sha256']==a['productionReceipt']['sha256'] and binding['nativeInstallationPending'] is True,'Native sidecar mismatch')
 require(datetime.datetime.fromisoformat(prod['at'].replace('Z','+00:00'))<=datetime.datetime.fromisoformat(expected['at'].replace('Z','+00:00')),'Observation predates migration')
 return authority

def main():
 global OUT
 require(os.geteuid()==0 and socket.gethostname()=='FantaSeaLand','Expected root on HQ')
 require(len(sys.argv)==4 and sys.argv[1] in ('observe','apply'),'Use observe|apply BINDINGS SHA256; code-only rollback is forbidden after SQL')
 action=sys.argv[1];approvalraw=raw(sys.argv[2]);require(sha(approvalraw)==sys.argv[3],'Binding bytes changed');a=json.loads(approvalraw);_profile.bind_operation(a,PROFILE,PROFILE_REF)
 for key in ('candidate','tree','priorCandidate','priorTree'):require(isinstance(a.get(key),str) and re.fullmatch('[a-f0-9]{40}',a[key]),'Unbound '+key)
 require(a['candidate']!=a['priorCandidate'],'Candidate equals prior');new=BASE/'releases'/a['candidate'];prior=BASE/'releases'/a['priorCandidate']
 old_links=CONFIG/'recovery'/('build-tool-links-c'+a['priorCandidate'][:8]+'.json');new_links=CONFIG/'recovery'/('build-tool-links-c'+a['candidate'][:8]+'.json')
 if action=='observe':print(json.dumps(observation(a),indent=2));return
 require(a['authorized'] is True and a['action']=='apply_schema_held' and a['activationAllowed'] is False,'Explicit install-only approval required')
 require(a['reviewedFacts']=={'productionCommitted':True,'writersDurablyHeld':True,'noNewApplicationWrites':True,'freshRecoveryPointVerified':True,'codeOnlyRollbackForbidden':True},'Migration boundary review missing')
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
 before=observation(a);held(before,a);expected=pinned(a['nativeObservation'])
 for key in ('currentTarget','files','units','userUnits','timers','userTimers','workerPurposes','workerActivation','careMode','workerCareMode'):require(before[key]==expected[key],'Held baseline drift: '+key)
 authority=validate_receipts(a,before,expected,n)
 stage=pinned(a['linuxStageReceipt']);require(stage['status']=='staged_inert' and stage['validation']['checkout']=={'projectRoot':str(new),'head':a['candidate'],'tree':a['tree'],'status':''},'Wrong staging receipt')
 measured=json.loads(run(['/usr/sbin/runuser','-u','mrfantasea','--','/usr/bin/python3',str(HERE/'inventory.py'),a['candidate'],a['tree']]))
 require(measured['inventorySha256']==stage['inventory']['inventorySha256'],'Staged bytes/modes drifted')
 payloads={};digests={}
 for name in AUTH:
  b=raw(HERE/'authority'/name);require(sha(b)==a['authorityFiles'][name]==authority['files'][name]['sha256'],'Authority payload mismatch');digests[name]=sha(b);payloads[str(CONFIG/name)]=b
 require(sha(raw(a['nativeObservationBinding']['path']))==authority['files']['native-observation-binding.json']['sha256'],'Authority sidecar bytes mismatch')
 validate_staged_authority(HERE/'authority',digests,new)
 for name in ['hosted.env','tenant.env']:
  b=raw(CONFIG/name)
  for auth,key in AUTH.items():b,count=re.subn(rb'(?m)^'+key.encode()+rb'="[a-f0-9]{64}"$',key.encode()+b'="'+digests[auth].encode()+b'"',b);require(count==1,'Missing exact anchor field')
  payloads[str(CONFIG/name)]=b
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
 payloads[str(new_links)]=links_manifest(prior,new,old_links)
 OUT=Path(PATHS['installation']);require(not os.path.lexists(OUT) and not os.path.lexists(new_links),'Prior attempt evidence exists; no replay')
 _profile.current_window(a);os.umask(0o077);OUT.mkdir(mode=0o700);(OUT/'originals').mkdir(mode=0o700)
 ps=(BASE/'current').lstat();require(stat.S_ISLNK(ps.st_mode),'Current pointer is not a symlink')
 journal={'state':'prepared_held','candidate':a['candidate'],'priorCandidate':a['priorCandidate'],'startedAt':now(),'before':before,'productionReceipt':a['productionReceipt'],'pointer':{'uid':ps.st_uid,'gid':ps.st_gid},'files':[],'expectedSystemUnitsAfter':expected_units,'codeOnlyRollbackAllowed':False,'activationAllowed':False}
 for i,(p,b) in enumerate(payloads.items()):
  existing=before['files'].get(p);m=existing if existing is not None else {'mode':0o640,'uid':0,'gid':1000};old=raw(p) if existing else None
  if old is not None:atomic(OUT/'originals'/str(i),old,{'mode':0o600,'uid':0,'gid':0})
  journal['files'].append({'path':p,'original':str(i) if existing else None,'metadata':m,'afterSha256':sha(b)})
 save('journal.json',journal)
 try:
  for e in journal['files']:atomic(e['path'],payloads[e['path']],e['metadata'])
  pointer(new,journal['pointer']);run(['/usr/bin/systemctl','daemon-reload'])
  verifier=validate_authority(CONFIG,{name:sha(raw(CONFIG/name)) for name in AUTH},new)
  after=observation(a);require(after['currentTarget']==str(new),'Installed pointer mismatch')
  require(after['units']==expected_units,'System unit readback differs beyond exact approved WorkingDirectory substitution')
  for key in ('userUnits','timers','userTimers','workerPurposes','workerActivation','careMode','workerCareMode'):require(after[key]==before[key],'Runtime/hold changed during installation: '+key)
  for n in PRESERVE:require(after['files'][str(CONFIG/n)]==before['files'][str(CONFIG/n)],'Unrelated/hold configuration changed: '+n)
  for p in a['holdPaths']:require(after['files'][p]==before['files'][p],'Durable hold changed')
  for e in journal['files']:require(meta(e['path'])['sha256']==e['afterSha256'],'Installed file drift')
  journal['state']='installed_held';journal['installedAt']=now();journal['actualInstalledVerifier']=verifier;save('journal.json',journal)
  result={'state':'installed_held','candidate':a['candidate'],'tree':a['tree'],'migrationCount':COUNT,'at':now(),'productionReceipt':a['productionReceipt'],'databaseEffectsThisOperation':False,'databaseAlreadyMigrated':True,'customerDataRestored':False,'serviceStartsOrStops':False,'providerModesChanged':False,'activationAllowed':False,'codeOnlyRollbackAllowed':False,'allWritersRemainHeld':True,'siteCodeWritersRemainHeld':True,'privateHqHeldPreserved':True,'nativeFiles':{e['path']:meta(e['path']) for e in journal['files']},'actualInstalledVerifier':verifier,'actualWorkerPurposes':after['workerPurposes'],'after':after}
  save('result.json',result);print(json.dumps(result))
 except Exception as e:
  journal['state']='failed_install_held';journal['failureAt']=now();save('journal.json',journal)
  save('failure.json',{'at':now(),'exception':type(e).__name__,'reason':str(e) if isinstance(e,RuntimeError) else 'Command failed; inspect journal','automaticRollback':False,'codeOnlyRollbackAllowed':False,'serviceStartsOrStops':False});raise
if __name__=='__main__':main()
