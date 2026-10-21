import os,stat,json,hashlib,subprocess,re,sys
from pathlib import Path
assert len(sys.argv) in (3,4) and (len(sys.argv)==3 or sys.argv[3] in ('--entries','--custody'))
C,T=sys.argv[1:3]
assert re.fullmatch('[a-f0-9]{40}',C) and re.fullmatch('[a-f0-9]{40}',T)
root=Path('/home/mrfantasea/.local/share/sitesourcery-production/releases')/C
assert os.getuid()==1000 and root.resolve()==root
assert subprocess.check_output(['git','--no-optional-locks','-c','safe.directory='+str(root),'rev-parse','HEAD'],cwd=root,text=True).strip()==C
assert subprocess.check_output(['git','--no-optional-locks','-c','safe.directory='+str(root),'rev-parse','HEAD^{tree}'],cwd=root,text=True).strip()==T
assert not subprocess.check_output(['git','--no-optional-locks','-c','safe.directory='+str(root),'status','--porcelain=v1','--untracked-files=all'],cwd=root,text=True)
entries=[]; total=0; pending=[root]
while pending:
 directory=pending.pop()
 for item in sorted(os.scandir(directory),key=lambda x:x.name):
  if directory==root and item.name=='.git': continue
  file=Path(item.path); info=item.stat(follow_symlinks=False); relative=str(file.relative_to(root)); mode=oct(stat.S_IMODE(info.st_mode))
  if stat.S_ISLNK(info.st_mode):
   target=os.readlink(file); assert not os.path.isabs(target),(relative,target)
   resolved=file.resolve(strict=True); assert resolved.is_relative_to(root) and not resolved.is_relative_to(root/'.git'),(relative,target)
   entries.append({'path':relative,'type':'symlink','mode':mode,'target':target})
  elif stat.S_ISDIR(info.st_mode):
   entries.append({'path':relative,'type':'directory','mode':mode}); pending.append(file)
  else:
   assert stat.S_ISREG(info.st_mode),relative
   total+=info.st_size; assert total<=4*1024*1024*1024
   sha=hashlib.sha256()
   with file.open('rb') as handle:
    for chunk in iter(lambda:handle.read(1024*1024),b''):sha.update(chunk)
   entries.append({'path':relative,'type':'file','mode':mode,'byteCount':info.st_size,'sha256':sha.hexdigest()})
  assert len(entries)<=100000
entries.sort(key=lambda x:x['path'])
canonical=(json.dumps(entries,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
assert not subprocess.check_output(['git','--no-optional-locks','-c','safe.directory='+str(root),'status','--porcelain=v1','--untracked-files=all'],cwd=root,text=True)
result={'inventorySha256':hashlib.sha256(canonical).hexdigest(),'fileCount':sum(x['type']=='file' for x in entries),'totalFileBytes':total}
if len(sys.argv)==4:result['entries']=entries
if len(sys.argv)==4 and sys.argv[3]=='--custody':
 import importlib.util
 spec=importlib.util.spec_from_file_location('release_isolation',Path(__file__).with_name('isolation.py'))
 isolation=importlib.util.module_from_spec(spec);spec.loader.exec_module(isolation)
 custody=isolation.collect_custody(root)
 assert isolation.legacy_inventory(custody)==result,'Legacy/custody observation changed'
 result['custody']=custody
print(json.dumps(result))
