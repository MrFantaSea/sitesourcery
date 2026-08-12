import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  hostedFileAllowlist,
  hostedOperatorAssets
} from "../build-hosted.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const desk = require("../../operator/operator.js");

const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";

function queue() {
  return {
    schema: "sitesourcery.operator-work-queue/v1",
    sourceAuthoritative: true,
    genericRepair: false,
    items: [{
      schema: "sitesourcery.operator-work-queue-item/v1",
      id: "40000000-0000-4000-8000-000000000001",
      source: {
        table: "ss.hosted_support_cases",
        id: CASE,
        revision: 3,
        digest: "a".repeat(64),
        state: "in_review"
      },
      organizationId: ORG,
      projectId: null,
      kind: "privacy_case",
      severity: "high",
      status: "open",
      deadlineAt: "2026-08-12T12:00:00.000Z",
      repair: null,
      openedAt: "2026-08-11T12:00:00.000Z",
      revision: 2,
      digest: "b".repeat(64),
      updatedAt: "2026-08-11T13:00:00.000Z"
    }]
  };
}

function operatorCase() {
  return {
    schema: "sitesourcery.support-case-operator-read/v1",
    id: CASE,
    requestKind: "deletion",
    scope: { kind: "account", organizationId: ORG, projectId: null },
    state: "in_review",
    identityState: "verified",
    assigned: true,
    deadline: { dueAt: "2026-08-12T12:00:00.000Z", status: "active" },
    decision: null,
    appeal: { available: false, dueAt: null, caseId: null, state: null },
    notifications: [],
    audit: [{
      sequence: 1,
      kind: "opened",
      actorKind: "customer",
      evidenceDigest: "c".repeat(64),
      occurredAt: "2026-08-11T12:00:00.000Z",
      eventDigest: "d".repeat(64)
    }],
    openedAt: "2026-08-11T12:00:00.000Z",
    closedAt: null,
    revision: 4,
    intakeChannel: "authenticated",
    requesterUserId: "10000000-0000-4000-8000-000000000001",
    requesterReferenceDigest: "e".repeat(64),
    parentCaseId: null,
    assignedOperatorId: "10000000-0000-4000-8000-000000000002",
    identityEvidenceDigest: "f".repeat(64),
    deadlineBasisDigest: "1".repeat(64),
    appealBasisDigest: null,
    closureReasonCode: null,
    evidence: [{
      kind: "identity_verification",
      sourceKind: "operator",
      digest: "f".repeat(64),
      recordedAt: "2026-08-11T12:30:00.000Z"
    }]
  };
}

test("operator assets remain hosted-only and expose an effect-held responsive desk", async () => {
  assert.deepEqual(hostedOperatorAssets, [
    "operator/index.html",
    "operator/operator.css",
    "operator/operator.js"
  ]);
  for (const file of hostedOperatorAssets) {
    assert.equal(hostedFileAllowlist.includes(file), true);
    assert.equal(publicFileAllowlist.includes(file), false);
  }
  const [html, css, javascript] = await Promise.all(
    hostedOperatorAssets.map((file) => readFile(path.join(ROOT, file), "utf8"))
  );
  assert.match(html, /id="main"[^>]*tabindex="-1"/u);
  assert.match(html, /does not send customer mail or execute deletion or export requests/u);
  assert.match(html, /Assessment and Custom tools/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.match(css, /grid-template-columns: 1fr/u);
  assert.match(css, /min-height: 2\.75rem/u);
  assert.doesNotMatch(javascript, /\.innerHTML\b/u);
  assert.doesNotMatch(javascript, /notification-reservation|\/exports|\/deletion/u);
  assert.match(javascript, /\/operator\/work-queue/u);
  assert.match(javascript, /\/operator\/support-cases/u);
});

test("operator UI validators bind canonical queue and digest-only case projections", () => {
  assert.equal(desk.validateQueue(queue()).items[0].organizationId, ORG);
  assert.equal(desk.validateOperatorCase(operatorCase()).id, CASE);
  assert.equal(
    desk.validateCaseList({
      schema: "sitesourcery.support-case-operator-list/v1",
      cases: [operatorCase()]
    }).cases[0].revision,
    4
  );
  assert.throws(
    () => desk.validateQueue({ ...queue(), sourceAuthoritative: false }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateOperatorCase({ ...operatorCase(), rawMessage: "customer body" }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateOperatorCase({
      ...operatorCase(),
      audit: [{ ...operatorCase().audit[0], eventDigest: "not-a-digest" }]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
});
