import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATIONS_ALERT_TRANSITION_SCHEMA,
  OPERATIONS_REPORT_SCHEMA
} from "../alert-adapter.mjs";
import {
  createResendOperationsAlertTransport
} from "../resend-alert-transport.mjs";

const DOMAIN_ID =
  "123e4567-e89b-42d3-a456-426614174000";
const MESSAGE_ID =
  "223e4567-e89b-42d3-a456-426614174000";
const ADAPTER_ID = "owner-alert-port";
const DESTINATION_REF = "owner-primary";
const INCIDENT_FINGERPRINT = "a".repeat(64);
const TRANSITION_ID = "b".repeat(64);
const ENVIRONMENT = Object.freeze({
  SITESOURCERY_RESEND_API_KEY:
    "re_test_operations_transport_key",
  SITESOURCERY_RESEND_DOMAIN_ID: DOMAIN_ID,
  SITESOURCERY_ALERT_RECIPIENT:
    "owner-operations@example.test",
  SITESOURCERY_ALERT_ADAPTER_ID: ADAPTER_ID,
  SITESOURCERY_ALERT_DESTINATION_REF:
    DESTINATION_REF
});

function verifiedDomain(overrides = {}) {
  return {
    object: "domain",
    id: DOMAIN_ID,
    name: "sitesourcery.com",
    status: "verified",
    capabilities: {
      sending: "enabled"
    },
    records: [
      { record: "SPF", status: "verified" },
      { record: "DKIM", status: "verified" }
    ],
    open_tracking: false,
    click_tracking: false,
    ...overrides
  };
}

function jsonResponse(value, ok = true) {
  return {
    ok,
    async text() {
      return JSON.stringify(value);
    }
  };
}

function incidentEnvelope() {
  return {
    schema:
      "sitesourcery.outbound-alert-envelope/v1",
    adapterId: ADAPTER_ID,
    destinationRef: DESTINATION_REF,
    approvalDigest: "c".repeat(64),
    report: {
      schema: OPERATIONS_REPORT_SCHEMA,
      observedAt:
        "2026-08-02T12:00:00.000Z",
      providerEgress: "held",
      sourceOperations: {},
      ok: false,
      checks: [],
      alerts: [
        {
          code: "RUNTIME_PROBE_UNAVAILABLE",
          severity: "critical",
          summary:
            "The runtime state probe could not complete."
        }
      ]
    },
    transition: {
      schema:
        OPERATIONS_ALERT_TRANSITION_SCHEMA,
      transitionId: TRANSITION_ID,
      kind: "incident",
      createdAt:
        "2026-08-02T12:00:00.000Z",
      incidentFingerprint:
        INCIDENT_FINGERPRINT,
      previousIncidentFingerprint: null,
      alertCodes: [
        "RUNTIME_PROBE_UNAVAILABLE"
      ],
      previousAlertCodes: []
    }
  };
}

test("Resend operations alerts verify the exact sending domain and deliver only bounded operational facts", async () => {
  const calls = [];
  const transport =
    createResendOperationsAlertTransport({
      environment: ENVIRONMENT,
      adapterId: ADAPTER_ID,
      destinationRef: DESTINATION_REF,
      async fetchImpl(url, options) {
        calls.push({ url, options });
        if (options.method === "GET") {
          return jsonResponse(verifiedDomain());
        }
        return jsonResponse({ id: MESSAGE_ID });
      },
      clock: () =>
        new Date("2026-08-02T12:00:01.000Z")
    });
  assert.deepEqual(await transport.readiness(), {
    ready: true,
    verified: true,
    provider: "resend"
  });
  const receipt = await transport.deliver(
    incidentEnvelope()
  );
  assert.deepEqual(receipt, {
    accepted: true,
    provider: "resend",
    providerMessageId: MESSAGE_ID,
    transitionId: TRANSITION_ID,
    acceptedAt: "2026-08-02T12:00:01.000Z"
  });
  assert.equal(calls.length, 3);
  const request = calls[2];
  assert.equal(
    request.url,
    "https://api.resend.com/emails"
  );
  assert.equal(request.options.method, "POST");
  assert.equal(
    request.options.headers["Idempotency-Key"],
    `sitesourcery-operations/${TRANSITION_ID}`
  );
  const body = JSON.parse(request.options.body);
  assert.equal(
    body.from,
    "Site Sourcery Alerts <alerts@sitesourcery.com>"
  );
  assert.deepEqual(body.to, [
    "owner-operations@example.test"
  ]);
  assert.equal(
    body.subject,
    "[CRITICAL] Site Sourcery operations alert"
  );
  assert.match(
    body.text,
    /RUNTIME_PROBE_UNAVAILABLE/u
  );
  assert.doesNotMatch(
    request.options.body,
    /re_test_operations_transport_key|approvalDigest|sourceOperations/u
  );
});

test("Resend operations alerts fail closed on tracking, domain drift, and destination drift", async () => {
  for (const [domain, code] of [
    [
      verifiedDomain({ open_tracking: true }),
      "RESEND_TRACKING_MUST_BE_DISABLED"
    ],
    [
      verifiedDomain({ name: "example.test" }),
      "RESEND_DOMAIN_MISMATCH"
    ]
  ]) {
    const transport =
      createResendOperationsAlertTransport({
        environment: ENVIRONMENT,
        adapterId: ADAPTER_ID,
        destinationRef: DESTINATION_REF,
        fetchImpl: async () =>
          jsonResponse(domain)
      });
    assert.equal(
      (await transport.readiness()).code,
      code
    );
  }

  const transport =
    createResendOperationsAlertTransport({
      environment: ENVIRONMENT,
      adapterId: ADAPTER_ID,
      destinationRef: DESTINATION_REF,
      fetchImpl: async () =>
        jsonResponse(verifiedDomain())
    });
  await assert.rejects(
    transport.deliver({
      ...incidentEnvelope(),
      destinationRef: "another-destination"
    }),
    /envelope is invalid/u
  );
  assert.throws(
    () =>
      createResendOperationsAlertTransport({
        environment: {
          ...ENVIRONMENT,
          SITESOURCERY_ALERT_ADAPTER_ID:
            "another-adapter"
        },
        adapterId: ADAPTER_ID,
        destinationRef: DESTINATION_REF
      }),
    /adapter identity is invalid/u
  );
});
