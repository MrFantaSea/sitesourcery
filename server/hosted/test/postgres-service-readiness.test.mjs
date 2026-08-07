import assert from "node:assert/strict";
import test from "node:test";

import { createHeldCatalogPort } from "../../commerce/adapters/held.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";

const ACTOR = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001"
});

function createService(catalogPort) {
  let authorityServiceCalls = 0;
  const service = createCanonicalPostgresService({
    authority: {
      kind: "canonical-postgres",
      async readiness() {
        return { ready: true, database: "test" };
      },
      async service() {
        authorityServiceCalls += 1;
        throw new Error("unexpected authority service call");
      }
    },
    identity: {
      authenticate() {},
      register() {},
      completeRegistration() {},
      async registrationReadiness() {
        return {
          ready: true,
          verified: true,
          mode: "production"
        };
      },
      signIn() {},
      signOut() {},
      issueRecoveryForDelivery() {},
      completeRecovery() {},
      requireRecentReauthentication() {}
    },
    compiler: {
      schema: "sitesourcery.spark-compiler/v1",
      revision: "test-revision",
      compile() {}
    },
    catalogPort,
    publicationPort: {
      kind: "held-publication",
      request() {},
      rollback() {},
      unpublish() {},
      async readiness() {
        return { ready: true, held: true };
      }
    },
    exportStore: {
      kind: "test-exports",
      key() {},
      put() {},
      get() {},
      delete() {}
    },
    recoveryMailPort: {
      async readiness() {
        return {
          ready: true,
          verified: true,
          mode: "production"
        };
      },
      deliver() {}
    }
  });
  return {
    service,
    authorityServiceCalls: () => authorityServiceCalls
  };
}

test("an explicit catalog hold keeps the account and project runtime ready", async () => {
  const context = createService(createHeldCatalogPort());
  const readiness = await context.service.readiness();

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.catalog, {
    ready: false,
    mode: "held",
    code: "catalog_unavailable"
  });
  assert.equal(readiness.providers.checkout, "held");
  assert.equal(context.authorityServiceCalls(), 0);
  await assert.rejects(
    context.service.getOfferCatalog(),
    (error) =>
      error?.code === "catalog_unavailable" &&
      error?.status === 503
  );
});

test("an unsealed Privacy V3 hold does not take down reads, but gates authority and project creation", async () => {
  const context = createService(createHeldCatalogPort());
  assert.equal((await context.service.readiness()).ready, true);
  await assert.rejects(
    context.service.getProjectLegalAuthority(),
    (error) =>
      error?.code === "LEGAL_CONFIGURATION_REQUIRED" &&
      error?.status === 503
  );
  await assert.rejects(
    context.service.createProject(
      ACTOR,
      "00000000-0000-4000-8000-000000000002",
      {
        name: "Held project",
        commandId: "privacy-v3-held-create"
      }
    ),
    (error) =>
      error?.code === "LEGAL_CONFIGURATION_REQUIRED" &&
      error?.status === 503
  );
  assert.equal(context.authorityServiceCalls(), 0);
});

test("an invalid configured catalog still fails runtime readiness closed", async () => {
  const context = createService({
    async current() {
      return {
        schema: "invalid-catalog",
        state: "hold"
      };
    }
  });
  const readiness = await context.service.readiness();

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.catalog, {
    ready: false,
    mode: "unavailable",
    code: "invalid_catalog"
  });
  assert.equal(context.authorityServiceCalls(), 0);
});
