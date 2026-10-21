"""Fixed HQ isolation custody. Imports and pure transforms perform no native effects.

Legacy stage receipts are immutable. Installed ACL custody is a different fact.
Only the held root installer may apply the exact NEW-release ACL transformation.
"""
import copy
import errno
import hashlib
import json
import os
import pwd
import grp
import re
import stat
import struct
import subprocess
from pathlib import Path

BASE = Path('/home/mrfantasea/.local/share/sitesourcery-production')
POLICY = Path('/etc/sitesourcery/runtime/isolation-policy.json')
MARKER = Path('/etc/sitesourcery/runtime/isolation-accepted.json')
API_ENV = '/etc/sitesourcery/runtime/api.env'
WORKER_ENV = '/etc/sitesourcery/runtime/worker.env'
ROLES = ('api', 'workers', 'tenant', 'gateway')
UNITS = tuple('sitesourcery-hq-' + n + '.service' for n in ROLES)
DROP = '99-zz-runtime-isolation.conf'
READINESS_HELPER = '/usr/local/libexec/sitesourcery-worker-readiness-20261020/wait-api-ready.mjs'
TEMPLATE_HASHES = dict(zip(UNITS, (
    'd77c1a4b3f1fb10979d9ce3530a0dc83e8ae73917a489eb7d47ad4a563499001',
    '9b485a1b129b99e0ca0f8d8a0bc3993d9e75b1230a6182aa296e45cd4b026389',
    '868f8ecfda5de2c9d5ff3d82d25a0c0f064f63361bdd5fb6aa0fba944fcfe5ef',
    '88fc444cfc1966fcb531b2601d3b6b065630f9c7ab257911380d0a5d610ebaf4')))
COUNTS = dict(zip(UNITS, (5, 4, 5, 1)))
IDENTITIES = dict(zip(('ss-api','ss-worker','ss-tenant','ss-gateway','ss-tunnel',
                           'ss-code','ss-export','ss-health','ss-publication','ss-tenant-data'),range(910,920)))
NSS_GROUPS = {'ss-api':{910,915,916,917,918,919},'ss-worker':{911,915,916,917,918},
              'ss-tenant':{912,915,919},'ss-gateway':{913,915},'ss-tunnel':{914}}
ANCHORS = ('SITESOURCERY_RELEASE_EPOCH_SHA256', 'SITESOURCERY_ORIGIN_SEAL_FILE_SHA256',
           'SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256')
MODULES = ('SITESOURCERY_RECOVERY_TRANSPORT_MODULE', 'SITESOURCERY_REGISTRATION_TRANSPORT_MODULE')
AUTH_FILES = tuple('/etc/sitesourcery/' + n for n in
                   ('final-release-epoch-v2.json', 'origin-seal.json', 'origin-installed-readback.json'))
