import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresTwilioResponderInboundRepository
} from "../twilio-responder-inbound-postgres.mjs";

const ORGANIZATION = "10000000-0000-4000-8000-0000000000aa";
const PROJECT = "10000000-0000-4000-8000-0000000000ab";
const CONTACT = "10000000-0000-4000-8000-0000000000ac";
const NOW = "2026-08-12T18:00:00.000Z";
const PAYLOAD_DIGEST = "1".repeat(64);
const SID_DIGEST = "2".repeat(64);
const TO_LOOKUP_V2 = "3".repeat(64);
const TO_LOOKUP_V1 = "4".repeat(64);
const FROM_LOOKUP = "5".repeat(64);
const CONTACT_ROUTE = "6".repeat(64);
const ACCOUNT_DIGEST = "7".repeat(64);
const SIGNATURE_DIGEST = "8".repeat(64);
const EVIDENCE_DIGEST = "9".repeat(64);

function binding(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-0000000000ad",
    organization_id: ORGANIZATION,
    project_id: PROJECT,
    provider: "twilio",
    number_lookup_digest: TO_LOOKUP_V2,
    lookup_key_version: "v2",
    account_sid_digest: ACCOUNT_DIGEST,
    messaging_service_sid_digest: null,
    state: "active",
    ...overrides
  };
}

function ledgerRow(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-0000000000ae",
    provider: "twilio",
    channel: "sms",
    event_kind: "message_received",
    provider_event_digest: PAYLOAD_DIGEST,
    provider_event_id_digest: SID_DIGEST,
    account_sid_digest: ACCOUNT_DIGEST,
    messaging_service_sid_digest: null,
    to_number_lookup_digest: TO_LOOKUP_V2,
    to_number_key_version: "v2",
    from_route_digest: FROM_LOOKUP,
    from_route_key_version: "v2",
    dial_call_status: null,
    opt_out_type: null,
    classified_intent: "message",
    signature_verification_digest: SIGNATURE_DIGEST,
    payload_digest: PAYLOAD_DIGEST,
    state: "applied",
    state_reason: null,
    organization_id: ORGANIZATION,
    project_id: PROJECT,
    core_provider_event_id: "10000000-0000-4000-8000-0000000000af",
    received_at: NOW,
    created_at: NOW,
    ...overrides
  };
}

function fact(overrides = {}) {
  return {
    channel: "sms",
    eventKind: "message_received",
    providerEventIdDigest: SID_DIGEST,
    providerEventDigest: PAYLOAD_DIGEST,
    payloadDigest: PAYLOAD_DIGEST,
    accountSidDigest: ACCOUNT_DIGEST,
    messagingServiceSidDigest: null,
    toNumberLookupDigest: TO_LOOKUP_V2,
    toNumberKeyVersion: "v2",
    toNumberLookupCandidateDigests: [TO_LOOKUP_V2, TO_LOOKUP_V1],
    fromRouteDigest: FROM_LOOKUP,
    fromRouteKeyVersion: "v2",
    contactRouteDigest: CONTACT_ROUTE,
    fromRouteEligible: true,
    classifiedIntent: "message",
    dialCallStatus: null,
    optOutType: null,
    signatureVerificationDigest: SIGNATURE_DIGEST,
    evidenceDigest: EVIDENCE_DIGEST,
    receivedAt: NOW,
    material: { from: "+18565550100", body: "hello there" },
    sealMaterial: async () => ({
      keyVersion: "2026-08",
      nonce: Buffer.alloc(12, 1),
      authenticationTag: Buffer.alloc(16, 2),
      ciphertext: Buffer.alloc(32, 3)
    }),
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
        const scope = { context, queries: [] };
        calls.push(scope);
        return work({
          query(text, values = []) {
            scope.queries.push({ text, values });
            return handler(text, values, context, scope);
          }
        });
      }
    }
  };
}

function repository(handler, overrides = {}) {
  const fake = fakeAuthority(handler);
  return {
    fake,
    repo: createPostgresTwilioResponderInboundRepository({
      authority: fake.authority,
      verifierKeyVersions: ["v2", "v1"],
      randomUUID: () => "10000000-0000-4000-8000-0000000000ae",
      ...overrides
    })
  };
}

