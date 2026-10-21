"""Disposable, isolated adapter tests. No production paths, service calls or SQL."""
import copy
import datetime
import hashlib
import importlib.util
import json
import io
import os
import stat
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ss_release_profile_test', HERE / 'profile.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)
spec = importlib.util.spec_from_file_location('ss_release_isolation_test', HERE / 'isolation.py')
isolation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isolation)


def profile(mode='presentation-only'):
    schema = {'beforeCount': 114 if mode == 'presentation-only' else 112, 'afterCount': 114,
              'beforeTableCount': 315 if mode == 'presentation-only' else 313,
              'afterTableCount': 315, 'schemaSha256': 'a' * 64, 'manifestSha256': 'b' * 64}
    return {'schema': 'sitesourcery.native-release-profile/v1', 'mode': mode, 'cohort': 'fixture-native-114',
            'candidate': 'a' * 40, 'tree': 'b' * 40, 'priorCandidate': 'c' * 40, 'priorTree': 'd' * 40,
            'expectedSchema': schema,
            'workerPurposes': ['export', 'notification-mail', 'alakazam-fulfillment', 'alakazam-publication',
                               'alakazam-retained-lifecycle', 'provider-reconciliation', 'project-lifecycle', 'care-lifecycle'],
            'careMode': 'approved_live', 'workerCareMode': 'approved_live',
            'owner': {'userId': '11111111-1111-1111-1111-111111111111', 'organizationId': '22222222-2222-2222-2222-222222222222'},
            'runtime': {'node': '/home/mrfantasea/.local/share/sitesourcery-fixture/node', 'nodeVersion': 'v24.18.0', 'sharpVersion': '0.35.5'},
            'databaseIdentity': {'db': 'sitesourcery_production', 'databaseOid': '12345', 'username': 'mrfantasea',
                                 'directory': '/home/mrfantasea/.local/share/sitesourcery-production-postgresql-16.14/data',
                                 'port': '55433', 'sockets': '/run/user/1000/sitesourcery-production-postgresql'},
            'collectorFiles': {'ops/fin008-data-convergence.mjs': 'c' * 64, 'ops/immutable-evidence.mjs': 'd' * 64},
            'expectedCapabilities': {**{k: True for k in ['downloadQuote','downloadPayment','alakazamQuote','alakazamCheckout','alakazamDowngrade','alakazamPublication','mailProviderEvents']},'careCatalog': {'mounted': True, 'commercialReady': True}},
            'baselineConfiguration': {p: 'e' * 64 for p in ['/etc/sitesourcery/hosted.env', '/etc/sitesourcery/workers.env', '/etc/sitesourcery/WORKERS_APPROVED']},
            'migration': None if mode == 'presentation-only' else {
                'addedEmptyRelations': ['ss.fixture_one', 'ss.fixture_two'],
                'reservedRollbackNames': ['ss_fixture_rollback', 'ss_fixture_failed'],
                'nodeSha256': 'f' * 64, 'nodeBytes': 10, 'storageGuardSha256': '1' * 64, 'storageManifestSha256': '2' * 64}}