# Only these reviewed immutable native operands may be custody inputs. Release-
# substituted base units/epoch/config files are deliberately not static policy.
STATIC_PATHS = {
    '/etc/sitesourcery/runtime/egress.nft',
    '/etc/tmpfiles.d/sitesourcery-runtime.conf',
    '/etc/systemd/system/sitesourcery-runtime-directories.service',
    '/etc/systemd/system/sitesourcery-runtime-egress.service',
    '/etc/systemd/system/sitesourcery-hq-cloudflared.service.d/99-zz-runtime-isolation.conf',
    '/etc/systemd/system/sitesourcery-hq-workers.service.d/99-api-readiness-wait.conf',
    READINESS_HELPER,
    '/etc/sitesourcery/WORKERS_APPROVED', '/etc/sitesourcery/PUBLICATION_APPROVED',
    '/etc/sitesourcery/Caddyfile.hq', '/etc/sitesourcery/cloudflared.yml',
    '/etc/sitesourcery/cloudflared.json',
    '/etc/sitesourcery/mail/private-renderer-7c22bf5e6219f4a24337be885dd4411718ffa0af.mjs',
    '/var/lib/sitesourcery-storage/guard.py', '/var/lib/sitesourcery-storage/manifest.json',
    '/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node',
    '/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/caddy-2.11.4',
    '/home/mrfantasea/.local/share/sitesourcery-toolchain-staging-20261009/bin/cloudflared-2026.7.3',
    '/home/mrfantasea/.config/systemd/user/sitesourcery-production-postgresql.service',
    '/home/mrfantasea/.config/systemd/user/sitesourcery-production-postgresql.service.d/protected-storage.conf',
    '/home/mrfantasea/.config/systemd/user/sitesourcery-production-postgresql.service.d/99-runtime-isolation.conf',
    '/home/mrfantasea/.local/share/sitesourcery-production-postgresql-16.14/data/postgresql.conf',
    '/home/mrfantasea/.local/share/sitesourcery-production-postgresql-16.14/data/pg_hba.conf',
    '/home/mrfantasea/.local/share/sitesourcery-production-postgresql-16.14/data/pg_ident.conf',
}
PROPERTIES = ('User', 'Group', 'SupplementaryGroups', 'WorkingDirectory', 'BindReadOnlyPaths',
              'BindPaths', 'ReadOnlyPaths', 'ReadWritePaths', 'ProtectHome', 'ProtectSystem',
              'TemporaryFileSystem', 'InaccessiblePaths', 'NoNewPrivileges', 'EnvironmentFiles',
              'Requires', 'After', 'RestrictAddressFamilies', 'CapabilityBoundingSet',
              'AmbientCapabilities', 'ExecStart', 'ExecStartPre', 'UMask', 'PrivateTmp',
              'PrivateDevices', 'PrivateIPC', 'ProtectProc', 'ProcSubset', 'RestrictNamespaces',
              'RestrictSUIDSGID', 'RestrictRealtime', 'LockPersonality', 'ProtectKernelTunables',
              'ProtectKernelModules', 'ProtectKernelLogs', 'ProtectControlGroups', 'RuntimeDirectory')


def require(value, message):
    if not value:
        raise ValueError(message)


def keys(value, names):
    require(type(value) is dict and set(value) == set(names.split()), 'isolation fields changed')


def digest(value, length=64):
    require(type(value) is str and re.fullmatch('[a-f0-9]{%d}' % length, value), 'invalid isolation digest')


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def enabled(profile):
    return 'isolation' in profile['runtime']


def validate_profile(value):
    keys(value, 'policySha256 priorAcceptanceSha256')
    for item in value.values():
        digest(item)


def check_mode(profile):
    require(enabled(profile) == os.path.lexists(MARKER), 'isolation mode/installed marker mismatch')


def drop_path(unit):
    require(unit in UNITS, 'unregistered isolation unit')
    return '/etc/systemd/system/' + unit + '.d/' + DROP


def read_bytes(path, root_owned=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, 'noncanonical isolation input')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 32 * 1024 * 1024,
            'unsafe isolation input')
    if root_owned:
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'isolation input custody changed')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as handle:
        opened = os.fstat(handle.fileno())
        require((info.st_dev, info.st_ino) == (opened.st_dev, opened.st_ino), 'isolation input replaced')
        raw = handle.read(32 * 1024 * 1024 + 1)
        finished = os.fstat(handle.fileno())
        fields = ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_uid','st_gid','st_nlink')
        require(all(getattr(info,k)==getattr(finished,k) for k in fields), 'isolation input changed during read')
    require(len(raw) == info.st_size, 'isolation input length changed')
    return raw


def pinned(ref, root_owned=False):
    keys(ref, 'path sha256'); digest(ref['sha256'])
    raw = read_bytes(ref['path'], root_owned)
    require(sha(raw) == ref['sha256'], 'isolation input digest changed')
    return json.loads(raw)


def metadata(path):
    raw = read_bytes(path, True); info = Path(path).lstat()
    require(not read_acl(path, info)['extended'], 'atomic config must use classic permissions')
    return {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid,
            'bytes': len(raw), 'sha256': sha(raw)}


def static_metadata(path):
    path=Path(path)
    require(path.is_absolute() and path.resolve()==path,'noncanonical static custody path')
    info=path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=256*1024*1024,
            'unsafe static custody file')
    fields=('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_uid','st_gid','st_nlink')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as handle:
        opened=os.fstat(handle.fileno())
        require(all(getattr(info,k)==getattr(opened,k) for k in fields),'static file replaced')
        hashed=hashlib.sha256()
        for chunk in iter(lambda:handle.read(1024*1024),b''):hashed.update(chunk)
        final=os.fstat(handle.fileno())
        require(all(getattr(info,k)==getattr(final,k) for k in fields),'static file changed during read')
    value={'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid,'nlink':info.st_nlink,
           'bytes':info.st_size,'sha256':hashed.hexdigest(),'acl':read_acl(path,info)}
    validate_static_metadata(value)
    return value