function appliedFlowHandler({
  bindingRow = binding(),
  sweepCount = 0,
  coreEvents = [],
  ledgerInserts = [],
  materialInserts = []
} = {}) {
  return (text, values, context) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("from ss.responder_twilio_inbound_events")) {
      if (text.includes("provider_event_digest = $1")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from ss.responder_provider_number_bindings")) {
      if (text.includes("state = 'active'")) {
        return bindingRow === null
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [bindingRow] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from ss.responder_provider_events")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("insert into ss.responder_runtime_controls")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("from ss.responder_contact_authorities")) {
      return {
        rowCount: 1,
        rows: [{ id: CONTACT, state: "active" }]
      };
    }
    if (text.includes("update ss.responder_contact_authorities")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("insert into ss.responder_interactions")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("insert into ss.responder_provider_events")) {
      coreEvents.push({ values, context });
      return {
        rowCount: 1,
        rows: [{
          id: "10000000-0000-4000-8000-0000000000af",
          interaction_id: "10000000-0000-4000-8000-0000000000b0",
          organization_id: values[3],
          project_id: values[4],
          event_kind: values[9],
          message_intent: values[10],
          state: "applied",
          occurred_at: NOW,
          recorded_at: NOW
        }]
      };
    }
    if (text.includes("insert into ss.responder_twilio_inbound_events")) {
      ledgerInserts.push({ values, context });
      return {
        rowCount: 1,
        rows: [ledgerRow({
          state: values[16],
          state_reason: values[17],
          organization_id: values[18],
          project_id: values[19],
          core_provider_event_id: values[20],
          classified_intent: values[13]
        })]
      };
    }
    if (text.includes("insert into ss.responder_inbound_private_materials")) {
      materialInserts.push({ values, context });
      return { rowCount: 1, rows: [{ inbound_event_id: values[0] }] };
    }
    if (text.includes("update ss.responder_delivery_operations")) {
      return { rowCount: sweepCount, rows: [] };
    }
    throw new Error(`unhandled query: ${text.slice(0, 60)}`);
  };
}

test("a bound SMS event applies core evidence, ledger, and sealed material atomically", async () => {
  const coreEvents = [];
  const ledgerInserts = [];
  const materialInserts = [];
  const { fake, repo } = repository(appliedFlowHandler({
    coreEvents,
    ledgerInserts,
    materialInserts
  }));
  const receipt = await repo.ingestInboundEvent(fact());
  assert.equal(receipt.eventState, "applied");
  assert.equal(receipt.coreApplied, true);
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.suppression, null);
  assert.equal(coreEvents.length, 1);
  assert.equal(coreEvents[0].values[6], "twilio");
  assert.equal(
    coreEvents[0].values[8],
    CONTACT_ROUTE,
    "the core join uses the transient contact route digest"
  );
  assert.equal(coreEvents[0].context.organizationId, ORGANIZATION);
  assert.equal(ledgerInserts.length, 1);
  assert.equal(ledgerInserts[0].values[7], TO_LOOKUP_V2);
  assert.equal(ledgerInserts[0].values[8], "v2");
  assert.equal(ledgerInserts[0].values[9], FROM_LOOKUP);
  assert.equal(ledgerInserts[0].values[10], "v2");
  assert.equal(materialInserts.length, 1);
  const everyValue = JSON.stringify(
    fake.calls.flatMap((scope) => scope.queries.map((query) => query.values))
  );
  assert.equal(everyValue.includes("+18565550100"), false);
  assert.equal(everyValue.includes("hello there"), false);
  assert.equal(
    everyValue.includes(CONTACT_ROUTE),
    true,
    "the contact route digest flows only to the proved core tables"
  );
});

test("binding lookup queries every keyed candidate digest", async () => {
  let observedCandidates = null;
  const { repo } = repository((text, values, context) => {
    if (text.includes("from ss.responder_twilio_inbound_events")) {
      return { rowCount: 0, rows: [] };
    }
    if (
      text.includes("from ss.responder_provider_number_bindings") &&
      text.includes("number_lookup_digest = any") &&
      text.includes("state = 'active'")
    ) {
      observedCandidates = values[0];
      return { rowCount: 1, rows: [binding()] };
    }
    return appliedFlowHandler()(text, values, context);
  });
  await repo.ingestInboundEvent(fact());
  assert.deepEqual(observedCandidates, [TO_LOOKUP_V2, TO_LOOKUP_V1]);
});

