
import os, json, hashlib, shutil, subprocess, sys, stat, tarfile
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


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()

def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=sys.stderr)

def inventory(root):
    tree=CONFIG['tree'] if root.name==CONFIG['candidate'] else CONFIG['oldTree']
    return json.loads(command('/usr/bin/python3','-I','-B',str(Path(__file__).with_name('inventory.py')),root.name,tree,'--entries'))

assert len(sys.argv)==4,'stage.py PROFILE SHA256 STAGE_INPUT SHA256 ARCHIVE'
CONFIG=_profile.read_pinned(sys.argv[1],sys.argv[2]);_profile.bind_operation(CONFIG,PROFILE,PROFILE_REF)
_profile.keys(CONFIG,'schema profile authorized issuedAt expiresAt helpers old oldTree releases node candidate tree releaseInput sourceInputSha256 priorActualReceiptSha256 expectedSource oldInventorySha256 minimumAvailableBytes hostedArchiveSha256 hostedArchiveBytes hostedFiles packages packageReuse','stage input')
assert CONFIG['schema']=='sitesourcery.native-stage-input/v1' and CONFIG['authorized'] is True
_profile.verify_bundle(CONFIG,Path(__file__).resolve().parent)
import datetime
issued=datetime.datetime.fromisoformat(CONFIG['issuedAt'].replace('Z','+00:00'));expires=datetime.datetime.fromisoformat(CONFIG['expiresAt'].replace('Z','+00:00'))
assert issued<=datetime.datetime.now(datetime.timezone.utc)<expires<=issued+datetime.timedelta(minutes=30)
assert set(CONFIG['packages'])=={'package.json','package-lock.json'}
for k in ['old','oldTree']:_profile.digest(CONFIG[k],40)
assert CONFIG['old']!=CONFIG['candidate']
assert CONFIG['releases']=='/home/mrfantasea/.local/share/sitesourcery-production/releases/' and CONFIG['node']==PROFILE['runtime']['node']
for k in ['oldInventorySha256','sourceInputSha256','priorActualReceiptSha256','hostedArchiveSha256']:_profile.digest(CONFIG[k])
assert CONFIG['releaseInput']['epoch']['source']=={'commitSha':PROFILE['candidate'],'treeSha':PROFILE['tree']}
assert CONFIG['releaseInput']['epoch']['migration']['count']==COUNT and CONFIG['releaseInput']['epoch']['migration']['manifestSha256']==PROFILE['expectedSchema']['manifestSha256']
assert command('hostname') == 'FantaSeaLand'
assert os.getuid() == 1000 and command('id', '-un') == 'mrfantasea'
os.umask(0o077)
old = Path(CONFIG['releases']) / CONFIG['old']
new = Path(CONFIG['releases']) / CONFIG['candidate']
assert old.resolve() == old and new.parent.resolve() == new.parent
assert not os.path.lexists(new), 'Destination must be absent; retain any failed stage'
assert len(sys.argv)==4, 'exact qualified archive required'
archive=Path(sys.argv[3]); assert stat.S_ISREG(archive.lstat().st_mode)
assert archive.stat().st_size==CONFIG['hostedArchiveBytes'] and archive.stat().st_size<256*1024*1024
assert hashlib.sha256(archive.read_bytes()).hexdigest()==CONFIG['hostedArchiveSha256']
hosted_expected={e['path']:e for e in CONFIG['hostedFiles']}
with tarfile.open(archive) as tar:
    entries=tar.getmembers(); assert len(entries)==len(hosted_expected) and {e.name for e in entries}==set(hosted_expected)
    for entry in entries:
        relative=Path(entry.name)
        assert entry.isfile() and entry.size==hosted_expected[entry.name]['byteCount'] and relative.parts[0]=='_hosted' and '..' not in relative.parts and not relative.is_absolute()
assert command(CONFIG['node'], '--version') == PROFILE['runtime']['nodeVersion']
assert command('git', '--no-optional-locks', '-c', 'safe.directory='+str(old), '-C', str(old), 'rev-parse', 'HEAD') == CONFIG['old']
assert command('git', '--no-optional-locks', '-c', 'safe.directory='+str(old), '-C', str(old), 'rev-parse', 'HEAD^{tree}') == CONFIG['oldTree']
old_inventory = inventory(old)
assert old_inventory['inventorySha256'] == CONFIG['oldInventorySha256'], 'Prior verified bytes or file modes changed'
space = os.statvfs(old)
assert space.f_bavail * space.f_frsize >= CONFIG['minimumAvailableBytes'], 'Insufficient space for separate copied release'
_profile.current_window(CONFIG)
new.mkdir(mode=0o700)
run('git', '-c', 'init.defaultBranch=staged', 'init', str(new))
run('git', '-C', str(new), 'remote', 'add', 'origin', 'https://github.com/MrFantaSea/sitesourcery.git')
run('git', '-C', str(new), '-c', 'safe.directory='+str(old), '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', '--no-recurse-submodules', str(old), CONFIG['old'])
run('git', '-C', str(new), '-c', 'credential.helper=', 'fetch', '--no-tags', '--no-recurse-submodules', 'origin', CONFIG['candidate'])
run('git', '-C', str(new), 'checkout', '--detach', CONFIG['candidate'])
assert command('git', '-C', str(new), 'rev-parse', 'HEAD') == CONFIG['candidate']
assert command('git', '-C', str(new), 'rev-parse', 'HEAD^{tree}') == CONFIG['tree']
assert command('git', '-C', str(new), 'rev-parse', '--is-shallow-repository') == 'false'

