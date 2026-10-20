#!/usr/bin/python3
"""Narrow native successor of next-custody/durable-holds.py. No backup or SQL."""
import atexit,datetime,fcntl,hashlib,json,os,re,socket,stat,subprocess,sys,time,urllib.request
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

OUT=Path(PATHS['journal'])
BASE=Path('/home/mrfantasea/.local/share/sitesourcery-production');CONFIG=Path('/etc/sitesourcery')
MARKER=Path(PATHS['marker']);MARKER_BYTES=PATHS['markerText'].encode()
DROP=PATHS['dropin'];DROP_BYTES=('[Unit]\nConditionPathExists=!'+str(MARKER)+'\n').encode()
PRIOR=PROFILE['priorCandidate'];PRIOR_TREE=PROFILE['priorTree']
API=('system','sitesourcery-hq-api.service');PG=('user','sitesourcery-production-postgresql.service');GATEWAY=('system','sitesourcery-hq-gateway.service');MOUNT=('user','sitesourcery-hq-backup-mount.service')
RUNTIME=[('system','sitesourcery-hq-tenant.service'),('system','sitesourcery-hq-workers.service')]
ADMISSION=[('system','sitesourcery-hq-cloudflared.service'),('system','sitesourcery-hq-backup.timer'),('system','sitesourcery-hq-monitor.timer')]
PASSIVE=[('system','sitesourcery-hq-monitor.service')]
LATE=[API,('system','sitesourcery-hq-backup.service'),('system','sitesourcery-hq-backup-recovery.service')]
EARLY=RUNTIME+ADMISSION+PASSIVE;ALL=EARLY+LATE
PRIVATE=[('user','client-profile-hub.service'),('user','client-profile-hub-backup.timer'),('user','client-profile-hub-morning-research.timer'),('user','client-profile-hub-backup.service'),('user','client-profile-hub-morning-research.service')]
PRIVATE_APP=PRIVATE[0];PRIVATE_TIMERS=PRIVATE[1:3];PRIVATE_JOBS=PRIVATE[3:]
INDEPENDENT=[PG,GATEWAY,MOUNT];INITIAL=EARLY+PRIVATE;CONTROLLED=ALL+PRIVATE
IDENTITY=Path('/home/mrfantasea/.config/sitesourcery-hq-operator/identity.json')
READY_FILES=['/usr/local/libexec/sitesourcery-worker-readiness-20261016/wait-api-ready.mjs','/etc/systemd/system/sitesourcery-hq-workers.service.d/99-api-readiness-wait.conf']
SNAPSHOT=Path(PATHS['readinessSnapshot'])
sha=lambda b:hashlib.sha256(b).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
key=lambda u:':'.join(u)
def require(ok,message):
 if not ok:raise RuntimeError(message)
def prefix(scope):return ['/usr/bin/systemctl'] if scope=='system' else ['/usr/sbin/runuser','-u','mrfantasea','--','/usr/bin/env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user']
def state(u):
 names=['LoadState','ActiveState','SubState','UnitFileState','FragmentPath','DropInPaths']+([] if u[1].endswith('.timer') else ['MainPID','NRestarts','WorkingDirectory'])
 raw=subprocess.check_output(prefix(u[0])+['show',u[1],'--property='+','.join(names)],stderr=subprocess.PIPE,timeout=15)
 v=dict(l.split('=',1) for l in raw.decode().splitlines());require(v['LoadState']=='loaded','unit_missing:'+key(u));return v