test("unknown, retired, and mismatched numbers quarantine as tenantless unbound evidence", async () => {
  const cases = [
    [{ bindingRow: null, retired: false }, "no_binding"],
    [{ bindingRow: null, retired: true }, "retired_binding"],
    [
      { bindingRow: binding({ account_sid_digest: "e".repeat(64) }) },
      "account_mismatch"
    ],
    [
      {
        bindingRow: binding({
          messaging_service_sid_digest: "d".repeat(64)
        })
      },
      "service_mismatch"
    ]
  ];
  for (const [scenario, expectedReason] of cases) {
    const inserts = [];
    const { repo } = repository((text, values, context) => {
      if (text.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("from ss.responder_twilio_inbound_events")) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes("from ss.responder_provider_number_bindings")) {
        if (text.includes("state = 'active'")) {
          return scenario.bindingRow
            ? { rowCount: 1, rows: [scenario.bindingRow] }
            : { rowCount: 0, rows: [] };
        }
        return scenario.retired
          ? { rowCount: 1, rows: [{}] }
          : { rowCount: 0, rows: [] };
      }
      if (text.includes("insert into ss.responder_twilio_inbound_events")) {
        inserts.push({ values, context });
        return {
          rowCount: 1,
          rows: [ledgerRow({
            state: "unbound",
            state_reason: values[17],
            organization_id: null,
            project_id: null,
            core_provider_event_id: null
          })]
        };
      }
      throw new Error(`unbound flow should not run: ${text.slice(0, 50)}`);
    });
    const receipt = await repo.ingestInboundEvent(fact());
    assert.equal(receipt.eventState, "unbound");
    assert.equal(receipt.stateReason, expectedReason);
    assert.equal(receipt.coreApplied, false);
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].values[17], expectedReason);
    assert.equal(inserts[0].values[18], null);
    assert.equal(inserts[0].values[19], null);
    assert.equal(
      inserts[0].context.organizationId,
      undefined,
      "unbound evidence is recorded without any tenant context"
    );
  }
});

test("a durable STOP sweeps queued, waiting, and claimed deliveries", async () => {
  let sweep = null;
  const coreEvents = [];
  const handler = appliedFlowHandler({ coreEvents, sweepCount: 3 });
  const { repo } = repository((text, values, context) => {
    if (text.includes("update ss.responder_delivery_operations")) {
      sweep = { text, values, context };
      return { rowCount: 3, rows: [] };
    }
    return handler(text, values, context);
  });
  const receipt = await repo.ingestInboundEvent(fact({
    classifiedIntent: "stop",
    optOutType: "STOP"
  }));
  assert.equal(receipt.eventState, "applied");
  assert.deepEqual(receipt.suppression, { cancelledOperations: 3 });
  assert.match(sweep.text, /'queued', 'retry_wait', 'claimed'/u);
  assert.match(sweep.text, /lease_owner = null/u);
  assert.match(sweep.text, /lease_expires_at = null/u);
  assert.match(sweep.text, /provider_effects_authorized = false/u);
  assert.match(sweep.text, /RESPONDER_DELIVERY_OPTED_OUT/u);
  assert.match(sweep.text, /authority\.state <> 'active'/u);
  assert.equal(
    sweep.context.organizationId,
    undefined,
    "the sweep runs with global system authority, never tenant context"
  );
  assert.equal(sweep.values[0], ORGANIZATION);
});

test("an exact raw-payload replay returns the recorded receipt and re-runs STOP suppression", async () => {
  let sweeps = 0;
  const { repo } = repository((text) => {
    if (text.includes("from ss.responder_twilio_inbound_events")) {
      return {
        rowCount: 1,
        rows: [ledgerRow({ classified_intent: "stop", opt_out_type: "STOP" })]
      };
    }
    if (text.includes("update ss.responder_delivery_operations")) {
      sweeps += 1;
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`replay must not write: ${text.slice(0, 50)}`);
  });
  const receipt = await repo.ingestInboundEvent(fact({
    classifiedIntent: "stop",
    optOutType: "STOP"
  }));
  assert.equal(receipt.replayed, true);
  assert.equal(receipt.eventState, "applied");
  assert.equal(sweeps, 1, "replayed STOP evidence still self-heals the queue");
});

