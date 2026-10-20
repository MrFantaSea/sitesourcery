#!/usr/bin/python3
"""Site-only same-schema adaptation of accepted durable-handoff.py. No backup or SQL."""
import atexit,datetime,fcntl,hashlib,json,os,re,socket,stat,subprocess,sys,time,urllib.request
from pathlib import Path

# The profile is data; no native command runs while loading or validating it.
import importlib.util
_profile_spec=importlib.util.spec_from_file_location('sitesourcery_release_profile',Path(__file__).with_name('profile.py'))
_profile=importlib.util.module_from_spec(_profile_spec);_profile_spec.loader.exec_module(_profile)
require_profile=_profile.require
require_profile(len(sys.argv)>=4,'PROFILE SHA256 ACTION required')
PROFILE_REF={'path':sys.argv[1],'sha256':sys.argv[2]}
PROFILE=_profile.load_profile(sys.argv[1],sys.argv[2],'presentation-only')
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
INDEPENDENT=[PG,GATEWAY,MOUNT]+PRIVATE
IDENTITY=Path('/home/mrfantasea/.config/sitesourcery-hq-operator/identity.json')
READY_FILES=['/usr/local/libexec/sitesourcery-worker-readiness-20261016/wait-api-ready.mjs','/etc/systemd/system/sitesourcery-hq-workers.service.d/99-api-readiness-wait.conf']
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
 require(u in ALL and u[0]=='system','non_site_service_control_forbidden');subprocess.run(prefix(u[0])+[action,u[1]],check=True,timeout=90,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def reload():
 for s in ['system']:subprocess.run(prefix(s)+['daemon-reload'],check=True,timeout=20,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
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
 exact(MARKER,MARKER_BYTES,0o600)
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
 units={key(u):state(u) for u in ALL+INDEPENDENT};files={}
 for v in units.values():
  for p in [v['FragmentPath'],*v['DropInPaths'].split()]:files[p]=unit_definition_meta(Path(p))
 for p in READY_FILES+[str(IDENTITY)]+['/etc/sitesourcery/'+n for n in ['hosted.env','workers.env','tenant.env','backup.env','monitor.env','WORKERS_APPROVED','PUBLICATION_APPROVED','origin-seal.json','origin-installed-readback.json','final-release-epoch-v2.json']]:files[p]=meta(Path(p))
 worker=envvalues('workers.env');config=json.loads(worker['SITESOURCERY_WORKER_CONFIG']);require(config['activation']=='owner-approved' and config['purposes']==PROFILE['workerPurposes'],'accepted_configured_purposes_required');require(worker.get('SITESOURCERY_CARE_MODE','held')==PROFILE['workerCareMode'],'existing_Care_activation_changed')
 return {'source':str((BASE/'current').resolve()),'units':units,'files':files,'workerPurposes':config['purposes'],'workerConfigSha256':sha(worker['SITESOURCERY_WORKER_CONFIG'].encode())}
def unchanged_baseline(j):
 for u in INDEPENDENT:
  require(state(u)==j['baseline']['units'][key(u)],'untouched_unit_changed:'+key(u))
  v=j['baseline']['units'][key(u)]
  for p in [v['FragmentPath'],*v['DropInPaths'].split()]:require(unit_definition_meta(Path(p))==j['baseline']['files'][p],'independent_definition_changed:'+p)
 require(meta(IDENTITY)==j['baseline']['files'][str(IDENTITY)],'existing_owner_identity_changed')
 for p in READY_FILES:require(meta(Path(p))==j['baseline']['files'][p],'readiness_file_changed')
 require(meta(CONFIG/'workers.env')==j['baseline']['files'][str(CONFIG/'workers.env')],'worker_configuration_changed')
def fence_free():
 for n in ['BACKUP_QUIESCE','BACKUP_CYCLE_STATE.json']:require(not os.path.lexists(Path('/srv/sitesourcery-storage/production/backup-control')/n),'backup_recovery_pending')
def ready(candidate,count,tree):
 req=urllib.request.Request('http://127.0.0.1:8081/api/v1/ready',headers={'Host':'sitesourcery.com','X-Forwarded-Proto':'https'})
 with urllib.request.urlopen(req,timeout=5) as r:v=json.load(r)
 require(v['ready'] is True and v['release']['candidateCommitSha']==candidate and v['release']['migrationCount']==count and v['release']['candidateTreeSha']==tree,'exact_API_not_ready');return v['release']
def main():
 global a
 action=sys.argv[1];require(os.geteuid()==0 and socket.gethostname()=='FantaSeaLand','exact_HQ_root_required')
 if action=='observe':print(json.dumps(observe()));sys.exit(0)
 require(action in ['initial','rehold','resume-api','resume-runtime','resume-admission','restore-api','restore-runtime','restore-admission'] and len(sys.argv)==4,'unknown_action')
 a=anchored({'path':sys.argv[2],'sha256':sys.argv[3]});_profile.bind_operation(a,PROFILE,PROFILE_REF);_profile.verify_bundle(a,Path(__file__).resolve().parent);require(a['approved'] is True and a['action']==action and a['scope']=='native_handoff','approval_required')
 require(all(isinstance(a.get(k),str) and re.fullmatch('[a-f0-9]{40}',a[k]) for k in ['candidate','tree']) and a['candidate']!=PRIOR,'actual_new_release_binding_required')
 issued=datetime.datetime.fromisoformat(a['issuedAt'].replace('Z','+00:00'));expires=datetime.datetime.fromisoformat(a['expiresAt'].replace('Z','+00:00'));require(issued<=datetime.datetime.now(datetime.timezone.utc)<expires<=issued+datetime.timedelta(hours=1),'approval_expired')
 require(a['backupRunByThisHelper'] is False and a['databaseMutationAllowed'] is False and a['providerConfigurationChangeAllowed'] is False,'extra_effect_forbidden');fence_free()
 locks=[]
 atexit.register(lambda:[os.close(fd) for fd in reversed(locks)])
 for p in ['/run/sitesourcery-monitor/monitor.lock','/srv/sitesourcery-storage/production/backup-control/operations.lock']:
  fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'existing_lock_changed');locks.append(fd);end=time.monotonic()+10
  while True:
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
   except BlockingIOError:require(time.monotonic()<end,'operations_busy');time.sleep(.1)
 if action=='initial':
  before=observe();require(before==anchored(a['baselineReceipt']),'fresh_baseline_changed');require(before['source']==str(BASE/'releases'/PRIOR),'prior_source_changed');ready(PRIOR,BEFORE_COUNT,PRIOR_TREE)
  require(not os.path.lexists(OUT) and not os.path.lexists(MARKER) and all(not os.path.lexists(drop(u)) for u in ALL),'prior_handoff_exists')
  require(all(before['units'][key(u)]['ActiveState']=='inactive' for u in PASSIVE+LATE[1:]),'background_one_shot_active');require(all(before['units'][key(u)]['ActiveState'] in ['active','inactive'] for u in ALL),'transitioning_unit')
  require(all(before['units'][key(u)]['ActiveState']=='active' for u in RUNTIME+[API,ADMISSION[0],PG,GATEWAY,MOUNT,PRIVATE[0]]) and before['workerPurposes']==PROFILE['workerPurposes'],'accepted_configured_purpose_baseline_required')
  require(before['units'][key(PRIVATE[1])]['ActiveState']=='active' and before['units'][key(PRIVATE[2])]['ActiveState']=='inactive' and before['units'][key(PRIVATE[2])]['UnitFileState']=='disabled','private_timer_baseline_changed')
  require(all(all(Path(p).name<DROP for p in v['DropInPaths'].split()) for v in before['units'].values()),'later_dropin_requires_review')
  _profile.current_window(a,3600);os.umask(0o077);OUT.mkdir(mode=0o700);save('journal.json',{'at':now(),'baseline':before,'authoritySha256':sys.argv[3]});create(MARKER,MARKER_BYTES,0o600);hold(ALL);reload()
  for u in ADMISSION+PASSIVE+list(reversed(RUNTIME))+LATE:control(u,'stop')
  require(all(state(u)['ActiveState']=='inactive' and state(u)['MainPID']=='0' for u in ALL if not u[1].endswith('.timer')),'site_writer_not_stopped');require(all(state(u)['ActiveState']=='inactive' for u in ALL),'site_timer_or_operation_not_held');unchanged_baseline({'baseline':before})
  save('initial-holds.json',{'at':now(),'phase':'initial','units':{key(u):state(u) for u in ALL},'holdPaths':[str(MARKER)]+[str(drop(u)) for u in ALL],'apiIntentionallyActive':False,'independentServicesPreserved':True,'backupNotRun':True,'databaseMutationPerformed':False});print(json.dumps({'phase':'initial','passed':True,'backupNotRun':True,'durableHoldPathCount':10}));sys.exit(0)
 j=anchored(a['journal']);unchanged_baseline(j)
 if action=='rehold':
  require(not os.path.lexists(OUT/'rehold-intent.json') and not os.path.lexists(OUT/'rehold.json'),'rehold_attempt_already_exists')
  initial=anchored(a['initialHoldReceipt']);require(initial['phase']=='initial' and initial['holdPaths']==[str(MARKER)]+[str(drop(u)) for u in ALL] and initial['apiIntentionallyActive'] is False,'genuine_initial_hold_required')
  installed=anchored(a['installedReceipt']);require(installed['state']=='installed_held' and installed['candidate']==a['candidate'] and installed['tree']==a['tree'] and installed['migrationCount']==COUNT and installed['schemaUnchanged'] is True and installed['databaseEffectsThisOperation'] is False and installed['activationAllowed'] is False,'genuine_new_installed_receipt_required')
  require((BASE/'current').resolve()==BASE/'releases'/a['candidate'],'rehold_source_changed')
  for path,expected in installed['nativeFiles'].items():require(meta(Path(path))==expected,'installed_native_file_changed:'+path)
  if os.path.lexists(MARKER):exact(MARKER,MARKER_BYTES,0o600)
  observed_before={}
  for u in ALL:
   if os.path.lexists(drop(u)):exact(drop(u),DROP_BYTES,0o644)
   v=state(u);observed_before[key(u)]=v;require(v['ActiveState'] in ['active','inactive','failed'] and v['UnitFileState']==j['baseline']['units'][key(u)]['UnitFileState'],'unreviewed_site_state:'+key(u))
  save('rehold-intent.json',{'at':now(),'authoritySha256':sys.argv[3],'journal':a['journal'],'installedReceipt':a['installedReceipt'],'observedBeforeStop':observed_before,'automatic':False})
  if not os.path.lexists(MARKER):create(MARKER,MARKER_BYTES,0o600)
  hold([u for u in ALL if not os.path.lexists(drop(u))]);reload()
  for u in ADMISSION+PASSIVE+list(reversed(RUNTIME))+LATE:control(u,'stop')
  stopped={key(u):state(u) for u in ALL};save('rehold-stopped-before-reset.json',{'at':now(),'units':stopped})
  reset_units=[]
  for u in ALL:
   if u[1].endswith('.timer'):continue
   v=stopped[key(u)];require(v['MainPID']=='0' and v['ActiveState'] in ['inactive','failed'],'site_stop_incomplete:'+key(u))
   if v['ActiveState']=='failed' or v['NRestarts']!=j['baseline']['units'][key(u)]['NRestarts']:
    require(j['baseline']['units'][key(u)]['NRestarts']=='0','nonzero_original_restart_counter_requires_review:'+key(u));control(u,'reset-failed');reset_units.append(key(u))
  for u in ALL:
   exact(drop(u),DROP_BYTES,0o644);v=state(u);expected=installed['after']['timers' if u[1].endswith('.timer') else 'units'][u[1]]
   require(v['ActiveState']=='inactive' and (u[1].endswith('.timer') or v['MainPID']=='0') and all(v[k]==value for k,value in expected.items() if k!='Id'),'exact_native_stopped_state_not_restored:'+key(u))
  exact(MARKER,MARKER_BYTES,0o600);unchanged_baseline(j)
  save('rehold.json',{'at':now(),'phase':'rehold','candidate':a['candidate'],'tree':a['tree'],'holdPaths':[str(MARKER)]+[str(drop(u)) for u in ALL],'holdFiles':{str(path):meta(path) for path in [MARKER]+[drop(u) for u in ALL]},'units':{key(u):state(u) for u in ALL},'explicitResetFailedUnits':reset_units,'exactNativeStoppedStateRestored':True,'independentServicesPreserved':True,'automaticRollback':False});print(json.dumps({'phase':'rehold','passed':True,'durableHoldPathCount':10}));sys.exit(0)
 exact(MARKER,MARKER_BYTES,0o600)
 restoring=action.startswith('restore-');phase_action=action.replace('restore-','resume-');target_candidate=PRIOR if restoring else a['candidate'];target_tree=PRIOR_TREE if restoring else a['tree']
 receipt_ref=a['rollbackReceipt'] if restoring else a['installedReceipt']
 installed=anchored(receipt_ref)
 if restoring:
  require(receipt_ref['path']==PATHS['installation']+'/rollback-result.json','exact_failed_candidate_rollback_path_required')
  require(installed['state']=='rolled_back_held' and installed['candidate']==PRIOR and installed['tree']==PRIOR_TREE and installed['migrationCount']==COUNT and installed['schemaUnchanged'] is True and installed['databaseEffectsThisOperation'] is False and installed['serviceStartsOrStops'] is False and installed['activationAllowed'] is False,'genuine_prior_rollback_receipt_required')
 else:
  require(installed['state']=='installed_held' and installed['migrationCount']==COUNT and installed['schemaUnchanged'] is True and installed['databaseEffectsThisOperation'] is False and installed['siteCodeWritersRemainHeld'] is True and installed['independentPrivateHqPreserved'] is True and installed['activationAllowed'] is False and installed['candidate']==a['candidate'] and installed['tree']==a['tree'],'genuine_same_schema_installed_receipt_required')
 require((BASE/'current').resolve()==BASE/'releases'/target_candidate,'installed_source_changed')
 if phase_action=='resume-api':
  release([API]);control(API,'start');end=time.monotonic()+60
  try:
   while True:
    try:release_identity=ready(target_candidate,COUNT,target_tree);break
    except Exception:require(time.monotonic()<end,'API_readiness_timeout');time.sleep(.5)
  except BaseException:control(API,'stop');raise
  save(action+'.json',{'at':now(),'release':release_identity,'unit':state(API),'admissionStillHeld':True});print(json.dumps({'phase':action,'passed':True}));sys.exit(0)
 ready(target_candidate,COUNT,target_tree)
 selected=RUNTIME if phase_action=='resume-runtime' else ADMISSION+PASSIVE+LATE[1:]
 if phase_action=='resume-admission':
  require(a['priorRuntimeAndOwnerAccepted'] is True,'runtime_and_owner_acceptance_required');accepted=anchored(a['runtimeAcceptanceReceipt'])
  require(accepted['state']=='passed' and accepted['candidate']==target_candidate and accepted['tree']==target_tree and accepted['acceptanceMode']==('restored-prior' if restoring else 'new') and accepted['migrationCount']==COUNT and accepted['publicAdmissionStillHeld'] is True and accepted['installedReceiptSha256']==receipt_ref['sha256'] and accepted['runtimeResumeReceiptSha256']==meta(OUT/('restore-runtime.json' if restoring else 'resume-runtime.json'))['sha256'],'exact_runtime_acceptance_required')
 release(selected)
 for u in selected:
  if j['baseline']['units'][key(u)]['ActiveState']=='active':control(u,'start')
 for u in selected:require(state(u)['ActiveState']==j['baseline']['units'][key(u)]['ActiveState'] and state(u)['UnitFileState']==j['baseline']['units'][key(u)]['UnitFileState'],'prior_state_not_restored:'+key(u))
 unchanged_baseline(j)
 if phase_action=='resume-admission':
  require(all(not os.path.lexists(drop(u)) for u in ALL),'remaining_owned_hold');MARKER.unlink()
 save(action+'.json',{'at':now(),'phase':action,'units':{key(u):state(u) for u in selected},'workerPurposes':j['baseline']['workerPurposes'],'readinessFilesPreserved':True,'enablementUnchanged':True});print(json.dumps({'phase':action,'passed':True}))

if __name__=='__main__':main()
