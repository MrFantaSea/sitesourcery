#!/usr/bin/python3
"""Readonly current-invocation worker and existing-owner GET acceptance; no lifecycle."""
import datetime,hashlib,json,os,re,socket,stat,subprocess,sys,time,urllib.request,urllib.parse
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
PROFILE=_profile.load_profile(sys.argv[1],sys.argv[2],'schema-changing')
PATHS=_profile.derived(PROFILE);COUNT=PROFILE['expectedSchema']['afterCount'];BEFORE_COUNT=PROFILE['expectedSchema']['beforeCount']
TABLES=PROFILE['expectedSchema']['afterTableCount'];BEFORE_TABLES=PROFILE['expectedSchema']['beforeTableCount']
sys.argv=[sys.argv[0]]+sys.argv[3:]
if sys.argv[1:]==['validate']:
 print(json.dumps({'valid':True,'mode':PROFILE['mode'],'candidate':PROFILE['candidate'],'migrationCount':COUNT,'holdCount':len(PATHS['holdPaths']),'nativeEffects':False}));sys.exit(0)

C=PROFILE['candidate'];T=PROFILE['tree']
PURPOSES=PROFILE['workerPurposes']
EXPECTED_CARE_CATALOG=PROFILE['expectedCapabilities'].get('careCatalog')
EXPECTED_MAIL_PROVIDER_EVENTS=PROFILE['expectedCapabilities'].get('mailProviderEvents')
EXPECTED_BASELINE_CONFIG_SHA256=PROFILE['baselineConfiguration']
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
 args=['/usr/bin/systemctl','show',unit,'--property=LoadState,ActiveState,SubState,MainPID,NRestarts,UnitFileState,InvocationID,ExecMainStartTimestamp,WorkingDirectory,FragmentPath,DropInPaths']
 if user:args=['/usr/sbin/runuser','-u','mrfantasea','--','/usr/bin/env','XDG_RUNTIME_DIR=/run/user/1000','DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus','/usr/bin/systemctl','--user']+args[1:]
 v=dict(x.split('=',1) for x in command(args).decode().splitlines());require(v['LoadState']=='loaded','unit_missing');return v
def runtimes():return {**{n:show(n) for n in ['sitesourcery-hq-api.service',WORKER,'sitesourcery-hq-tenant.service','sitesourcery-hq-gateway.service']},**{n:show(n,True) for n in ['sitesourcery-production-postgresql.service','client-profile-hub.service']}}
PRIVATE_NAMES=['client-profile-hub.service','client-profile-hub-backup.timer','client-profile-hub-morning-research.timer','client-profile-hub-backup.service','client-profile-hub-morning-research.service']
def anchored_private(ref,name):
 require(ref['path']==str(J/name),'exact_private_receipt_path_required');raw,metadata=regular(J/name)
 require(metadata['uid']==0 and metadata['gid']==0 and metadata['mode']==0o600 and metadata['sha256']==ref['sha256'],'private_receipt_custody_changed');return json.loads(raw)
