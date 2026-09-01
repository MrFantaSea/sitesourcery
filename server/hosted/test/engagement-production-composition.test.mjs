import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  assertProductionEngagementReady,
  createProductionEngagementBootstrap
} from "../engagement-production-composition.mjs";

const LEGAL = Object.freeze({
  acceptanceSchema: "sitesourcery.project-legal-acceptance/v7",
  authorityDigest: "a".repeat(64),
  documents: Object.freeze([]),
  documentBindings: Object.freeze([]),
  artifactBindings: Object.freeze([])
});

test("absent released legal authority keeps production engagement held", async () => {
  const boundary = createProductionEngagementBootstrap({
    legalAuthority: null
  });
  assert.deepEqual(await boundary.readiness(), {
    state: "held",
    providerEffects: false
  });
  await assert.doesNotReject(() =>
    assertProductionEngagementReady({
      legalAuthority: null,
      engagementBootstrap: boundary
    })
  );
});

test("released legal authority composes through the versioned pepper owner", async () => {
  let selectedFactory = null;
  let selectedOptions = null;
  const repository = {
    readiness: async () => ({ ready: true }),
    issueInvitation() {},
    claimInvitation() {}
  };
  const boundary = createProductionEngagementBootstrap({
    authority: { service() {} },
    legalAuthority: LEGAL,
    identityPepperConfiguration: {
      compose(factory, options) {
        selectedFactory = factory;
        selectedOptions = options;
        return repository;
      }
    },
    tokenSecret: randomBytes(32)
  });
  assert.equal(typeof selectedFactory, "function");
  assert.deepEqual(selectedOptions, {
    authority: { service: selectedOptions.authority.service },
    legalAuthority: LEGAL
  });
  assert.deepEqual(await assertProductionEngagementReady({
    legalAuthority: LEGAL,
    engagementBootstrap: boundary
  }), {
    state: "ready",
    providerEffects: false,
    invitationSchema:
      "sitesourcery.customer-engagement-invitation/v1",
    claimSchema: "sitesourcery.customer-engagement-claim/v1"
  });
});

test("released legal authority fails closed on missing secrets or storage", async () => {
  assert.throws(
    () => createProductionEngagementBootstrap({
      authority: { service() {} },
      legalAuthority: LEGAL,
      identityPepperConfiguration: { compose() {} },
      tokenSecret: Buffer.alloc(31)
    }),
    (error) =>
      error.code ===
      "ENGAGEMENT_PRODUCTION_CONFIGURATION_INVALID"
  );
  await assert.rejects(
    () => assertProductionEngagementReady({
      legalAuthority: LEGAL,
      engagementBootstrap: {
        readiness: async () => ({
          state: "held",
          providerEffects: false
        })
      }
    }),
    (error) =>
      error.code ===
      "ENGAGEMENT_PRODUCTION_CONFIGURATION_INVALID"
  );
});
