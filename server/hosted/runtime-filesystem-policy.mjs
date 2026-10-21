// These IDs are deployment configuration, never request input. An absent value
// retains the single-user private-file contract used by local installations.
export function optionalRuntimeId(value, label = "Runtime identity") {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError(`${label} must be a positive non-root UID or GID.`);
  }
  return value;
}

export function runtimeIdFromEnvironment(environment, name) {
  const value = environment[name];
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/u.test(value)) {
    throw new TypeError(`${name} must be a canonical positive UID or GID.`);
  }
  return optionalRuntimeId(Number(value), name);
}

export function exportStoreAccessFromEnvironment(environment = process.env) {
  const sharedGroupId = runtimeIdFromEnvironment(environment, "SITESOURCERY_EXPORT_GROUP_ID");
  const raw = environment.SITESOURCERY_EXPORT_WRITER_UIDS;
  if (sharedGroupId === null && raw === undefined) return { sharedGroupId: null };
  if (sharedGroupId === null || typeof raw !== "string" || !/^[1-9][0-9]{0,9}(?:,[1-9][0-9]{0,9})?$/u.test(raw)) {
    throw new TypeError("Shared export access requires its group and exact writer UIDs.");
  }
  const writerUids = raw.split(",").map(value => optionalRuntimeId(Number(value), "Export writer"));
  if (new Set(writerUids).size !== writerUids.length) {
    throw new TypeError("Export writer UIDs must be distinct.");
  }
  return {
    sharedGroupId, writerUids
  };
}

export function workerHealthAccessFromEnvironment(environment = process.env) {
  const ownerUid = runtimeIdFromEnvironment(environment, "SITESOURCERY_EXPORT_WORKER_UID");
  const sharedGroupId = runtimeIdFromEnvironment(environment, "SITESOURCERY_EXPORT_HEALTH_GROUP_ID");
  if ((ownerUid === null) !== (sharedGroupId === null)) {
    throw new TypeError("Worker health requires both its owner UID and reader group GID.");
  }
  return {
    filePath: environment.SITESOURCERY_EXPORT_WORKER_HEALTH_PATH,
    ...(ownerUid === null ? {} : { ownerUid, sharedGroupId })
  };
}
