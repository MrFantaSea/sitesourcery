"""Typed data for the fixed HQ topology. Loading a profile performs no native action."""
import datetime
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

PURPOSES = {'export', 'cancellation', 'notification-mail', 'alakazam-fulfillment',
            'alakazam-publication', 'alakazam-retained-lifecycle', 'responder-fulfillment',
            'provider-reconciliation', 'responder-retention', 'project-lifecycle',
            'domain-lifecycle', 'care-lifecycle'}
SYSTEM = ['tenant.service', 'workers.service', 'cloudflared.service', 'backup.timer',
          'monitor.timer', 'monitor.service', 'api.service', 'backup.service', 'backup-recovery.service']
PRIVATE = ['client-profile-hub.service', 'client-profile-hub-backup.service',
           'client-profile-hub-morning-research.service', 'client-profile-hub-backup.timer',
           'client-profile-hub-morning-research.timer']


def require(value, message):
    if not value:
        raise ValueError(message)


def keys(value, expected, label):
    require(type(value) is dict and set(value) == set(expected.split()), label + ': unknown/missing field')


def digest(value, length=64):
    require(type(value) is str and re.fullmatch('[a-f0-9]{%d}' % length, value), 'invalid digest')


def absolute(value):
    require(type(value) is str and value.startswith('/') and str(Path(value)) == value
            and '..' not in Path(value).parts, 'noncanonical absolute path')


def integer(value, minimum=1):
    require(type(value) is int and value >= minimum, 'invalid integer')


