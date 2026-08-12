import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../security.mjs";
import {
  createPostgresResponderPrivateMaterialResolver
} from "../responder-private-material-postgres.mjs";
import {
  createResponderPrivateMaterialVault
} from "../responder-private-material-vault.mjs";

const TO = "+18562441220";
const BODY = "Sorry we missed you - this is Site Sourcery. Reply STOP to opt out.";
const IDS = Object.freeze({
  operation: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  interaction: "10000000-0000-4000-8000-000000000004",
  contact: "10000000-0000-4000-8000-000000000005"
});
const ROUTE_DIGEST = digest({ routeKind: "sms", address: TO });
const CONTENT_DIGEST = digest({ contentKind: "sms", body: BODY });
const NOW = "2026-08-12T22:00:00.000Z";

function selectedVault() {
  return createResponderPrivateMaterialVault({
    currentKeyVersion: "responder-2026-08",
    currentKey: Buffer.alloc(32, 7),
    randomBytes: () => Buffer.alloc(12, 3)
  });
}

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

function operation(overrides = {}) {
  return {
    id: IDS.operation,
    organization_id: IDS.organization,
    project_id: IDS.project,
    interaction_id: IDS.interaction,
    contact_authority_id: IDS.contact,
    message_kind: "missed_call_ack",
    route_digest: ROUTE_DIGEST,
    content_digest: CONTENT_DIGEST,
    state: "queued",
    attempt_count: 0,
    authority_state: "active",
    interaction_state: "open",
    ...overrides
  };
}

function storeInput(overrides = {}) {
  return {
    operationId: IDS.operation,
    organizationId: IDS.organization,
    projectId: IDS.project,
    interactionId: IDS.interaction,
    contactAuthorityId: IDS.contact,
    messageKind: "missed_call_ack",
    routeDigest: ROUTE_DIGEST,
    contentDigest: CONTENT_DIGEST,
    to: TO,
    body: BODY,
    recordedAt: NOW,
    ...overrides
  };
}

function resolution(overrides = {}) {
  return {
    schema: "sitesourcery.responder-private-sms-resolution/v1",
    operationId: IDS.operation,
    organizationId: IDS.organization,
    projectId: IDS.project,
    interactionId: IDS.interaction,
    contactAuthorityId: IDS.contact,
    messageKind: "missed_call_ack",
    routeDigest: ROUTE_DIGEST,
    contentDigest: CONTENT_DIGEST,
    ...overrides
  };
}

test("private material readiness proves only the exact forced-RLS contract and vault", async () => {
  const authority = fakeAuthority(() => ({
    rowCount: 1,
    rows: [{ contract_ready: true, rls_ready: true }]
  }));
  const resolver = createPostgresResponderPrivateMaterialResolver({
    authority,
    vault: selectedVault()
  });
  assert.deepEqual(await resolver.readiness(), {
    ready: true,
    verified: true,
    kind: "responder-private-delivery-material-resolver",
    providerEffects: false,
    code: null
  });
  const source = authority.calls.map((call) => call.text ?? "").join("\n");
  assert.match(source, /hosted_responder_private_material_contract_v1/u);
  assert.match(source, /relrowsecurity and c\.relforcerowsecurity/u);
  assert.equal(authority.calls[0].context.readOnly, true);
});

test("store seals one exact pre-claim operation and replays without a second ciphertext", async () => {
  let stored = null;
  let insertCount = 0;
  const authority = fakeAuthority((text, values) => {
    if (text.includes("from ss.responder_delivery_operations operation")) {
      return { rowCount: 1, rows: [operation()] };
    }
    if (text.includes("from ss.responder_private_delivery_materials") &&
        text.includes("select operation_id")) {
      return stored
        ? { rowCount: 1, rows: [{
            operation_id: IDS.operation,
            state: "active",
            route_digest: ROUTE_DIGEST,
            content_digest: CONTENT_DIGEST
          }] }
        : { rowCount: 0, rows: [] };
    }
    if (text.includes("insert into ss.responder_private_delivery_materials")) {
      insertCount += 1;
      stored = {
        key_version: values[8],
        nonce: values[9],
        authentication_tag: values[10],
        ciphertext: values[11]
      };
      return { rowCount: 1, rows: [{ operation_id: IDS.operation }] };
    }
    throw new Error("unexpected query");
  });
  const resolver = createPostgresResponderPrivateMaterialResolver({
    authority,
    vault: selectedVault()
  });
  assert.deepEqual(await resolver.storeSmsMaterial(storeInput()), {
    schema: "sitesourcery.responder-private-material-receipt/v1",
    operationId: IDS.operation,
    routeDigest: ROUTE_DIGEST,
    contentDigest: CONTENT_DIGEST,
    state: "active",
    replayed: false,
    providerEffects: false
  });
  assert.equal(insertCount, 1);
  assert.equal(stored.ciphertext.includes(Buffer.from(TO)), false);
  assert.equal(stored.ciphertext.includes(Buffer.from(BODY)), false);
  assert.equal(JSON.stringify(authority.calls).includes(TO), false);
  assert.equal(JSON.stringify(authority.calls).includes(BODY), false);
  assert.equal((await resolver.storeSmsMaterial(storeInput())).replayed, true);
  assert.equal(insertCount, 1);
});

test("resolve opens material only for one claimed, released, active authority", async () => {
  const vault = selectedVault();
  const selectedAuthority = { ...resolution() };
  delete selectedAuthority.schema;
  const envelope = await vault.sealSmsMaterial(
    selectedAuthority,
    { to: TO, body: BODY }
  );
  const authority = fakeAuthority((text) => {
    assert.match(text, /operation\.state = 'claimed'/u);
    assert.match(text, /control\.state = 'approved_live'/u);
    assert.match(text, /not control\.global_kill_engaged/u);
    assert.match(text, /contact\.state = 'active'/u);
    assert.match(text, /interaction\.state = 'open'/u);
    return {
      rowCount: 1,
      rows: [{
        key_version: envelope.keyVersion,
        nonce: envelope.nonce,
        authentication_tag: envelope.authenticationTag,
        ciphertext: envelope.ciphertext,
        envelope_verified: true
      }]
    };
  });
  const resolver = createPostgresResponderPrivateMaterialResolver({
    authority,
    vault
  });
  assert.deepEqual(await resolver.resolveSmsMaterial(resolution()), {
    schema: "sitesourcery.responder-private-sms-material/v1",
    routeDigest: ROUTE_DIGEST,
    contentDigest: CONTENT_DIGEST,
    to: TO,
    body: BODY
  });
  assert.equal(authority.calls[0].context.actorKind, "system");
  assert.equal(authority.calls[0].context.readOnly, true);
  assert.equal(authority.calls[0].context.organizationId, IDS.organization);
});

test("missing, drifted, or unverifiable material remains provider-free and unavailable", async () => {
  for (const result of [
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ envelope_verified: false }] }
  ]) {
    const authority = fakeAuthority(() => result);
    const resolver = createPostgresResponderPrivateMaterialResolver({
      authority,
      vault: selectedVault()
    });
    await assert.rejects(
      resolver.resolveSmsMaterial(resolution()),
      (error) => error?.code === "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE"
    );
  }
  const authority = fakeAuthority(() => {
    throw new Error("must not query expanded input");
  });
  const resolver = createPostgresResponderPrivateMaterialResolver({
    authority,
    vault: selectedVault()
  });
  await assert.rejects(
    resolver.resolveSmsMaterial({ ...resolution(), phone: TO }),
    (error) => error?.code === "RESPONDER_PRIVATE_MATERIAL_INVALID"
  );
  assert.equal(authority.calls.length, 0);
});