def validate_static_metadata(value):
    keys(value,'mode uid gid nlink bytes sha256 acl');digest(value['sha256'])
    require(all(type(value[k]) is int and value[k]>=0 for k in ('mode','uid','gid','nlink','bytes')) and
            value['uid'] in (0,1000) and value['gid']<=2147483647 and value['nlink']==1 and
            value['mode']<=0o777 and not value['mode']&0o022 and value['bytes']<=256*1024*1024,
            'unsafe static custody metadata')
    validate_acl(value['acl'],value['mode'])
    require(all(not permissions&2 for tag,permissions,identity in value['acl']['entries'] if tag!=1),
            'static ACL grants non-owner write')


def validate_policy(policy):
    keys(policy, 'schema codeReadGroup unitTemplates staticFiles identities')
    validate_identities(policy['identities'])
    require(policy['schema'] == 'sitesourcery.runtime-isolation-policy/v1', 'unknown isolation policy')
    require(policy['codeReadGroup'] == 915, 'unreviewed code read group')
    require(type(policy['unitTemplates']) is dict and set(policy['unitTemplates']) == set(UNITS),
            'exact four release consumers required')
    for unit, template in policy['unitTemplates'].items():
        require(type(template) is str and sha(template.encode()) == TEMPLATE_HASHES[unit],
                'unreviewed isolation template')
        require(template.count('@CANDIDATE@') == COUNTS[unit], 'release operand count changed')
    require(type(policy['staticFiles']) is dict and set(policy['staticFiles'])==STATIC_PATHS,
            'complete finite static isolation custody required')
    # Finite native files only; never a directory or user-controlled storage path.
    for name, expected in policy['staticFiles'].items():
        require(name in STATIC_PATHS and name not in mutable_files(), 'unreviewed static isolation path')
        validate_static_metadata(expected)
    return policy



def validate_identities(value):
    keys(value,'groups users')
    require(value['groups']==IDENTITIES and set(value['users'])==set(NSS_GROUPS), 'isolation identity map changed')
    for name,item in value['users'].items():
        keys(item,'uid gid groups')
        require(type(item['uid']) is int and type(item['gid']) is int and
                item['uid']==item['gid']==IDENTITIES[name], 'isolation user identity changed')
        groups=item['groups']
        require(type(groups) is list and all(type(g) is int for g in groups) and
                groups==sorted(NSS_GROUPS[name]),
                'unapproved NSS supplementary group')


def observe_identities(expected):
    validate_identities(expected)
    actual={'groups':{},'users':{}}
    for name,number in IDENTITIES.items():
        value=grp.getgrnam(name)
        require(value.gr_gid==number and grp.getgrgid(number).gr_name==name, 'NSS group identity drift')
        actual['groups'][name]=number
    for name in NSS_GROUPS:
        value=pwd.getpwnam(name)
        require(pwd.getpwuid(value.pw_uid).pw_name==name, 'NSS user identity alias')
        actual['users'][name]={'uid':value.pw_uid,'gid':value.pw_gid,
                               'groups':sorted(os.getgrouplist(name,value.pw_gid))}
    require(actual==expected,'NSS user/group membership drift')
    return actual


def validate_metadata(value):
    keys(value, 'mode uid gid bytes sha256'); digest(value['sha256'])
    require(all(type(value[k]) is int and value[k] >= 0 for k in ('mode', 'uid', 'gid', 'bytes'))
            and value['uid'] == 0 and value['mode'] <= 0o777 and not value['mode'] & 0o022,
            'unsafe isolation file metadata')


def mutable_files():
    return set(AUTH_FILES) | {API_ENV, WORKER_ENV, str(MARKER), str(POLICY)} | {drop_path(u) for u in UNITS}


def render(policy, candidate):
    digest(candidate, 40)
    return {drop_path(u): text.replace('@CANDIDATE@', candidate).encode()
            for u, text in policy['unitTemplates'].items()}


