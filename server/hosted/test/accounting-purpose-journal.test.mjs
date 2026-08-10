import assert from "node:assert/strict";
import test from "node:test";

import {
  createAccountingPurposeJournal,
  createHeldAccountingPurposeJournal
} from "../accounting-purpose-journal.mjs";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OPERATOR_ORG = "22222222-2222-4222-8222-222222222222";
const DIGEST = "a".repeat(64);
const NOW = "2026-08-10T18:00:00.000Z";

function fixture() {
  const calls = [];
  const repository = {
    async readiness() { return { ready: true }; },
    async synchronize() {
      calls.push(["synchronize"]);
      return { insertedCount: 0 };
    },
    async list(input) {
      calls.push(["list", input]);
      return {
        schema: "sitesourcery.accounting-purpose-journal/v1",
        entries: [],
        nextCursor: null
      };
    },
    async exportRows(input) {
      calls.push(["export", input]);
      return [];
    }
  };
  return {
    calls,
    service: createAccountingPurposeJournal({ repository })
  };
}

test("accounting journal is held by default and cannot create effects", async () => {
  const service = createHeldAccountingPurposeJournal();
  assert.deepEqual(await service.readiness(), {
    ready: false,
    verified: false,
    kind: "accounting-purpose-journal",
    mode: "held",
    code: "ACCOUNTING_PURPOSE_HELD",
    sourceAuthoritative: false,
    authoritativeAccounting: false,
    commercialEffects: false,
    providerEffects: false
  });
  for (const method of ["synchronize", "list", "export"]) {
    await assert.rejects(service[method]({}), {
      code: "ACCOUNTING_PURPOSE_HELD"
    });
  }
});

test("read is exact, bounded, and operator-scoped", async () => {
  const { calls, service } = fixture();
  await service.list({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    cursor: null,
    limit: 50
  });
  assert.deepEqual(calls[0], ["list", {
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    cursor: null,
    limit: 50
  }]);
  assert.throws(() => service.list({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    cursor: null,
    limit: 201
  }), { code: "ACCOUNTING_PURPOSE_INVALID" });
  assert.throws(() => service.list({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    cursor: null,
    limit: 50,
    providerRead: true
  }), { code: "ACCOUNTING_PURPOSE_INVALID" });
});

test("cursor and export contracts reject shape expansion", async () => {
  const { calls, service } = fixture();
  await service.list({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    cursor: { occurredAt: NOW, idempotencyDigest: DIGEST },
    limit: 1
  });
  const exported = await service.export({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    asOf: NOW
  });
  assert.equal(exported.schema,
    "sitesourcery.accounting-purpose-journal-export/v1");
  assert.equal(exported.sourceAuthoritative, false);
  assert.equal(exported.authoritativeAccounting, false);
  assert.equal(exported.providerEffects, false);
  assert.equal(exported.rowCount, 0);
  assert.match(exported.exportDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(calls.map(([method]) => method), ["list", "export"]);
  await assert.rejects(service.export({
    actorId: ACTOR,
    operatorOrganizationId: OPERATOR_ORG,
    asOf: NOW,
    settlementStatus: "paid"
  }), { code: "ACCOUNTING_PURPOSE_INVALID" });
});

test("active construction requires the complete narrow repository", () => {
  assert.throws(
    () => createAccountingPurposeJournal({ repository: {} }),
    { code: "ACCOUNTING_PURPOSE_CONFIGURATION_REQUIRED" }
  );
});
