import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMERCE_NOTIFICATION_AUTHORITIES
} from "../commerce-transition-notifications.mjs";
import {
  CALCULATED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
  REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS,
  REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
  REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS,
  createNotificationMailPrivateRenderer,
  previewReviewedNotificationMail
} from "../../../ops/notification-mail-private-renderer.mjs";

const NOW = "2026-08-11T16:00:00.000Z";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_ID = "41000000-0000-4000-8000-000000000001";
const REFERENCE_ID = "42000000-0000-4000-8000-000000000001";
const SOURCE_DIGEST = "a".repeat(64);
const CUSTOMER = "customer@example.test";
const OPERATOR = "operator@example.test";

function configuration(overrides = {}) {
  return {
    mode: "reviewed",
    operatorRecipient: OPERATOR,
    templateRegistrySha256:
      REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    ...overrides
  };
}

function variables(definition, overrides = {}) {
  return definition.family === "commerce"
    ? {
        reference: REFERENCE_ID,
        revision: 1,
        state: definition.states[0],
        ...overrides
      }
    : { reference: REFERENCE_ID, ...overrides };
}

function preview(definition, to = CUSTOMER, overrides = {}) {
  return previewReviewedNotificationMail({
    templateVersion: definition.version,
    to,
    variables: variables(definition, overrides)
  });
}

function fakeAuthority({
  definition,
  to = CUSTOMER,
  mutateRow = (row) => row,
  sourceAvailable = true,
  operatorReady = true,
  calls = []
} = {}) {
  return {
    kind: "canonical-postgres",
    async service(context, work) {
      assert.deepEqual(context, { actorKind: "system", readOnly: true });
      return work({
        async query(sql, parameters = []) {
          calls.push({ sql, parameters });
          if (sql.includes("notification-private-renderer:readiness")) {
            return {
              rowCount: 1,
              rows: [{
                relations_ready: true,
                contract_ready: true,
                operator_ready: operatorReady
              }]
            };
          }
          if (sql.includes("notification-private-renderer:operator-recipient")) {
            return {
              rowCount: operatorReady ? 1 : 0,
              rows: operatorReady ? [{ id: "operator-id" }] : []
            };
          }
          if (
            sql.includes("notification-private-renderer:support-source") ||
            sql.includes("notification-private-renderer:commerce-source")
          ) {
            if (!sourceAvailable) return { rowCount: 0, rows: [] };
            const base = {
              message_id: MESSAGE_ID,
              message_type: definition.messageType,
              template_version: definition.version,
              recipient_digest: preview(
                definition,
                definition.audience === "operator" ? OPERATOR : to
              ).evidence.recipientDigest,
              source_reservation_id: SOURCE_ID,
              source_reservation_digest: SOURCE_DIGEST,
              event_kind: definition.eventKind,
              reference_id: REFERENCE_ID,
              recipient_email: definition.audience === "operator" ? null : to,
              ...(definition.family === "commerce"
                ? {
                    audience_kind: definition.audience,
                    source_revision: "1",
                    source_state: definition.states[0]
                  }
                : {})
            };
            return { rowCount: 1, rows: [mutateRow({ ...base })] };
          }
          throw new Error("unexpected private renderer query");
        }
      });
    }
  };
}

function renderInput(definition, selectedPreview, overrides = {}) {
  return {
    messageId: MESSAGE_ID,
    messageType: definition.messageType,
    recipientDigest: selectedPreview.evidence.recipientDigest,
    subjectReferenceDigest:
      selectedPreview.evidence.subjectReferenceDigest,
    contentDigest: selectedPreview.evidence.contentDigest,
    templateVersion: definition.version,
    sourceKind: definition.sourceKind,
    sourceReservationId: SOURCE_ID,
    sourceReservationDigest: SOURCE_DIGEST,
    observedAt: NOW,
    ...overrides
  };
}

test("reviewed registry pins every current support, commerce, and Care template", () => {
  assert.equal(REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.length, 29);
  assert.equal(REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS.length, 29);
  assert.equal(
    CALCULATED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256
  );
  assert.equal(
    REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.filter(
      (definition) => definition.family === "support"
    ).length,
    5
  );
  assert.equal(
    REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.filter(
      (definition) => definition.family === "care"
    ).length,
    3
  );
  assert.equal(
    REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.filter(
      (definition) => definition.family === "commerce"
    ).length,
    21
  );
  assert.deepEqual(
    Object.fromEntries(
      REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS
        .filter((definition) => definition.family === "commerce")
        .map((definition) => [definition.eventKind, {
          audience: definition.audience,
          states: definition.states
        }])
    ),
    Object.fromEntries(
      Object.entries(COMMERCE_NOTIFICATION_AUTHORITIES).map(
        ([eventKind, authority]) => [eventKind, {
          audience: authority.audience,
          states: authority.states
        }]
      )
    )
  );

  for (const definition of REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS) {
    const first = preview(
      definition,
      definition.audience === "operator" ? OPERATOR : CUSTOMER
    );
    const second = preview(
      definition,
      definition.audience === "operator" ? OPERATOR : CUSTOMER
    );
    assert.deepEqual(second, first);
    assert.equal(first.templateDigest, definition.templateDigest);
    assert.equal(first.providerEffects, false);
    assert.match(first.evidence.recipientDigest, /^[0-9a-f]{64}$/u);
    assert.match(first.evidence.subjectReferenceDigest, /^[0-9a-f]{64}$/u);
    assert.match(first.evidence.contentDigest, /^[0-9a-f]{64}$/u);
    assert.match(first.rendered.text, /Never send passwords/u);
    assert.match(first.rendered.html, /Never send passwords/u);
  }
});

