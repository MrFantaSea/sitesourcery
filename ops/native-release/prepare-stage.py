#!/usr/bin/env python3
"""Prepare INERT STAGE ONLY from qualified bytes; never install, rebuild or authorize native effects."""
import ast,hashlib,io,json,os,re,stat,subprocess,sys,tarfile
from pathlib import Path

# The profile is data; no native command runs while loading or validating it.
import importlib.util
_profile_spec=importlib.util.spec_from_file_location('sitesourcery_release_profile',Path(__file__).with_name('profile.py'))
_profile=importlib.util.module_from_spec(_profile_spec);_profile_spec.loader.exec_module(_profile)
require_profile=_profile.require
require_profile(len(sys.argv)>=4,'PROFILE SHA256 ACTION required')
PROFILE_REF={'path':sys.argv[1],'sha256':sys.argv[2]}
PROFILE=_profile.load_profile(sys.argv[1],sys.argv[2],None)
PATHS=_profile.derived(PROFILE);COUNT=PROFILE['expectedSchema']['afterCount'];BEFORE_COUNT=PROFILE['expectedSchema']['beforeCount']
TABLES=PROFILE['expectedSchema']['afterTableCount'];BEFORE_TABLES=PROFILE['expectedSchema']['beforeTableCount']
sys.argv=[sys.argv[0]]+sys.argv[3:]
if sys.argv[1:]==['validate']:
 print(json.dumps({'valid':True,'mode':PROFILE['mode'],'candidate':PROFILE['candidate'],'migrationCount':COUNT,'holdCount':len(PATHS['holdPaths']),'nativeEffects':False}));sys.exit(0)

P=Path(__file__).resolve().parent

NODE=sys.executable # Node is supplied as a reviewed local tool path in the preparation input.
sha=lambda b:hashlib.sha256(b).hexdigest()
def anchored(ref):
 p=Path(ref['path']);assert p.is_absolute() and stat.S_ISREG(p.lstat().st_mode)
 b=p.read_bytes();assert sha(b)==ref['sha256'];return b