def rewrite_api_env(raw, prior, candidate, digests):
    digest(prior, 40); digest(candidate, 40)
    require(set(digests) == set(ANCHORS), 'exact API anchor set required')
    for key, value in digests.items():
        digest(value)
        raw, count = re.subn(rb'(?m)^' + key.encode() + rb'="[a-f0-9]{64}"$',
                             key.encode() + b'="' + value.encode() + b'"', raw)
        require(count == 1, 'missing/duplicate exact API anchor')
    for key in MODULES:
        old = str(BASE / 'releases' / prior / 'server/hosted/resend-mail-transport.mjs')
        new = str(BASE / 'releases' / candidate / 'server/hosted/resend-mail-transport.mjs')
        pattern = rb'(?m)^' + key.encode() + rb'="' + re.escape(old.encode()) + rb'"$'
        raw, count = re.subn(pattern, key.encode() + b'="' + new.encode() + b'"', raw)
        require(count == 1, 'missing/duplicate exact API module path')
    return raw


def acl_xattr(path, name):
    try:
        return os.getxattr(path, name, follow_symlinks=False)
    except OSError as error:
        if error.errno in (errno.ENODATA, getattr(errno, 'ENOATTR', errno.ENODATA)):
            return None
        raise


def decode_acl(raw):
    require(raw is not None and len(raw) >= 4 and (len(raw) - 4) % 8 == 0,
            'invalid POSIX ACL encoding')
    require(struct.unpack_from('<I', raw)[0] == 2, 'unknown POSIX ACL version')
    result = [list(struct.unpack_from('<HHI', raw, offset)) for offset in range(4, len(raw), 8)]
    require(all(tag in (1, 2, 4, 8, 16, 32) and 0 <= permissions <= 7
                for tag, permissions, identity in result), 'invalid POSIX ACL entry')
    require(len({(e[0], e[2]) for e in result}) == len(result), 'duplicate ACL entry')
    return sorted(result, key=lambda e: (e[0], e[2]))


def read_acl(path, info):
    require(not stat.S_ISLNK(info.st_mode), 'symlink ACL must not be followed')
    require(acl_xattr(path, 'system.posix_acl_default') is None, 'default code ACL forbidden')
    raw = acl_xattr(path, 'system.posix_acl_access')
    mode = stat.S_IMODE(info.st_mode)
    entries = decode_acl(raw) if raw else [[1, (mode >> 6) & 7, 4294967295],
                                          [4, (mode >> 3) & 7, 4294967295],
                                          [32, mode & 7, 4294967295]]
    return {'extended': raw is not None, 'entries': entries}


def validate_acl(value, mode):
    keys(value,'extended entries')
    require(type(value['extended']) is bool and type(value['entries']) is list,
            'invalid custody ACL')
    acl=value['entries']
    require(all(type(e) is list and len(e)==3 and all(type(n) is int for n in e)
        and e[0] in (1,2,4,8,16,32) and 0<=e[1]<=7 and 0<=e[2]<=4294967295 for e in acl),
            'invalid custody ACL entry')
    require(acl==sorted(acl,key=lambda e:(e[0],e[2])) and len({(e[0],e[2]) for e in acl})==len(acl),
            'noncanonical custody ACL')
    require(all((e[2]==4294967295) == (e[0] in (1,4,16,32)) for e in acl), 'invalid ACL identity')
    base={e[0]:e[1] for e in acl if e[2]==4294967295}
    require({1,4,32} <= set(base) and set(base) <= {1,4,16,32} and
            base[1]==(mode>>6)&7 and base[32]==mode&7 and
            base.get(16,base[4])==(mode>>3)&7, 'ACL/mode mismatch')
    require(value['extended'] == (16 in base), 'ACL extended flag mismatch')