test("preview refuses arbitrary templates, fields, content, states, and recipients", () => {
  const commerce = REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.find(
    (definition) => definition.family === "commerce"
  );
  assert.throws(
    () => previewReviewedNotificationMail({
      templateVersion: "arbitrary-template.v1",
      to: CUSTOMER,
      variables: { reference: REFERENCE_ID }
    }),
    (error) => error?.code ===
      "NOTIFICATION_PRIVATE_RENDERER_TEMPLATE_UNAVAILABLE"
  );
  for (const input of [
    {
      templateVersion: commerce.version,
      to: CUSTOMER,
      variables: {
        ...variables(commerce),
        arbitraryContent: "Send a secret"
      }
    },
    {
      templateVersion: commerce.version,
      to: CUSTOMER,
      variables: variables(commerce, { state: "unreviewed" })
    },
    {
      templateVersion: commerce.version,
      to: CUSTOMER,
      variables: variables(commerce, { reference: "<script>" })
    },
    {
      templateVersion: commerce.version,
      to: "Real Recipient <person@example.test>",
      variables: variables(commerce)
    }
  ]) {
    assert.throws(
      () => previewReviewedNotificationMail(input),
      (error) => error?.code?.startsWith(
        "NOTIFICATION_PRIVATE_RENDERER_"
      ) === true
    );
  }
});

test("standalone private renderer is held by default and performs no read", async () => {
  const renderer = createNotificationMailPrivateRenderer();
  assert.equal(renderer.mode, "held");
  assert.equal(renderer.providerEffects, false);
  assert.equal((await renderer.readiness()).ready, false);
  await assert.rejects(
    renderer.render({}),
    (error) => error?.code === "NOTIFICATION_PRIVATE_RENDERER_HELD"
  );
});

test("reviewed renderer resolves exact support and commerce recipients behind digest evidence", async () => {
  for (const definition of [
    REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.find(
      (item) => item.version === "support-case-response.v1"
    ),
    REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.find(
      (item) => item.version ===
        "commerce-assessment-report-delivered.v1"
    ),
    REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.find(
      (item) => item.version ===
        "commerce-invoice-finalization-failed.v1"
    )
  ]) {
    const to = definition.audience === "operator" ? OPERATOR : CUSTOMER;
    const selectedPreview = preview(definition, to);
    const calls = [];
    const renderer = createNotificationMailPrivateRenderer({
      authority: fakeAuthority({ definition, to, calls }),
      configuration: configuration()
    });
    assert.equal((await renderer.readiness()).ready, true);
    assert.deepEqual(
      await renderer.render(renderInput(definition, selectedPreview)),
      selectedPreview.rendered
    );
    assert.equal(calls.every((call) => !call.sql.includes(to)), true);
    assert.equal(
      calls.every(
        (call) => call.parameters.every(
          (value) =>
            typeof value !== "string" || !value.includes("@") ||
            [to, OPERATOR].includes(value)
        )
      ),
      true
    );
  }
});

test("renderer rejects version, source, recipient, and output digest drift before provider access", async () => {
  const definition = REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.find(
    (item) => item.version === "support-case-response.v1"
  );
  const selectedPreview = preview(definition);
  const cases = [
    {
      input: { templateVersion: "support-case-closure.v1" },
      mutateRow: (row) => row
    },
    {
      input: { sourceReservationDigest: "b".repeat(64) },
      sourceAvailable: false
    },
    {
      input: { recipientDigest: "c".repeat(64) },
      mutateRow: (row) => ({ ...row, recipient_digest: "c".repeat(64) })
    },
    {
      input: { contentDigest: "d".repeat(64) },
      mutateRow: (row) => row
    },
    {
      input: { subjectReferenceDigest: "e".repeat(64) },
      mutateRow: (row) => row
    },
    {
      input: {},
      mutateRow: (row) => ({ ...row, event_kind: "closure" })
    }
  ];
  for (const selected of cases) {
    const renderer = createNotificationMailPrivateRenderer({
      authority: fakeAuthority({
        definition,
        mutateRow: selected.mutateRow,
        sourceAvailable: selected.sourceAvailable
      }),
      configuration: configuration()
    });
    await assert.rejects(
      renderer.render(renderInput(
        definition,
        selectedPreview,
        selected.input
      )),
      (error) => error?.code?.startsWith(
        "NOTIFICATION_PRIVATE_RENDERER_"
      ) === true && error?.details?.providerEffects === false
    );
  }
});

test("Care template previews are exact but the current reservation-only source cannot enter dispatch", async () => {
  const definition = REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS.find(
    (item) => item.version === "care-ticket-update.v1"
  );
  const selectedPreview = preview(definition);
  assert.equal(selectedPreview.rendered.templateVersion, definition.version);
  const renderer = createNotificationMailPrivateRenderer({
    authority: fakeAuthority({ definition }),
    configuration: configuration()
  });
  await assert.rejects(
    renderer.render(renderInput(definition, selectedPreview, {
      sourceKind: "support"
    })),
    (error) => error?.code ===
      "NOTIFICATION_PRIVATE_RENDERER_TEMPLATE_UNAVAILABLE"
  );
});

test("renderer source has no logging or external transport boundary", async () => {
  const source = await readFile(
    new URL("../../../ops/notification-mail-private-renderer.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /(?:console[.]|process[.](?:stdout|stderr)|fetch\s*\(|https?:\/\/)/u
  );
  assert.doesNotMatch(source, /\b(?:sendMail|sendNotification)\s*\(/u);
  assert.doesNotMatch(source, /from\s+["'][.]{1,2}\//u);
  const standalone = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  assert.equal(
    standalone.REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256
  );
  assert.equal(
    standalone.createNotificationMailPrivateRenderer().mode,
    "held"
  );
});
