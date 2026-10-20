#!/usr/bin/python3
"""Readonly current-invocation worker and existing-owner GET acceptance; no lifecycle."""
import datetime,hashlib,json,os,re,socket,stat,subprocess,sys,time,urllib.request,urllib.parse
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

C=PROFILE['candidate'];T=PROFILE['tree']
PURPOSES=PROFILE['workerPurposes']
USER=PROFILE['owner']['userId'];ORG=PROFILE['owner']['organizationId']
BASE=Path('/home/mrfantasea/.local/share/sitesourcery-production');J=Path(PATHS['journal'])
ID=Path('/home/mrfantasea/.config/sitesourcery-hq-operator/identity.json');WORKER='sitesourcery-hq-workers.service'
sha=lambda b:hashlib.sha256(b).hexdigest();now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def require(ok,reason):
 if not ok:raise RuntimeError(reason)
def regular(p):
 st=p.lstat();require(stat.S_ISREG(st.st_mode) and st.st_nlink==1,'regular_file_required');b=p.read_bytes();return b,{'uid':st.st_uid,'gid':st.st_gid,'mode':stat.S_IMODE(st.st_mode),'sha256':sha(b)}
def read(p):return json.loads(regular(p)[0])
def command(args):return subprocess.check_output(args,stderr=subprocess.PIPE,timeout=10)
def show(unit,user=False):
 args=['/usr/bin/systemctl','show',unit,'--property=LoadState,ActiveState,MainPID,NRestarts,UnitFileState,InvocationID,WorkingDirectory']
 if user:args=['/usr/sbin/runuser','-u','mrfantasea','--','/usr/bin/env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user']+args[1:]
 v=dict(x.split('=',1) for x in command(args).decode().splitlines());require(v['LoadState']=='loaded','unit_missing');return v
def runtimes():return {**{n:show(n) for n in ['sitesourcery-hq-api.service',WORKER,'sitesourcery-hq-tenant.service','sitesourcery-hq-gateway.service']},**{n:show(n,True) for n in ['sitesourcery-production-postgresql.service','client-profile-hub.service']}}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());http=[]
def get(port,path):
 headers={'Accept':'application/json'}
 if port==8081:headers.update({'Host':'sitesourcery.com','X-Forwarded-Proto':'https'})
 with opener.open(urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers=headers),timeout=10) as response:
  raw=response.read(2*1024*1024+1);require(response.status==200 and len(raw)<=2*1024*1024,'http_read_failed');require(response.headers.get('Content-Type','').startswith('application/json'),'json_response_required')
 http.append({'port':port,'path':path,'status':200,'bytes':len(raw),'sha256':sha(raw)});return json.loads(raw)
