import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import {
  validateNativeReleaseInput,
  constructNativeReleaseAuthority,
  emitNativeReleaseAuthority,
  assertSameSchemaWorkerChange,
} from '../native-release-authority.mjs';

const NOW = Date.parse('2026-10-20T18:10:00Z');
const sha = c => c.repeat(64);
function workerFixture() {
  const files = [
    { path: 'ops/deploy/hq/workers.env.example', sha256: sha('a'), byteCount: 10 },
    { path: 'server/hosted/bin/server.mjs', sha256: sha('b'), byteCount: 20 },
    { path: 'server/hosted/bin/worker.mjs', sha256: sha('c'), byteCount: 30 },
  ];
  const prior = { domain: 'origin-worker-runtime', files, fileCount: 3, byteCount: 60,
    sha256: sha('d'), contractSha256: sha('e'), contract: {
      activation: 'held', apiEntrypoint: { path: files[1].path, sha256: files[1].sha256 },
      workerEntrypoint: { path: files[2].path, sha256: files[2].sha256 },
      allowsProviderEffects: false, selectedPurposes: ['export'],
    } };
  const candidate = structuredClone(prior);
  candidate.files[1].sha256 = sha('f'); candidate.files[1].byteCount = 25;
  candidate.byteCount = 65; candidate.sha256 = sha('1'); candidate.contractSha256 = sha('2');
  candidate.contract.apiEntrypoint.sha256 = sha('f');
  const delta = { beforeSha256: prior.sha256, afterSha256: candidate.sha256, files: [{
    path: files[1].path, before: { sha256: sha('b'), byteCount: 20 },
    after: { sha256: sha('f'), byteCount: 25 },
  }] };
  return { prior, candidate, delta };
}
function input(mode = 'presentation-only') {
  const system = ['tenant', 'workers', 'cloudflared', 'backup.timer', 'monitor.timer',
    'monitor', 'api', 'backup', 'backup-recovery'].map(n =>
    'sitesourcery-hq-' + n + (n.endsWith('.timer') ? '' : '.service'));
  const marker = '/etc/sitesourcery/FIXTURE_HANDOFF_HOLD';
  const dropin = 'zz-fixture-handoff-hold.conf';
  const privateServices = ['client-profile-hub.service', 'client-profile-hub-backup.service',
    'client-profile-hub-morning-research.service'];
  const privateTimers = ['client-profile-hub-backup.timer', 'client-profile-hub-morning-research.timer'];
  const holds = [marker, ...system.map(n => `/etc/systemd/system/${n}.d/${dropin}`)];
  const baseline = {
    workerPurposes: ['export', 'notification-mail', 'care-lifecycle'],
    workerActivation: 'owner-approved', postgresql: {}, privateHqTimers: {},
  };
  const evidence = ['successorInput', 'ciFinalReceipt', 'githubRun', 'githubRawLog',
    'linuxStageReceipt', 'priorOriginSeal', 'priorInstalledReadback', 'priorEpoch',
    'nativeObservation', 'productionReceipt', 'productionMigrationInputs', 'configurationObservation'];
  if (mode === 'presentation-only') {
    baseline.privateHq = {};
    evidence.push('priorInstallationReceipt', 'schemaObservation');
  } else {
    baseline.privateHqServices = {};
    baseline.careMode = baseline.workerCareMode = 'approved_live';
    holds.push(...[...privateServices, ...privateTimers]
      .map(n => `/home/mrfantasea/.config/systemd/user/${n}.d/${dropin}`));
    evidence.push('coherentBackupReceipt', 'finalHoldsReceipt', 'combinedSmokeReceipt',
      'heldDatabaseFingerprint', 'rollbackReservationReceipt', 'configurationBoundaryReceipt');
  }
  baseline.holdFiles = Object.fromEntries(holds.map(p => [p, {
    uid: 0, gid: 0, mode: p === marker && mode === 'presentation-only' ? 0o600 : 0o644,
    bytes: 30, sha256: sha('d'),
  }]));
  return {
    schema: 'sitesourcery.native-release-authority-input/v1', mode,
    candidate: 'a'.repeat(40), tree: 'b'.repeat(40), priorCandidate: 'c'.repeat(40),
    priorTree: 'd'.repeat(40), workflowCommit: 'e'.repeat(40), workflowRun: '123', workflowAttempt: '1',
    emissionApproved: true, activationAllowed: false,
    issuedAt: '2026-10-20T18:00:00Z', expiresAt: '2026-10-20T18:25:00Z',
    helperRepository: '/tmp/fixture-repo', outputDirectory: '/tmp/fixture-output',
    databaseIdentity: { db: 'sitesourcery_production', databaseOid: '76816', username: 'mrfantasea',
      directory: '/tmp/fixture-db', port: '55433', sockets: '/run/user/1000/sitesourcery-production-postgresql' },
    expectedSchema: { beforeCount: mode === 'presentation-only' ? 110 : 109, afterCount: 110,
      manifestSha256: sha('a'), schemaSha256: sha('b'), tableCount: 309 },
    holdMarker: marker, holdDropin: dropin, baseline,
    evidence: Object.fromEntries(evidence.map(k => [k, { path: `/tmp/${k}.json`, sha256: sha('c') }])),
  };
}