def private_definition_readback(journal):
 result={}
 for name in PRIVATE_NAMES:
  unit=journal['baseline']['units']['user:'+name]
  for value in [unit['FragmentPath'],*unit['DropInPaths'].split()]:
   p=Path(value);expected=journal['baseline']['files'][value];st=p.lstat()
   if 'definitionLink' in expected:
    link=expected['definitionLink'];require(stat.S_ISLNK(st.st_mode) and st.st_nlink==link['nlink'] and st.st_uid==link['uid'] and st.st_gid==link['gid'] and stat.S_IMODE(st.st_mode)==link['mode'] and os.readlink(p)==link['linkText'] and str(p.resolve(strict=True))==link['resolvedPath'],'private_definition_link_changed');p=p.resolve(strict=True)
   raw,metadata=regular(p);require({**metadata,'bytes':len(raw)}=={k:v for k,v in expected.items() if k!='definitionLink'},'private_definition_bytes_changed');result[value]=metadata['sha256']
 return result
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
  require(os.getuid()==0 and socket.gethostname()=='FantaSeaLand','exact_root_host_required');require(len(sys.argv)==2,'finite_expiry_required_no_code_only_restore')
  expires=datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00'));require(0<(expires-datetime.datetime.now(datetime.timezone.utc)).total_seconds()<=3600,'finite_expiry_required')
  require(re.fullmatch('[a-f0-9]{40}',C) and re.fullmatch('[a-f0-9]{40}',T),'actual_new_release_binding_required')
  new_candidate=C;restoring=False;runtime_name='resume-runtime.json'
  require(isinstance(EXPECTED_CARE_CATALOG,dict),'actual_Care_capability_baseline_required')
  require((BASE/'current').resolve()==BASE/'releases'/C,'current_source_changed')
  journal=read(J/'journal.json');require(journal['baseline']['workerPurposes']==PURPOSES,'accepted_configured_purpose_baseline_changed');require(PURPOSES==PROFILE['workerPurposes'],'actual_configured_purpose_baseline_required');resume=read(J/runtime_name);require(resume['phase']=='resume-runtime' and resume['workerPurposes']==PURPOSES,'genuine_runtime_resume_required')
  installedPath=Path(PATHS['installation'])/'result.json';installed=read(installedPath);require(installed['state']=='installed_held' and installed['candidate']==C and installed['tree']==T and installed['migrationCount']==COUNT and installed['databaseAlreadyMigrated'] is True and installed['codeOnlyRollbackAllowed'] is False and installed['databaseEffectsThisOperation'] is False and installed['activationAllowed'] is False and installed['privateHqHeldPreserved'] is True,'genuine_install_required')
  isolation=_isolation.verify_installed(PROFILE,installed)
  epoch=read(Path('/etc/sitesourcery/final-release-epoch-v2.json'))
  for p,want in EXPECTED_BASELINE_CONFIG_SHA256.items():require(journal['baseline']['files'][p]['sha256']==want,'accepted_configuration_baseline_changed')
  for n in ['workers.env','WORKERS_APPROVED']:
   p=Path('/etc/sitesourcery')/n;require(regular(p)[1]['sha256']==journal['baseline']['files'][str(p)]['sha256'],'worker_configuration_changed')
  identityRaw,identityMeta=regular(ID);identity=json.loads(identityRaw);require(identityMeta['uid']==1000 and identityMeta['mode']==0o600 and identity['userId']==USER and identity['organizationId']==ORG,'existing_owner_identity_required');require(identityMeta['sha256']==journal['baseline']['files'][str(ID)]['sha256'],'owner_identity_changed_since_hold')
  units=runtimes();require(all(v['ActiveState']=='active' and int(v['MainPID'])>0 for v in units.values()),'runtime_not_active')
  require(show('sitesourcery-hq-cloudflared.service')['ActiveState']=='inactive','admission_must_still_be_held')
  for name in ['sitesourcery-production-postgresql.service']+([] if _isolation.enabled(PROFILE) else ['sitesourcery-hq-gateway.service']):
   key=('user:' if name=='sitesourcery-production-postgresql.service' else 'system:')+name
   require(all(units[name][k]==journal['baseline']['units'][key][k] for k in ['ActiveState','MainPID','NRestarts']),'preserved_runtime_changed')
  privateHold=anchored_private(resume['privateHqHoldReceipt'],'private-hq-held.json');privateResume=anchored_private(resume['privateHqResumeReceipt'],'private-hq-resume.json')
  require(privateHold['state']=='private_hq_held' and privateResume['state']=='private_hq_resumed' and privateResume['candidate']==C and privateResume['tree']==T and privateResume['privateHqHoldReceipt']==resume['privateHqHoldReceipt'] and privateResume['installedReceipt']['sha256']==sha(installedPath.read_bytes()),'genuine_private_HQ_resume_required')
  require(privateResume['journal']==privateHold['journal']=={'path':str(J/'journal.json'),'sha256':sha((J/'journal.json').read_bytes())},'private_HQ_journal_changed')
  require(privateResume['originalProcessIdentity']==privateHold['originalProcessIdentity']==journal['originalPrivateHqProcessIdentity'] and privateResume['originalUnit']==journal['baseline']['units']['user:client-profile-hub.service'],'private_original_identity_changed')
  hq=units['client-profile-hub.service'];require(all(hq[k]==v for k,v in privateResume['unit'].items()),'private_resumed_state_changed')
  require(all(hq[k]==v for k,v in privateResume['processIdentity'].items()),'private_resumed_process_changed')
  require(all(privateResume['unit'][k]==v for k,v in privateResume['originalUnit'].items() if k!='MainPID'),'private_original_configuration_or_enablement_changed')
  require(all(privateResume['processIdentity'][k]!=privateResume['originalProcessIdentity'][k] for k in ['MainPID','InvocationID','ExecMainStartTimestamp']),'private_restart_evidence_required')
  privateOtherUnits={name:show(name,True) for name in PRIVATE_NAMES[1:]}
  for name,value in privateOtherUnits.items():
   require(all(value[k]==v for k,v in privateHold['units']['user:'+name].items()),'private_writer_or_timer_resumed_early')
   require(value['ActiveState']=='inactive' and value.get('MainPID','0')=='0' and value['UnitFileState']==journal['baseline']['units']['user:'+name]['UnitFileState'],'private_writer_hold_or_enablement_changed')
  require(privateOtherUnits['client-profile-hub-morning-research.timer']['UnitFileState']=='disabled','morning_research_must_remain_disabled')
  privateDefinitions=private_definition_readback(journal)
  gateway=_isolation.verify_gateway(PROFILE,installed,resume,units,journal) if isolation else None
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
   hb,hm=regular(Path(_profile.worker_health_binding(PROFILE)['path']));health=json.loads(hb);age=int(time.time()*1000)-health.get('checkedAtMs',0)
   fresh=_profile.worker_health_metadata_ok(PROFILE,hm) and health.get('schema')=='sitesourcery.export-worker-health/v1' and health.get('purpose')=='export' and health.get('successful') is True and health.get('state')=='running' and health.get('cycle',0)>0 and any(x.get('event')=='sitesourcery.worker.export' and x.get('workerId')==health.get('workerId') and x.get('cycle')==health.get('cycle') and x.get('state')=='running' and not x.get('errorCode') for x in events) and 0<=age<120000
   if started and fresh and all(cycles.values()):break
   require(time.monotonic()<end,'fresh_configured_purpose_cycles_missing');time.sleep(1)
  cycleProof={p:{k:values[-1][k] for k in ['event','state','cycle','resultStatus','result','claimed','completed','manualReview','released'] if k in values[-1]} for p,values in cycles.items()}
  phase='existing_private_owner_gets';me=get(8790,'/api/v1/me');require(me['user']['id']==USER,'owner_changed')
  orgs=get(8790,'/api/v1/organizations');require(any(o['id']==ORG and o['role']=='owner' and o.get('state','active')=='active' for o in orgs['organizations']),'owner_organization_changed')
  queue=get(8790,'/api/v1/operator/work-queue?'+urllib.parse.urlencode({'operatorOrganizationId':ORG}));require(queue['schema']=='sitesourcery.operator-work-queue/v1' and isinstance(queue['items'],list),'owner_queue_shape_changed')
  require(regular(ID)[0]==identityRaw,'identity_changed_during_gets');require(runtimes()==units,'runtime_changed_during_acceptance');require({name:show(name,True) for name in PRIVATE_NAMES[1:]}==privateOtherUnits,'private_hold_changed_during_acceptance');require(private_definition_readback(journal)==privateDefinitions,'private_definition_changed_during_acceptance')
  require(show('sitesourcery-hq-cloudflared.service')['ActiveState']=='inactive','admission_changed_during_acceptance');require(datetime.datetime.now(datetime.timezone.utc)<expires,'approval_expired')
  print(json.dumps({'state':'passed','acceptanceMode':'new','at':now(),'candidate':C,'tree':T,'migrationCount':COUNT,'release':release,'capabilities':capabilities,'units':units,'workerPurposes':PURPOSES,'workerInvocationId':invocation,'workerCycles':cycleProof,'workerJournalSha256':sha(raw),'workerStartedJournalSha256':sha(startedRaw),'exportHeartbeat':{k:health[k] for k in ['schema','state','successful','cycle','checkedAtMs','purpose','errorCode','workerId'] if k in health},'exportHealthSha256':sha(hb),'exportHealthAgeMs':age,'privateHq':{'originalProcessIdentity':privateResume['originalProcessIdentity'],'resumedProcessIdentity':privateResume['processIdentity'],'configurationAndEnablementPreserved':True,'definitionSha256':privateDefinitions,'privateWritersAndTimersStillHeld':True,'sameExistingOwner':True,'sameExistingOrganization':True,'ownerRole':True,'queueRead':True,'queueItemCount':len(queue['items']),'identityUnchanged':True,'identitySha256':sha(identityRaw),'naturalExistingSessionReconnectPossible':True,'forcedRotation':False},'http':http,**({'isolation':isolation,'gateway':gateway} if isolation else {}),'runtimeResumeReceiptSha256':sha((J/runtime_name).read_bytes()),'privateHqResumeReceiptSha256':resume['privateHqResumeReceipt']['sha256'],'privateHqHoldReceiptSha256':resume['privateHqHoldReceipt']['sha256'],'installedReceiptSha256':sha(installedPath.read_bytes()),'publicAdmissionStillHeld':True,'serviceCommandsInvoked':False,'customerCommandsInvoked':False,'providerMutationCommandsInvoked':False,'sqlInvokedByCollector':False},indent=2))
 except Exception as e:
  print(json.dumps({'state':'failed','phase':phase,'name':type(e).__name__,'reason':str(e) if type(e) is RuntimeError else None,'serviceCommandsInvoked':False,'customerCommandsInvoked':False,'providerMutationCommandsInvoked':False}));sys.exit(1)

if __name__=='__main__':main()
