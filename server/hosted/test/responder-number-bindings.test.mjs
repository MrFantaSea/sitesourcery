import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createPostgresResponderNumberBindingsRepository
} from "../responder-number-bindings-postgres.mjs";
import {
  createResponderNumberBindingsHttpBoundary
} from "../responder-number-bindings-http.mjs";

const ORGANIZATION = "10000000-0000-4000-8000-0000000000aa";
const PROJECT = "10000000-0000-4000-8000-0000000000ab";
const BINDING = "10000000-0000-4000-8000-0000000000ad";
const USER = "10000000-0000-4000-8000-0000000000ba";
const NOW = "2026-08-12T18:00:00.000Z";
const PHONE = "+18562441220";
const PHONE_SID = `PN${"a".repeat(32)}`;
const ACCOUNT_SID = `AC${"b".repeat(32)}`;

function row(overrides = {}) {
  return {
    id: BINDING,
    command_id: "binding-command-0001",
    request_digest: "1".repeat(64),
    organization_id: ORGANIZATION,
    project_id: PROJECT,
    provider: "twilio",
    voice_ingress_role: "managed_front_door",
    number_lookup_digest: "2".repeat(64),
    lookup_key_version: "v2",
    phone_number_sid_digest: "3".repeat(64),
    account_sid_digest: "4".repeat(64),
    messaging_service_sid_digest: null,
    provider_readback_digest: "5".repeat(64),
    state: "active",
    provisioned_by_user_id: USER,
    provision_evidence_digest: "6".repeat(64),
    provisioned_at: NOW,
    retired_at: null,
    retired_by_user_id: null,
    retire_evidence_digest: null,
    retired_reason: null,
    revision: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

function fakeAuthority(handler) {
  const calls = [];
  return {
    calls,
    authority: {
      kind: "canonical-postgres",
      async service(context, work) {
        calls.push(context);
        return work({
          query: (text, values = []) => handler(text, values, context)
        });
      }
    }
  };
}

function repository(handler) {
  const fake = fakeAuthority(handler);
  return {
    fake,
    repo: createPostgresResponderNumberBindingsRepository({
      authority: fake.authority,
      verifierKeyVersions: ["v2", "v1"],
      randomUUID: () => BINDING
    })
  };
}

function operatorActor() {
  return { kind: "operator", organizationId: ORGANIZATION, userId: USER };
}

function provisionInput(overrides = {}) {
  return {
    commandId: "binding-command-0001",
    requestDigest: "1".repeat(64),
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    voiceIngressRole: "conditional_forward_destination",
    numberLookupDigest: "2".repeat(64),
    numberLookupCandidateDigests: ["2".repeat(64), "b".repeat(64)],
    lookupKeyVersion: "v2",
    phoneNumberSidDigest: "3".repeat(64),
    accountSidDigest: "4".repeat(64),
    messagingServiceSidDigest: null,
    providerReadbackDigest: "5".repeat(64),
    provisionEvidenceDigest: "6".repeat(64),
    recordedAt: NOW,
    ...overrides
  };
}

test("provisioning stores keyed digests with the PN resource and readback authority", async () => {
  let inserted = null;
  let candidateCheck = null;
  const { fake, repo } = repository((text, values, context) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("where command_id = $1")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("number_lookup_digest = any")) {
      candidateCheck = values[0];
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("insert into ss.responder_provider_number_bindings")) {
      inserted = { values, context };
      return {
        rowCount: 1,
        rows: [row({ voice_ingress_role: values[7] })]
      };
    }
    throw new Error(`unhandled: ${text.slice(0, 50)}`);
  });
  const receipt = await repo.provisionBinding(
    operatorActor(),
    provisionInput()
  );
  assert.deepEqual(
    candidateCheck,
    ["2".repeat(64), "b".repeat(64)],
    "duplicate detection must cover every keyring version"
  );
  assert.equal(receipt.state, "active");
  assert.equal(receipt.voiceIngressRole, "conditional_forward_destination");
  assert.equal(receipt.lookupKeyVersion, "v2");
  assert.equal(receipt.phoneNumberSidDigest, "3".repeat(64));
  assert.equal(receipt.providerReadbackDigest, "5".repeat(64));
  assert.equal(receipt.replayed, false);
  assert.equal(inserted.context.actorKind, "operator");
  assert.equal(inserted.context.organizationId, ORGANIZATION);
  assert.equal(inserted.values[7], "conditional_forward_destination");
  assert.equal(fake.calls.length, 1);
});