def collect_custody(root):
    root = Path(root); top = root.lstat()
    require(root.resolve() == root and stat.S_ISDIR(top.st_mode), 'unsafe code root')
    entries = []; pending = [root]; total = 0
    while pending:
        file = pending.pop(); info = file.lstat(); relative = str(file.relative_to(root))
        require(info.st_dev == top.st_dev and info.st_uid == 1000 and info.st_gid == 1000,
                'code device/owner changed')
        require(not any(ord(c) < 32 or ord(c) == 127 for c in relative), 'unsafe code name')
        item = {'path': relative, 'uid': info.st_uid, 'gid': info.st_gid,
                'mode': oct(stat.S_IMODE(info.st_mode)), 'nlink': info.st_nlink}
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(file); resolved = file.resolve(strict=True)
            require(info.st_nlink == 1 and not os.path.isabs(target) and resolved.is_relative_to(root)
                    and not resolved.is_relative_to(root / '.git'), 'unsafe code link')
            item.update(type='symlink', target=target)
        else:
            require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'special code entry')
            require(not stat.S_IMODE(info.st_mode) & 0o7022, 'writable/special code permissions')
            item['acl'] = read_acl(file, info)
            if stat.S_ISDIR(info.st_mode):
                item['type'] = 'directory'
                pending.extend(file / name for name in sorted(os.listdir(file), reverse=True)
                               if not (file == root and name == '.git'))
            else:
                require(info.st_nlink == 1, 'shared code file')
                total += info.st_size; require(total <= 4 * 1024**3, 'code inventory too large')
                fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, 'rb') as handle:
                    opened = os.fstat(handle.fileno())
                    fields = ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_uid','st_gid','st_nlink')
                    require(all(getattr(info,k)==getattr(opened,k) for k in fields), 'code replaced')
                    value = hashlib.sha256()
                    for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                        value.update(chunk)
                    finished = os.fstat(handle.fileno())
                    fields = ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_mode','st_uid','st_gid','st_nlink')
                    require(all(getattr(finished,k)==getattr(opened,k) for k in fields), 'code changed during read')
                item.update(type='file', byteCount=info.st_size, sha256=value.hexdigest())
        entries.append(item); require(len(entries) <= 100001, 'too many code entries')
    entries.sort(key=lambda e: e['path'])
    return {'schema': 'sitesourcery.release-custody/v1', 'entries': entries,
            'custodySha256': sha(encoded(entries))}


def validate_custody(value):
    keys(value, 'schema entries custodySha256')
    require(value['schema'] == 'sitesourcery.release-custody/v1' and type(value['entries']) is list
            and 0 < len(value['entries']) <= 100001, 'invalid custody inventory')
    require(sha(encoded(value['entries'])) == value['custodySha256'], 'custody digest changed')
    paths = [e['path'] for e in value['entries']]
    require(paths == sorted(set(paths)) and paths[0] == '.', 'custody path inventory changed')
    for entry in value['entries']:
        path = Path(entry['path'])
        require(not path.is_absolute() and '..' not in path.parts and '.git' not in path.parts
                and str(path) == entry['path'], 'unsafe custody path')
        require(entry['uid'] == entry['gid'] == 1000, 'code owner changed')
        require(entry['type'] in ('file', 'directory', 'symlink'), 'unknown custody entry')
        expected = 'path uid gid mode nlink type' + (' target' if entry['type']=='symlink' else
                    ' acl byteCount sha256' if entry['type']=='file' else ' acl')
        keys(entry, expected)
        require(type(entry['mode']) is str and re.fullmatch(r'0o[0-7]{3,4}', entry['mode']), 'invalid custody mode')
        mode = int(entry['mode'],8)
        require(type(entry['nlink']) is int and entry['nlink'] >= 1, 'invalid link count')
        if entry['type']=='symlink':
            import posixpath
            require(entry['nlink']==1 and mode==0o777 and type(entry['target']) is str
                    and not entry['target'].startswith('/'), 'unsafe custody symlink')
            resolved=posixpath.normpath(posixpath.join(str(path.parent),entry['target']))
            require(resolved!='..' and not resolved.startswith('../') and '.git' not in Path(resolved).parts,
                    'escaping custody symlink')
        else:
            require(not mode & 0o7022, 'unsafe custody permissions')
            validate_acl(entry['acl'],mode)
            if entry['type']=='file':
                require(entry['nlink']==1 and type(entry['byteCount']) is int and entry['byteCount']>=0,
                        'unsafe regular custody file')
                digest(entry['sha256'])
    return value


def legacy_inventory(custody):
    entries = []
    for entry in custody['entries']:
        if entry['path'] == '.':
            continue
        names = ['path', 'type', 'mode'] + (['target'] if entry['type'] == 'symlink' else
                 ['byteCount', 'sha256'] if entry['type'] == 'file' else [])
        entries.append({k: entry[k] for k in names})
    return {'inventorySha256': sha(encoded(entries)), 'entries': entries,
            'fileCount': sum(e['type'] == 'file' for e in entries),
            'totalFileBytes': sum(e.get('byteCount', 0) for e in entries)}


