"""Disposable, isolated adapter tests. No production paths, service calls or SQL."""
import copy
import datetime
import hashlib
import importlib.util
import json
import os
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


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ss-native-contract-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()

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


if __name__ == '__main__':
    unittest.main()