test("a reused payload identity with different provider evidence conflicts", async () => {
  const { repo } = repository((text) => {
    if (text.includes("from ss.responder_twilio_inbound_events")) {
      return {
        rowCount: 1,
        rows: [ledgerRow({ provider_event_id_digest: "f".repeat(64) })]
      };
    }
    throw new Error("conflict path must not write");
  });
  await assert.rejects(
    repo.ingestInboundEvent(fact()),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT"
  );
});

test("a distinct payload for an already-applied provider resource supersedes without core effect", async () => {
  const inserts = [];
  const handler = appliedFlowHandler({ ledgerInserts: inserts });
  const { repo } = repository((text, values, context) => {
    if (
      text.includes("from ss.responder_twilio_inbound_events") &&
      text.includes("event_kind = $1")
    ) {
      return { rowCount: 1, rows: [{}] };
    }
    if (text.includes("insert into ss.responder_provider_events")) {
      throw new Error("superseded evidence must never reach the core");
    }
    return handler(text, values, context);
  });
  const receipt = await repo.ingestInboundEvent(fact());
  assert.equal(receipt.eventState, "superseded");
  assert.equal(receipt.stateReason, "duplicate_payload_variant");
  assert.equal(receipt.coreApplied, false);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[16], "superseded");
});

test("a binding retired between resolution and apply re-resolves instead of misattributing", async () => {
  let resolutions = 0;
  let inserted = null;
  const { repo } = repository((text, values, context) => {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("from ss.responder_twilio_inbound_events")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("from ss.responder_provider_number_bindings")) {
      if (text.includes("where id = $1")) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes("state = 'active'")) {
        resolutions += 1;
        return resolutions === 1
          ? { rowCount: 1, rows: [binding()] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("insert into ss.responder_twilio_inbound_events")) {
      inserted = { values, context };
      return {
        rowCount: 1,
        rows: [ledgerRow({
          state: "unbound",
          state_reason: values[17],
          organization_id: null,
          project_id: null,
          core_provider_event_id: null
        })]
      };
    }
    throw new Error(`drift flow must not reach: ${text.slice(0, 50)}`);
  });
  const receipt = await repo.ingestInboundEvent(fact());
  assert.equal(resolutions, 2, "the drift forces one full re-resolution");
  assert.equal(receipt.eventState, "unbound");
  assert.equal(receipt.stateReason, "no_binding");
  assert.equal(
    inserted.values[18],
    null,
    "evidence is never attributed to the retired owner"
  );
});

test("serialization failures retry to completion instead of dropping provider truth", async () => {
  let attempts = 0;
  const handler = appliedFlowHandler({});
  const { repo } = repository((text, values, context) => {
    if (
      text.includes("pg_advisory_xact_lock") &&
      String(values[0]).startsWith("responder-inbound:")
    ) {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("could not serialize");
        error.code = "40001";
        throw error;
      }
    }
    return handler(text, values, context);
  });
  const receipt = await repo.ingestInboundEvent(fact());
  assert.equal(receipt.eventState, "applied");
  assert.equal(attempts, 2);
});

test("readiness fails closed when active bindings outrun the configured key versions", async () => {
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
    "TWILIO_RESPONDER_INBOUND_LOOKUP_KEY_COVERAGE_REQUIRED"
  );
});

test("the repository refuses malformed facts and configurations", async () => {
  const { repo } = repository(() => {
    throw new Error("must not reach storage");
  });
  await assert.rejects(
    async () => repo.ingestInboundEvent(
      fact({ toNumberLookupCandidateDigests: [] })
    ),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID"
  );
  await assert.rejects(
    async () => repo.ingestInboundEvent(
      fact({ providerEventDigest: "0".repeat(64) })
    ),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID"
  );
  await assert.rejects(
    async () => repo.ingestInboundEvent(fact({
      fromRouteEligible: false
    })),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID"
  );
  assert.throws(
    () => createPostgresTwilioResponderInboundRepository({
      authority: { kind: "canonical-postgres", service: () => {} },
      verifierKeyVersions: []
    }),
    (error) =>
      error?.code ===
        "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFIGURATION_REQUIRED"
  );
});