objects = new/'.git/objects'
assert not os.path.lexists(objects/'info/alternates') and not os.path.lexists(objects/'info/http-alternates'), 'Shared object alternates are forbidden'
for directory, dirs, files in os.walk(objects, followlinks=False):
    for name in dirs:
        assert not (Path(directory)/name).is_symlink(), 'Git object directory link is forbidden'
    for name in files:
        file = Path(directory)/name
        assert not file.is_symlink() and file.is_file() and file.stat().st_nlink == 1, 'Git objects must be independent regular files'
for name, package_digest in CONFIG['packages'].items():
    assert hashlib.sha256((new/name).read_bytes()).hexdigest() == package_digest, 'Package input changed; do not reuse'
assert not os.path.lexists(new/'node_modules') and not os.path.lexists(new/'_hosted')
shutil.copytree(old/'node_modules', new/'node_modules', symlinks=True, copy_function=shutil.copy2)
# New qualified website bytes; the prior hosted artifact is deliberately not copied.
with tarfile.open(archive) as tar:
    entries=tar.getmembers(); assert len(entries)==len(hosted_expected) and {e.name for e in entries}==set(hosted_expected)
    for entry in entries:
        assert entry.isfile() and entry.size==hosted_expected[entry.name]['byteCount']
        relative=Path(entry.name); assert not relative.is_absolute() and '..' not in relative.parts and relative.parts[0]=='_hosted'
        content=tar.extractfile(entry).read(); assert hashlib.sha256(content).hexdigest()==hosted_expected[entry.name]['sha256']
        target=new/relative; target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with target.open('xb') as handle: handle.write(content)
        target.chmod(0o644)

javascript = """
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=config.releases+config.candidate;
const {verifyOriginReleaseRepository}=await import(pathToFileURL(root+'/ops/origin-seal-repository.mjs'));
const {verifyCiReleaseGitCheckout}=await import(pathToFileURL(root+'/ops/ci-release-proof-repository.mjs'));
const checkout=await verifyCiReleaseGitCheckout({projectRoot:root,expectedHead:config.candidate,expectedTree:config.tree});
const seal=await verifyOriginReleaseRepository({projectRoot:root,releaseInput:config.releaseInput});
assert.equal(seal.releaseInputDigest,config.releaseInput.digest);
assert.deepEqual(seal.source,{commitSha:config.candidate,treeSha:config.tree});
assert.equal(seal.artifact.sha256,config.releaseInput.epoch.artifact.manifestSha256);
assert.equal(seal.migration.count,profile.expectedSchema.afterCount);assert.equal(seal.migration.sha256,profile.expectedSchema.manifestSha256);
const sharp=createRequire(pathToFileURL(root+'/package.json'))('sharp');
assert.equal(process.version,profile.runtime.nodeVersion);assert.equal(process.platform,'linux');assert.equal(sharp.versions.sharp,profile.runtime.sharpVersion);
const png=await sharp({create:{width:1,height:1,channels:3,background:'#000000'}}).png().toBuffer();
const metadata=await sharp(png).metadata();assert.equal(metadata.width,1);assert.equal(metadata.height,1);
console.log(JSON.stringify({checkout,seal,native:{node:process.version,platform:process.platform,arch:process.arch,sharp:sharp.versions.sharp,vips:sharp.versions.vips,pngBytes:png.length}}));
"""
configuration = json.dumps(CONFIG)
javascript = 'const config=JSON.parse(' + json.dumps(configuration) + '),profile=JSON.parse('+json.dumps(json.dumps(PROFILE))+');\n' + javascript
validation = json.loads(subprocess.check_output([CONFIG['node'], '--input-type=module', '-'],
    input=javascript, text=True, cwd=new))
new_inventory = inventory(new)
observed_source = {entry['path']:entry for entry in new_inventory['entries']}
for source_expected in CONFIG['expectedSource']:
    actual = observed_source[source_expected['path']]
    assert actual['type'] == source_expected['type'], ('Tracked type drift', source_expected['path'])
    if actual['type'] == 'file':
        assert (actual['byteCount'],actual['sha256']) == (source_expected['byteCount'],source_expected['sha256']), ('Tracked byte drift',source_expected['path'])
        assert bool(int(actual['mode'],8) & 0o111) == (source_expected['gitMode'] == '100755'), ('Tracked executable mode drift',source_expected['path'])
    else:
        assert actual['target'] == source_expected['target'], ('Tracked symlink drift',source_expected['path'])
assert inventory(old)['inventorySha256'] == CONFIG['oldInventorySha256'], 'Original release changed during staging'

payload = lambda value: [x for x in value['entries'] if x['path']=='node_modules' or x['path'].startswith('node_modules/')]
assert payload(new_inventory) == payload(old_inventory), 'Reused Linux dependency bytes, modes or internal links changed'
assert command('git', '--no-optional-locks', '-c', 'safe.directory='+str(old), '-C', str(old), 'status', '--porcelain=v1', '--untracked-files=all') == ''
print(json.dumps({'schema':'sitesourcery.hq-linux-release-reuse/v1','status':'staged_inert',
    'oldRelease':str(old),'newRelease':str(new),'priorInventorySha256':old_inventory['inventorySha256'],
    'sourceInputSha256':CONFIG['sourceInputSha256'],'priorActualReceiptSha256':CONFIG['priorActualReceiptSha256'],
    'trackedSourceFilesVerified':len(CONFIG['expectedSource']),'originalReleaseUnchanged':True,'gitHistorySeededFrom':CONFIG['old'],'independentGitObjectsVerified':True,'npmInstallCount':0,'hostedBuildCount':0,'independentCopies':True,'dependencyPayloadByteIdentical':True,'hostedArtifactReused':False,'hostedArchiveSha256':CONFIG['hostedArchiveSha256'],
    'validation':validation,'inventory':new_inventory},indent=2))