def validate_profile(p):
    keys(p, 'schema mode cohort candidate tree priorCandidate priorTree expectedSchema workerPurposes '
            'careMode workerCareMode owner runtime databaseIdentity collectorFiles expectedCapabilities '
            'baselineConfiguration migration', 'profile')
    require(p['schema'] == 'sitesourcery.native-release-profile/v1', 'unknown profile schema')
    require(p['mode'] in ['presentation-only', 'schema-changing'], 'unknown release mode')
    require(re.fullmatch('[a-z][a-z0-9-]{2,63}', p['cohort'] or ''), 'invalid cohort')
    for name in ['candidate', 'tree', 'priorCandidate', 'priorTree']:
        digest(p[name], 40)
    require(p['candidate'] != p['priorCandidate'], 'candidate equals predecessor')
    s = p['expectedSchema']
    keys(s, 'beforeCount afterCount beforeTableCount afterTableCount schemaSha256 manifestSha256', 'schema')
    for name in ['beforeCount', 'afterCount', 'beforeTableCount', 'afterTableCount']:
        integer(s[name])
    digest(s['schemaSha256']); digest(s['manifestSha256'])
    if p['mode'] == 'presentation-only':
        require(s['beforeCount'] == s['afterCount'] and s['beforeTableCount'] == s['afterTableCount'],
                'presentation release cannot change schema')
        require(p['migration'] is None, 'presentation release cannot migrate')
    else:
        require(s['afterCount'] > s['beforeCount'], 'schema release must append migrations')
        m = p['migration']
        keys(m, 'addedEmptyRelations reservedRollbackNames nodeSha256 nodeBytes storageGuardSha256 storageManifestSha256', 'migration')
        for name in ['nodeSha256', 'storageGuardSha256', 'storageManifestSha256']:
            digest(m[name])
        integer(m['nodeBytes'])
        require(type(m['addedEmptyRelations']) is list and len(set(m['addedEmptyRelations'])) == len(m['addedEmptyRelations']), 'duplicate added relation')
        require(all(type(n) is str and re.fullmatch('[a-z_][a-z0-9_]*[.][a-z_][a-z0-9_]*', n) for n in m['addedEmptyRelations']), 'invalid added relation')
        require(s['afterTableCount'] == s['beforeTableCount'] + len(m['addedEmptyRelations']), 'additive table contract mismatch')
        require(type(m['reservedRollbackNames']) is list and len(m['reservedRollbackNames']) == 2
                and len(set(m['reservedRollbackNames'])) == 2
                and all(type(n) is str and re.fullmatch('ss_[a-z0-9_]{1,59}', n) for n in m['reservedRollbackNames']), 'invalid rollback reservation')
    purposes = p['workerPurposes']
    require(type(purposes) is list and 'export' in purposes and set(purposes) <= PURPOSES
            and len(purposes) == len(set(purposes)), 'invalid worker purpose inventory')
    for name in ['careMode', 'workerCareMode']:
        require(p[name] in ['held', 'approved_live'], 'invalid Care mode')
    keys(p['owner'], 'userId organizationId', 'owner')
    for value in p['owner'].values():
        require(type(value) is str and re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', value), 'invalid owner identity')
    keys(p['runtime'], 'node nodeVersion sharpVersion', 'runtime')
    require(p['runtime']['node'].startswith('/home/mrfantasea/.local/share/sitesourcery-'), 'unreviewed runtime root')
    absolute(p['runtime']['node'])
    require(re.fullmatch('v[0-9]+[.][0-9]+[.][0-9]+', p['runtime']['nodeVersion'] or ''), 'invalid node version')
    require(re.fullmatch('[0-9]+[.][0-9]+[.][0-9]+', p['runtime']['sharpVersion'] or ''), 'invalid sharp version')
    db = p['databaseIdentity']
    keys(db, 'db databaseOid username directory port sockets', 'database identity')
    require(db['db'] == 'sitesourcery_production' and db['username'] == 'mrfantasea'
            and db['port'] == '55433' and db['sockets'] == '/run/user/1000/sitesourcery-production-postgresql', 'unreviewed database endpoint')
    require(re.fullmatch('[1-9][0-9]*', db['databaseOid'] or ''), 'invalid database oid')
    absolute(db['directory'])
    require(db['directory'].startswith('/home/mrfantasea/.local/share/sitesourcery-production-postgresql-')
            and db['directory'].endswith('/data'), 'unreviewed database storage')
    keys(p['collectorFiles'], 'ops/fin008-data-convergence.mjs ops/immutable-evidence.mjs', 'schema collector')
    for value in p['collectorFiles'].values(): digest(value)
    keys(p['expectedCapabilities'], 'downloadQuote downloadPayment alakazamQuote alakazamCheckout alakazamDowngrade alakazamPublication careCatalog mailProviderEvents', 'capability baseline')
    require(type(p['expectedCapabilities']['careCatalog']) is dict and p['expectedCapabilities']['careCatalog'], 'Care catalog baseline required')
    require(all(type(v) is bool for k,v in p['expectedCapabilities'].items() if k != 'careCatalog'), 'capability booleans required')
    require(all(type(k) is str and re.fullmatch('[a-zA-Z][a-zA-Z0-9]*', k) for k in p['expectedCapabilities']), 'invalid capability key')
    require(len(json.dumps(p['expectedCapabilities'])) < 32768, 'capability baseline too large')
    keys(p['baselineConfiguration'], '/etc/sitesourcery/hosted.env /etc/sitesourcery/workers.env /etc/sitesourcery/WORKERS_APPROVED', 'configuration baseline')
    for value in p['baselineConfiguration'].values(): digest(value)
    return p


def read_pinned(filename, sha256):
    absolute(filename); digest(sha256)
    p = Path(filename); st = p.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_size <= 32 * 1024 * 1024
            and p.resolve() == p, 'unsafe input custody')
    raw = p.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == sha256, 'input digest changed')
    return json.loads(raw)


def load_profile(filename, sha256, mode=None):
    p = validate_profile(read_pinned(filename, sha256))
    require(mode is None or p['mode'] == mode, 'adapter mode mismatch')
    return p