def content_projection(inventory):
    return [{**{k: v for k, v in e.items() if k != 'mode'},
             **({'executable': bool(int(e['mode'],8) & 0o111)} if e['type']=='file' else {})}
            for e in inventory['entries']]


def planned_custody(before, group=915):
    validate_custody(before); require(group == 915, 'unreviewed code group')
    after = copy.deepcopy(before)
    for entry in after['entries']:
        if entry['type'] == 'symlink':
            continue
        mode = int(entry['mode'], 8)
        require(not mode & 0o7022, 'unsafe code mode')
        acl = entry['acl']['entries']; base = {e[0]: e for e in acl if e[0] in (1, 4, 32)}
        require(set(base) == {1, 4, 32} and len(base) == 3, 'incomplete base ACL')
        allowed = {(1, 4294967295), (4, 4294967295), (32, 4294967295),
                   (16, 4294967295), (8, group)}
        require(all((e[0], e[2]) in allowed for e in acl), 'unapproved named ACL')
        permissions = 5 if entry['type'] == 'directory' or mode & 0o111 else 4
        require(all(e[1] == permissions for e in acl if e[0] == 8), 'unexpected code group permissions')
        mask = base[4][1] | permissions
        require(not mask & 2 and not base[32][1] & 2, 'ACL write expansion')
        entry['acl'] = {'extended': True, 'entries': sorted(
            list(base.values()) + [[8, permissions, group], [16, mask, 4294967295]],
            key=lambda e: (e[0], e[2]))}
        entry['mode'] = oct((mode & ~0o070) | (mask << 3))
    after['custodySha256'] = sha(encoded(after['entries']))
    return after


def apply_custody(root, before, after, effect_gate):
    require(os.geteuid() == 0, 'root ACL installer required')
    require(collect_custody(root) == before and planned_custody(before) == after, 'ACL preflight changed')
    effect_gate()  # The potentially long read must not outlive effect authority.
    for old, new in zip(before['entries'], after['entries']):
        if old == new:
            continue
        path = Path(root) / old['path']; info = path.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'ACL symlink replacement')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | (os.O_DIRECTORY if old['type'] == 'directory' else 0))
        try:
            opened = os.fstat(fd)
            require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino), 'ACL target replaced')
            raw = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *e) for e in new['acl']['entries'])
            effect_gate()
            os.setxattr(fd, 'system.posix_acl_access', raw)
            os.fsync(fd)
        finally:
            os.close(fd)
    require(collect_custody(root) == after, 'ACL postflight changed')


def validate_binding(binding, policy, candidate=None, tree=None):
    keys(binding, 'schema state candidate tree policySha256 originalStageReceipt inventory custody files effectiveUnits')
    require(binding['schema'] == 'sitesourcery.runtime-isolation-binding/v1' and
            binding['state'] in ('isolation_accepted', 'installed_isolated_held'), 'unknown isolation binding')
    for key in ('candidate', 'tree'):
        digest(binding[key], 40)
    if candidate is not None:
        require(binding['candidate'] == candidate and binding['tree'] == tree, 'isolation release changed')
    validate_custody(binding['custody'])
    require(legacy_inventory(binding['custody']) == binding['inventory'], 'actual inventory/custody mismatch')
    require(planned_custody(binding['custody']) == binding['custody'], 'code ACL policy not installed')
    keys(binding['originalStageReceipt'], 'path sha256'); digest(binding['originalStageReceipt']['sha256'])
    expected = set(policy['staticFiles']) | {drop_path(u) for u in UNITS} | set(AUTH_FILES) | {API_ENV, WORKER_ENV}
    require(set(binding['files']) == expected and set(binding['effectiveUnits']) == set(UNITS), 'isolation custody set changed')
    for name,value in binding['files'].items():
        (validate_static_metadata if name in policy['staticFiles'] else validate_metadata)(value)
    for values in binding['effectiveUnits'].values():
        keys(values, ' '.join(PROPERTIES))
        for name, value in values.items():
            require((type(value) is list and (value or name=='ExecStartPre') and all(type(v) is str for v in value))
                    if name in ('ExecStart','ExecStartPre') else type(value) is str, 'invalid effective unit property')
    return binding