test("an active binding under a prior pepper version blocks re-provisioning", async () => {
  const { repo } = repository((text) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("where command_id = $1")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("number_lookup_digest = any")) {
      return { rowCount: 1, rows: [{}] };
    }
    throw new Error("a cross-version duplicate must never insert");
  });
  await assert.rejects(
    repo.provisionBinding(operatorActor(), provisionInput()),
    (error) => error?.code === "RESPONDER_NUMBER_BINDING_CONFLICT"
  );
});

test("provision and retirement replays are exact; drift conflicts", async () => {
  const { repo } = repository((text) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("where command_id = $1")) {
      return { rowCount: 1, rows: [row()] };
    }
    throw new Error("replay must not insert");
  });
  const replay = await repo.provisionBinding(
    operatorActor(),
    provisionInput()
  );
  assert.equal(replay.replayed, true);
  await assert.rejects(
    repo.provisionBinding(
      operatorActor(),
      provisionInput({ requestDigest: "9".repeat(64) })
    ),
    (error) =>
      error?.code === "RESPONDER_NUMBER_BINDING_IDEMPOTENCY_CONFLICT"
  );

  const retire = repository((text) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("for update")) {
      return {
        rowCount: 1,
        rows: [row({
          state: "retired",
          retired_at: NOW,
          retired_by_user_id: USER,
          retire_evidence_digest: "7".repeat(64),
          retired_reason: "number_released",
          revision: 2
        })]
      };
    }
    throw new Error("retired replay must not update");
  });
  const replayedRetirement = await retire.repo.retireBinding(
    operatorActor(),
    {
      commandId: "binding-retire-0001",
      requestDigest: "8".repeat(64),
      organizationId: ORGANIZATION,
      bindingId: BINDING,
      retiredReason: "number_released",
      retireEvidenceDigest: "7".repeat(64),
      recordedAt: NOW
    }
  );
  assert.equal(replayedRetirement.replayed, true);
  assert.equal(replayedRetirement.state, "retired");
});

test("binding readiness fails closed when a stored key version is uncovered", async () => {
  const { repo } = repository((text) => {
    if (text.includes("hosted_responder_twilio_inbound_contract_v1")) {
      return {
        rowCount: 1,
        rows: [{
          contract_ready: true,
          tables_ready: true,
          lookup_keys_cover_bindings: false
        }]
      };
    }
    throw new Error("unexpected readiness query");
  });
  const readiness = await repo.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(
    readiness.code,
    "RESPONDER_NUMBER_BINDING_LOOKUP_KEY_COVERAGE_REQUIRED"
  );
});

function lookupDigests() {
  return {
    kind: "responder-lookup-digests",
    providerEffects: false,
    writerVersion: "v2",
    verifierVersions: ["v2"],
    readiness: async () => ({ ready: true }),
    numberLookupDigest: (address) => ({
      digest: createHmac("sha256", "test-number")
        .update(String(address), "utf8").digest("hex"),
      keyVersion: "v2"
    }),
    numberLookupCandidates: (address) => [{
      digest: createHmac("sha256", "test-number")
        .update(String(address), "utf8").digest("hex"),
      keyVersion: "v2"
    }],
    callerRouteDigest: (address) => ({
      digest: createHmac("sha256", "test-caller")
        .update(String(address), "utf8").digest("hex"),
      keyVersion: "v2"
    })
  };
}

function httpBoundary({ commands = [], authenticated = { userId: USER } } = {}) {
  return createResponderNumberBindingsHttpBoundary({
    repository: {
      kind: "responder-number-bindings-postgres",
      providerEffects: false,
      readiness: async () => ({ ready: true }),
      async provisionBinding(actor, command) {
        commands.push({ operation: "provision", actor, command });
        return { schema: "sitesourcery.responder-number-binding-receipt/v1" };
      },
      async retireBinding(actor, command) {
        commands.push({ operation: "retire", actor, command });
        return { schema: "sitesourcery.responder-number-binding-receipt/v1" };
      },
      async listBindings(actor, organizationId) {
        commands.push({ operation: "list", actor, organizationId });
        return { bindings: [] };
      }
    },
    lookupDigests: lookupDigests(),
    authenticate: async () => authenticated,
    requireWriteGuard: async () => true,
    clock: { now: () => NOW }
  });
}

function provisionRequest(body, { idempotencyKey = "binding-command-0001" } = {}) {
  return new Request(
    `https://sitesourcery.com/api/v1/operator/responder/organizations/${ORGANIZATION}/number-bindings`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(body)
    }
  );
}