def derived(p):
    cohort = p['cohort']
    marker = '/etc/sitesourcery/' + cohort.upper().replace('-', '_') + '_HANDOFF_HOLD'
    drop = 'zz-' + cohort + '-handoff-hold.conf'
    paths = [marker] + ['/etc/systemd/system/sitesourcery-hq-' + n + '.d/' + drop for n in SYSTEM]
    if p['mode'] == 'schema-changing':
        paths += ['/home/mrfantasea/.config/systemd/user/' + n + '.d/' + drop for n in PRIVATE]
    return {'marker': marker, 'dropin': drop, 'markerText': 'Site Sourcery ' + cohort + ' handoff\n',
            'holdPaths': paths, 'journal': '/var/lib/sitesourcery-' + cohort + '-handoff',
            'installation': '/var/lib/sitesourcery-' + cohort + '-update-' + p['candidate'],
            'readinessSnapshot': '/etc/sitesourcery/recovery/' + cohort + '-readiness',
            'migrationEvidence': 'evidence-' + cohort,
            'migrationUnit': 'sitesourcery-' + cohort + '-production-upgrade.service'}


def bind_operation(a, p, profile_ref):
    require(a.get('profile') == profile_ref, 'operation profile binding changed')
    for name in ['candidate', 'tree', 'priorCandidate', 'priorTree']:
        if name in a: require(a[name] == p[name], 'operation identity mismatch: ' + name)
    if 'databaseIdentity' in a: require(a['databaseIdentity'] == p['databaseIdentity'], 'database binding changed')
    if 'baseline' in a:
        require(a['baseline']['workerPurposes'] == p['workerPurposes'], 'worker baseline changed')
    if 'holdPaths' in a: require(set(a['holdPaths']) == set(derived(p)['holdPaths']), 'hold scope changed')


def current_window(a, seconds=1800):
    issued = datetime.datetime.fromisoformat(a['issuedAt'].replace('Z', '+00:00'))
    expires = datetime.datetime.fromisoformat(a['expiresAt'].replace('Z', '+00:00'))
    require(issued <= datetime.datetime.now(datetime.timezone.utc) < expires
            <= issued + datetime.timedelta(seconds=seconds), 'current finite authority required')


def verify_bundle(a, directory):
    files = sorted(p.name for p in directory.iterdir() if p.suffix in ['.py', '.mjs'])
    require(set(a.get('helpers', {})) == set(files), 'complete adapter bundle hashes required')
    for name in files:
        p = directory / name; st = p.lstat()
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_uid == 0
                and not st.st_mode & 0o022, 'adapter bundle custody changed')
        require(hashlib.sha256(p.read_bytes()).hexdigest() == a['helpers'][name], 'adapter drift: ' + name)


def authority_reference(receipt, name):
    refs = []
    if name in receipt: refs.append(receipt[name])
    if name in receipt.get('evidence', {}): refs.append(receipt['evidence'][name])
    if name == 'productionReceipt':
        refs += [v for k, v in receipt.items() if re.fullmatch(r'production[0-9]+Receipt', k)]
    require(refs and all(v == refs[0] for v in refs), 'missing/conflicting authority reference: ' + name)
    return refs[0]


def worker_cycle_ok(event, purpose):
    if (event.get('event') != 'sitesourcery.worker.' + purpose or event.get('state') != 'running'
            or type(event.get('cycle')) is not int or event['cycle'] <= 0 or event.get('errorCode')):
        return False
    if purpose == 'notification-mail':
        result = event.get('result')
        return (type(result) is dict and all(type(result.get(k)) is int and result[k] >= 0
                for k in ['selected', 'accepted', 'alreadyRecorded', 'busy', 'expired'])
                and sum(result[k] for k in ['accepted', 'alreadyRecorded', 'busy', 'expired']) == result['selected'])
    return event.get('resultStatus') not in [None, 'held', 'error']


if __name__ == '__main__':
    require(len(sys.argv) == 3, 'profile.py PROFILE SHA256')
    print(json.dumps(load_profile(sys.argv[1], sys.argv[2])))
