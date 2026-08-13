import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPostgresResponderPrivateMaterialRetentionRepository
} from "../responder-private-material-retention-postgres.mjs";

function fakeAuthority(query) {
  const calls = [];
  return {
    calls,
    kind: "canonical-postgres",
    async service(context, work) {
      calls.push({ context });
      return work({
        async query(text, values = []) {
          calls.push({ text, values });
          return query(text, values, calls);
        }
      });
    }
  };
}

test("retention readiness proves the exact forced-RLS contract and no decryption authority", async () => {
  const authority = fakeAuthority(() => ({
    rowCount: 1,
    rows: [{ contract_ready: true, tables_ready: true }]
  }));
  const repository =
    createPostgresResponderPrivateMaterialRetentionRepository({ authority });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "responder-private-material-retention-postgres",
    providerEffects: false,
    decryptsMaterial: false,
    code: null
  });
  assert.equal(authority.calls[0].context.readOnly, true);
  const source = authority.calls.map((call) => call.text ?? "").join("\n");
  assert.match(source, /hosted_responder_private_material_retention_contract_v1/u);
  assert.match(source, /count\(\*\) = 5/u);
});

test("repository source has zeroing authority but no vault, decrypt, or ciphertext readback", async () => {
  const source = await readFile(new URL(
    "../responder-private-material-retention-postgres.mjs",
    import.meta.url
  ), "utf8");
  assert.doesNotMatch(source, /private-material-vault/u);
  assert.doesNotMatch(source, /openSmsMaterial/u);
  assert.doesNotMatch(source, /createDecipheriv|openSmsMaterial|decryptMaterial/u);
  assert.doesNotMatch(
    source,
    /select[^;`]*(?:nonce|authentication_tag|ciphertext)/iu
  );
  assert.match(
    source,
    /set nonce = null, authentication_tag = null, ciphertext = null/u
  );
  assert.match(
    source,
    /set key_version = null, nonce = null,\s*authentication_tag = null, ciphertext = null,\s*envelope_digest = null/u
  );
  assert.match(source, /lease_expires_at > clock_timestamp\(\)/u);
  assert.match(source, /for update skip locked/u);
  assert.match(source, /responder_private_material_holds/u);
});

test("discovery is bounded, rechecks active holds, and returns counts only", async () => {
  const firstId = "10000000-0000-4000-8000-000000000001";
  const authority = fakeAuthority((text, values) => {
    assert.match(text, /responder_private_material_destroy_reason/u);
    assert.match(text, /responder_private_material_holds hold/u);
    assert.match(text, /limit \$2/u);
    assert.equal(values[0], "2026-08-13T12:00:00.000Z");
    assert.equal(values[1], 11);
    assert.deepEqual(values[2], Array(11).fill(firstId));
    return { rowCount: 3, rows: [{ id: "redacted" }] };
  });
  const repository =
    createPostgresResponderPrivateMaterialRetentionRepository({
      authority,
      randomUUID: () => firstId
    });
  assert.deepEqual(await repository.discoverEligible({
    workerId: "responder-retention-test-worker-0001",
    observedAt: "2026-08-13T12:00:00.000Z",
    limit: 11
  }), {
    schema: "sitesourcery.responder-private-material-discovery/v1",
    discovered: 3,
    observedAt: "2026-08-13T12:00:00.000Z",
    providerEffects: false
  });
  assert.deepEqual(authority.calls[0].context, {
    actorKind: "system",
    isolation: "serializable"
  });
});

test("the bounded failure ceiling becomes explicit manual review", async () => {
  const jobId = "10000000-0000-4000-8000-000000000001";
  const authority = fakeAuthority((text) => {
    assert.match(text, /failure_count = 99/u);
    assert.match(text, /then 'manual_review'/u);
    assert.match(text, /manual_review_at/u);
    return {
      rowCount: 1,
      rows: [{ id: jobId, state: "manual_review" }]
    };
  });
  const repository =
    createPostgresResponderPrivateMaterialRetentionRepository({ authority });
  assert.deepEqual(await repository.releaseClaim({
    jobId,
    workerId: "responder-retention-test-worker-0001",
    failureCode: "RESPONDER_RETENTION_TEST_FAILURE",
    observedAt: "2026-08-13T12:00:00.000Z",
    retryAt: "2026-08-13T12:00:05.000Z"
  }), {
    status: "manual_review",
    jobId,
    providerEffects: false
  });
});
