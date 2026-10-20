#!/usr/bin/env python3
"""One entry point for a single explicitly selected native release boundary."""
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sitesourcery_release_profile', HERE / 'profile.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def main():
    contract.require(len(sys.argv) >= 4, 'run.py PROFILE SHA256 ACTION [ACTION INPUTS]')
    filename, digest, action, *args = sys.argv[1:]
    profile = contract.load_profile(filename, digest)
    mode = 'presentation' if profile['mode'] == 'presentation-only' else 'schema'
    paths = contract.derived(profile)
    actions = {
        'prepare-stage': ('prepare-stage.py', [], 3),
        'stage': ('stage.py', [], 3),
        'observe': ('install-' + mode + '.py', ['observe'], 2),
        'observe-handoff': ('handoff-' + mode + '.py', ['observe'], 0),
        'hold-initial': ('handoff-' + mode + '.py', ['initial'], 2),
        'install': ('install-' + mode + '.py', ['apply'], 2),
        'resume-api': ('handoff-' + mode + '.py', ['resume-api'], 2),
        'resume-runtime': ('handoff-' + mode + '.py', ['resume-runtime'], 2),
        'accept-runtime': ('accept-' + mode + '.py', [], 1),
        'resume-admission': ('handoff-' + mode + '.py', ['resume-admission'], 2),
    }
    if mode == 'presentation':
        actions.update({
            'observe-schema': ('install-presentation.py', ['observe-schema'], 2),
            'rehold': ('handoff-presentation.py', ['rehold'], 2),
            'rollback': ('install-presentation.py', ['rollback'], 2),
            'restore-api': ('handoff-presentation.py', ['restore-api'], 2),
            'restore-runtime': ('handoff-presentation.py', ['restore-runtime'], 2),
            'accept-restored-runtime': ('accept-presentation.py', [], 1),
            'restore-admission': ('handoff-presentation.py', ['restore-admission'], 2),
        })
    else:
        actions.update({
            'hold-final': ('handoff-schema.py', ['final'], 2),
            'migrate-once': ('migrate-once.mjs', ['--apply-once'], 1),
        })
    if action == 'describe':
        contract.require(not args, 'describe takes no action inputs')
        files = sorted(p for p in HERE.iterdir() if p.suffix in ['.py', '.mjs'])
        print(json.dumps({'schema': 'sitesourcery.native-release-description/v1',
                          'mode': profile['mode'], 'candidate': profile['candidate'],
                          'profile': {'path': filename, 'sha256': digest},
                          'paths': paths, 'actions': sorted(actions), 'nativeEffects': False,
                          'helpers': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}))
        return
    contract.require(action in actions, 'action is not available for this release mode')
    adapter, prefix, count = actions[action]
    contract.require(len(args) == count, 'wrong action input count')
    suffix = ['prior'] if action == 'accept-restored-runtime' else []
    executable = profile['runtime']['node'] if adapter.endswith('.mjs') else sys.executable
    isolation = [] if adapter.endswith('.mjs') else ['-I', '-B']
    # exec does not retry, auto-advance a phase, or perform an automatic rollback.
    os.execv(executable, [executable, *isolation, str(HERE / adapter), filename, digest, *prefix, *args, *suffix])


if __name__ == '__main__':
    main()
