import assert from "node:assert/strict";
import test from "node:test";

import { createHeldCatalogPort } from "../../commerce/adapters/held.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";

const ACTOR = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001"
});

function createService(catalogPort, {
  authorityService = null,
  compiler = null
} = {}) {
  let authorityServiceCalls = 0;
  const service = createCanonicalPostgresService({
    authority: {
      kind: "canonical-postgres",
      async readiness() {
        return { ready: true, database: "test" };
      },
      async service(...args) {
        authorityServiceCalls += 1;
        if (authorityService) return authorityService(...args);
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
    compiler: compiler ?? {
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

test("version compilation cannot run before authoritative project ownership", async () => {
  let compileCalls = 0;
  const context = createService(createHeldCatalogPort(), {
    authorityService: async (_options, work) => work({
      async query() {
        return { rowCount: 0, rows: [] };
      }
    }),
    compiler: {
      revision: "test-revision",
      compile() {
        compileCalls += 1;
        throw new Error("compiler must not run");
      }
    }
  });
  await assert.rejects(
    context.service.createVersion(
      ACTOR,
      "00000000-0000-4000-8000-000000000003",
      {
        rawFacts: {},
        reviewAttested: true,
        previewDigest: "a".repeat(64),
        commandId: "authority-before-compile-001"
      }
    ),
    (error) => error?.code === "NOT_FOUND" && error?.status === 404
  );
  assert.equal(compileCalls, 0);
});

test("compile quota is authoritative and runs before compiler work", async () => {
  let compileCalls = 0;
  const organizationId = "00000000-0000-4000-8000-000000000002";
  const context = createService(createHeldCatalogPort(), {
    authorityService: async (_options, work) => work({
      async query(statement) {
        const sql = String(statement).replace(/\s+/gu, " ").trim();
        if (sql.includes("from ss.projects project")) {
          return { rowCount: 1, rows: [{ organization_id: organizationId }] };
        }
        if (sql.includes("from ss.organization_memberships")) {
          return {
            rowCount: 1,
            rows: [{ role: "owner", state: "active" }]
          };
        }
        if (sql.startsWith("select request_digest, state, response_body")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.startsWith("insert into ss.idempotency_keys")) {
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("pg_advisory_xact_lock")) {
          return { rowCount: 1, rows: [{ locked: true }] };
        }
        if (sql.includes("select count(*)::integer as count")) {
          return {
            rowCount: 1,
            rows: [{
              count: sql.includes("route_key = 'project.version.create'") ? 21 : 1
            }]
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }
    }),
    compiler: {
      revision: "test-revision",
      compile() {
        compileCalls += 1;
        throw new Error("compiler must not run");
      }
    }
  });
  await assert.rejects(
    context.service.createVersion(
      ACTOR,
      "00000000-0000-4000-8000-000000000003",
      {
        rawFacts: {},
        reviewAttested: true,
        previewDigest: "a".repeat(64),
        commandId: "compile-quota-before-work-001"
      }
    ),
    (error) => error?.code === "COMPILE_RATE_LIMITED" && error?.status === 429
  );
  assert.equal(compileCalls, 0);
});

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
