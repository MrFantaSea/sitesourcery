import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../../domain/canonical.mjs";
import { createSpaceshipDomainReadAdapter } from "../../domain/adapters/spaceship.mjs";
import { createConfiguredDomainLifecycleExecutor } from "../domain-lifecycle-worker-executor.mjs";
import { createSiteSourceryDomainLifecycleExecutor, createSpaceshipDomainLifecycleExecutor,
  readPrivateSpaceshipJson } from "../spaceship-domain-lifecycle-executor.mjs";

function fixture() {
  const organizationId = randomUUID(), projectId = randomUUID(), customerId = randomUUID();
  const body = { schema: "sitesourcery.domain-provider-pin/v1", providerCode: "spaceship",
    registrarOfRecord: "Spaceship", domain: "readback.example" };
  const claim = { schema: "sitesourcery.domain-lifecycle-worker-claim/v1", jobId: randomUUID(),
    organizationId, projectId, lifecycleStateId: randomUUID(), fence: 1, action: "refresh_authoritative",
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), lifecycle: {
      schema: "sitesourcery.domain-provider-lifecycle/v1",
      scope: { organizationId, projectId, customerId, actorId: customerId },
      pin: { ...body, fingerprint: digest(body) }
    } };
  const services = [], queries = [];
  const authority = { kind: "canonical-postgres", async service(options, callback) {
    services.push(options);
    return callback({ async query(sql, parameters) { queries.push({ sql, parameters }); return { rowCount: 1, rows: [{ id: claim.jobId }] }; } });
  } };
  const readback = { name: "readback.example", lifecycleStatus: "registered", autoRenew: false,
    expirationDate: new Date(Date.now() + 86400000).toISOString(), eppStatuses: [], suspensions: [] };
  const reader = getDomain => ({ readOnly: true, providerEffects: false, getDomain });
  return { claim, authority, readback, reader, services, queries };
}

test("unconfigured loader and read adapter stay held without accessing custody or provider", async () => {
  const executor = await createConfiguredDomainLifecycleExecutor({ environment: {},
    read() { assert.fail("held mode must not read a file"); }, load() { assert.fail("held mode must not load an adapter"); } });
  assert.equal((await executor.readiness()).ready, false);
  const reader = createSpaceshipDomainReadAdapter({ vault: { readProviderCredentials() { assert.fail("no credential read"); } } });
  await assert.rejects(reader.getDomain({ domain: "readback.example" }), { code: "spaceship_readback_held" });
});

test("reviewed factory rejects incomplete or redirected custody before opening any file", async () => {
  for (const environment of [{}, { SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODE: "reviewed" }, {
    SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODE: "reviewed",
    SITESOURCERY_SPACESHIP_READBACK_APPROVAL_FILE: "/tmp/unreviewed-approval.json",
    SITESOURCERY_SPACESHIP_READBACK_APPROVAL_SHA256: "a".repeat(64),
    CREDENTIALS_DIRECTORY: "/run/credentials/sitesourcery-hq-workers.service"
  }]) await assert.rejects(createSiteSourceryDomainLifecycleExecutor({ environment }), {
    code: "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED"
  });
});

test("cross-project, changed pin and pre-aborted claims perform zero database or provider work", async () => {
  for (const change of [c => { c.projectId = randomUUID(); }, c => { c.lifecycle.pin.domain = "other.example"; },
    c => { c.lifecycle.scope.actorId = randomUUID(); }, c => { c.fence = 0; }]) {
    const f = fixture(); change(f.claim);
    const executor = createSpaceshipDomainLifecycleExecutor({ authority: f.authority,
      reader: f.reader(async () => assert.fail("invalid claim must not read provider")) });
    await assert.rejects(executor.execute(f.claim), { code: "DOMAIN_LIFECYCLE_CLAIM_INVALID" });
    assert.equal(f.services.length, 0);
  }
  const f = fixture();
  const executor = createSpaceshipDomainLifecycleExecutor({ authority: f.authority,
    reader: f.reader(async () => assert.fail("aborted claim must not read provider")) });
  await assert.rejects(executor.execute(f.claim, { signal: AbortSignal.abort() }), { code: "DOMAIN_LIFECYCLE_READBACK_ABORTED" });
  assert.equal(f.services.length, 0);
});

test("ambiguous Domain responses stay manual without writing lifecycle authority", async () => {
  const cases = [{ lifecycleStatus: "creating" }, { lifecycleStatus: "future-value" }, { name: "other.example" },
    { autoRenew: true }, { expirationDate: "invalid" }, { expirationDate: "2020-01-01T00:00:00.000Z" },
    { eppStatuses: ["serverHold"] }, { suspensions: [{ reasonCode: "unverified" }] }];
  for (const patch of cases) {
    const f = fixture();
    const executor = createSpaceshipDomainLifecycleExecutor({ authority: f.authority,
      reader: f.reader(async () => ({ ...f.readback, ...patch })) });
    const result = await executor.execute(f.claim);
    assert.equal(result.receiptKind, "manual_review"); assert.equal(result.result.terminal, false);
    assert.equal(f.services.length, 1); assert.equal(f.services[0].readOnly, true);
    assert.equal(f.services[0].organizationId, f.claim.organizationId);
    assert.equal(f.queries[0].parameters[6], digest(f.claim.lifecycle));
  }
});

test("provider failure remains retryable with no raw credential or response text", async () => {
  const f = fixture();
  const executor = createSpaceshipDomainLifecycleExecutor({ authority: f.authority,
    reader: f.reader(async () => { throw new Error("private-key-and-provider-body"); }) });
  await assert.rejects(executor.execute(f.claim), error => {
    assert.equal(error.code, "DOMAIN_LIFECYCLE_READBACK_UNAVAILABLE");
    assert.doesNotMatch(error.stack, /private-key-and-provider-body/u); return true;
  });
  assert.equal(f.services.length, 1); assert.equal(f.services[0].readOnly, true);
});

test("private credentials require bounded regular unshared owner-only files and canonical custody", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ss-domain-custody-"));
  const filename = path.join(directory, "credential.json");
  const bytes = '{"apiKey":"synthetic-key","apiSecret":"synthetic-secret"}';
  try {
    await writeFile(filename, bytes, { mode: 0o600 });
    assert.equal((await readPrivateSpaceshipJson(filename)).bytes.toString(), bytes);
    assert.deepEqual(await readPrivateSpaceshipJson(filename, { metadataOnly: true }), {});
    await assert.rejects(readPrivateSpaceshipJson(filename, { uid: process.getuid() + 1 }), { code: "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID" });
    await chmod(filename, 0o644);
    await assert.rejects(readPrivateSpaceshipJson(filename), { code: "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID" });
    assert.equal((await readPrivateSpaceshipJson(filename, { secret: false })).bytes.toString(), bytes);
    await chmod(filename, 0o600);
    const linked = path.join(directory, "symlink.json"); await symlink(filename, linked);
    await assert.rejects(readPrivateSpaceshipJson(linked));
    const hard = path.join(directory, "hard.json"); await link(filename, hard);
    await assert.rejects(readPrivateSpaceshipJson(filename), { code: "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID" });
    await rm(hard);
    await writeFile(filename, "x".repeat(8193));
    await assert.rejects(readPrivateSpaceshipJson(filename), { code: "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID" });
    await writeFile(filename, "");
    await assert.rejects(readPrivateSpaceshipJson(filename), { code: "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID" });
    const alias = path.join(directory, "alias"); await symlink(directory, alias);
    await assert.rejects(readPrivateSpaceshipJson(path.join(alias, "credential.json")), { code: "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
