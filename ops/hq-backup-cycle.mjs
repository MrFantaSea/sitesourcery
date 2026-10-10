import { BackupCycleFailure, runBackupCycle, recoverBackupCycle } from "./backup-cycle.mjs";
import {
  createSafeCommandRunner, HQ_BACKUP_CONTROL_ROOT, HQ_BACKUP_MANAGED_UNITS,
  HQ_BACKUP_QUIESCE_PATH, HQ_BACKUP_RUNTIME_UNIT
} from "./backup-ports.mjs";

export const HQ_BACKUP_UID = 1000;
export const HQ_BACKUP_FAILURE_DOMAIN = "hq-sitesourcery-production-01";
export const HQ_BACKUP_STAGING_ROOT = "/srv/sitesourcery-storage/production/backup-staging";
export const HQ_BACKUP_STATE_PATH = `${HQ_BACKUP_CONTROL_ROOT}/BACKUP_CYCLE_STATE.json`;

function invalid(message) {
  throw new BackupCycleFailure("BACKUP_CYCLE_CONFIGURATION_INVALID", message);
}

export function assertHqBackupEnvironment(environment, uid = process.getuid?.()) {
  if (uid !== HQ_BACKUP_UID ||
      environment.SITESOURCERY_SOURCE_FAILURE_DOMAIN !== HQ_BACKUP_FAILURE_DOMAIN ||
      environment.SITESOURCERY_BACKUP_STAGING_ROOT !== HQ_BACKUP_STAGING_ROOT ||
      environment.SITESOURCERY_BACKUP_QUIESCE_PATH !== HQ_BACKUP_QUIESCE_PATH) {
    invalid("HQ backup requires its exact non-root owner, protected paths and failure domain.");
  }
}

export function createHqBackupLifecycle({ uid = process.getuid?.(), commandRunner = createSafeCommandRunner() } = {}) {
  if (uid !== HQ_BACKUP_UID) invalid("HQ service control requires the reviewed non-root owner.");
  async function command(action, selected) {
    if (!HQ_BACKUP_MANAGED_UNITS.some(unit => unit.unit === selected?.unit && unit.scope === selected?.scope)) {
      invalid("HQ service control refuses an unreviewed unit or scope.");
    }
    const runtimeDirectory = `/run/user/${uid}`;
    return commandRunner.run("/usr/bin/systemctl", [
      ...(selected.scope === "user" ? ["--user"] : []), "--no-ask-password", action, selected.unit
    ], {
      env: {
        PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
        ...(selected.scope === "user" ? {
          XDG_RUNTIME_DIR: runtimeDirectory,
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDirectory}/bus`
        } : {})
      },
      allowedExitCodes: action === "is-active" ? [0, 3] : [0],
      captureStdout: action === "is-active",
      label: `HQ backup writer ${action}`
    });
  }
  return Object.freeze({
    async unitState(unit) { return (await command("is-active", unit)).stdout.trim(); },
    async stopUnit(unit) { await command("stop", unit); },
    async startUnit(unit) { await command("start", unit); }
  });
}

function configuration({ environment, uid, lifecycle }) {
  assertHqBackupEnvironment(environment, uid);
  return {
    runtimeUnit: HQ_BACKUP_RUNTIME_UNIT,
    sourceFailureDomainId: HQ_BACKUP_FAILURE_DOMAIN,
    fencePath: HQ_BACKUP_QUIESCE_PATH,
    statePath: HQ_BACKUP_STATE_PATH,
    stagingRoot: HQ_BACKUP_STAGING_ROOT,
    managedUnits: HQ_BACKUP_MANAGED_UNITS,
    lifecycle, uid
  };
}

export function runHqBackupCycle({
  environment = process.env, uid = process.getuid?.(),
  lifecycle = createHqBackupLifecycle({ uid }), backup
}) {
  return runBackupCycle({ ...configuration({ environment, uid, lifecycle }), backup });
}

export function recoverHqBackupCycle({
  environment = process.env, uid = process.getuid?.(),
  lifecycle = createHqBackupLifecycle({ uid })
} = {}) {
  return recoverBackupCycle(configuration({ environment, uid, lifecycle }));
}