def write_json(path, value):
    raw = (json.dumps(value) + '\n').encode()
    path.write_bytes(raw)
    return {'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest()}


def load_adapter(name, p, directory):
    ref = write_json(directory / (name + '.profile.json'), p)
    spec = importlib.util.spec_from_file_location('ss_adapter_' + name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, 'argv', [str(HERE / (name + '.py')), ref['path'], ref['sha256'], 'fixture']):
        spec.loader.exec_module(module)
    return module, ref


def held_fixture(module, p):
    units = {n: {'LoadState': 'loaded', 'ActiveState': 'inactive', 'MainPID': '0'} for n in module.SYSTEM_NAMES}
    units['sitesourcery-hq-gateway.service']['ActiveState'] = 'active'
    pg = {'ActiveState': 'active', 'MainPID': '70'}
    private = {'LoadState': 'loaded', 'ActiveState': 'active' if p['mode'] == 'presentation-only' else 'inactive',
               'MainPID': '71' if p['mode'] == 'presentation-only' else '0'}
    paths = contract.derived(p)['holdPaths']
    holds = {name: {'sha256': 'e' * 64, 'uid': 0, 'gid': 0, 'mode': 420, 'bytes': 20} for name in paths}
    timers = {'client-profile-hub-backup.timer': {'LoadState': 'loaded', 'ActiveState': 'active', 'UnitFileState': 'enabled'}}
    baseline = {'workerPurposes': p['workerPurposes'], 'workerActivation': 'owner-approved', 'postgresql': pg, 'holdFiles': holds}
    user_units = {'sitesourcery-production-postgresql.service': pg, 'client-profile-hub.service': private}
    if p['mode'] == 'schema-changing':
        timers = {name: {'LoadState': 'loaded', 'ActiveState': 'inactive', 'UnitFileState': 'disabled' if 'morning' in name else 'enabled'} for name in module.PRIVATE_HQ_TIMERS}
        baseline.update(privateHqServices={n: copy.deepcopy(private) for n in module.PRIVATE_HQ_SERVICES}, careMode='approved_live', workerCareMode='approved_live')
        user_units.update(baseline['privateHqServices'])
    else:
        baseline['privateHq'] = private
    baseline['privateHqTimers'] = timers
    a = {'candidate': p['candidate'], 'priorCandidate': p['priorCandidate'], 'baseline': copy.deepcopy(baseline), 'holdPaths': paths}
    o = {'currentTarget': str(module.BASE / 'releases' / p['priorCandidate']), 'workerPurposes': p['workerPurposes'],
         'workerActivation': 'owner-approved', 'units': units, 'userUnits': user_units, 'userTimers': timers,
         'timers': {n: {'LoadState': 'loaded', 'ActiveState': 'inactive'} for n in ['sitesourcery-hq-backup.timer', 'sitesourcery-hq-monitor.timer']},
         'files': holds, 'careMode': 'approved_live', 'workerCareMode': 'approved_live'}
    return copy.deepcopy(o), copy.deepcopy(a)


# Frozen v3 bytes are embedded so tests have no external-machine inputs.
ISOLATION_TEMPLATES = {
    'sitesourcery-hq-api.service': """# INERT PROPOSAL. Requires reviewed source, native custody and finite root apply authority.
[Unit]
Requires=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
After=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
[Service]
WorkingDirectory=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@
User=ss-api
Group=ss-api
SupplementaryGroups=
SupplementaryGroups=ss-code ss-export ss-health ss-publication ss-tenant-data
UMask=0007
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
PrivateIPC=yes
ProtectSystem=strict
ProtectHome=tmpfs
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictAddressFamilies=
RestrictAddressFamilies=AF_UNIX AF_INET
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RuntimeDirectory=
ReadOnlyPaths=
ReadOnlyPaths=/etc/sitesourcery
ReadWritePaths=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
TemporaryFileSystem=/srv/sitesourcery-storage:ro
InaccessiblePaths=-/run/user -/run/docker.sock -/run/containerd -/run/dbus -/run/systemd/private -/var/lib/sitesourcery-storage
EnvironmentFile=
EnvironmentFile=/etc/sitesourcery/runtime/api.env
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node
BindReadOnlyPaths=/run/sitesourcery/health
BindReadOnlyPaths=/run/sitesourcery-database
BindPaths=/srv/sitesourcery-storage/production/app/private-exports
ReadWritePaths=/srv/sitesourcery-storage/production/app/private-exports
BindPaths=/srv/sitesourcery-storage/production/app/tenant-runtime
ReadWritePaths=/srv/sitesourcery-storage/production/app/tenant-runtime
BindPaths=/run/sitesourcery/publication
ReadWritePaths=/run/sitesourcery/publication
ExecStartPre=
ExecStartPre=+/usr/bin/python3 -I -B /var/lib/sitesourcery-storage/guard.py /var/lib/sitesourcery-storage/manifest.json all --manifest-sha256 f772aa6da30b3910148639aad370395c4f935b08efd180103bdec62eeea7690c
ExecStartPre=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/server/hosted/assert-runtime.mjs
ExecStartPre=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/ops/verify-final-release-epoch-v2.mjs --epoch ${SITESOURCERY_RELEASE_EPOCH_FILE} --epoch-sha256 ${SITESOURCERY_RELEASE_EPOCH_SHA256} --origin-seal ${SITESOURCERY_ORIGIN_SEAL_FILE} --origin-seal-sha256 ${SITESOURCERY_ORIGIN_SEAL_FILE_SHA256} --installed-readback ${SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE} --installed-readback-sha256 ${SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256}
ExecStart=
ExecStart=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/server/hosted/bin/server.mjs
""",
    'sitesourcery-hq-workers.service': """# INERT PROPOSAL. Requires reviewed source, native custody and finite root apply authority.
[Unit]
Requires=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
After=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
[Service]
WorkingDirectory=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@
User=ss-worker
Group=ss-worker
SupplementaryGroups=
SupplementaryGroups=ss-code ss-export ss-health ss-publication
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
PrivateIPC=yes
ProtectSystem=strict
ProtectHome=tmpfs
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictAddressFamilies=
RestrictAddressFamilies=AF_UNIX AF_INET
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RuntimeDirectory=
ReadOnlyPaths=
ReadOnlyPaths=/etc/sitesourcery
ReadWritePaths=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
TemporaryFileSystem=/srv/sitesourcery-storage:ro
InaccessiblePaths=-/run/user -/run/docker.sock -/run/containerd -/run/dbus -/run/systemd/private -/var/lib/sitesourcery-storage
EnvironmentFile=
EnvironmentFile=/etc/sitesourcery/runtime/worker.env
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node
BindReadOnlyPaths=/run/sitesourcery/publication
BindReadOnlyPaths=/run/sitesourcery-database
BindReadOnlyPaths=/usr/local/libexec/sitesourcery-worker-readiness-20261020/wait-api-ready.mjs
BindPaths=/srv/sitesourcery-storage/production/app/private-exports
ReadWritePaths=/srv/sitesourcery-storage/production/app/private-exports
BindPaths=/run/sitesourcery/health
ReadWritePaths=/run/sitesourcery/health
ExecStartPre=
ExecStartPre=+/usr/bin/python3 -I -B /var/lib/sitesourcery-storage/guard.py /var/lib/sitesourcery-storage/manifest.json all --manifest-sha256 f772aa6da30b3910148639aad370395c4f935b08efd180103bdec62eeea7690c
ExecStartPre=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/server/hosted/assert-runtime.mjs
ExecStartPre=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /usr/local/libexec/sitesourcery-worker-readiness-20261020/wait-api-ready.mjs
ExecStart=
ExecStart=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/server/hosted/bin/worker.mjs
""",
    'sitesourcery-hq-tenant.service': """# INERT PROPOSAL. Requires reviewed source, native custody and finite root apply authority.
[Unit]
Requires=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
After=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
[Service]
WorkingDirectory=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@
User=ss-tenant
Group=ss-tenant
SupplementaryGroups=
SupplementaryGroups=ss-code ss-tenant-data
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
PrivateIPC=yes
ProtectSystem=strict
ProtectHome=tmpfs
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictAddressFamilies=
RestrictAddressFamilies=AF_UNIX AF_INET
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RuntimeDirectory=
ReadOnlyPaths=
ReadOnlyPaths=/etc/sitesourcery
ReadWritePaths=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
TemporaryFileSystem=/srv/sitesourcery-storage:ro
InaccessiblePaths=-/run/user -/run/docker.sock -/run/containerd -/run/dbus -/run/systemd/private -/var/lib/sitesourcery-storage
EnvironmentFile=
EnvironmentFile=/etc/sitesourcery/tenant.env
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node
BindReadOnlyPaths=/srv/sitesourcery-storage/production/app/tenant-runtime
ExecStartPre=
ExecStartPre=+/usr/bin/python3 -I -B /var/lib/sitesourcery-storage/guard.py /var/lib/sitesourcery-storage/manifest.json all --manifest-sha256 f772aa6da30b3910148639aad370395c4f935b08efd180103bdec62eeea7690c
ExecStartPre=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/server/selfhost/bin/assert-runtime.mjs
ExecStartPre=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/ops/verify-final-release-epoch-v2.mjs --epoch ${SITESOURCERY_RELEASE_EPOCH_FILE} --epoch-sha256 ${SITESOURCERY_RELEASE_EPOCH_SHA256} --origin-seal ${SITESOURCERY_ORIGIN_SEAL_FILE} --origin-seal-sha256 ${SITESOURCERY_ORIGIN_SEAL_FILE_SHA256} --installed-readback ${SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE} --installed-readback-sha256 ${SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256}
ExecStart=
ExecStart=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node /home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/server/selfhost/bin/server.mjs
""",
    'sitesourcery-hq-gateway.service': """# INERT PROPOSAL. Requires reviewed source, native custody and finite root apply authority.
[Unit]
Requires=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
After=sitesourcery-runtime-directories.service sitesourcery-runtime-egress.service
[Service]
User=ss-gateway
Group=ss-gateway
SupplementaryGroups=
SupplementaryGroups=ss-code
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
PrivateTmp=yes
PrivateDevices=yes
PrivateIPC=yes
ProtectSystem=strict
ProtectHome=tmpfs
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictAddressFamilies=
RestrictAddressFamilies=AF_UNIX AF_INET
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
RuntimeDirectory=
ReadOnlyPaths=
ReadOnlyPaths=/etc/sitesourcery
ReadWritePaths=
BindPaths=
BindReadOnlyPaths=
TemporaryFileSystem=
TemporaryFileSystem=/srv/sitesourcery-storage:ro
InaccessiblePaths=-/run/user -/run/docker.sock -/run/containerd -/run/dbus -/run/systemd/private -/var/lib/sitesourcery-storage
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-production/releases/@CANDIDATE@/_hosted:/home/mrfantasea/.local/share/sitesourcery-production/current/_hosted
BindReadOnlyPaths=/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/caddy-2.11.4
""",
}


def isolated_profile(mode='presentation-only'):
    p = profile(mode)
    p['runtime']['isolation'] = {'policySha256': '1'*64, 'priorAcceptanceSha256': '2'*64}
    p['runtime']['workerHealth'] = {'path':'/run/sitesourcery/health/export-worker-health.json','uid':911,'gid':917,'mode':0o640}
    p['databaseIdentity']['sockets'] += ',/run/sitesourcery-database'
    return p


def code_custody():
    def item(path, mode, kind='directory'):
        e = {'path':path,'type':kind,'uid':1000,'gid':1000,'mode':oct(mode),'nlink':1 if kind=='file' else 2,
             'acl':{'extended':False,'entries':[[1,(mode>>6)&7,4294967295],[4,(mode>>3)&7,4294967295],[32,mode&7,4294967295]]}}
        if kind=='file': e.update(byteCount=3,sha256=isolation.sha(b'abc'))
        return e
    entries=[item('.',0o700),item('bin',0o700),item('bin/main',0o700,'file'),item('data',0o600,'file'),
             {'path':'link','type':'symlink','uid':1000,'gid':1000,'mode':'0o777','nlink':1,'target':'data'}]
    return rehash_custody({'schema':'sitesourcery.release-custody/v1','entries':entries})


def rehash_custody(value):
    value['custodySha256']=isolation.sha(isolation.encoded(value['entries']))
    return value


def isolation_policy():
    return {'schema':'sitesourcery.runtime-isolation-policy/v1','codeReadGroup':915,
            'unitTemplates':copy.deepcopy(ISOLATION_TEMPLATES),
            'identities':{'groups':dict(isolation.IDENTITIES),'users':{n:{'uid':isolation.IDENTITIES[n],
                'gid':isolation.IDENTITIES[n],'groups':sorted(isolation.NSS_GROUPS[n])} for n in isolation.NSS_GROUPS}},
            'staticFiles':{name:static_meta() for name in isolation.STATIC_PATHS}}


def file_meta(raw=b'fixture'):
    return {'mode':0o640,'uid':0,'gid':1000,'bytes':len(raw),'sha256':isolation.sha(raw)}


def static_meta(raw=b'fixture',uid=0,gid=1000,mode=0o640):
    return dict(file_meta(raw),uid=uid,gid=gid,mode=mode,nlink=1,acl={'extended':False,
        'entries':[[1,(mode>>6)&7,4294967295],[4,(mode>>3)&7,4294967295],[32,mode&7,4294967295]]})


def isolation_binding(p, policy, stage_ref, custody):
    files=set(policy['staticFiles'])|set(isolation.AUTH_FILES)|{isolation.API_ENV,isolation.WORKER_ENV}|{isolation.drop_path(u) for u in isolation.UNITS}
    units={u:{k:(['fixture'] if k in ('ExecStart','ExecStartPre') else 'fixture') for k in isolation.PROPERTIES} for u in isolation.UNITS}
    return {'schema':'sitesourcery.runtime-isolation-binding/v1','state':'isolation_accepted',
            'candidate':p['priorCandidate'],'tree':p['priorTree'],'policySha256':p['runtime']['isolation']['policySha256'],
            'originalStageReceipt':stage_ref,'inventory':isolation.legacy_inventory(custody),'custody':custody,
            'files':{f:(copy.deepcopy(policy['staticFiles'][f]) if f in policy['staticFiles'] else file_meta()) for f in files},'effectiveUnits':units}

class Contracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ss-native-contract-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()

    def test_worker_health_binds_dedicated_custody_without_weakening_legacy_acceptance(self):
        p = profile()
        legacy = {'uid': 1000, 'gid': 1000, 'mode': 0o600}
        self.assertTrue(contract.worker_health_metadata_ok(p, legacy))
        p['runtime']['workerHealth'] = {'path': '/run/sitesourcery/health/export-worker-health.json',
                                      'uid': 321, 'gid': 654, 'mode': 0o640}
        contract.validate_profile(p)
        actual = {'uid': 321, 'gid': 654, 'mode': 0o640}
        self.assertTrue(contract.worker_health_metadata_ok(p, actual))
        self.assertFalse(contract.worker_health_metadata_ok(p, legacy))
        for key, wrong in [('uid', 1000), ('gid', 1000), ('mode', 0o660)]:
            bad = dict(actual); bad[key] = wrong
            self.assertFalse(contract.worker_health_metadata_ok(p, bad))
            bad_profile = copy.deepcopy(p); bad_profile['runtime']['workerHealth'][key] = wrong
            with self.assertRaises(ValueError): contract.validate_profile(bad_profile)
        for wrong in ['/etc/passwd', '/run/sitesourcery/export-worker-health.json',
                      '/run/sitesourcery/../health/export-worker-health.json']:
            bad = copy.deepcopy(p); bad['runtime']['workerHealth']['path'] = wrong
            with self.assertRaises(ValueError): contract.validate_profile(bad)

    def test_new_schema_and_eight_workers_validate_every_python_adapter(self):
        for mode in ['presentation-only', 'schema-changing']:
            p = profile(mode); ref = write_json(self.directory / (mode + '.json'), p)
            for adapter in ['install-', 'handoff-', 'accept-']:
                name = adapter + ('presentation' if mode == 'presentation-only' else 'schema') + '.py'
                result = subprocess.run([sys.executable, '-I', '-B', str(HERE / name), ref['path'], ref['sha256'], 'validate'], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                value = json.loads(result.stdout)
                self.assertEqual(value['migrationCount'], 114)
                self.assertFalse(value['nativeEffects'])
                self.assertEqual(value['holdCount'], 10 if mode == 'presentation-only' else 15)

    def test_input_typos_mode_changes_unknown_workers_and_paths_refuse(self):
        changes = [lambda p: p.update(canddiate=p['candidate']),
                   lambda p: p['expectedSchema'].update(afterCount=115),
                   lambda p: p['workerPurposes'].append('export'),
                   lambda p: p['workerPurposes'].append('unreviewed-worker'),
                   lambda p: p.update(cohort='../escape'),
                   lambda p: p['runtime'].update(node='/bin/sh'),
                   lambda p: p['databaseIdentity'].update(db='another_customer'),
                   lambda p: p['baselineConfiguration'].update(extra='f' * 64)]
        for change in changes:
            p = profile(); change(p)
            with self.assertRaises((ValueError, TypeError)): contract.validate_profile(p)
        p = profile('schema-changing'); p['migration']['addedEmptyRelations'].append('ss.fixture_three')
        with self.assertRaises(ValueError): contract.validate_profile(p)

    def test_pinned_profiles_reject_changed_bytes_and_symlink_ancestors(self):
        p = profile(); ref = write_json(self.directory / 'profile.json', p)
        p['tree'] = 'f' * 40; write_json(Path(ref['path']), p)
        with self.assertRaisesRegex(ValueError, 'digest changed'): contract.load_profile(**{'filename': ref['path'], 'sha256': ref['sha256']})
        actual = self.directory / 'actual'; actual.mkdir(); ref = write_json(actual / 'profile.json', p)
        (self.directory / 'link').symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'custody'): contract.load_profile(str(self.directory / 'link/profile.json'), ref['sha256'])

    def test_held_installation_preserves_independent_services_and_requires_all_writers_stopped(self):
        for mode, name in [('presentation-only', 'install-presentation'), ('schema-changing', 'install-schema')]:
            p = profile(mode); module, _ = load_adapter(name, p, self.directory)
            observed, approval = held_fixture(module, p)
            module.held(observed, approval)
            for change in [lambda o: o['units']['sitesourcery-hq-workers.service'].update(ActiveState='active', MainPID='88'),
                           lambda o: o['userUnits']['sitesourcery-production-postgresql.service'].update(MainPID='99'),
                           lambda o: o['files'][approval['holdPaths'][0]].update(sha256='f' * 64),
                           lambda o: o['workerPurposes'].remove('notification-mail')]:
                wrong = copy.deepcopy(observed); change(wrong)
                with self.assertRaises(RuntimeError): module.held(wrong, approval)
            if mode == 'schema-changing':
                wrong = copy.deepcopy(observed); wrong['userUnits']['client-profile-hub.service'].update(ActiveState='active', MainPID='77')
                with self.assertRaises(RuntimeError): module.held(wrong, approval)

    def test_stale_install_authority_refuses_before_any_lock_or_native_command(self):
        for mode, name in [('presentation-only', 'install-presentation'), ('schema-changing', 'install-schema')]:
            p = profile(mode); module, ref = load_adapter(name, p, self.directory)
            facts = ({'unchangedSchema': True, 'siteCodeWritersHeld': True, 'historicalProvenanceVerified': True,
                      'independentServicesPreserved': True, 'noDatabaseMutation': True} if mode == 'presentation-only' else
                     {'productionCommitted': True, 'writersDurablyHeld': True, 'noNewApplicationWrites': True,
                      'freshRecoveryPointVerified': True, 'codeOnlyRollbackForbidden': True})
            a = {k: p[k] for k in ['candidate', 'tree', 'priorCandidate', 'priorTree']}
            a.update(profile=ref, authorized=True, action='apply_presentation_held' if mode == 'presentation-only' else 'apply_schema_held',
                     activationAllowed=False, reviewedFacts=facts, issuedAt='2000-01-01T00:00:00Z', expiresAt='2000-01-01T00:25:00Z')
            operation = write_json(self.directory / (name + '.operation.json'), a)
            with patch.object(sys, 'argv', [name, 'apply', operation['path'], operation['sha256']]), \
                 patch.object(module.os, 'geteuid', return_value=0), patch.object(module.socket, 'gethostname', return_value='FantaSeaLand'), \
                 patch.object(module, 'HERE', types.SimpleNamespace(stat=lambda: types.SimpleNamespace(st_uid=0, st_mode=0o750))), \
                 patch.object(module._profile, 'verify_bundle'), patch.object(module.os, 'open', side_effect=AssertionError('native lock attempted')), \
                 patch.object(module, 'run', side_effect=AssertionError('native command attempted')):
                with self.assertRaisesRegex(RuntimeError, 'Finite current approval required'): module.main()

    def test_schema_mode_has_no_code_only_rollback_action(self):
        p = profile('schema-changing'); ref = write_json(self.directory / 'profile.json', p)
        result = subprocess.run([sys.executable, '-I', '-B', str(HERE / 'run.py'), ref['path'], ref['sha256'], 'rollback', '/does/not/exist', '0' * 64], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('action is not available', result.stderr)

    def test_typed_authority_evidence_and_legacy_alias_must_agree(self):
        ref = {'path': '/fixture/committed.json', 'sha256': 'e' * 64}
        authority = {'evidence': {'productionReceipt': ref}, 'production114Receipt': ref}
        self.assertEqual(contract.authority_reference(authority, 'productionReceipt'), ref)
        authority['production114Receipt'] = dict(ref, sha256='f' * 64)
        with self.assertRaisesRegex(ValueError, 'conflicting'): contract.authority_reference(authority, 'productionReceipt')

    def test_notification_result_contract_accepts_current_events_and_rejects_errors(self):
        event = {'event': 'sitesourcery.worker.notification-mail', 'state': 'running', 'cycle': 24,
                 'result': {'selected': 1, 'accepted': 1, 'alreadyRecorded': 0, 'busy': 0, 'expired': 0}}
        self.assertTrue(contract.worker_cycle_ok(event, 'notification-mail'))
        for change in [lambda x: x.update(errorCode='provider_error'), lambda x: x.update(cycle=0),
                       lambda x: x['result'].update(selected=2), lambda x: x['result'].update(accepted='1')]:
            bad = copy.deepcopy(event); change(bad); self.assertFalse(contract.worker_cycle_ok(bad, 'notification-mail'))


    def test_isolation_profile_has_exact_four_consumers_and_gateway_hold_in_both_modes(self):
        for mode, count in [('presentation-only',11),('schema-changing',16)]:
            p=isolated_profile(mode); contract.validate_profile(p)
            self.assertEqual(len(contract.derived(p)['holdPaths']),count)
            for prefix in ('install-','handoff-','accept-'):
                name=prefix+('presentation' if mode=='presentation-only' else 'schema')
                module,ref=load_adapter(name,p,self.directory)
                if prefix=='handoff-':
                    self.assertIn(module.GATEWAY,module.RUNTIME)
                    self.assertNotIn(module.GATEWAY,module.INDEPENDENT)
                if prefix=='install-':
                    observed,approval=held_fixture(module,p)
                    observed['units']['sitesourcery-hq-gateway.service'].update(ActiveState='inactive',MainPID='0')
                    module.held(observed,approval)
                    observed['units']['sitesourcery-hq-gateway.service']['MainPID']='22'
                    with self.assertRaises(RuntimeError): module.held(observed,approval)
                result=subprocess.run([sys.executable,'-I','-B',str(HERE/(name+'.py')),ref['path'],ref['sha256'],'validate'],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout)['holdCount'],count)
            for bad in ({'policySha256':'1'*64},{'policySha256':'1'*64,'priorAcceptanceSha256':'2'*64,'extra':True}):
                p['runtime']['isolation']=bad
                with self.assertRaises(ValueError): contract.validate_profile(p)

    def test_frozen_four_templates_render_only_candidate_and_refuse_unreviewed_directive(self):
        policy=isolation_policy(); isolation.validate_policy(policy)
        for candidate in ('a'*40,'c'*40):
            result=isolation.render(policy,candidate)
            self.assertEqual(len(result),4)
            for u,text in policy['unitTemplates'].items():
                self.assertEqual(result[isolation.drop_path(u)].decode().replace(candidate,'@CANDIDATE@'),text)
                self.assertEqual(result[isolation.drop_path(u)].count(candidate.encode()),isolation.COUNTS[u])
        for mutate in (lambda p:p['unitTemplates'].pop(isolation.UNITS[-1]),
                       lambda p:p['unitTemplates'].update({'unknown.service':'fixture'}),
                       lambda p:p['unitTemplates'].__setitem__(isolation.UNITS[0],p['unitTemplates'][isolation.UNITS[0]].replace('NoNewPrivileges=yes','NoNewPrivileges=no'))):
            bad=copy.deepcopy(policy); mutate(bad)
            with self.assertRaises(ValueError): isolation.validate_policy(bad)

    def test_api_environment_exact_five_substitutions_preserve_other_bytes(self):
        old='c'*40; new='a'*40
        raw=(b'# fixture only\nSYNTHETIC_SECRET="retained-literal"\n'+
             b''.join((k+'="'+'1'*64+'"\n').encode() for k in isolation.ANCHORS)+
             b''.join((k+'="'+str(isolation.BASE/'releases'/old/'server/hosted/resend-mail-transport.mjs')+'"\n').encode() for k in isolation.MODULES))
        changed=isolation.rewrite_api_env(raw,old,new,{k:'2'*64 for k in isolation.ANCHORS})
        self.assertEqual(changed.replace(b'2'*64,b'1'*64).replace(new.encode(),old.encode()),raw)
        self.assertIn(b'SYNTHETIC_SECRET="retained-literal"',changed)
        for bad in (raw+raw.splitlines(keepends=True)[2],raw.replace(b'1'*64,b'wrong',1),raw.replace(old.encode(),b'f'*40,1),raw.replace(isolation.MODULES[0].encode(),b'MISSING',1)):
            with self.assertRaises(ValueError): isolation.rewrite_api_env(bad,old,new,{k:'2'*64 for k in isolation.ANCHORS})

    def test_original_stage_and_actual_acl_inventory_are_independently_bound(self):
        p=isolated_profile(); policy=isolation_policy(); before=code_custody(); after=isolation.planned_custody(before)
        stage={'status':'staged_inert','inventory':isolation.legacy_inventory(before)}
        stage_ref=write_json(self.directory/'original-stage.json',stage); original=Path(stage_ref['path']).read_bytes()
        policy_ref=write_json(self.directory/'policy.json',policy);p['runtime']['isolation']['policySha256']=policy_ref['sha256']
        binding=isolation_binding(p,policy,dict(stage_ref,path='/native/original-stage.json'),after)
        accepted=write_json(self.directory/'accepted.json',binding);p['runtime']['isolation']['priorAcceptanceSha256']=accepted['sha256']
        refs={'policy':policy_ref,'priorAcceptance':accepted}
        self.assertEqual(isolation.local_inputs(p,refs,stage_ref)[1],binding)
        self.assertNotEqual(stage['inventory']['inventorySha256'],binding['inventory']['inventorySha256'])
        self.assertEqual(Path(stage_ref['path']).read_bytes(),original)
        bad=copy.deepcopy(binding);bad['originalStageReceipt']['sha256']='f'*64
        bad_ref=write_json(self.directory/'bad.json',bad);p['runtime']['isolation']['priorAcceptanceSha256']=bad_ref['sha256']
        with self.assertRaisesRegex(ValueError,'lineage'):isolation.local_inputs(p,dict(refs,priorAcceptance=bad_ref),stage_ref)
        bad=copy.deepcopy(binding);bad['custody']['entries'][3]['sha256']='f'*64;rehash_custody(bad['custody']);bad['inventory']=isolation.legacy_inventory(bad['custody'])
        bad_ref=write_json(self.directory/'bad-content.json',bad);p['runtime']['isolation']['priorAcceptanceSha256']=bad_ref['sha256']
        with self.assertRaisesRegex(ValueError,'content'):isolation.local_inputs(p,dict(refs,priorAcceptance=bad_ref),stage_ref)

    def test_content_projection_preserves_paths_links_bytes_and_executable_class(self):
        old=isolation.legacy_inventory(code_custody())
        for field,value in [('path','renamed'),('sha256','e'*64),('byteCount',4),('mode','0o600')]:
            bad=copy.deepcopy(old);bad['entries'][1][field]=value
            self.assertNotEqual(isolation.content_projection(old),isolation.content_projection(bad))
        bad=copy.deepcopy(old);bad['entries'][-1]['target']='bin/main'
        self.assertNotEqual(isolation.content_projection(old),isolation.content_projection(bad))

    def test_custody_detects_metadata_not_in_legacy_inventory(self):
        before=code_custody();legacy=isolation.legacy_inventory(before)
        for change in (lambda e:e[0].update(mode='0o750'),lambda e:e[2].update(uid=911),lambda e:e[2].update(gid=915),lambda e:e[2]['acl']['entries'].append([8,4,916])):
            bad=copy.deepcopy(before);change(bad['entries']);rehash_custody(bad)
            self.assertEqual(isolation.legacy_inventory(bad),legacy)
            self.assertNotEqual(bad['custodySha256'],before['custodySha256'])
            with self.assertRaises(ValueError):isolation.validate_custody(bad)

    def test_planned_acl_is_finite_read_only_idempotent_and_preserves_symlinks(self):
        before=code_custody();snapshot=copy.deepcopy(before);after=isolation.planned_custody(before)
        isolation.validate_custody(after)
        self.assertEqual(before,snapshot);self.assertEqual(after,isolation.planned_custody(after))
        self.assertEqual(after['entries'][-1],before['entries'][-1])
        self.assertEqual([e['mode'] for e in after['entries'][:4]],['0o750','0o750','0o750','0o640'])
        for e in after['entries'][:-1]:
            self.assertFalse(next(x[1] for x in e['acl']['entries'] if x[0]==8)&2)
            self.assertEqual(e['uid'],1000)
        bad=copy.deepcopy(after);bad['entries'][0]['acl']['entries'][2][2]=916;rehash_custody(bad)
        with self.assertRaises(ValueError):isolation.planned_custody(bad)
        bad=copy.deepcopy(after);bad['entries'][0]['acl']['entries'][2][1]=7;rehash_custody(bad)
        with self.assertRaises(ValueError):isolation.planned_custody(bad)

    def test_acl_codec_and_default_acl_fail_closed(self):
        acl=isolation.planned_custody(code_custody())['entries'][0]['acl']['entries']
        raw=struct.pack('<I',2)+b''.join(struct.pack('<HHI',*e) for e in acl)
        self.assertEqual(isolation.decode_acl(raw),acl)
        for bad in (b'',raw[:-1],struct.pack('<I',3)+raw[4:],raw+raw[4:12]):
            with self.assertRaises(ValueError):isolation.decode_acl(bad)
        with patch.object(isolation,'acl_xattr',return_value=raw):
            with self.assertRaisesRegex(ValueError,'default'):isolation.read_acl('/fixture',types.SimpleNamespace(st_mode=stat.S_IFDIR|0o750))
        with patch.object(isolation.os,'getxattr',create=True,side_effect=OSError(95,'unsupported')):
            with self.assertRaises(OSError):isolation.acl_xattr('/fixture','system.posix_acl_access')

    def test_partial_acl_failure_allows_only_recorded_before_or_after_entries(self):
        before=code_custody();after=isolation.planned_custody(before)
        for n in range(len(before['entries'])+1):
            partial=copy.deepcopy(before);partial['entries'][:n]=copy.deepcopy(after['entries'][:n]);rehash_custody(partial)
            self.assertTrue(isolation.valid_partial_custody(partial,before,after))
        bad=copy.deepcopy(after);bad['entries'][3]['sha256']='f'*64;rehash_custody(bad)
        self.assertFalse(isolation.valid_partial_custody(bad,before,after))

    def test_native_mode_marker_blocks_implicit_downgrade(self):
        for exists,p,valid in ((False,profile(),True),(True,isolated_profile(),True),(True,profile(),False),(False,isolated_profile(),False)):
            with patch.object(isolation.os.path,'lexists',return_value=exists):
                if valid:isolation.check_mode(p)
                else:
                    with self.assertRaises(ValueError):isolation.check_mode(p)

    def test_acl_mutation_requires_root_and_exact_remeasured_stage_before_any_write(self):
        before=code_custody();after=isolation.planned_custody(before)
        with patch.object(isolation.os,'geteuid',return_value=1000),patch.object(isolation.os,'setxattr',create=True,side_effect=AssertionError('write')):
            with self.assertRaisesRegex(ValueError,'root'):isolation.apply_custody('/fixture',before,after,lambda:None)
        with patch.object(isolation.os,'geteuid',return_value=0),patch.object(isolation,'collect_custody',return_value=after),patch.object(isolation.os,'setxattr',create=True,side_effect=AssertionError('write')):
            with self.assertRaisesRegex(ValueError,'preflight'):isolation.apply_custody('/fixture',before,after,lambda:None)

    def test_staged_custody_must_match_exact_candidate_before_acl_plan(self):
        p=isolated_profile();before=code_custody();stage={'custody':before,'inventory':isolation.legacy_inventory(before)}
        observed={'candidate':p['priorCandidate'],'tree':p['priorTree']}
        with patch.object(isolation,'observe',return_value=observed),patch.object(isolation,'collect_custody',return_value=before):
            self.assertEqual(isolation.before_install(p,stage)['after'],isolation.planned_custody(before))
        with patch.object(isolation,'observe',return_value=observed),patch.object(isolation,'collect_custody',return_value=isolation.planned_custody(before)):
            with self.assertRaisesRegex(ValueError,'staged'):isolation.before_install(p,stage)

    def test_installed_marker_is_reverified_before_every_resume(self):
        p=isolated_profile();ref={'path':str(isolation.MARKER),'sha256':'9'*64}
        installed={'candidate':p['candidate'],'tree':p['tree'],'isolationBinding':ref}
        with patch.object(isolation,'observe',return_value={'candidate':p['candidate'],'tree':p['tree']}) as observed:
            isolation.verify_installed(p,installed);observed.assert_called_once_with(p,'9'*64)
        with patch.object(isolation,'observe',side_effect=ValueError('actual file drift')):
            with self.assertRaisesRegex(ValueError,'actual file drift'):isolation.verify_installed(p,installed)
        with patch.object(isolation,'observe',return_value={'candidate':p['priorCandidate'],'tree':p['priorTree']}):
            with self.assertRaisesRegex(ValueError,'candidate'):isolation.verify_installed(p,installed)
        installed['isolationBinding']['path']='/tmp/fake'
        with self.assertRaisesRegex(ValueError,'path'):isolation.verify_installed(p,installed)

    def test_successor_binding_preserves_original_stage_and_static_worker_bytes(self):
        p=isolated_profile();policy=isolation_policy();before=code_custody();after=isolation.planned_custody(before)
        old=isolation_binding(p,policy,{'path':'/old-stage','sha256':'1'*64},after)
        for values in old['effectiveUnits'].values():values['WorkingDirectory']=str(isolation.BASE/'releases'/p['priorCandidate'])
        payloads=isolation.render(policy,p['candidate']);payloads[isolation.API_ENV]=b'new synthetic API bytes'
        new_ref={'path':'/new-stage','sha256':'3'*64}
        with patch.object(isolation,'native_context',return_value=(policy,old,'2'*64)):
            new=isolation.successor_binding(p,new_ref,{'after':after},payloads)
        self.assertEqual(new['state'],'installed_isolated_held');self.assertEqual(new['originalStageReceipt'],new_ref)
        self.assertEqual(new['files'][isolation.WORKER_ENV],old['files'][isolation.WORKER_ENV])
        self.assertEqual(old['originalStageReceipt']['path'],'/old-stage')
        self.assertEqual(new['files'][isolation.API_ENV]['sha256'],isolation.sha(payloads[isolation.API_ENV]))
        self.assertNotIn(p['priorCandidate'],json.dumps(new['effectiveUnits']))

    def test_classic_config_extended_acl_is_never_silently_lost(self):
        with patch.object(isolation,'read_bytes',return_value=b'fixture'),patch.object(Path,'lstat',return_value=types.SimpleNamespace(st_uid=0,st_gid=915,st_mode=0o640)),patch.object(isolation,'read_acl',return_value={'extended':True}):
            with self.assertRaisesRegex(ValueError,'classic'):isolation.metadata('/fixture')

    def test_effective_units_remove_only_volatile_execution_state(self):
        lines=[]
        for k in isolation.PROPERTIES:
            value='{ path=/fixture/node ; argv[]=/fixture/node /fixture/app ; pid=123 ; start_time=volatile ; }' if k=='ExecStart' else '' if k=='ExecStartPre' else 'fixed'
            lines.append(k+'='+value)
        with patch.object(isolation.subprocess,'check_output',return_value='\n'.join(lines)):
            result=isolation.effective_units()
        for unit in result.values():
            self.assertEqual(unit['ExecStart'],['/fixture/node /fixture/app ']);self.assertEqual(unit['ExecStartPre'],[])
            self.assertEqual(unit['NoNewPrivileges'],'fixed')

    def test_gateway_requires_fresh_process_and_exact_candidate_static_bytes(self):
        import urllib.request
        p=isolated_profile();unit='sitesourcery-hq-gateway.service';key='system:'+unit
        installed={'candidate':p['candidate'],'isolationBinding':{'sha256':'9'*64}}
        resume={'units':{key:{'MainPID':'22','InvocationID':'a'*32}}};journal={'baseline':{'units':{key:{'MainPID':'11','InvocationID':'b'*32}}}}
        units={unit:{'ActiveState':'active','MainPID':'22','NRestarts':'0','InvocationID':'a'*32}}
        binding={'inventory':{'entries':[{'path':'_hosted/index.html','type':'file','byteCount':3,'sha256':isolation.sha(b'new')}]}}
        class Response:
            status=200
            def __init__(self,data):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return self.data[:n]
        for body,passes in ((b'new',True),(b'old',False),(b'new-extra',False)):
            def open_response(request,timeout):
                self.assertEqual(request.full_url,'http://127.0.0.1:8081/')
                self.assertEqual(request.get_header('Host'),'sitesourcery.com')
                self.assertEqual(request.get_header('Accept-encoding'),'identity')
                self.assertEqual(timeout,5)
                return Response(body)
            opener=types.SimpleNamespace(open=open_response)
            with patch.object(isolation,'native_context',return_value=(None,binding,None)),patch.object(urllib.request,'build_opener',return_value=opener):
                if passes:self.assertEqual(isolation.verify_gateway(p,installed,resume,units,journal)['sha256'],isolation.sha(b'new'))
                else:
                    with self.assertRaisesRegex(ValueError,'stale'):isolation.verify_gateway(p,installed,resume,units,journal)
        for change in ({'MainPID':'11'},{'NRestarts':'1'},{'InvocationID':''},{'ActiveState':'inactive'}):
            bad=copy.deepcopy(units);bad[unit].update(change)
            with patch.object(urllib.request,'build_opener',side_effect=AssertionError('unexpected network')):
                with self.assertRaisesRegex(ValueError,'freshly'):isolation.verify_gateway(p,installed,resume,bad,journal)


    def test_actual_disposable_tree_rejects_hardlinks_escape_links_and_replaced_inode(self):
        root=self.directory/'code';root.mkdir(mode=0o700)
        (root/'data').write_bytes(b'abc');(root/'data').chmod(0o600)
        (root/'link').symlink_to('data');(root/'.git').mkdir();(root/'.git'/'private').write_bytes(b'ignored')
        original_lstat=Path.lstat;original_fstat=os.fstat
        # Only owner numbers and Linux ACL access are synthetic; actual disk paths,
        # bytes, links, inode checks and descriptor reads exercise the collector.
        def owned(info):
            values={k:getattr(info,k) for k in dir(info) if k.startswith('st_')}
            values.update(st_uid=1000,st_gid=1000)
            if stat.S_ISLNK(info.st_mode):values['st_mode']=stat.S_IFLNK|0o777
            return types.SimpleNamespace(**values)
        def acl(path,info):
            mode=stat.S_IMODE(info.st_mode)
            return {'extended':False,'entries':[[1,(mode>>6)&7,4294967295],[4,(mode>>3)&7,4294967295],[32,mode&7,4294967295]]}
        with patch.object(Path,'lstat',lambda p:owned(original_lstat(p))),patch.object(isolation.os,'fstat',lambda fd:owned(original_fstat(fd))),patch.object(isolation,'read_acl',side_effect=acl):
            first=isolation.collect_custody(root);isolation.validate_custody(first)
            self.assertEqual([e['path'] for e in first['entries']],['.','data','link'])
            os.link(root/'data',root/'hard')
            with self.assertRaisesRegex(ValueError,'shared'):isolation.collect_custody(root)
            (root/'hard').unlink();(root/'link').unlink();(root/'link').symlink_to('../code')
            # Resolves within root, so this link itself is safe. Escaping it is not.
            isolation.collect_custody(root)
            (root/'link').unlink();(root/'link').symlink_to('..')
            with self.assertRaisesRegex(ValueError,'unsafe code link'):isolation.collect_custody(root)
            (root/'link').unlink();(root/'link').symlink_to('data')
            def replaced(fd):
                info=owned(original_fstat(fd));info.st_ino+=1;return info
            with patch.object(isolation.os,'fstat',side_effect=replaced):
                with self.assertRaisesRegex(ValueError,'replaced'):isolation.collect_custody(root)
        # Hash-bound input guard also rejects aliases and shared files on actual disk.
        ref=write_json(self.directory/'input.json',{'safe':True})
        (self.directory/'input-link.json').symlink_to('input.json')
        with self.assertRaisesRegex(ValueError,'noncanonical'):isolation.pinned(dict(ref,path=str(self.directory/'input-link.json')))
        os.link(ref['path'],self.directory/'shared.json')
        with self.assertRaisesRegex(ValueError,'unsafe'):isolation.pinned(ref)


    def test_nss_numeric_identities_and_memberships_cannot_drift_or_gain_owner_groups(self):
        expected=isolation_policy()['identities'];isolation.validate_identities(expected)
        def group_name(name):return types.SimpleNamespace(gr_name=name,gr_gid=isolation.IDENTITIES[name])
        def group_id(number):return group_name(next(n for n,g in isolation.IDENTITIES.items() if g==number))
        def user_name(name):return types.SimpleNamespace(pw_name=name,pw_uid=isolation.IDENTITIES[name],pw_gid=isolation.IDENTITIES[name])
        def user_id(number):return user_name(next(n for n,g in isolation.IDENTITIES.items() if g==number))
        with patch.object(isolation.grp,'getgrnam',side_effect=group_name),patch.object(isolation.grp,'getgrgid',side_effect=group_id),patch.object(isolation.pwd,'getpwnam',side_effect=user_name),patch.object(isolation.pwd,'getpwuid',side_effect=user_id),patch.object(isolation.os,'getgrouplist',side_effect=lambda n,g:sorted(isolation.NSS_GROUPS[n])):
            self.assertEqual(isolation.observe_identities(expected),expected)
            with patch.object(isolation.os,'getgrouplist',side_effect=lambda n,g:[g,1000]):
                with self.assertRaisesRegex(ValueError,'membership'):isolation.observe_identities(expected)
            with patch.object(isolation.grp,'getgrgid',return_value=types.SimpleNamespace(gr_name='another-name')):
                with self.assertRaisesRegex(ValueError,'group identity'):isolation.observe_identities(expected)
        for group in (0,4,27,125,1000,914):
            bad=copy.deepcopy(expected);bad['users']['ss-api']['groups']=sorted([910,group])
            with self.assertRaises(ValueError):isolation.validate_identities(bad)
        bad=copy.deepcopy(expected);bad['users']['ss-api']['groups']=[910]
        with self.assertRaises(ValueError):isolation.validate_identities(bad)


    def test_expiry_after_last_custody_read_blocks_acl_and_resume_effects(self):
        before=code_custody();after=isolation.planned_custody(before)
        expired={'value':False}
        def collect(root):expired['value']=True;return before
        def gate():
            if expired['value']:raise ValueError('authority expired after inventory')
        with patch.object(isolation.os,'geteuid',return_value=0),patch.object(isolation,'collect_custody',side_effect=collect),patch.object(isolation.os,'open',side_effect=AssertionError('ACL open after expiry')),patch.object(isolation.os,'setxattr',create=True,side_effect=AssertionError('ACL write after expiry')):
            with self.assertRaisesRegex(ValueError,'expired after inventory'):isolation.apply_custody('/fixture',before,after,gate)
        for name,mode in [('handoff-presentation','presentation-only'),('handoff-schema','schema-changing')]:
            module,_=load_adapter(name,isolated_profile(mode),self.directory);module.a={'fixture':True}
            checks={'count':0}
            def window(*args):
                checks['count']+=1
                if checks['count']>1:raise ValueError('authority expired after exact read')
            with patch.object(module._profile,'current_window',side_effect=window),patch.object(module,'exact'),patch.object(Path,'unlink',side_effect=AssertionError('hold release after expiry')),patch.object(module,'reload',side_effect=AssertionError('reload after expiry')):
                with self.assertRaisesRegex(ValueError,'expired after exact'):module.release([module.API])
            with patch.object(module._profile,'current_window',side_effect=ValueError('expired')),patch.object(module.subprocess,'run',side_effect=AssertionError('start after expiry')):
                with self.assertRaisesRegex(ValueError,'expired'):module.control(module.API,'start')
            # A failed-start safety stop remains available after expiry.
            with patch.object(module._profile,'current_window',side_effect=ValueError('expired')),patch.object(module.subprocess,'run') as run:
                module.control(module.API,'stop');run.assert_called_once()


    def test_pre_gateway_readiness_uses_direct_api_only_in_isolation_mode(self):
        for mode,suffix in [('presentation-only','presentation'),('schema-changing','schema')]:
            for p,port in [(profile(mode),8081),(isolated_profile(mode),18988)]:
                module,_=load_adapter('handoff-'+suffix,p,self.directory)
                body={'ready':True,'release':{'candidateCommitSha':p['candidate'],'candidateTreeSha':p['tree'],'migrationCount':114}}
                def respond(request,timeout):
                    self.assertEqual(request.full_url,'http://127.0.0.1:'+str(port)+'/api/v1/ready')
                    self.assertEqual(timeout,5)
                    return io.BytesIO(json.dumps(body).encode())
                with patch.object(module.urllib.request,'urlopen',side_effect=respond):
                    self.assertEqual(module.ready(p['candidate'],114,p['tree']),body['release'])
                    with self.assertRaises(RuntimeError):module.ready(p['priorCandidate'],114,p['priorTree'])


    def test_expiry_during_fsync_keeps_original_and_noncolliding_rollback_temporary(self):
        for mode,name in [('presentation-only','install-presentation'),('schema-changing','install-schema')]:
            module,_=load_adapter(name,isolated_profile(mode),self.directory)
            directory=self.directory/name;directory.mkdir();destination=directory/'config';destination.write_bytes(b'old')
            metadata={'mode':0o600,'uid':os.getuid(),'gid':os.getgid()};expired={'value':False}
            real_fsync=os.fsync
            def syncing(fd):real_fsync(fd);expired['value']=True
            def gate():
                if expired['value']:raise ValueError('expired during fsync')
            with patch.object(module.os,'fsync',side_effect=syncing):
                with self.assertRaisesRegex(ValueError,'expired during fsync'):module.atomic(destination,b'new',metadata,gate)
            self.assertEqual(destination.read_bytes(),b'old')
            retained=destination.with_name(destination.name+'.native-release-update-'+module.sha(b'new')+'.tmp')
            self.assertEqual(retained.read_bytes(),b'new')
            module.atomic(destination,b'old',metadata,lambda:None)
            self.assertEqual(destination.read_bytes(),b'old');self.assertTrue(retained.exists())
            # A temporary next-C pointer does not collide with explicit prior-C restore.
            module.BASE=directory;target=directory/('a'*40);prior=directory/('c'*40)
            (directory/'current').symlink_to(prior)
            with self.assertRaisesRegex(ValueError,'expired'):module.pointer(target,metadata,lambda:(_ for _ in ()).throw(ValueError('expired')))
            self.assertEqual(os.readlink(directory/'current'),str(prior))
            module.pointer(prior,metadata,lambda:None)
            self.assertTrue((directory/('current.native-release-update-'+target.name+'.tmp')).is_symlink())


    def test_static_custody_uses_only_finite_paths_and_pins_nonroot_tool_acl(self):
        policy=isolation_policy();tool='/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node'
        expected=static_meta(uid=1000,gid=1000,mode=0o750)
        expected['acl']={'extended':True,'entries':[[1,7,4294967295],[4,0,4294967295],[8,5,915],[16,5,4294967295],[32,0,4294967295]]}
        policy['staticFiles'][tool]=expected;isolation.validate_policy(policy)
        omitted=copy.deepcopy(policy);omitted['staticFiles'].pop(tool)
        with self.assertRaisesRegex(ValueError,'complete finite'):isolation.validate_policy(omitted)
        for name in ('/etc/sitesourcery/arbitrary','/etc/systemd/system/sitesourcery-hq-api.service',
                     '/home/mrfantasea/.ssh/id_ed25519','/var/lib/sitesourcery-storage/../private'):
            bad=copy.deepcopy(policy);bad['staticFiles'][name]=static_meta()
            with self.assertRaisesRegex(ValueError,'static'):isolation.validate_policy(bad)
        for mutate in (lambda v:v.update(uid=910),lambda v:v.update(nlink=2),lambda v:v.update(mode=0o770),
                       lambda v:v['acl']['entries'][2].__setitem__(1,7)):
            bad=copy.deepcopy(expected);mutate(bad)
            with self.assertRaises(ValueError):isolation.validate_static_metadata(bad)
        # ACL drift changes policy even when the historical metadata-only file tuple is identical.
        changed=copy.deepcopy(expected);changed['acl']['entries'][2][2]=916
        self.assertEqual({k:v for k,v in expected.items() if k!='acl'},{k:v for k,v in changed.items() if k!='acl'})
        self.assertNotEqual(isolation.sha(isolation.encoded(expected)),isolation.sha(isolation.encoded(changed)))

    def test_actual_postgresql_configuration_and_override_are_required_static_custody(self):
        policy=isolation_policy()
        paths=['/home/mrfantasea/.local/share/sitesourcery-production-postgresql-16.14/data/'+name
               for name in ('postgresql.conf','pg_hba.conf','pg_ident.conf')]
        paths.append('/home/mrfantasea/.config/systemd/user/sitesourcery-production-postgresql.service.d/99-runtime-isolation.conf')
        for name in paths:
            self.assertIn(name,policy['staticFiles'])
            bad=copy.deepcopy(policy);del bad['staticFiles'][name]
            with self.assertRaisesRegex(ValueError,'complete finite'):isolation.validate_policy(bad)
        for name in paths[:3]:policy['staticFiles'][name]=static_meta(uid=1000,gid=1000,mode=0o600)
        policy['staticFiles'][paths[3]]=static_meta(uid=1000,gid=1000,mode=0o644)
        isolation.validate_policy(policy)

    def test_socket_identity_is_exact_single_or_dual_according_to_isolation_mode(self):
        legacy='/run/user/1000/sitesourcery-production-postgresql'
        dual=legacy+',/run/sitesourcery-database'
        for mode in ('presentation-only','schema-changing'):
            for make,expected in ((profile,legacy),(isolated_profile,dual)):
                p=make(mode);contract.validate_profile(p)
                self.assertEqual(p['databaseIdentity']['sockets'],expected)
                for sockets in (dual if expected==legacy else legacy,'/run/sitesourcery-database',
                                '/run/sitesourcery-database,'+legacy,legacy+', /run/sitesourcery-database',
                                dual+',/tmp/extra'):
                    bad=copy.deepcopy(p);bad['databaseIdentity']['sockets']=sockets
                    with self.assertRaisesRegex(ValueError,'database endpoint'):contract.validate_profile(bad)

    def test_active_readiness_operand_is_exact_confirmed_twentieth_in_both_handoffs(self):
        helper='/usr/local/libexec/sitesourcery-worker-readiness-20261020/wait-api-ready.mjs'
        command='/home/mrfantasea/.local/share/sitesourcery-recovery-runtime-20261003/node '+helper
        for vectors,valid in (([command],True),([],False),([command.replace('20261020','20261016')],False),
                              ([command,command],False),([command+'-unexpected'],False)):
            raw='ExecStartPre='+' '.join('{ path=/node ; argv[]='+v+' ; ignore_errors=no ; }' for v in vectors)+'\n'
            with patch.object(isolation.subprocess,'check_output',return_value=raw) as call:
                if valid:isolation.verify_readiness_operand()
                else:
                    with self.assertRaisesRegex(ValueError,'readiness operand'):isolation.verify_readiness_operand()
                self.assertEqual(call.call_args.args[0],['/usr/bin/systemctl','show','sitesourcery-hq-workers.service','--property=ExecStartPre'])
        for filename in ('handoff-presentation.py','handoff-schema.py'):
            source=(HERE/filename).read_text()
            line=next(line for line in source.splitlines() if line.startswith('READY_FILES='))
            self.assertEqual(line,"READY_FILES=[_isolation.READINESS_HELPER,'/etc/systemd/system/sitesourcery-hq-workers.service.d/99-api-readiness-wait.conf']")
            self.assertIn(' _isolation.verify_readiness_operand()\n',source)


    def test_native_policy_and_marker_are_classic_and_owner_readable(self):
        p=isolated_profile();policy=isolation_policy();binding=isolation_binding(p,policy,{'path':'/original','sha256':'3'*64},isolation.planned_custody(code_custody()))
        raw=isolation.encoded(binding)
        good=types.SimpleNamespace(st_uid=0,st_gid=1000,st_mode=stat.S_IFREG|0o640)
        with patch.object(isolation.os.path,'lexists',return_value=True),patch.object(Path,'lstat',return_value=good),patch.object(isolation,'read_acl',return_value={'extended':False}),patch.object(isolation,'pinned',return_value=policy),patch.object(isolation,'read_bytes',return_value=raw):
            self.assertEqual(isolation.native_context(p,isolation.sha(raw))[1],binding)
            for info in (types.SimpleNamespace(st_uid=1000,st_gid=1000,st_mode=stat.S_IFREG|0o640),types.SimpleNamespace(st_uid=0,st_gid=0,st_mode=stat.S_IFREG|0o640),types.SimpleNamespace(st_uid=0,st_gid=1000,st_mode=stat.S_IFREG|0o600)):
                with patch.object(Path,'lstat',return_value=info):
                    with self.assertRaisesRegex(ValueError,'owner-readable'):isolation.native_context(p)
            with patch.object(isolation,'read_acl',return_value={'extended':True}):
                with self.assertRaisesRegex(ValueError,'owner-readable'):isolation.native_context(p)


    def observation_output(self, overrides=None, omitted=()):
        values={name:'' for name in isolation.PROPERTIES}
        values.update(ExecStart='{ path=/fixture/node ; argv[]=/fixture/node /fixture/app ; pid=123 ; }',
                      ExecStartPre='', After='z.service a.service', Requires='z.service a.service')
        values.update(overrides or {})
        return '\n'.join(k+'='+v for k,v in values.items() if k not in omitted)+'\n'

    def test_observation_keeps_ordered_repeated_arrays(self):
        first='{ path=/guard ; argv[]=/guard one ; pid=1 ; }'
        second='{ path=/ready ; argv[]=/ready two ; pid=2 ; }'
        raw=self.observation_output({'ExecStartPre':first,'EnvironmentFiles':'/first (ignore_errors=no)'})
        raw+='ExecStartPre='+second+'\nEnvironmentFiles=/second (ignore_errors=no)\n'
        with patch.object(isolation.subprocess,'check_output',return_value=raw) as call:
            result=isolation.effective_units()
        self.assertEqual(call.call_count,4)
        for unit in result.values():
            self.assertEqual(unit['ExecStartPre'],['/guard one ','/ready two '])
            self.assertEqual(unit['EnvironmentFiles'],'/first (ignore_errors=no) /second (ignore_errors=no)')

    def test_observation_missing_arrays_require_exact_typed_bus_reads(self):
        raw=self.observation_output(omitted=('EnvironmentFiles','ExecStartPre'))
        def response(argv,**kwargs):
            if argv[0]=='/usr/bin/systemctl':return raw
            self.assertEqual(argv[:5],['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1'])
            self.assertEqual(argv[5],'/org/freedesktop/systemd1/unit/sitesourcery_2dhq_2dgateway_2eservice')
            self.assertEqual(argv[6],'org.freedesktop.systemd1.Service')
            return json.dumps({'type':{'EnvironmentFiles':'a(sb)','ExecStartPre':'a(sasbttttuii)'}[argv[-1]],'data':[]})
        with patch.object(isolation.subprocess,'check_output',side_effect=response) as call:
            value=isolation.systemd_properties('sitesourcery-hq-gateway.service')
        self.assertEqual(call.call_count,3);self.assertEqual(value['ExecStartPre'],'');self.assertEqual(value['EnvironmentFiles'],'')

    def test_observation_rejects_unproved_or_nonempty_omission(self):
        raw=self.observation_output(omitted=('EnvironmentFiles',))
        for value in ({'type':'a(sb)','data':[['/secret',False]]},{'type':'as','data':[]},
                      {'type':'a(sb)','data':None},{'type':'a(sb)','data':[],'extra':True},[], 'not-json'):
            response=value if isinstance(value,str) else json.dumps(value)
            with patch.object(isolation.subprocess,'check_output',side_effect=[raw,response]):
                with self.assertRaises(ValueError):isolation.systemd_properties(isolation.UNITS[0])

    def test_observation_rejects_duplicate_scalars_and_empty_mixed_arrays(self):
        for tail in ('User=ss-api\n','ExecStartPre=\n','EnvironmentFiles=/other\n','Unknown=thing\n','malformed\n'):
            with patch.object(isolation.subprocess,'check_output',return_value=self.observation_output()+tail) as call:
                with self.assertRaises(ValueError):isolation.systemd_properties(isolation.UNITS[0])
                self.assertEqual(call.call_count,1)

    def test_observation_missing_scalar_or_execstart_never_defaults(self):
        for name in ('User','NoNewPrivileges','ExecStart'):
            with patch.object(isolation.subprocess,'check_output',return_value=self.observation_output(omitted=(name,))) as call:
                with self.assertRaisesRegex(ValueError,'incomplete'):isolation.systemd_properties(isolation.UNITS[0])
                self.assertEqual(call.call_count,1)

    def test_observation_sorts_dependencies_without_dropping_names(self):
        for raw in (self.observation_output({'After':'z a a','Requires':'z a'}),
                    self.observation_output({'After':'a z a','Requires':'a z'})):
            with patch.object(isolation.subprocess,'check_output',return_value=raw):
                value=isolation.systemd_properties(isolation.UNITS[0])
            self.assertEqual(value['After'],'a a z');self.assertEqual(value['Requires'],'a z')

    def test_observation_repeated_readiness_commands_cannot_hide_earlier_operand(self):
        old=isolation.READINESS_HELPER.replace('20261020','20261016')
        raw='ExecStartPre={ path=/node ; argv[]=/node '+old+' ; }\n'
        raw+='ExecStartPre={ path=/node ; argv[]=/node '+isolation.READINESS_HELPER+' ; }\n'
        with patch.object(isolation.subprocess,'check_output',return_value=raw):
            with self.assertRaisesRegex(ValueError,'readiness operand'):isolation.verify_readiness_operand()

    def test_observation_dbus_failure_and_unregistered_commands_fail_closed(self):
        with patch.object(isolation.subprocess,'check_output',side_effect=[self.observation_output(omitted=('EnvironmentFiles',)),OSError('bus unavailable')]):
            with self.assertRaises(OSError):isolation.systemd_properties(isolation.UNITS[0])
        for unit,names in (('unrelated.service',isolation.PROPERTIES),(isolation.UNITS[0],('User',)),
                           ('sitesourcery-hq-gateway.service',('ExecStartPre',))):
            with patch.object(isolation.subprocess,'check_output',side_effect=AssertionError('command must not run')):
                with self.assertRaisesRegex(ValueError,'unregistered'):isolation.systemd_properties(unit,names)


if __name__ == '__main__':
    unittest.main()
