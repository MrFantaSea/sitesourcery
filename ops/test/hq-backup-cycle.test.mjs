import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { beginBackupCycle, recoverBackupCycle, runBackupCycle, BACKUP_CYCLE_GROUP_SCHEMA } from "../backup-cycle.mjs";
import { createBackupPorts, createHqBackupPorts, HQ_BACKUP_MANAGED_UNITS, HQ_BACKUP_RUNTIME_UNIT, HQ_BACKUP_QUIESCE_PATH } from "../backup-ports.mjs";
import { assertHqBackupEnvironment, createHqBackupLifecycle, HQ_BACKUP_FAILURE_DOMAIN, HQ_BACKUP_STAGING_ROOT } from "../hq-backup-cycle.mjs";

const key = unit => `${unit.scope}:${unit.unit}`;
const absent = filename => assert.rejects(lstat(filename), error => error.code === "ENOENT");
async function fixture(t, { workersActive = true, ownerActive = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ss-hq-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const control = path.join(root, "protected-control");
  const stagingRoot = path.join(root, "staging");
  await Promise.all([mkdir(control, { mode: 0o700 }), mkdir(stagingRoot, { mode: 0o700 })]);
  const config = {
    runtimeUnit: HQ_BACKUP_RUNTIME_UNIT, sourceFailureDomainId: HQ_BACKUP_FAILURE_DOMAIN,
    fencePath: path.join(control, "BACKUP_QUIESCE"), statePath: path.join(control, "BACKUP_CYCLE_STATE.json"),
    stagingRoot, managedUnits: HQ_BACKUP_MANAGED_UNITS, uid: process.getuid(),
    now: () => new Date("2026-10-09T12:00:00.000Z"), snapshotIdFactory: () => "hq-backup-fixture"
  };
  const initial = [true, workersActive, ownerActive];
  const states = new Map(HQ_BACKUP_MANAGED_UNITS.map((unit, i) => [key(unit), initial[i] ? "active" : "inactive"]));
  const calls = [];
  const lifecycle = {
    async unitState(unit) { return states.get(key(unit)); },
    async stopUnit(unit) {
      // This assertion runs at the real mutation boundary, including partial stops.
      const state = JSON.parse(await readFile(config.statePath, "utf8"));
      assert.equal(state.schema, BACKUP_CYCLE_GROUP_SCHEMA);
      assert.deepEqual(state.runtimeStates, HQ_BACKUP_MANAGED_UNITS.map((unit, i) => ({ ...unit, wasActive: initial[i] })));
      assert.equal((await lstat(config.statePath)).mode & 0o777, 0o600);
      assert.equal(JSON.parse(await readFile(config.fencePath, "utf8")).writerFence, "engaged");
      calls.push(["stop", key(unit)]); states.set(key(unit), "inactive");
    },
    async startUnit(unit) {
      await absent(config.fencePath);
      calls.push(["start", key(unit)]); states.set(key(unit), "active");
    }
  };
  config.lifecycle = lifecycle;
  return { root, config, lifecycle, states, calls, initial };
}
function assertRestored(context) {
  assert.deepEqual([...context.states.values()], context.initial.map(value => value ? "active" : "inactive"));
}

test("HQ backup persists all prior states before stopping writers and leaves held workers and readers alone", async t => {
  const context = await fixture(t, { workersActive: false });
  const result = await runBackupCycle({ ...context.config, async backup() {
    assert.deepEqual([...context.states.values()], ["inactive", "inactive", "inactive"]);
    return { encrypted: true };
  } });
  assert.equal(result.ok, true); assertRestored(context);
  assert.deepEqual(context.calls, [
    ["stop", "user:client-profile-hub.service"], ["stop", "system:sitesourcery-hq-api.service"],
    ["start", "system:sitesourcery-hq-api.service"], ["start", "user:client-profile-hub.service"]
  ]);
  await Promise.all([absent(context.config.statePath), absent(context.config.fencePath)]);
});

test("backup failure restores all originally active writers and removes plaintext", async t => {
  const context = await fixture(t);
  const plaintext = path.join(context.config.stagingRoot, "sitesourcery-backup-failed");
  const failure = new Error("synthetic encrypted capture failure");
  await assert.rejects(runBackupCycle({ ...context.config, async backup() {
    await mkdir(plaintext); await writeFile(path.join(plaintext, "postgres.dump"), "fixture"); throw failure;
  } }), error => error === failure);
  assertRestored(context);
  assert.deepEqual(context.calls.filter(call => call[0] === "start").map(call => call[1]), HQ_BACKUP_MANAGED_UNITS.map(key));
  await Promise.all([absent(plaintext), absent(context.config.statePath)]);
});

test("a partial stop failure restores every prior active writer before returning the failure", async t => {
  const context = await fixture(t);
  const stop = context.lifecycle.stopUnit;
  context.lifecycle.stopUnit = async unit => {
    await stop(unit);
    if (unit.unit === "sitesourcery-hq-workers.service") throw new Error("synthetic partial stop");
  };
  await assert.rejects(beginBackupCycle(context.config), /synthetic partial stop/u);
  assertRestored(context);
  assert.equal(context.calls.filter(call => call[0] === "start").length, 3);
  await absent(context.config.statePath);
});

test("partial recovery attempts every writer and preserves state until a fresh process succeeds", async t => {
  const context = await fixture(t);
  await beginBackupCycle(context.config);
  const start = context.lifecycle.startUnit;
  context.lifecycle.startUnit = async unit => {
    if (unit.unit === HQ_BACKUP_RUNTIME_UNIT) { context.calls.push(["failed-start", key(unit)]); throw new Error("synthetic restart failure"); }
    await start(unit);
  };
  await assert.rejects(recoverBackupCycle(context.config), error => error.code === "BACKUP_CYCLE_RECOVERY_FAILED");
  assert.ok(context.calls.some(call => call[0] === "start" && call[1] === "user:client-profile-hub.service"));
  assert.ok(context.calls.some(call => call[0] === "start" && call[1] === "system:sitesourcery-hq-workers.service"));
  assert.equal((await lstat(context.config.statePath)).isFile(), true);
  await absent(context.config.fencePath);
  const restarted = { ...context.config, lifecycle: { ...context.lifecycle, startUnit: start } };
  await recoverBackupCycle(restarted);
  assertRestored(context); await absent(context.config.statePath);
});

test("interrupted recovery uses durable state without activating previously inactive owner or worker", async t => {
  const context = await fixture(t, { ownerActive: false, workersActive: false });
  await beginBackupCycle(context.config);
  const recovered = await recoverBackupCycle({ ...context.config, lifecycle: { ...context.lifecycle } });
  assert.equal(recovered.recovered, true); assertRestored(context);
  assert.equal(context.calls.filter(call => call[0] === "start").length, 1);
});

test("plaintext cleanup failure still restores writers and retains the recovery record", async t => {
  const context = await fixture(t);
  await beginBackupCycle(context.config);
  const unsafe = path.join(context.config.stagingRoot, "sitesourcery-backup-unsafe");
  await symlink(context.root, unsafe);
  await assert.rejects(recoverBackupCycle(context.config), error => error.code === "BACKUP_CYCLE_STAGING_INVALID");
  assertRestored(context);
  assert.equal((await lstat(context.config.statePath)).isFile(), true);
  await unlink(unsafe); await recoverBackupCycle(context.config); await absent(context.config.statePath);
});

test("tampered unit scope cannot substitute another recovery vector", async t => {
  const context = await fixture(t);
  await beginBackupCycle(context.config);
  const state = JSON.parse(await readFile(context.config.statePath, "utf8"));
  state.runtimeStates[1].scope = "user";
  await writeFile(context.config.statePath, JSON.stringify(state), { mode: 0o600 });
  await assert.rejects(recoverBackupCycle(context.config), error => error.code === "BACKUP_CYCLE_STATE_INVALID");
  assert.equal(context.calls.filter(call => call[0] === "start").length, 0);
  assert.equal((await lstat(context.config.statePath)).isFile(), true);
});

test("a held-state change disagrees with the pinned fence and cannot start a held worker", async t => {
  const context = await fixture(t, { workersActive: false });
  await beginBackupCycle(context.config);
  const state = JSON.parse(await readFile(context.config.statePath, "utf8"));
  state.runtimeStates[1].wasActive = true;
  await writeFile(context.config.statePath, JSON.stringify(state), { mode: 0o600 });
  await assert.rejects(recoverBackupCycle(context.config), error => error.code === "BACKUP_CYCLE_FENCE_INVALID");
  assert.equal(context.calls.filter(call => call[0] === "start").length, 0);
  assert.equal(context.states.get("system:sitesourcery-hq-workers.service"), "inactive");
});

test("failed or transitioning writers abort before state, fence or stop actions", async t => {
  const context = await fixture(t);
  context.states.set(key(HQ_BACKUP_MANAGED_UNITS[1]), "activating");
  await assert.rejects(beginBackupCycle(context.config), error => error.code === "BACKUP_CYCLE_RUNTIME_STATE_INVALID");
  assert.deepEqual(context.calls, []);
  await Promise.all([absent(context.config.statePath), absent(context.config.fencePath)]);
});

test("HQ control pins exact mixed scopes and never invokes root, a shell or an unknown unit", async () => {
  const calls = [];
  const lifecycle = createHqBackupLifecycle({ uid: 1000, commandRunner: { async run(command, args, options) {
    calls.push({ command, args, options }); return { stdout: "inactive\n" };
  } } });
  for (const unit of HQ_BACKUP_MANAGED_UNITS) {
    assert.equal(await lifecycle.unitState(unit), "inactive"); await lifecycle.stopUnit(unit); await lifecycle.startUnit(unit);
  }
  assert.equal(calls.length, 9);
  for (const call of calls) {
    assert.equal(call.command, "/usr/bin/systemctl");
    assert.ok(call.args.includes("--no-ask-password"));
    const user = call.args.at(-1) === "client-profile-hub.service";
    assert.equal(call.args.includes("--user"), user);
    assert.equal(call.options.env.DBUS_SESSION_BUS_ADDRESS, user ? "unix:path=/run/user/1000/bus" : undefined);
  }
  for (const unit of [
    { scope: "system", unit: "client-profile-hub.service" },
    { scope: "system", unit: "sitesourcery-hq-gateway.service" },
    { scope: "system", unit: "sitesourcery-hq-workers@export.service" },
    { scope: "user", unit: "sitesourcery-hq-api.service" }
  ]) await assert.rejects(lifecycle.startUnit(unit), error => error.code === "BACKUP_CYCLE_CONFIGURATION_INVALID");
  for (const uid of [0, 501, undefined]) assert.throws(() => createHqBackupLifecycle({ uid }), /reviewed non-root owner/u);
  assert.equal(calls.length, 9);
});

test("HQ quiesce rejects other database connections and any remaining private owner writer", async t => {
  const context = await fixture(t);
  await beginBackupCycle(context.config);
  let count = "1", queries = 0;
  const ports = createBackupPorts({
    sourceRoots: [], quiescePath: context.config.fencePath, sourceFailureDomainId: HQ_BACKUP_FAILURE_DOMAIN,
    databaseUrl: "postgresql://fixture@localhost/fixture", ageRecipientFile: "/unused-fixture", environment: {},
    runtimeUnit: HQ_BACKUP_RUNTIME_UNIT, systemctlPrefix: [], systemctlRuntimeDirectory: null,
    requiredMarkerUid: process.getuid(), managedUnits: HQ_BACKUP_MANAGED_UNITS,
    lifecycle: context.lifecycle, requireNoClientConnections: true,
    commandRunner: { async run(command, args) {
      assert.equal(command, "psql"); queries += 1;
      assert.match(args.at(-1), /backend_type = 'client backend'/u);
      assert.doesNotMatch(args.at(-1), /application_name/u);
      return { stdout: `${count}\n` };
    } }
  });
  await assert.rejects(ports.assertQuiesced(), error => error.code === "BACKUP_NOT_QUIESCED");
  count = "0";
  assert.equal((await ports.assertQuiesced()).databaseWriterCount, 0);
  context.states.set("user:client-profile-hub.service", "active");
  await assert.rejects(ports.assertQuiesced(), error => error.code === "BACKUP_NOT_QUIESCED");
  assert.equal(queries, 2);
  context.states.set("user:client-profile-hub.service", "inactive");
  const marker = JSON.parse(await readFile(context.config.fencePath, "utf8")); marker.snapshotId = "changed";
  await writeFile(context.config.fencePath, JSON.stringify(marker));
  await assert.rejects(ports.assertQuiesced(), error => error.code === "BACKUP_NOT_QUIESCED");
  assert.equal(queries, 2);
});

test("HQ environment and production port reject path, owner and failure-domain drift", () => {
  const environment = {
    SITESOURCERY_SOURCE_FAILURE_DOMAIN: HQ_BACKUP_FAILURE_DOMAIN,
    SITESOURCERY_BACKUP_STAGING_ROOT: HQ_BACKUP_STAGING_ROOT,
    SITESOURCERY_BACKUP_QUIESCE_PATH: HQ_BACKUP_QUIESCE_PATH
  };
  assert.doesNotThrow(() => assertHqBackupEnvironment(environment, 1000));
  for (const field of Object.keys(environment)) {
    assert.throws(() => assertHqBackupEnvironment({ ...environment, [field]: "/tmp/drift" }, 1000));
  }
  assert.throws(() => assertHqBackupEnvironment(environment, 0));
  assert.throws(() => createHqBackupPorts({ quiescePath: "/tmp/fence", uid: 1000 }));
});

test("held HQ templates keep static and tenant serving and grant only exact service actions", async () => {
  const read = name => readFile(new URL(`../deploy/hq/${name}`, import.meta.url), "utf8");
  const [backup, recovery, api, workers, tenant, gateway, owner, policy] = await Promise.all([
    "sitesourcery-hq-backup.service.held", "sitesourcery-hq-backup-recovery.service.held",
    "sitesourcery-hq-api.service.held", "sitesourcery-hq-workers.service.held", "sitesourcery-hq-tenant.service.held",
    "sitesourcery-hq-gateway.service.held", "client-profile-hub-backup-fence.conf.held", "49-sitesourcery-backup.rules.held"
  ].map(read));
  for (const source of [backup, recovery]) {
    assert.match(source, /^User=mrfantasea$/mu); assert.match(source, /^NoNewPrivileges=true$/mu);
    assert.match(source, /backup-control\/operations.lock/u); assert.match(source, /run-hq-backup-cycle.mjs recover/u);
    assert.doesNotMatch(source, /^Exec\S*=\+|sudo|User=root/mu);
  }
  assert.doesNotMatch(recovery, /ConditionPathIsMountPoint=.*off-machine|ReadWritePaths=.*off-machine/u);
  for (const source of [api, workers, owner]) assert.ok(source.includes(`ConditionPathExists=!${HQ_BACKUP_QUIESCE_PATH}`));
  for (const source of [tenant, gateway]) assert.doesNotMatch(source, /BACKUP_QUIESCE|(?:After|Requires|BindsTo)=.*sitesourcery-hq-api/u);
  let rule;
  vm.runInNewContext(policy, { polkit: { addRule(value) { rule = value; }, Result: { YES: "yes" } } });
  const action = (unit, verb, id = "org.freedesktop.systemd1.manage-units") => ({ id, lookup: key => ({ unit, verb })[key] });
  for (const unit of ["sitesourcery-hq-api.service", "sitesourcery-hq-workers.service"]) {
    for (const verb of ["start", "stop"]) assert.equal(rule(action(unit, verb), { user: "mrfantasea" }), "yes");
    for (const verb of ["restart", "reload", "enable", "set-property"]) assert.equal(rule(action(unit, verb), { user: "mrfantasea" }), undefined);
    assert.equal(rule(action(unit, "start"), { user: "other" }), undefined);
    assert.equal(rule(action(unit, "start", "org.freedesktop.systemd1.manage-unit-files"), { user: "mrfantasea" }), undefined);
  }
  for (const unit of ["sshd.service", "client-profile-hub.service", "sitesourcery-hq-gateway.service", "sitesourcery-hq-workers@export.service"]) {
    assert.equal(rule(action(unit, "start"), { user: "mrfantasea" }), undefined);
  }
});