def main():
 assert len(sys.argv)==4,'prepare-stage.py PROFILE SHA256 REVIEWED_BINDING SHA256 OUTPUT_DIRECTORY'
 os.umask(0o077);raw=anchored({'path':sys.argv[1],'sha256':sys.argv[2]});a=json.loads(raw);_profile.bind_operation(a,PROFILE,PROFILE_REF)
 _profile.keys(a,'profile reviewed nativeEffectsAuthorized candidate tree helperRepository localNode successorInput priorStageReceipt qualifiedHostedRoot','stage preparation')
 local_node=Path(a['localNode']);assert local_node.is_absolute() and local_node.resolve()==local_node
 NODE=str(local_node)
 assert a['reviewed'] is True and a['nativeEffectsAuthorized'] is False
 priorraw=anchored(a['priorStageReceipt']);prior=json.loads(priorraw)
 assert prior['status']=='staged_inert'
 OLD=prior['validation']['checkout']['head'];OT=prior['validation']['checkout']['tree']
 _profile.digest(OLD,40);_profile.digest(OT,40)
 assert prior['validation']['seal']['source']=={'commitSha':OLD,'treeSha':OT}
 C=a['candidate'];T=a['tree']
 assert re.fullmatch('[a-f0-9]{40}',C) and C!=OLD and re.fullmatch('[a-f0-9]{40}',T)
 repo=Path(a['helperRepository']);assert repo.is_absolute() and repo.resolve()==repo
 git=lambda *args:subprocess.check_output(['git','--no-optional-locks','-C',str(repo),*args])
 assert git('status','--porcelain')==b''
 assert git('rev-parse',C+'^{tree}').decode().strip()==T
 assert git('diff','--name-only',C).decode().strip() in ('','ops/releases/ci-successor-inputs/'+C+'.json')
 old_package=git('show',OLD+':package.json');new_package=git('show',C+':package.json')
 old_lock=git('show',OLD+':package-lock.json');new_lock=git('show',C+':package-lock.json')
 assert old_lock==new_lock,'Lockfile changed: dependency reuse forbidden'
 assert old_package==new_package,'Package bytes changed: dependency reuse forbidden'
 packages={'package.json':sha(new_package),'package-lock.json':sha(new_lock)}
 inpraw=anchored(a['successorInput']);inp=json.loads(inpraw);release=inp['originReleaseInput']
 assert release['epoch']['source']=={'commitSha':C,'treeSha':T}
 assert release['epoch']['migration']['count']==COUNT
 assert release['epoch']['migration']['manifestSha256']==PROFILE['expectedSchema']['manifestSha256']
 prior=json.loads(priorraw);assert prior['status']=='staged_inert' and prior['validation']['checkout']['head']==OLD
 assert prior['validation']['checkout']['tree']==OT
 prior_packages={e['path']:e['sha256'] for e in prior['inventory']['entries'] if e['path'] in ('package.json','package-lock.json')}
 assert prior_packages=={'package.json':sha(old_package),'package-lock.json':sha(old_lock)}
 inv=prior['inventory'];_profile.digest(inv['inventorySha256'])
 artifact=Path(a['qualifiedHostedRoot']);assert artifact==repo/'_hosted' and artifact.resolve()==artifact
 js="import {pathToFileURL} from 'node:url';const {collectCiRollbackArtifactEvidence}=await import(pathToFileURL(process.argv[1]+'/ops/ci-release-proof-repository.mjs'));console.log(JSON.stringify(await collectCiRollbackArtifactEvidence({artifactRoot:process.argv[2]})));"
 measured=json.loads(subprocess.check_output([NODE,'--input-type=module','-e',js,str(repo),str(artifact)]))
 assert measured['sha256']==release['epoch']['artifact']['manifestSha256'],'Qualified hosted artifact mismatch'
 assert measured['byteCount']<128*1024*1024 and measured['fileCount']<10000
 # Capture the already-measured files once; no old artifact reuse, generation or install.
 hosted={}
 for e in measured['files']:
  relative=Path(e['path']);assert relative.parts[0]=='_hosted' and '..' not in relative.parts and not relative.is_absolute()
  p=repo/relative;assert stat.S_ISREG(p.lstat().st_mode) and p.resolve()==p
  b=p.read_bytes();assert len(b)==e['byteCount'] and sha(b)==e['sha256'];hosted[e['path']]=b
 source=[]
 for entry in git('ls-tree','-r','-z','--full-tree',C).split(b'\0'):
  if not entry:continue
  header,name=entry.split(b'\t',1);mode,kind,oid=header.decode().split();assert kind=='blob'
  source.append({'path':name.decode(),'gitMode':mode,'oid':oid})
 proc=subprocess.Popen(['git','--no-optional-locks','-C',str(repo),'cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
 blobs,_=proc.communicate(('\n'.join(e['oid'] for e in source)+'\n').encode());assert proc.returncode==0
 offset=0
 for e in source:
  end=blobs.index(b'\n',offset);oid,kind,size=blobs[offset:end].decode().split();size=int(size);b=blobs[end+1:end+1+size];offset=end+2+size
  assert oid==e.pop('oid') and kind=='blob'
  if e['gitMode']=='120000':e.update(type='symlink',target=b.decode())
  else:assert e['gitMode'] in ('100644','100755');e.update(type='file',byteCount=len(b),sha256=sha(b))
 out=Path(sys.argv[3]);_profile.absolute(str(out));assert out.parent.resolve()==out.parent
 assert not os.path.lexists(out);out.mkdir(mode=0o700)
 def save(name,b):
  with (out/name).open('xb') as f:f.write(b)
  return {'path':str(out/name),'sha256':sha(b),'bytes':len(b)}
 with tarfile.open(out/'hosted.tar','x',format=tarfile.USTAR_FORMAT) as tar:
  for name,b in sorted(hosted.items()):
   e=tarfile.TarInfo(name);e.size=len(b);e.mode=0o644;e.uid=1000;e.gid=1000;e.mtime=0;tar.addfile(e,io.BytesIO(b))
 archive=(out/'hosted.tar').read_bytes()
 cfg={'schema':'sitesourcery.native-stage-input/v1','profile':PROFILE_REF,'authorized':False,'issuedAt':None,'expiresAt':None,'helpers':{p.name:sha(p.read_bytes()) for p in P.iterdir() if p.suffix in ['.py','.mjs']},'old':OLD,'oldTree':OT,'releases':'/home/mrfantasea/.local/share/sitesourcery-production/releases/','node':PROFILE['runtime']['node']}
 cfg.update(candidate=C,tree=T,releaseInput=release,sourceInputSha256=sha(inpraw),priorActualReceiptSha256=sha(priorraw),expectedSource=sorted(source,key=lambda x:x['path']),oldInventorySha256=inv['inventorySha256'],minimumAvailableBytes=2*inv['totalFileBytes']+len(archive),hostedArchiveSha256=sha(archive),hostedArchiveBytes=len(archive),hostedFiles=measured['files'])
 cfg['packages']=packages # Package and lock are byte-identical to the retained2f dependency payload.
 cfg['packageReuse']={'scope':'exact package and lock byte equality','prior':prior_packages,'candidate':packages,'lockByteIdentical':True,'packageByteIdentical':True}
 configuration=(json.dumps(cfg,indent=2)+'\n').encode()
 files=[save('stage-input.UNAPPROVED.json',configuration),save('successor-input.json',inpraw),save('release-binding.REVIEWED.json',raw)]
 result={'preparedOnly':True,'candidate':C,'tree':T,'baseline':OLD,'migrationInventoryCount':COUNT,'databaseMigrationsApplied':0,'stageOnly':True,'reviewedBindingSha256':sha(raw),'nativeEffectsAuthorized':False,'hostedArtifactManifestSha256':measured['sha256'],'hostedArchive':{'path':str(out/'hosted.tar'),'sha256':sha(archive),'bytes':len(archive)},'dependencyReuseOnly':True,'packageReuse':cfg['packageReuse'],'hostedRebuilt':False,'files':files,'nativeStageTransferDirectory':f'/home/mrfantasea/.local/share/sitesourcery-stage-transfer-{PROFILE["cohort"]}-{C[:8]}','nativeReleaseDirectory':cfg['releases']+C}
 save('packet-preparation.json',(json.dumps(result,indent=2)+'\n').encode());print(json.dumps(result))
if __name__=='__main__':main()