def local_inputs(profile, refs, prior_stage):
    keys(refs, 'policy priorAcceptance')
    spec = profile['runtime']['isolation']
    require(refs['policy']['sha256'] == spec['policySha256'] and
            refs['priorAcceptance']['sha256'] == spec['priorAcceptanceSha256'], 'local isolation input not profile-bound')
    policy = validate_policy(pinned(refs['policy']))
    binding = validate_binding(pinned(refs['priorAcceptance']), policy,
                               profile['priorCandidate'], profile['priorTree'])
    require(binding['policySha256'] == spec['policySha256'] and
            binding['originalStageReceipt']['sha256'] == prior_stage['sha256'], 'original stage/isolation lineage changed')
    stage = pinned(prior_stage)
    require(stage['status'] == 'staged_inert' and content_projection(stage['inventory']) ==
            content_projection(binding['inventory']), 'historical staged content changed')
    return policy, binding


def effective_units():
    result = {}
    for unit in UNITS:
        raw = subprocess.check_output(['/usr/bin/systemctl', 'show', unit, '--property=' + ','.join(PROPERTIES)],
                                      stderr=subprocess.PIPE, timeout=15, text=True)
        values = dict(line.split('=', 1) for line in raw.splitlines())
        require(set(values) == set(PROPERTIES), 'incomplete effective isolation properties')
        for key in ('ExecStart', 'ExecStartPre'):
            # Discard volatile pid/timestamp/status fields, retaining exact ordered argv vectors.
            original = values[key]
            values[key] = re.findall(r'argv\[\]=(.*?);', original)
            require(values[key] or (key=='ExecStartPre' and original==''), 'missing effective command vector')
        result[unit] = values
    return result


def verify_readiness_operand():
    raw = subprocess.check_output(['/usr/bin/systemctl', 'show', 'sitesourcery-hq-workers.service',
                                   '--property=ExecStartPre'], stderr=subprocess.PIPE, timeout=15, text=True)
    vectors = re.findall(r'argv\[\]=(.*?);', raw)
    operands = [part for vector in vectors for part in vector.split()
                if '/sitesourcery-worker-readiness-' in part]
    require(operands == [READINESS_HELPER], 'active worker readiness operand changed')


def native_context(profile, expected_hash=None):
    check_mode(profile)
    if not enabled(profile):
        return None
    spec = profile['runtime']['isolation']
    for path in (POLICY,MARKER):
        info=path.lstat()
        require(info.st_uid==0 and info.st_gid==1000 and stat.S_IMODE(info.st_mode)==0o640
                and not read_acl(path,info)['extended'], 'policy/marker must remain owner-readable classic0640')
    policy = validate_policy(pinned({'path': str(POLICY), 'sha256': spec['policySha256']}, True))
    raw = read_bytes(MARKER, True)
    if expected_hash is not None:
        require(sha(raw) == expected_hash, 'isolation marker changed')
    binding = validate_binding(json.loads(raw), policy)
    require(binding['policySha256'] == spec['policySha256'], 'isolation policy changed')
    return policy, binding, sha(raw)


def observe(profile, expected_hash=None, verify=True):
    context = native_context(profile, expected_hash)
    if context is None:
        return None
    policy, binding, hashed = context
    identities = observe_identities(policy['identities'])
    files = {name:(static_metadata(name) if name in policy['staticFiles'] else metadata(name))
             for name in binding['files']}
    units = effective_units()
    custody = collect_custody(BASE / 'releases' / binding['candidate'])
    if verify:
        require(files == binding['files'], 'isolation file custody changed')
        for name, expected in policy['staticFiles'].items():
            require(binding['files'][name] == expected, 'static isolation binding changed')
        for name, expected in render(policy, binding['candidate']).items():
            require(read_bytes(name, True) == expected, 'release isolation operand changed')
        require(units == binding['effectiveUnits'], 'effective isolation drift')
        require(custody == binding['custody'], 'installed code custody changed')
    return {'binding': {'path': str(MARKER), 'sha256': hashed}, 'candidate': binding['candidate'],
            'tree': binding['tree'], 'files': files, 'effectiveUnits': units, 'identities':identities,
            'custodySha256': custody['custodySha256']}