def control(u,action):
 require((u in ALL and u[0]=='system') or (u in PRIVATE and u[0]=='user'),'unlisted_service_control_forbidden');subprocess.run(prefix(u[0])+[action,u[1]],check=True,timeout=90,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def reload():
 for s in ['system','user']:subprocess.run(prefix(s)+['daemon-reload'],check=True,timeout=20,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def meta(p):
 s=p.lstat();require(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'not_single_regular_file');return {'sha256':sha(p.read_bytes()),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'bytes':s.st_size}
def unit_definition_meta(p):
 # Only the four actual pre-existing private-HQ unit symlinks are accepted.
 names={'client-profile-hub.service','client-profile-hub-backup.timer','client-profile-hub-backup.service','client-profile-hub-morning-research.service'}
 s=p.lstat()
 if not stat.S_ISLNK(s.st_mode):return meta(p)
 target=Path('/home/mrfantasea/client-profile-hub/deploy')/p.name
 require(p.parent==Path('/home/mrfantasea/.config/systemd/user') and p.name in names and s.st_uid==s.st_gid==1000 and stat.S_IMODE(s.st_mode)==0o777 and s.st_nlink==1,'unreviewed_unit_definition_link:'+str(p))
 link=os.readlink(p);require(link==str(target) and p.resolve(strict=True)==target,'unit_definition_link_target_changed:'+str(p))
 m=meta(target);require(m['uid']==m['gid']==1000 and m['mode']==0o664,'unit_definition_target_custody_changed:'+str(p))
 return {**m,'definitionLink':{'linkText':link,'resolvedPath':str(target),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink}}
def anchored(ref):
 p=Path(ref['path']);m=meta(p);require(m['sha256']==ref['sha256'] and m['uid']==0 and not m['mode']&0o022,'receipt_custody_changed');return json.loads(p.read_bytes())
def save(name,value):
 fd=os.open(OUT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def create(p,b,mode):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),mode);os.fchown(f.fileno(),0,0);f.write(b);f.flush();os.fsync(f.fileno())
def drop(u):return (Path('/etc/systemd/system') if u[0]=='system' else Path('/home/mrfantasea/.config/systemd/user'))/(u[1]+'.d')/DROP
def exact(p,b,mode):
 m=meta(p);require(m['uid']==m['gid']==0 and m['mode']==mode and p.read_bytes()==b,'owned_hold_changed:'+str(p))
def hold(units):
 for u in units:
  p=drop(u)
  if not p.parent.exists():p.parent.mkdir(mode=0o755);os.chmod(p.parent,0o755)
  require(p.parent.resolve()==p.parent and not p.parent.stat().st_mode&0o002,'hold_parent_changed');create(p,DROP_BYTES,0o644)
def release(units):
 _profile.current_window(a,3600)
 exact(MARKER,MARKER_BYTES,0o644)
 for u in units:exact(drop(u),DROP_BYTES,0o644)
 for u in units:drop(u).unlink()
 reload()
def envvalues(name):
 d={}
 for line in (CONFIG/name).read_text().splitlines():
  if not line.strip() or line.lstrip().startswith('#'):continue
  k,v=line.split('=',1);require(k not in d,'duplicate_env_key');d[k]=json.loads(v) if v.startswith('"') else v
 return d
def observe():
 units={key(u):state(u) for u in ALL+INDEPENDENT+PRIVATE};files={}
 for v in units.values():
  for p in [v['FragmentPath'],*v['DropInPaths'].split()]:files[p]=unit_definition_meta(Path(p))
 for p in READY_FILES+[str(IDENTITY)]+['/etc/sitesourcery/'+n for n in ['hosted.env','workers.env','tenant.env','backup.env','monitor.env','WORKERS_APPROVED','PUBLICATION_APPROVED','origin-seal.json','origin-installed-readback.json','final-release-epoch-v2.json']]:files[p]=meta(Path(p))
 worker=envvalues('workers.env');config=json.loads(worker['SITESOURCERY_WORKER_CONFIG']);require(config['activation']=='owner-approved' and config['purposes']==PROFILE['workerPurposes'],'current_configured_purpose_Care_baseline_required')
 return {'source':str((BASE/'current').resolve()),'units':units,'files':files,'workerPurposes':config['purposes'],'workerConfigSha256':sha(worker['SITESOURCERY_WORKER_CONFIG'].encode()),'careMode':envvalues('hosted.env').get('SITESOURCERY_CARE_MODE','held'),'workerCareMode':worker.get('SITESOURCERY_CARE_MODE','held')}
def unchanged_baseline(j):
 for u in INDEPENDENT:
  require(state(u)==j['baseline']['units'][key(u)],'untouched_unit_changed:'+key(u))
  v=j['baseline']['units'][key(u)]
  for p in [v['FragmentPath'],*v['DropInPaths'].split()]:require(unit_definition_meta(Path(p))==j['baseline']['files'][p],'independent_definition_changed:'+p)
 require(meta(IDENTITY)==j['baseline']['files'][str(IDENTITY)],'existing_owner_identity_changed')
 for u in PRIVATE:
  v=j['baseline']['units'][key(u)]
  for p in [v['FragmentPath'],*v['DropInPaths'].split()]:require(unit_definition_meta(Path(p))==j['baseline']['files'][p],'private_definition_changed:'+p)
 for p in READY_FILES:require(meta(Path(p))==j['baseline']['files'][p],'readiness_file_changed')
 for name in ['workers.env','WORKERS_APPROVED']:
  require(meta(CONFIG/name)==j['baseline']['files'][str(CONFIG/name)],'worker_configuration_changed:'+name)
def fence_free():
 for n in ['BACKUP_QUIESCE','BACKUP_CYCLE_STATE.json']:require(not os.path.lexists(Path('/srv/sitesourcery-storage/production/backup-control')/n),'backup_recovery_pending')
def ready(candidate,count,tree):
 req=urllib.request.Request('http://127.0.0.1:8081/api/v1/ready',headers={'Host':'sitesourcery.com','X-Forwarded-Proto':'https'})
 with urllib.request.urlopen(req,timeout=5) as r:v=json.load(r)
 require(v['ready'] is True and v['release']['candidateCommitSha']==candidate and v['release']['migrationCount']==count and v['release']['candidateTreeSha']==tree,'exact_API_not_ready');return v['release']
def private_process_identity():
 raw=subprocess.check_output(prefix(PRIVATE_APP[0])+['show',PRIVATE_APP[1],'--property=MainPID,InvocationID,ExecMainStartTimestamp'],stderr=subprocess.PIPE,timeout=15)
 v=dict(line.split('=',1) for line in raw.decode().splitlines())
 require(int(v['MainPID'])>0 and re.fullmatch('[a-f0-9]{32}',v['InvocationID']) and v['ExecMainStartTimestamp'],'private_process_identity_required');return v

def private_held(j,ref):
 h=anchored(ref);require(h['state']=='private_hq_held' and h['journal']=={'path':str(OUT/'journal.json'),'sha256':meta(OUT/'journal.json')['sha256']} and h['originalProcessIdentity']==j['originalPrivateHqProcessIdentity'],'genuine_private_hold_required')
 require(set(h['units'])=={key(u) for u in PRIVATE},'private_hold_units_incomplete')
 for u in PRIVATE:
  v=h['units'][key(u)];require(v['ActiveState']=='inactive' and v['SubState']=='dead' and v.get('MainPID','0')=='0' and v['UnitFileState']==j['baseline']['units'][key(u)]['UnitFileState'],'private_writer_not_held')
  require(state(u)==v,'private_held_unit_changed:'+key(u));exact(drop(u),DROP_BYTES,0o644)
 return h

def private_resumed(j,hold_ref,resume_ref,remainder_held=True):
 h=anchored(hold_ref);r=anchored(resume_ref)
 require(r['state']=='private_hq_resumed' and r['candidate']==a['candidate'] and r['tree']==a['tree'] and r['journal']==a['journal'] and r['privateHqHoldReceipt']==hold_ref and r['installedReceipt']==a['installedReceipt'],'genuine_private_resume_required')
 require(r['originalProcessIdentity']==j['originalPrivateHqProcessIdentity'] and r['originalUnit']==j['baseline']['units'][key(PRIVATE_APP)],'private_original_state_changed')
 require(state(PRIVATE_APP)==r['unit'] and private_process_identity()==r['processIdentity'],'private_resumed_identity_changed')
 require(r['unit']['ActiveState']=='active' and int(r['unit']['MainPID'])>0 and r['processIdentity']['MainPID']!=r['originalProcessIdentity']['MainPID'] and r['processIdentity']['InvocationID']!=r['originalProcessIdentity']['InvocationID'] and r['processIdentity']['ExecMainStartTimestamp']!=r['originalProcessIdentity']['ExecMainStartTimestamp'],'private_new_process_required')
 require(all(r['unit'][k]==v for k,v in r['originalUnit'].items() if k!='MainPID'),'private_resumed_configuration_or_state_changed')
 require(not os.path.lexists(drop(PRIVATE_APP)),'private_app_hold_remaining')
 for u in PRIVATE_TIMERS+PRIVATE_JOBS:
  want=h['units'][key(u)] if remainder_held else j['baseline']['units'][key(u)]
  require(state(u)==want,'private_timer_or_job_state_changed:'+key(u))
  if remainder_held:exact(drop(u),DROP_BYTES,0o644)
  else:require(not os.path.lexists(drop(u)),'private_timer_or_job_hold_remaining')
 return r

def restored_states(units,j):
 end=time.monotonic()+45
 while True:
  values={key(u):state(u) for u in units}
  if all(values[key(u)]['ActiveState']==j['baseline']['units'][key(u)]['ActiveState'] and values[key(u)]['SubState']==j['baseline']['units'][key(u)]['SubState'] for u in units):break
  require(time.monotonic()<end,'prior_states_not_restored');time.sleep(.5)
 for u in units:
  v=values[key(u)];want=j['baseline']['units'][key(u)]
  require(all(v[k]==value for k,value in want.items() if k!='MainPID'),'prior_state_or_definition_not_restored:'+key(u))
  if 'MainPID' in want:require(int(v['MainPID'])>0 if want['ActiveState']=='active' else v['MainPID']=='0','prior_process_state_not_restored:'+key(u))
 return values

def main():
 global a
 action=sys.argv[1];require(os.geteuid()==0 and socket.gethostname()=='FantaSeaLand','exact_HQ_root_required')
 if action=='observe':print(json.dumps(observe()));sys.exit(0)
 require(action in ['initial','final','resume-api','resume-runtime','resume-admission'] and len(sys.argv)==4,'unknown_action')
 a=anchored({'path':sys.argv[2],'sha256':sys.argv[3]});_profile.bind_operation(a,PROFILE,PROFILE_REF);_profile.verify_bundle(a,Path(__file__).resolve().parent);require(a['approved'] is True and a['action']==action and a['scope']=='native_handoff','approval_required')
 issued=datetime.datetime.fromisoformat(a['issuedAt'].replace('Z','+00:00'));expires=datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'));require(issued<=datetime.datetime.now(datetime.timezone.utc)<expires<=issued+datetime.timedelta(hours=1),'approval_expired')
 require(all(isinstance(a.get(k),str) and re.fullmatch('[a-f0-9]{40}',a[k]) for k in ['candidate','tree']) and a['candidate']!=PRIOR,'actual_new_source_required')
 require(a['backupRunByThisHelper'] is False and a['databaseMutationAllowed'] is False and a['providerConfigurationChangeAllowed'] is False,'extra_effect_forbidden');fence_free()
 locks=[];atexit.register(lambda:[os.close(fd) for fd in reversed(locks)])
 for p in ['/run/sitesourcery-monitor/monitor.lock','/srv/sitesourcery-storage/production/backup-control/operations.lock']:
  fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'existing_lock_changed');locks.append(fd);end=time.monotonic()+10
  while True:
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
   except BlockingIOError:require(time.monotonic()<end,'operations_busy');time.sleep(.1)
 if action=='initial':
  before=observe();require(before==anchored(a['baselineReceipt']),'fresh_baseline_changed');require(before['source']==str(BASE/'releases'/PRIOR),'prior_source_changed');ready(PRIOR,BEFORE_COUNT,PRIOR_TREE)
  require(not os.path.lexists(OUT) and not os.path.lexists(MARKER) and not os.path.lexists(SNAPSHOT) and all(not os.path.lexists(drop(u)) for u in CONTROLLED),'prior_handoff_exists')
  require(all(before['units'][key(u)]['ActiveState']=='inactive' for u in PASSIVE+LATE[1:]+PRIVATE_JOBS),'background_one_shot_active');require(all(before['units'][key(u)]['ActiveState'] in ['active','inactive'] for u in CONTROLLED),'transitioning_unit')
  require(all(before['units'][key(u)]['ActiveState']=='active' for u in RUNTIME+[API,ADMISSION[0],PG,GATEWAY,MOUNT,PRIVATE_APP]) and before['workerPurposes']==PROFILE['workerPurposes'],'accepted_configured_purpose_baseline_required')
  require(before['units'][key(PRIVATE_TIMERS[1])]['ActiveState']=='inactive' and before['units'][key(PRIVATE_TIMERS[1])]['UnitFileState']=='disabled','morning_research_must_remain_disabled')
  require(all(all(Path(p).name<DROP for p in v['DropInPaths'].split()) for v in before['units'].values()),'later_dropin_requires_review')
  identity=private_process_identity();require(identity['MainPID']==before['units'][key(PRIVATE_APP)]['MainPID'],'private_process_changed_before_hold')
  _profile.current_window(a,3600);os.umask(0o077);OUT.mkdir(mode=0o700);save('journal.json',{'at':now(),'baseline':before,'originalPrivateHqProcessIdentity':identity,'authoritySha256':sys.argv[3]});create(MARKER,MARKER_BYTES,0o644);hold(INITIAL);reload()
  for u in ADMISSION+PRIVATE_TIMERS+PRIVATE_JOBS+[PRIVATE_APP]+PASSIVE+list(reversed(RUNTIME)):control(u,'stop')
  require(all(state(u)['ActiveState']=='inactive' and state(u).get('MainPID','0')=='0' for u in INITIAL),'initial_writer_not_stopped');require(state(API)==before['units'][key(API)],'API_must_remain_unchanged_for_backup')
  j=anchored({'path':str(OUT/'journal.json'),'sha256':meta(OUT/'journal.json')['sha256']});unchanged_baseline(j)
  save('private-hq-held.json',{'state':'private_hq_held','at':now(),'journal':{'path':str(OUT/'journal.json'),'sha256':meta(OUT/'journal.json')['sha256']},'originalProcessIdentity':identity,'units':{key(u):state(u) for u in PRIVATE},'sourceAndConfigurationUnchanged':True,'heldBeforeBoundaryCapture':True})
  privateRef={'path':str(OUT/'private-hq-held.json'),'sha256':meta(OUT/'private-hq-held.json')['sha256']};private_held(j,privateRef)
  SNAPSHOT.mkdir(mode=0o750);os.chmod(SNAPSHOT,0o750);os.chown(SNAPSHOT,0,1000);entries=[]
  for i,s in enumerate(READY_FILES):
   source=Path(s);m=meta(source);require(m==before['files'][s],'readiness_source_drift');dest=SNAPSHOT/('file-'+str(i));create(dest,source.read_bytes(),0o640);os.chown(dest,0,1000);entries.append({'originalPath':s,'snapshotMember':'configuration/recovery/'+SNAPSHOT.name+'/'+dest.name,'originalMetadata':m})
  b=(json.dumps({'schema':'sitesourcery.native-recovery-files/v1','entries':entries,'automaticRestore':False},indent=2)+'\n').encode();create(SNAPSHOT/'manifest.json',b,0o640);os.chown(SNAPSHOT/'manifest.json',0,1000)
  save('initial-holds.json',{'at':now(),'phase':'initial','units':{key(u):state(u) for u in CONTROLLED},'holdPaths':[str(MARKER)]+[str(drop(u)) for u in INITIAL],'privateHqHoldReceipt':privateRef,'readinessRecoverySnapshot':str(SNAPSHOT),'apiIntentionallyActive':True});print(json.dumps({'phase':'initial','passed':True,'backupNotRun':True,'ownedHoldFileCount':12,'privateHqHoldReceipt':privateRef}));sys.exit(0)
 j=anchored(a['journal']);unchanged_baseline(j);exact(MARKER,MARKER_BYTES,0o644)
 if action!='resume-admission':private_held(j,a['privateHqHoldReceipt'])
 else:private_resumed(j,a['privateHqHoldReceipt'],a['privateHqResumeReceipt'])
 if action=='final':
  for u in INITIAL:exact(drop(u),DROP_BYTES,0o644)
  require(all(state(u)['ActiveState']=='inactive' and state(u).get('MainPID','0')=='0' for u in CONTROLLED),'all_writers_and_operations_must_be_stopped');report=anchored(a['backupOriginalReport']);require(report['ok'] is True and report['action']=='run' and report['artifactCount']==2 and re.fullmatch('[a-f0-9]{64}',report['manifestSha256']) and datetime.datetime.fromisoformat(report['completedAt'].replace('Z','+00:00'))>=datetime.datetime.fromisoformat(j['at']),'fresh_successful_backup_required');hold(LATE);reload();unchanged_baseline(j);private_held(j,a['privateHqHoldReceipt'])
  save('final-holds.json',{'at':now(),'phase':'final','units':{key(u):state(u) for u in CONTROLLED},'holdPaths':[str(MARKER)]+[str(drop(u)) for u in CONTROLLED],'backupOriginalReport':a['backupOriginalReport'],'privateHqHoldReceipt':a['privateHqHoldReceipt'],'databaseMutationPerformed':False,'independentServicesPreserved':True,'privateHqRemainsHeld':True});print(json.dumps({'phase':'final','passed':True,'ownedHoldFileCount':15}));sys.exit(0)
 installed=anchored(a['installedReceipt']);require(installed['state']=='installed_held' and installed['migrationCount']==COUNT and installed['databaseAlreadyMigrated'] is True and installed['privateHqHeldPreserved'] is True and installed['codeOnlyRollbackAllowed'] is False and installed['activationAllowed'] is False and installed['candidate']==a['candidate'] and installed['tree']==a['tree'],'genuine_installed_receipt_required');require((BASE/'current').resolve()==BASE/'releases'/a['candidate'],'installed_source_changed')
 if action=='resume-api':
  release([API]);control(API,'start');end=time.monotonic()+60
  try:
   while True:
    try:release_identity=ready(a['candidate'],COUNT,a['tree']);break
    except Exception:require(time.monotonic()<end,'API_readiness_timeout');time.sleep(.5)
  except BaseException:control(API,'stop');raise
  unchanged_baseline(j);private_held(j,a['privateHqHoldReceipt'])
  save('resume-api.json',{'at':now(),'release':release_identity,'unit':state(API),'privateHqHoldReceipt':a['privateHqHoldReceipt'],'privateHqStillHeld':True,'admissionStillHeld':True});print(json.dumps({'phase':action,'passed':True}));sys.exit(0)
 ready(a['candidate'],COUNT,a['tree'])
 if action=='resume-runtime':
  selected=RUNTIME+[PRIVATE_APP];release(selected)
  for u in selected:
   if j['baseline']['units'][key(u)]['ActiveState']=='active':control(u,'start')
  units=restored_states(selected,j);identity=private_process_identity();original=j['originalPrivateHqProcessIdentity']
  require(identity['MainPID']==units[key(PRIVATE_APP)]['MainPID'] and all(identity[k]!=original[k] for k in ['MainPID','InvocationID','ExecMainStartTimestamp']),'private_new_process_identity_required')
  unchanged_baseline(j)
  save('private-hq-resume.json',{'state':'private_hq_resumed','at':now(),'candidate':a['candidate'],'tree':a['tree'],'journal':a['journal'],'privateHqHoldReceipt':a['privateHqHoldReceipt'],'installedReceipt':a['installedReceipt'],'originalUnit':j['baseline']['units'][key(PRIVATE_APP)],'originalProcessIdentity':original,'unit':units[key(PRIVATE_APP)],'processIdentity':identity,'configurationAndEnablementPreserved':True,'privateTimersStillHeld':True,'sourceWorkingDirectory':units[key(PRIVATE_APP)]['WorkingDirectory']})
  resumeRef={'path':str(OUT/'private-hq-resume.json'),'sha256':meta(OUT/'private-hq-resume.json')['sha256']};private_resumed(j,a['privateHqHoldReceipt'],resumeRef)
  save('resume-runtime.json',{'at':now(),'phase':action,'units':units,'privateHqResumeReceipt':resumeRef,'privateHqHoldReceipt':a['privateHqHoldReceipt'],'workerPurposes':j['baseline']['workerPurposes'],'readinessFilesPreserved':True,'enablementUnchanged':True,'admissionStillHeld':True});print(json.dumps({'phase':action,'passed':True,'privateHqResumeReceipt':resumeRef}));sys.exit(0)
 require(a['priorRuntimeAndOwnerAccepted'] is True,'runtime_and_owner_acceptance_required');accepted=anchored(a['runtimeAcceptanceReceipt'])
 require(accepted['state']=='passed' and accepted['candidate']==a['candidate'] and accepted['tree']==a['tree'] and accepted['migrationCount']==COUNT and accepted['publicAdmissionStillHeld'] is True and accepted['installedReceiptSha256']==a['installedReceipt']['sha256'] and accepted['runtimeResumeReceiptSha256']==meta(OUT/'resume-runtime.json')['sha256'] and accepted['privateHqResumeReceiptSha256']==a['privateHqResumeReceipt']['sha256'],'exact_runtime_acceptance_required')
 selected=ADMISSION+PASSIVE+LATE[1:]+PRIVATE_TIMERS+PRIVATE_JOBS;release(selected)
 for u in selected:
  if j['baseline']['units'][key(u)]['ActiveState']=='active':control(u,'start')
 units=restored_states(selected,j);unchanged_baseline(j);private_resumed(j,a['privateHqHoldReceipt'],a['privateHqResumeReceipt'],False)
 require(all(not os.path.lexists(drop(u)) for u in CONTROLLED),'remaining_owned_hold');MARKER.unlink()
 save('resume-admission.json',{'at':now(),'phase':action,'units':units,'privateHqResumeReceipt':a['privateHqResumeReceipt'],'workerPurposes':j['baseline']['workerPurposes'],'readinessFilesPreserved':True,'enablementUnchanged':True,'privateHqTimersRestored':True,'privateHqMorningResearchDisabled':state(PRIVATE_TIMERS[1])['UnitFileState']=='disabled','ownedHoldFilesRemaining':0});print(json.dumps({'phase':action,'passed':True}))

if __name__=='__main__':main()