def main():
 global C,T
 phase='preflight'
 try:
  require(os.getuid()==0 and socket.gethostname()=='FantaSeaLand','exact_root_host_required');require(len(sys.argv) in [2,3] and (len(sys.argv)==2 or sys.argv[2]=='prior'),'finite_expiry_and_optional_prior_mode_required')
  expires=datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00'));require(0<(expires-datetime.datetime.now(datetime.timezone.utc)).total_seconds()<=3600,'finite_expiry_required')
  require(re.fullmatch('[a-f0-9]{40}',C) and re.fullmatch('[a-f0-9]{40}',T),'actual_new_release_binding_required')
  new_candidate=C;restoring=len(sys.argv)==3;runtime_name='restore-runtime.json' if restoring else 'resume-runtime.json'
  if restoring:C=PROFILE['priorCandidate'];T=PROFILE['priorTree']
  require((BASE/'current').resolve()==BASE/'releases'/C,'current_source_changed')
  journal=read(J/'journal.json');resume=read(J/runtime_name);require(resume['phase']==('restore-runtime' if restoring else 'resume-runtime') and resume['workerPurposes']==PURPOSES,'genuine_runtime_resume_required')
  installedPath=Path(PATHS['installation'])/('rollback-result.json' if restoring else 'result.json');installed=read(installedPath);require(installed['state']==('rolled_back_held' if restoring else 'installed_held') and installed['candidate']==C and installed['tree']==T and installed['migrationCount']==COUNT and installed['schemaUnchanged'] is True and installed['databaseEffectsThisOperation'] is False and installed['activationAllowed'] is False and (restoring or installed['independentPrivateHqPreserved'] is True),'genuine_install_or_prior_rollback_required')
  epoch=read(Path('/etc/sitesourcery/final-release-epoch-v2.json'))
  for n in ['workers.env','WORKERS_APPROVED']:
   p=Path('/etc/sitesourcery')/n;require(regular(p)[1]['sha256']==journal['baseline']['files'][str(p)]['sha256'],'worker_configuration_changed')
  identityRaw,identityMeta=regular(ID);identity=json.loads(identityRaw);require(identityMeta['uid']==1000 and identityMeta['mode']==0o600 and identity['userId']==USER and identity['organizationId']==ORG,'existing_owner_identity_required');require(identityMeta['sha256']==journal['baseline']['files'][str(ID)]['sha256'],'owner_identity_changed_since_hold')
  units=runtimes();require(all(v['ActiveState']=='active' and int(v['MainPID'])>0 for v in units.values()),'runtime_not_active')
  require(show('sitesourcery-hq-cloudflared.service')['ActiveState']=='inactive','admission_must_still_be_held')
  for name in ['sitesourcery-production-postgresql.service','sitesourcery-hq-gateway.service','client-profile-hub.service']:
   key=('user:' if name in ['sitesourcery-production-postgresql.service','client-profile-hub.service'] else 'system:')+name
   require(all(units[name][k]==journal['baseline']['units'][key][k] for k in ['ActiveState','MainPID','NRestarts']),'preserved_runtime_changed')
  phase='api_readiness';ready=get(8081,'/api/v1/ready');release=ready['release']
  require(ready['ready'] is True and release['candidateCommitSha']==C and release['candidateTreeSha']==T and release['migrationCount']==COUNT and release['epochId']==epoch['epochId'] and release['bindingSha256']==epoch['bindingSha256'],'exact_readiness_required')
  capabilities=get(8081,'/api/v1/capabilities')
  for k,want in PROFILE['expectedCapabilities'].items():require(capabilities.get(k)==want,'capability_baseline_changed:'+k)
  phase='worker_cycles';end=time.monotonic()+45;invocation=units[WORKER]['InvocationID'];require(re.fullmatch('[a-f0-9]{32}',invocation),'worker_invocation_required')
  # Startup may be older than the recent cycle window; filter the same invocation first.
  startedRaw=command(['/usr/bin/journalctl','--quiet','--no-pager','--output=cat','--grep=sitesourcery[.]worker[.]started','-n','20','_SYSTEMD_INVOCATION_ID='+invocation]);startedEvents=[]
  for line in startedRaw.splitlines():
   try:x=json.loads(line)
   except (ValueError,UnicodeError):continue
   if isinstance(x,dict):startedEvents.append(x)
  started=any(x.get('event')=='sitesourcery.worker.started' and x.get('state',{}).get('runningPurposes')==PURPOSES for x in startedEvents)
  require(started,'current_invocation_startup_missing_or_purposes_changed')
  while True:
   worker=show(WORKER);require(worker['ActiveState']=='active' and worker['NRestarts']=='0' and worker['MainPID']==units[WORKER]['MainPID'] and worker['InvocationID']==invocation,'worker_restart_or_failure')
   raw=command(['/usr/bin/journalctl','--quiet','--no-pager','--output=cat','-n','2000','_SYSTEMD_INVOCATION_ID='+invocation]);events=[]
   for line in raw.splitlines():
    try:x=json.loads(line)
    except (ValueError,UnicodeError):continue
    if isinstance(x,dict):events.append(x)
   require(not any(x.get('errorCode') or x.get('event')=='sitesourcery.worker.failed' for x in events),'worker_cycle_failed')
   cycles={p:[x for x in events if _profile.worker_cycle_ok(x,p)] for p in PURPOSES if p!='export'}
   hb,hm=regular(Path('/run/sitesourcery/export-worker-health.json'));health=json.loads(hb);age=int(time.time()*1000)-health.get('checkedAtMs',0)
   fresh=hm['uid']==1000 and hm['mode']==0o600 and health.get('schema')=='sitesourcery.export-worker-health/v1' and health.get('purpose')=='export' and health.get('successful') is True and health.get('state')=='running' and health.get('cycle',0)>0 and any(x.get('event')=='sitesourcery.worker.export' and x.get('workerId')==health.get('workerId') and x.get('cycle')==health.get('cycle') and x.get('state')=='running' and not x.get('errorCode') for x in events) and 0<=age<120000
   if started and fresh and all(cycles.values()):break
   require(time.monotonic()<end,'fresh_configured_purpose_cycles_missing');time.sleep(1)
  cycleProof={p:{k:values[-1][k] for k in ['event','state','cycle','resultStatus','result','claimed','completed','manualReview','released'] if k in values[-1]} for p,values in cycles.items()}
  phase='existing_private_owner_gets';me=get(8790,'/api/v1/me');require(me['user']['id']==USER,'owner_changed')
  orgs=get(8790,'/api/v1/organizations');require(any(o['id']==ORG and o['role']=='owner' and o.get('state','active')=='active' for o in orgs['organizations']),'owner_organization_changed')
  queue=get(8790,'/api/v1/operator/work-queue?'+urllib.parse.urlencode({'operatorOrganizationId':ORG}));require(queue['schema']=='sitesourcery.operator-work-queue/v1' and isinstance(queue['items'],list),'owner_queue_shape_changed')
  require(regular(ID)[0]==identityRaw,'identity_changed_during_gets');require(runtimes()==units,'runtime_changed_during_acceptance')
  require(show('sitesourcery-hq-cloudflared.service')['ActiveState']=='inactive','admission_changed_during_acceptance');require(datetime.datetime.now(datetime.timezone.utc)<expires,'approval_expired')
  print(json.dumps({'state':'passed','acceptanceMode':'restored-prior' if restoring else 'new','at':now(),'candidate':C,'tree':T,'migrationCount':COUNT,'release':release,'capabilities':capabilities,'units':units,'workerPurposes':PURPOSES,'workerInvocationId':invocation,'workerCycles':cycleProof,'workerJournalSha256':sha(raw),'workerStartedJournalSha256':sha(startedRaw),'exportHeartbeat':{k:health[k] for k in ['schema','state','successful','cycle','checkedAtMs','purpose','errorCode','workerId'] if k in health},'exportHealthSha256':sha(hb),'exportHealthAgeMs':age,'privateHq':{'sameExistingOwner':True,'sameExistingOrganization':True,'ownerRole':True,'queueRead':True,'queueItemCount':len(queue['items']),'identityUnchanged':True,'identitySha256':sha(identityRaw),'naturalExistingSessionReconnectPossible':True,'forcedRotation':False},'http':http,'runtimeResumeReceiptSha256':sha((J/runtime_name).read_bytes()),'installedReceiptSha256':sha(installedPath.read_bytes()),'publicAdmissionStillHeld':True,'serviceCommandsInvoked':False,'customerCommandsInvoked':False,'providerMutationCommandsInvoked':False,'sqlInvokedByCollector':False},indent=2))
 except Exception as e:
  print(json.dumps({'state':'failed','phase':phase,'name':type(e).__name__,'reason':str(e) if type(e) is RuntimeError else None,'serviceCommandsInvoked':False,'customerCommandsInvoked':False,'providerMutationCommandsInvoked':False}));sys.exit(1)

if __name__=='__main__':main()