def before_install(profile, stage):
    observed = observe(profile, profile['runtime']['isolation']['priorAcceptanceSha256'])
    require(observed['candidate'] == profile['priorCandidate'] and observed['tree'] == profile['priorTree'],
            'isolation predecessor changed')
    before = validate_custody(stage['custody'])
    require(collect_custody(BASE / 'releases' / profile['candidate']) == before and
            legacy_inventory(before) == stage['inventory'], 'staged custody changed')
    return {'before': before, 'after': planned_custody(before), 'prior': observed}


def install_payloads(profile, digests):
    policy, binding, _ = native_context(profile, profile['runtime']['isolation']['priorAcceptanceSha256'])
    payloads = render(policy, profile['candidate'])
    payloads[API_ENV] = rewrite_api_env(read_bytes(API_ENV, True), profile['priorCandidate'],
                                      profile['candidate'], digests)
    return payloads


def successor_binding(profile, stage_ref, plan, payloads):
    policy, old, _ = native_context(profile, profile['runtime']['isolation']['priorAcceptanceSha256'])
    files = copy.deepcopy(old['files'])
    for name, value in payloads.items():
        if name in files:
            files[name].update(bytes=len(value), sha256=sha(value))
    units = json.loads(json.dumps(old['effectiveUnits']).replace(profile['priorCandidate'], profile['candidate']))
    return {'schema': old['schema'], 'state': 'installed_isolated_held', 'candidate': profile['candidate'],
            'tree': profile['tree'], 'policySha256': profile['runtime']['isolation']['policySha256'],
            'originalStageReceipt': stage_ref, 'inventory': legacy_inventory(plan['after']),
            'custody': plan['after'], 'files': files, 'effectiveUnits': units}


def verify_installed(profile, installed):
    if not enabled(profile):
        check_mode(profile); return None
    ref = installed['isolationBinding']; keys(ref, 'path sha256')
    require(ref['path'] == str(MARKER), 'installed isolation marker path changed')
    observed = observe(profile, ref['sha256'])
    require((observed['candidate'], observed['tree']) == (installed['candidate'], installed['tree']),
            'installed isolation candidate changed')
    return observed


def valid_partial_custody(actual, before, after):
    validate_custody(actual); validate_custody(before); validate_custody(after)
    return (len(actual['entries']) == len(before['entries']) == len(after['entries']) and
            planned_custody(before) == after and
            all(now == old or now == new for now, old, new in
                zip(actual['entries'], before['entries'], after['entries'])))


def verify_gateway(profile, installed, resume, units, journal):
    import urllib.request
    unit = 'sitesourcery-hq-gateway.service'
    key = 'system:' + unit
    current = units[unit]; started = resume['units'][key]
    require(current['ActiveState'] == 'active' and int(current['MainPID']) > 0
            and current['MainPID'] == started['MainPID'] and current['NRestarts'] == '0'
            and re.fullmatch('[a-f0-9]{32}', current['InvocationID'])
            and current['InvocationID'] == started['InvocationID']
            and current['InvocationID'] != journal['baseline']['units'][key]['InvocationID']
            and current['MainPID'] != journal['baseline']['units'][key]['MainPID'],
            'isolated gateway must be freshly resumed')
    _, binding, _ = native_context(profile, installed['isolationBinding']['sha256'])
    expected = next((e for e in binding['inventory']['entries'] if e['path'] == '_hosted/index.html'), None)
    require(expected and expected['type'] == 'file' and expected['byteCount'] <= 8 * 1024 * 1024,
            'candidate gateway artifact missing')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request('http://127.0.0.1:8081/',
        headers={'Host': 'sitesourcery.com', 'X-Forwarded-Proto': 'https', 'Accept-Encoding': 'identity'})
    with opener.open(request, timeout=5) as response:
        require(response.status == 200, 'gateway artifact status changed')
        raw = response.read(expected['byteCount'] + 1)
    require(len(raw) == expected['byteCount'] and sha(raw) == expected['sha256'], 'gateway serves stale artifact')
    return {'candidate': installed['candidate'], 'artifactPath': expected['path'], 'sha256': sha(raw),
            'mainPid': current['MainPID'], 'invocationId': current['InvocationID']}