test('both explicit modes accept typed inputs without hardcoded candidate or worker count', () => {
  for (const mode of ['presentation-only', 'schema-changing']) {
    const a = input(mode);
    assert.equal(validateNativeReleaseInput(a, NOW), a);
    a.baseline.workerPurposes.push('project-lifecycle');
    assert.equal(validateNativeReleaseInput(a, NOW), a);
  }
});
test('same-schema worker changes require exact reviewed source bindings and preserve contract semantics', () => {
  const { prior, candidate, delta } = workerFixture();
  assertSameSchemaWorkerChange(prior, structuredClone(prior));
  assertSameSchemaWorkerChange(prior, candidate, delta);
  assert.throws(() => assertSameSchemaWorkerChange(prior, candidate), /without pinned/);
  const a = input(); a.workerSourceDelta = delta;
  assert.equal(validateNativeReleaseInput(a, NOW), a);
  const schema = input('schema-changing'); schema.workerSourceDelta = delta;
  assert.throws(() => validateNativeReleaseInput(schema, NOW), /same-schema/);
});
test('worker delta refuses hidden file, permission contract, missing, stale and invented changes', () => {
  for (const change of [
    f => { f.candidate.files[0].sha256 = sha('3'); },
    f => { f.candidate.files.push({ path: 'new.mjs', sha256: sha('4'), byteCount: 4 }); },
    f => { f.candidate.files[2].sha256 = sha('4'); },
    f => { f.candidate.contract.allowsProviderEffects = true; },
    f => { f.candidate.contract.selectedPurposes.push('notification-mail'); },
    f => { f.candidate.byteCount++; },
    f => { f.delta.beforeSha256 = sha('5'); },
    f => { f.delta.afterSha256 = sha('5'); },
    f => { f.delta.files[0].after.byteCount++; },
    f => { f.delta.files[0].before.sha256 = sha('5'); },
    f => { f.delta.files[0].path = 'ops/deploy/hq/workers.env.example'; },
    f => { f.delta.files.push(structuredClone(f.delta.files[0])); },
    f => { f.delta.files = []; },
    f => { f.delta.unreviewed = true; },
  ]) {
    const fixture = workerFixture(); change(fixture);
    assert.throws(() => assertSameSchemaWorkerChange(fixture.prior, fixture.candidate, fixture.delta));
  }
});
test('unknown fields and typoed evidence roles fail closed', () => {
  for (const modify of [
    a => { a.canddiate = a.candidate; },
    a => { a.expectedSchema.schemaSHA256 = sha('b'); },
    a => { a.evidence.schemaObservation.extra = true; },
    a => { a.baseline.unreviewed = true; },
  ]) {
    const a = input(); modify(a);
    assert.throws(() => validateNativeReleaseInput(a, NOW), /unknown fields/);
  }
});
test('unknown modes, implicit mode changes and absent schema recovery evidence refuse', () => {
  const unknown = input(); unknown.mode = 'constructor';
  assert.throws(() => validateNativeReleaseInput(unknown, NOW), /Unknown release mode/);
  const changed = input(); changed.expectedSchema.afterCount++;
  assert.throws(() => validateNativeReleaseInput(changed, NOW));
  const missing = input('schema-changing'); delete missing.evidence.coherentBackupReceipt;
  assert.throws(() => validateNativeReleaseInput(missing, NOW), /unknown fields/);
  const missingHold = input('schema-changing');
  delete missingHold.baseline.holdFiles['/home/mrfantasea/.config/systemd/user/client-profile-hub.service.d/zz-fixture-handoff-hold.conf'];
  assert.throws(() => validateNativeReleaseInput(missingHold, NOW), /hold inventory/);
});
test('expired, future, malformed and overlong emission windows refuse', () => {
  for (const [issuedAt, expiresAt] of [
    ['2026-10-20T17:00:00Z', '2026-10-20T17:25:00Z'],
    ['2026-10-20T19:00:00Z', '2026-10-20T19:25:00Z'],
    ['invalid', '2026-10-20T18:25:00Z'],
    ['2026-10-20T18:00:00Z', '2026-10-20T19:25:00Z'],
  ]) {
    const a = input(); Object.assign(a, { issuedAt, expiresAt });
    assert.throws(() => validateNativeReleaseInput(a, NOW), /Emission authority/);
  }
});
test('candidate, digest, worker and native hold mistakes refuse', () => {
  for (const modify of [
    a => { a.tree = 'short'; },
    a => { a.candidate = a.priorCandidate; },
    a => { a.expectedSchema.manifestSha256 = 'not-a-digest'; },
    a => { a.baseline.workerPurposes.push('export'); },
    a => { a.baseline.holdFiles[a.holdMarker].uid = 1000; },
    a => { a.holdDropin = '../wrong.conf'; },
    a => { a.evidence.ciFinalReceipt.path = 'relative.json'; },
    a => { a.expectedSchema.afterCount = '110'; },
    a => { a.activationAllowed = true; },
  ]) {
    const a = input(); modify(a);
    assert.throws(() => validateNativeReleaseInput(a, NOW));
  }
});
test('bad input bytes, symlinks and expired authority create no output directory', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-native-authority-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const a = input(), output = path.join(dir, 'must-not-exist');
  a.outputDirectory = output;
  const file = path.join(dir, 'input.json'), raw = Buffer.from(JSON.stringify(a));
  await fs.writeFile(file, raw);
  const ref = { path: file, sha256: createHash('sha256').update(raw).digest('hex') };
  await assert.rejects(constructNativeReleaseAuthority({ ...ref, sha256: sha('0') }, { now: NOW }), /Anchored input drift/);
  const link = path.join(dir, 'link.json'); await fs.symlink(file, link);
  await assert.rejects(constructNativeReleaseAuthority({ ...ref, path: link }, { now: NOW }), /Invalid receipt file/);
  // Explicitly expired relative to wall clock, independently of the fixture clock.
  a.issuedAt = '2000-01-01T00:00:00Z'; a.expiresAt = '2000-01-01T00:25:00Z';
  const stale = Buffer.from(JSON.stringify(a)); await fs.writeFile(file, stale);
  await assert.rejects(emitNativeReleaseAuthority({ path: file,
    sha256: createHash('sha256').update(stale).digest('hex') }), /Emission authority/);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('isolated releases bind both policy digests and the additional gateway hold in either mode', () => {
  for (const mode of ['presentation-only', 'schema-changing']) {
    const a = input(mode);
    a.runtimeIsolation = { policySha256: sha('1'), priorAcceptanceSha256: sha('2') };
    a.databaseIdentity.sockets += ',/run/sitesourcery-database';
    const gateway = `/etc/systemd/system/sitesourcery-hq-gateway.service.d/${a.holdDropin}`;
    a.baseline.holdFiles[gateway] = { uid: 0, gid: 0, mode: 0o644, bytes: 30, sha256: sha('d') };
    assert.equal(validateNativeReleaseInput(a, NOW), a);
    assert.equal(Object.keys(a.baseline.holdFiles).length, mode === 'presentation-only' ? 11 : 16);
    delete a.baseline.holdFiles[gateway];
    assert.throws(() => validateNativeReleaseInput(a, NOW), /hold inventory/);
  }
});
test('isolation cannot add broad paths, omit policy bindings or masquerade as legacy authority', () => {
  for (const change of [
    a => { a.runtimeIsolation.policySha256 = 'bad'; },
    a => { delete a.runtimeIsolation.priorAcceptanceSha256; },
    a => { a.runtimeIsolation.extra = true; },
    a => { a.baseline.holdFiles['/etc/systemd/system/unregistered.service.d/hold.conf'] = a.baseline.holdFiles[a.holdMarker]; },
    a => { delete a.runtimeIsolation; },
  ]) {
    const a = input();
    a.runtimeIsolation = { policySha256: sha('1'), priorAcceptanceSha256: sha('2') };
    a.databaseIdentity.sockets += ',/run/sitesourcery-database';
    a.baseline.holdFiles[`/etc/systemd/system/sitesourcery-hq-gateway.service.d/${a.holdDropin}`] = {
      uid: 0, gid: 0, mode: 0o644, bytes: 30, sha256: sha('d'),
    };
    change(a);
    assert.throws(() => validateNativeReleaseInput(a, NOW));
  }
});
test('isolation never changes the finite emission or activation boundary', () => {
  const a = input();
  a.runtimeIsolation = { policySha256: sha('1'), priorAcceptanceSha256: sha('2') };
  a.databaseIdentity.sockets += ',/run/sitesourcery-database';
  a.baseline.holdFiles[`/etc/systemd/system/sitesourcery-hq-gateway.service.d/${a.holdDropin}`] = {
    uid: 0, gid: 0, mode: 0o644, bytes: 30, sha256: sha('d'),
  };
  a.activationAllowed = true;
  assert.throws(() => validateNativeReleaseInput(a, NOW));
  a.activationAllowed = false;
  assert.throws(() => validateNativeReleaseInput(a, NOW + 3600_000), /Emission authority/);
});

test('typed authority requires the exact single or dual socket identity for its mode', () => {
  const legacy = '/run/user/1000/sitesourcery-production-postgresql';
  const dual = legacy + ',/run/sitesourcery-database';
  for (const mode of ['presentation-only', 'schema-changing']) {
    for (const isolated of [false, true]) {
      const a = input(mode);
      if (isolated) {
        a.runtimeIsolation = { policySha256: sha('1'), priorAcceptanceSha256: sha('2') };
        a.baseline.holdFiles[`/etc/systemd/system/sitesourcery-hq-gateway.service.d/${a.holdDropin}`] = {
          uid: 0, gid: 0, mode: 0o644, bytes: 30, sha256: sha('d'),
        };
      }
      a.databaseIdentity.sockets = isolated ? dual : legacy;
      assert.equal(validateNativeReleaseInput(a, NOW), a);
      for (const sockets of [isolated ? legacy : dual, '/run/sitesourcery-database',
        '/run/sitesourcery-database,' + legacy, legacy + ', /run/sitesourcery-database', dual + ',/tmp/extra']) {
        assert.throws(() => validateNativeReleaseInput({ ...a,
          databaseIdentity: { ...a.databaseIdentity, sockets } }, NOW), /socket identity/);
      }
    }
  }
});

test('migration input connects only to the maintenance endpoint while retaining full observed socket identity', async () => {
  const source = await fs.readFile(new URL('../native-release/migrate-once.mjs', import.meta.url), 'utf8');
  // Execute the actual early endpoint guard without executing migration startup or I/O.
  const guards = source.split('\n').filter(line => line.startsWith('assert.deepEqual(input.database,'));
  assert.equal(guards.length, 1);
  assert.ok(source.includes('assert.deepEqual(identity,profile.databaseIdentity);'));
  const host = '/run/user/1000/sitesourcery-production-postgresql';
  for (const sockets of [host, host + ',/run/sitesourcery-database']) {
    const profile = { databaseIdentity: { sockets, port: '55433', username: 'mrfantasea',
      db: 'sitesourcery_production', directory: '/fixture/data' } };
    const database = { host, port: 55433, user: 'mrfantasea', database: 'sitesourcery_production',
      dataDirectory: '/fixture/data' };
    const execute = value => runInNewContext(`const profile=${JSON.stringify(profile)};
      const input=${JSON.stringify({ database: value })};\n${guards[0]}`, { assert }, { timeout: 1000 });
    execute(database);
    for (const badHost of [host + ',/run/sitesourcery-database', '/run/sitesourcery-database', '127.0.0.1']) {
      assert.throws(() => execute({ ...database, host: badHost }));
    }
  }
});