test("the operator surface digests raw provider identities and never echoes them", async () => {
  const commands = [];
  const boundary = httpBoundary({ commands });
  const response = await boundary.dispatch(provisionRequest({
    projectId: PROJECT,
    phoneNumber: PHONE,
    phoneNumberSid: PHONE_SID,
    accountSid: ACCOUNT_SID,
    messagingServiceSid: null,
    voiceIngressRole: "conditional_forward_destination",
    readbackAttestedAt: NOW,
    evidenceDigest: "6".repeat(64)
  }));
  assert.equal(response.status, 200);
  assert.equal(commands.length, 1);
  const { actor, command } = commands[0];
  assert.deepEqual(actor, {
    kind: "operator",
    organizationId: ORGANIZATION,
    userId: USER
  });
  assert.equal(command.lookupKeyVersion, "v2");
  assert.equal(command.voiceIngressRole, "conditional_forward_destination");
  assert.match(command.numberLookupDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    command.numberLookupCandidateDigests,
    [command.numberLookupDigest]
  );
  assert.match(command.phoneNumberSidDigest, /^[0-9a-f]{64}$/u);
  assert.match(command.providerReadbackDigest, /^[0-9a-f]{64}$/u);
  assert.match(command.requestDigest, /^[0-9a-f]{64}$/u);
  const serialized = JSON.stringify(command);
  assert.equal(serialized.includes(PHONE), false);
  assert.equal(serialized.includes(PHONE_SID), false);
  assert.equal(serialized.includes(ACCOUNT_SID), false);
});

test("the operator surface validates raw inputs, auth, guard, and idempotency", async () => {
  const commands = [];
  for (const [body, expectedCode] of [
    [{ projectId: PROJECT, phoneNumber: "8562441220",
      phoneNumberSid: PHONE_SID, accountSid: ACCOUNT_SID,
      messagingServiceSid: null, readbackAttestedAt: NOW,
      evidenceDigest: "6".repeat(64) }, "RESPONDER_NUMBER_BINDING_INVALID"],
    [{ projectId: PROJECT, phoneNumber: PHONE,
      phoneNumberSid: "PNshort", accountSid: ACCOUNT_SID,
      messagingServiceSid: null, readbackAttestedAt: NOW,
      evidenceDigest: "6".repeat(64) }, "RESPONDER_NUMBER_BINDING_INVALID"],
    [{ projectId: PROJECT, phoneNumber: PHONE,
      phoneNumberSid: PHONE_SID, accountSid: ACCOUNT_SID,
      messagingServiceSid: null, readbackAttestedAt: NOW },
      "RESPONDER_NUMBER_BINDING_INVALID"],
    [{ projectId: PROJECT, phoneNumber: PHONE,
      phoneNumberSid: PHONE_SID, accountSid: ACCOUNT_SID,
      messagingServiceSid: null, voiceIngressRole: "generic",
      readbackAttestedAt: NOW, evidenceDigest: "6".repeat(64) },
      "RESPONDER_NUMBER_BINDING_INVALID"]
  ]) {
    await assert.rejects(
      httpBoundary({ commands }).dispatch(provisionRequest(body)),
      (error) => error?.code === expectedCode
    );
  }
  await assert.rejects(
    httpBoundary({ commands, authenticated: null })
      .dispatch(provisionRequest({})),
    (error) => error?.code === "AUTHENTICATION_REQUIRED"
  );
  await assert.rejects(
    httpBoundary({ commands }).dispatch(provisionRequest({
      projectId: PROJECT,
      phoneNumber: PHONE,
      phoneNumberSid: PHONE_SID,
      accountSid: ACCOUNT_SID,
      messagingServiceSid: null,
      readbackAttestedAt: NOW,
      evidenceDigest: "6".repeat(64)
    }, { idempotencyKey: "x" })),
    (error) => error?.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(commands.length, 0);
  assert.equal(
    await httpBoundary({ commands }).dispatch(
      new Request("https://sitesourcery.com/api/v1/unrelated")
    ),
    null
  );
});

test("retirement and listing dispatch through the same guarded surface", async () => {
  const commands = [];
  const boundary = httpBoundary({ commands });
  const retireResponse = await boundary.dispatch(new Request(
    `https://sitesourcery.com/api/v1/operator/responder/organizations/${ORGANIZATION}/number-bindings/${BINDING}/retire`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "binding-retire-0001"
      },
      body: JSON.stringify({
        reason: "number_released",
        evidenceDigest: "7".repeat(64)
      })
    }
  ));
  assert.equal(retireResponse.status, 200);
  assert.equal(commands.at(-1).operation, "retire");
  assert.equal(commands.at(-1).command.bindingId, BINDING);
  const listResponse = await boundary.dispatch(new Request(
    `https://sitesourcery.com/api/v1/operator/responder/organizations/${ORGANIZATION}/number-bindings`
  ));
  assert.equal(listResponse.status, 200);
  assert.equal(commands.at(-1).operation, "list");
});
