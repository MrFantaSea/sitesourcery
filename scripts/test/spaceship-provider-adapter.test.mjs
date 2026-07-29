import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpaceshipRegistrarAdapter,
  SPACESHIP_API_ORIGIN,
  SPACESHIP_ASYNC_OPERATION_HEADER,
  SPACESHIP_MCP_PREVIEW_SOURCE
} from "../../server/domain/adapters/spaceship.mjs";
import { digest, normalizeDomain } from "../../server/domain/canonical.mjs";
import { ExternalEffectError } from "../../server/domain/errors.mjs";
import {
  ORDER_STATES,
  createDomainAccountBoundary,
  createDomainOrchestrator,
  createFakeDomainPorts,
  createMemoryDomainRepository
} from "../../server/domain/index.mjs";
import {
  assessSpaceshipStagingReadiness,
  SPACESHIP_REQUIRED_SCOPES
} from "../../server/domain/spaceship-readiness.mjs";

const NOW = "2026-07-28T16:00:00.000Z";
const CONTACT_ID = "A".repeat(27);
const CONTACT_ID_2 = "B".repeat(27);
const CONTACT = Object.freeze({
  firstName: "Avery",
  lastName: "River",
  email: "avery@example.test",
  address1: "10 Main Street",
  city: "Richmond",
  country: "US",
  stateProvince: "VA",
  postalCode: "23219",
  phone: "+1.2025550142"
});
const CONTACT_IDS = Object.freeze({
  registrant: CONTACT_ID,
  admin: CONTACT_ID,
  tech: CONTACT_ID,
  billing: CONTACT_ID
});

test("default composition is held and performs no provider call", async () => {
  const registrar = createSpaceshipRegistrarAdapter();
  await assert.rejects(
    registrar.getDomain({ domain: "example.com" }),
    (error) =>
      error instanceof ExternalEffectError &&
      error.code === "external_effect_held" &&
      error.certainty === "not_submitted"
  );
});

test("contract_test cannot use the process network fetch", () => {
  assert.throws(
    () =>
      createSpaceshipRegistrarAdapter({
        mode: "contract_test",
        testOnly: true,
        fetchImpl: globalThis.fetch,
        clock: clock(),
        vault: createVault()
      }),
    (error) => error.code === "spaceship_test_mode_network_forbidden"
  );
});

test("approved_live requires environment approval and written Spaceship consent", () => {
  assert.throws(
    () =>
      createSpaceshipRegistrarAdapter({
        mode: "approved_live",
        fetchImpl: async () => {
          throw new Error("must not run");
        },
        clock: clock(),
        vault: createVault(),
        liveApproval: {
          provider: "spaceship",
          approved: true,
          environment: "staging",
          approvalId: "owner-approval-1",
          approvedAt: NOW,
          capabilities: []
        }
      }),
    (error) => error.code === "spaceship_live_approval_missing"
  );
});

test("transport uses only the fixed HTTPS origin and secret headers never enter events", async () => {
  const events = [];
  const requests = [];
  const registrar = adapter({
    eventSink: (event) => events.push(event),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return json({
        status: "pending",
        type: "domains_Create",
        details: {},
        createdAt: NOW,
        modifiedAt: null
      });
    }
  });
  const result = await registrar.getOperation({ operationId: "abc123" });
  assert.equal(result.status, "pending");
  assert.equal(new URL(requests[0].url).origin, SPACESHIP_API_ORIGIN);
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/async-operations/abc123");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.headers["X-API-Key"], "test-api-key");
  assert.equal(requests[0].init.headers["X-API-Secret"], "test-api-secret");
  const serializedEvents = JSON.stringify(events);
  assert.doesNotMatch(serializedEvents, /test-api-key|test-api-secret/u);
  assert.deepEqual(Object.keys(events[0]).sort(), [
    "at",
    "method",
    "path",
    "provider",
    "result",
    "status"
  ]);
});

test("IDNA input is converted to the required A-label and invalid domains never fetch", async () => {
  let calls = 0;
  const registrar = adapter({
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(
        new URL(url).pathname,
        "/api/v1/domains/xn--bcher-kva.example"
      );
      return json(domainReadback("xn--bcher-kva.example"));
    }
  });
  assert.equal(normalizeDomain("BÜCHER.example."), "xn--bcher-kva.example");
  assert.equal(
    (await registrar.getDomain({ domain: "BÜCHER.example." })).name,
    "xn--bcher-kva.example"
  );
  await assert.rejects(
    registrar.getDomain({ domain: "bad_domain.example" }),
    (error) => error.code === "invalid_domain"
  );
  assert.equal(calls, 1);
});

test("preview binds availability to a current documented no-charge integer USD source", async () => {
  const calls = [];
  const previewCalls = [];
  const registrar = adapter({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return json({
        domain: "cedar.example",
        result: "available",
        premiumPricing: []
      });
    },
    pricePreview: {
      async previewRegistration(input) {
        previewCalls.push(input);
        return exactPreview({ domain: input.domain, years: input.years });
      }
    }
  });
  const result = await registrar.previewRegistration(registrationInput());
  assert.deepEqual(result.price, { amountMinor: 1900, currency: "USD" });
  assert.equal(result.status, "confirmation_required");
  assert.equal(result.noCharge, true);
  assert.equal(result.priceSource, SPACESHIP_MCP_PREVIEW_SOURCE);
  assert.equal(calls.length, 1);
  assert.equal(previewCalls.length, 1);
  assert.deepEqual(previewCalls[0].contacts, CONTACT_IDS);
});

test("unavailable domains never reach the price source", async () => {
  let priceCalls = 0;
  const registrar = adapter({
    fetchImpl: async () =>
      json({ domain: "cedar.example", result: "taken", premiumPricing: [] }),
    pricePreview: {
      async previewRegistration() {
        priceCalls += 1;
        throw new Error("must not run");
      }
    }
  });
  const result = await registrar.previewRegistration(registrationInput());
  assert.deepEqual(result, {
    status: "unavailable",
    domain: "cedar.example",
    reason: "taken"
  });
  assert.equal(priceCalls, 0);
});

test("standard-domain preview fails closed without a configured price source", async () => {
  const registrar = adapter({
    fetchImpl: async () =>
      json({ domain: "cedar.example", result: "available", premiumPricing: [] }),
    omitPricePreview: true
  });
  await assert.rejects(
    registrar.previewRegistration(registrationInput()),
    (error) =>
      error instanceof ExternalEffectError &&
      error.code === "spaceship_price_preview_unconfigured" &&
      error.certainty === "not_submitted"
  );
});

for (const [label, mutate, code] of [
  [
    "wrong provenance",
    (value) => ({ ...value, source: "invented-price" }),
    "spaceship_price_preview_untrusted"
  ],
  [
    "charged response",
    (value) => ({ ...value, noCharge: false }),
    "spaceship_price_preview_untrusted"
  ],
  [
    "wrong domain",
    (value) => ({ ...value, domain: "other.example" }),
    "spaceship_price_preview_untrusted"
  ],
  [
    "fractional minor units",
    (value) => ({ ...value, price: { amountMinor: 19.5, currency: "USD" } }),
    "spaceship_price_preview_invalid"
  ],
  [
    "non-USD money",
    (value) => ({ ...value, price: { amountMinor: 1900, currency: "EUR" } }),
    "spaceship_price_preview_invalid"
  ],
  [
    "stale observation",
    (value) => ({ ...value, observedAt: "2026-07-28T15:58:00.000Z" }),
    "spaceship_price_preview_stale"
  ]
]) {
  test(`price preview rejects ${label}`, async () => {
    const registrar = adapter({
      fetchImpl: async () =>
        json({ domain: "cedar.example", result: "available", premiumPricing: [] }),
      pricePreview: {
        async previewRegistration() {
          return mutate(exactPreview());
        }
      }
    });
    await assert.rejects(
      registrar.previewRegistration(registrationInput()),
      (error) => error.code === code
    );
  });
}

test("irreversible confirmation dispatches exactly once and requires the exact async header", async () => {
  let calls = 0;
  const registrar = adapter({
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(new URL(url).pathname, "/api/v1/domains/cedar.example");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        autoRenew: false,
        years: 1,
        privacyProtection: { level: "high", userConsent: true },
        contacts: CONTACT_IDS
      });
      return new Response(null, {
        status: 202,
        headers: { [SPACESHIP_ASYNC_OPERATION_HEADER]: "op123" }
      });
    }
  });
  const result = await registrar.confirmRegistration(registrationInput());
  assert.deepEqual(result, { operationId: "op123", price: null });
  assert.equal(calls, 1);
});

for (const [label, responseFactory, certainty, code] of [
  [
    "authoritative 422",
    () => problem(422),
    "not_submitted",
    "spaceship_http_422"
  ],
  ["server 500", () => problem(500), "ambiguous", "spaceship_http_500"],
  [
    "missing operation id",
    () => new Response(null, { status: 202 }),
    "ambiguous",
    "spaceship_confirmation_operation_missing"
  ],
  [
    "malformed operation id",
    () =>
      new Response(null, {
        status: 202,
        headers: { [SPACESHIP_ASYNC_OPERATION_HEADER]: "../secret" }
      }),
    "ambiguous",
    "spaceship_confirmation_operation_missing"
  ],
  [
    "malformed accepted JSON",
    () =>
      new Response("{", {
        status: 202,
        headers: {
          [SPACESHIP_ASYNC_OPERATION_HEADER]: "op123",
          "content-type": "application/json"
        }
      }),
    "ambiguous",
    "spaceship_response_json_invalid"
  ]
]) {
  test(`confirmation classifies ${label} without retry`, async () => {
    let calls = 0;
    const registrar = adapter({
      fetchImpl: async () => {
        calls += 1;
        return responseFactory();
      }
    });
    await assert.rejects(
      registrar.confirmRegistration(registrationInput()),
      (error) =>
        error instanceof ExternalEffectError &&
        error.code === code &&
        error.certainty === certainty
    );
    assert.equal(calls, 1);
  });
}

test("confirmation reset and timeout are ambiguous and never retried", async () => {
  let resetCalls = 0;
  const resetRegistrar = adapter({
    fetchImpl: async () => {
      resetCalls += 1;
      throw new TypeError("ECONNRESET api secret test-api-secret");
    }
  });
  await assert.rejects(
    resetRegistrar.confirmRegistration(registrationInput()),
    (error) =>
      error instanceof ExternalEffectError &&
      error.code === "spaceship_effect_transport_ambiguous" &&
      error.certainty === "ambiguous" &&
      !error.message.includes("test-api-secret")
  );
  assert.equal(resetCalls, 1);

  let timeoutCalls = 0;
  const timeoutRegistrar = adapter({
    config: { timeoutMs: 50 },
    fetchImpl: async (_url, init) => {
      timeoutCalls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true
        });
      });
    }
  });
  await assert.rejects(
    timeoutRegistrar.confirmRegistration(registrationInput()),
    (error) => error.certainty === "ambiguous"
  );
  assert.equal(timeoutCalls, 1);
});

test("read transport bounds bodies and rejects malformed JSON", async () => {
  const oversized = adapter({
    config: { maxBodyBytes: 1024 },
    fetchImpl: async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2048"
        }
      })
  });
  await assert.rejects(
    oversized.getOperation({ operationId: "op123" }),
    (error) =>
      error.code === "spaceship_response_too_large" &&
      error.certainty === "not_submitted"
  );

  const malformed = adapter({
    fetchImpl: async () =>
      new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  await assert.rejects(
    malformed.getOperation({ operationId: "op123" }),
    (error) =>
      error.code === "spaceship_response_json_invalid" &&
      error.certainty === "not_submitted"
  );
});

test("contacts use a durable claim, one provider save, exact readback, and opaque IDs", async () => {
  const requests = [];
  const vault = createVault();
  const registrar = adapter({
    vault,
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, init });
      if (init.method === "PUT") {
        const body = JSON.parse(init.body);
        assert.equal(body.email, CONTACT.email);
        assert.equal(Object.hasOwn(body, "fax"), false);
        return json({ contactId: CONTACT_ID });
      }
      return json(CONTACT);
    }
  });
  const result = await registrar.ensureContacts({
    tenantId: "tenant_1",
    customerId: "customer_1",
    registrantProfileRef: "vault://profile/1",
    registrantProfileDigest: "profile-digest-1"
  });
  assert.deepEqual(result, CONTACT_IDS);
  assert.equal(
    requests.filter((request) => request.init.method === "PUT").length,
    1
  );
  assert.equal(
    requests.filter((request) => request.init.method === "GET").length,
    4
  );
  assert.equal(vault.state.completed, 1);
  assert.equal(vault.state.unknown, 0);
});

test("ready contact bindings are read back and never saved again", async () => {
  const vault = createVault({ readyContactId: CONTACT_ID });
  let writes = 0;
  let reads = 0;
  const registrar = adapter({
    vault,
    fetchImpl: async (_url, init) => {
      if (init.method === "PUT") writes += 1;
      if (init.method === "GET") reads += 1;
      return json(CONTACT);
    }
  });
  await registrar.ensureContacts({
    tenantId: "tenant_1",
    customerId: "customer_1",
    registrantProfileRef: "vault://profile/1",
    registrantProfileDigest: "profile-digest-1"
  });
  assert.equal(writes, 0);
  assert.equal(reads, 4);
});

test("authoritative contact validation rejection releases the unused claim", async () => {
  const vault = createVault();
  const registrar = adapter({
    vault,
    fetchImpl: async () => problem(422)
  });
  await assert.rejects(
    registrar.ensureContacts({
      tenantId: "tenant_1",
      customerId: "customer_1",
      registrantProfileRef: "vault://profile/1",
      registrantProfileDigest: "profile-digest-1"
    }),
    (error) =>
      error.code === "spaceship_http_422" &&
      error.certainty === "not_submitted"
  );
  assert.equal(vault.state.released, 1);
  assert.equal(vault.state.unknown, 0);
});

test("an ambiguous contact save is durably stopped and cannot be repeated", async () => {
  const vault = createVault();
  let calls = 0;
  const registrar = adapter({
    vault,
    fetchImpl: async () => {
      calls += 1;
      return problem(500);
    }
  });
  const input = {
    tenantId: "tenant_1",
    customerId: "customer_1",
    registrantProfileRef: "vault://profile/1",
    registrantProfileDigest: "profile-digest-1"
  };
  await assert.rejects(
    registrar.ensureContacts(input),
    (error) =>
      error.code === "spaceship_contact_effect_unknown" &&
      error.certainty === "ambiguous"
  );
  assert.equal(vault.state.unknown, 1);
  await assert.rejects(
    registrar.ensureContacts(input),
    (error) =>
      error.code === "spaceship_contact_effect_unknown" &&
      error.certainty === "ambiguous"
  );
  assert.equal(calls, 1);
});

test("an accepted contact save followed by failed readback stays unknown, never releasable", async () => {
  const vault = createVault();
  const responses = [json({ contactId: CONTACT_ID }), problem(404)];
  let calls = 0;
  const registrar = adapter({
    vault,
    fetchImpl: async () => {
      calls += 1;
      return responses.shift();
    }
  });
  const input = {
    tenantId: "tenant_1",
    customerId: "customer_1",
    registrantProfileRef: "vault://profile/1",
    registrantProfileDigest: "profile-digest-1"
  };
  await assert.rejects(
    registrar.ensureContacts(input),
    (error) =>
      error.code === "spaceship_contact_effect_unknown" &&
      error.certainty === "ambiguous"
  );
  assert.equal(vault.state.released, 0);
  assert.equal(vault.state.unknown, 1);
  await assert.rejects(registrar.ensureContacts(input));
  assert.equal(calls, 2);
});

test("contact PII and provider secrets never enter emitted events or adapter errors", async () => {
  const events = [];
  const registrar = adapter({
    eventSink: (event) => events.push(event),
    fetchImpl: async () => problem(500)
  });
  let thrown;
  try {
    await registrar.ensureContacts({
      tenantId: "tenant_1",
      customerId: "customer_1",
      registrantProfileRef: "vault://profile/1",
      registrantProfileDigest: "profile-digest-1"
    });
  } catch (error) {
    thrown = error;
  }
  const serialized = JSON.stringify({
    events,
    error: {
      code: thrown.code,
      message: thrown.message,
      details: thrown.details
    }
  });
  for (const secret of [
    CONTACT.email,
    CONTACT.address1,
    CONTACT.phone,
    "test-api-key",
    "test-api-secret"
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("operation and domain readback validate documented provider state", async () => {
  const responses = [
    json({
      status: "success",
      type: "domains_Create",
      details: {},
      createdAt: NOW,
      modifiedAt: NOW
    }),
    json(domainReadback("cedar.example"))
  ];
  const registrar = adapter({
    fetchImpl: async () => responses.shift()
  });
  assert.equal(
    (await registrar.getOperation({ operationId: "op123" })).status,
    "success"
  );
  const domain = await registrar.getDomain({ domain: "cedar.example" });
  assert.equal(domain.lifecycleStatus, "registered");
  assert.equal(domain.contacts.registrant, CONTACT_ID);
  assert.equal(domain.nameservers.provider, "basic");
});

test("transfer assessment uses readback, 60-day rules, suspensions, and blocking EPP state", async () => {
  const old = domainReadback("cedar.example", {
    registrationDate: "2025-01-01T00:00:00.000Z",
    eppStatuses: ["clientTransferProhibited"]
  });
  const registrar = adapter({ fetchImpl: async () => json(old) });
  const result = await registrar.assessTransferOut({
    domain: "cedar.example",
    registrationDate: old.registrationDate
  });
  assert.equal(result.eligible, true);
  assert.equal(result.locked, true);
  assert.ok(result.manualPolicyChecksStillRequired.includes("unpaid_fees"));

  const young = adapter({
    fetchImpl: async () =>
      json(
        domainReadback("cedar.example", {
          registrationDate: "2026-07-20T00:00:00.000Z",
          eppStatuses: []
        })
      )
  });
  assert.equal(
    (
      await young.assessTransferOut({
        domain: "cedar.example",
        registrationDate: "2026-07-20T00:00:00.000Z"
      })
    ).reason,
    "initial_60_day_transfer_lock"
  );
});

test("transfer lock is read-before-write, no-ops locally, mutates once, and verifies readback", async () => {
  let noOpCalls = 0;
  const noOp = adapter({
    fetchImpl: async () => {
      noOpCalls += 1;
      return json(
        domainReadback("cedar.example", {
          eppStatuses: ["clientTransferProhibited"]
        })
      );
    }
  });
  assert.deepEqual(
    await noOp.setTransferLock({ domain: "cedar.example", locked: true }),
    { locked: true, changed: false }
  );
  assert.equal(noOpCalls, 1);

  const methods = [];
  const responses = [
    json(domainReadback("cedar.example", { eppStatuses: ["clientTransferProhibited"] })),
    json({ isLocked: false }),
    json(domainReadback("cedar.example", { eppStatuses: [] }))
  ];
  const unlock = adapter({
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return responses.shift();
    }
  });
  assert.deepEqual(
    await unlock.setTransferLock({ domain: "cedar.example", locked: false }),
    { locked: false, changed: true }
  );
  assert.deepEqual(methods, ["GET", "PUT", "GET"]);
});

test("auth code is returned only to the caller with the documented expiry mapping", async () => {
  const events = [];
  const registrar = adapter({
    eventSink: (event) => events.push(event),
    fetchImpl: async () =>
      json({ authCode: "epp-secret-code", expires: "2026-07-29T16:00:00.000Z" })
  });
  assert.deepEqual(await registrar.getAuthCode({ domain: "cedar.example" }), {
    authCode: "epp-secret-code",
    expiresAt: "2026-07-29T16:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(events), /epp-secret-code/u);
});

test("nameserver changes no-op on current state and verify a real mutation by readback", async () => {
  let calls = 0;
  const basic = adapter({
    fetchImpl: async () => {
      calls += 1;
      return json(domainReadback("cedar.example"));
    }
  });
  assert.deepEqual(
    await basic.setNameservers({ domain: "cedar.example", provider: "basic" }),
    { provider: "basic", hosts: [], changed: false }
  );
  assert.equal(calls, 1);

  const hosts = ["ns1.host.example", "ns2.host.example"];
  const methods = [];
  const responses = [
    json(domainReadback("cedar.example")),
    json({ hosts }),
    json(
      domainReadback("cedar.example", {
        nameservers: { provider: "custom", hosts }
      })
    )
  ];
  const custom = adapter({
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return responses.shift();
    }
  });
  assert.deepEqual(
    await custom.setNameservers({
      domain: "cedar.example",
      provider: "custom",
      hosts
    }),
    { provider: "custom", hosts, changed: true }
  );
  assert.deepEqual(methods, ["GET", "PUT", "GET"]);
});

test("hosted DNS records are validated, written once, and confirmed by readback", async () => {
  const methods = [];
  const record = { type: "A", name: "@", address: "192.0.2.10", ttl: 300 };
  const responses = [
    new Response(null, { status: 204 }),
    json({ items: [record], total: 1 })
  ];
  const registrar = adapter({
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return responses.shift();
    }
  });
  assert.deepEqual(
    await registrar.saveDnsRecords({
      domain: "cedar.example",
      records: [record]
    }),
    { saved: 1 }
  );
  assert.deepEqual(methods, ["PUT", "GET"]);

  let invalidCalls = 0;
  const invalid = adapter({
    fetchImpl: async () => {
      invalidCalls += 1;
      throw new Error("must not fetch");
    }
  });
  await assert.rejects(
    invalid.saveDnsRecords({
      domain: "cedar.example",
      records: [{ type: "A", name: "@", address: "999.1.1.1" }]
    }),
    (error) => error.code === "spaceship_dns_record_invalid"
  );
  assert.equal(invalidCalls, 0);
});

test("DNS deletion verifies absence and reports ambiguous readback mismatch", async () => {
  const record = { type: "TXT", name: "@", value: "verify=abc" };
  const ok = adapter({
    fetchImpl: sequence([
      new Response(null, { status: 204 }),
      json({ items: [], total: 0 })
    ])
  });
  assert.deepEqual(
    await ok.deleteDnsRecords({ domain: "cedar.example", records: [record] }),
    { deleted: 1 }
  );

  const mismatch = adapter({
    fetchImpl: sequence([
      new Response(null, { status: 204 }),
      json({ items: [record], total: 1 })
    ])
  });
  await assert.rejects(
    mismatch.deleteDnsRecords({ domain: "cedar.example", records: [record] }),
    (error) =>
      error.code === "spaceship_dns_delete_readback_ambiguous" &&
      error.certainty === "ambiguous"
  );
});

test("the adapter satisfies the orchestrator contract and holds capture when REST cannot prove final charge", async () => {
  const registrar = adapter({
    fetchImpl: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/api/v1/contacts" && init.method === "PUT") {
        return json({ contactId: CONTACT_ID });
      }
      if (pathname === `/api/v1/contacts/${CONTACT_ID}`) return json(CONTACT);
      if (pathname === "/api/v1/domains/cedar.example/available") {
        return json({
          domain: "cedar.example",
          result: "available",
          premiumPricing: []
        });
      }
      if (pathname === "/api/v1/domains/cedar.example" && init.method === "POST") {
        return new Response(null, {
          status: 202,
          headers: { [SPACESHIP_ASYNC_OPERATION_HEADER]: "operation123" }
        });
      }
      if (pathname === "/api/v1/async-operations/operation123") {
        return json({
          status: "success",
          type: "domains_Create",
          details: {},
          createdAt: NOW,
          modifiedAt: NOW
        });
      }
      if (pathname === "/api/v1/domains/cedar.example" && init.method === "GET") {
        return json(domainReadback("cedar.example"));
      }
      throw new Error(`unexpected mock route ${init.method} ${pathname}`);
    }
  });
  const fake = createFakeDomainPorts({ now: NOW });
  const repository = createMemoryDomainRepository();
  const orchestrator = createDomainOrchestrator({
    ports: {
      repository,
      registrar,
      payments: fake.payments,
      secrets: fake.secrets,
      clock: fake.clock,
      ids: fake.ids
    },
    config: { mutationMode: "fake", serviceFeeMinor: 0 }
  });
  const boundary = createDomainAccountBoundary(orchestrator);
  const session = {
    tenantId: "tenant_1",
    customerId: "customer_1",
    actorId: "customer_1",
    roles: []
  };
  const execute = (action, body) => boundary.execute({ session, action, body });
  let order = await execute("create", {
    commandId: "spaceship_create_1",
    projectId: "project_1",
    domain: "cedar.example",
    years: 1
  });
  order = await execute("consent", {
    commandId: "spaceship_consent_1",
    orderId: order.id,
    consentEvidenceId: "consent_evidence_1",
    actorSessionId: "session_1",
    ipHash: "ip_digest_1",
    userAgentHash: "ua_digest_1",
    registrantProfileRef: "vault://profile/1",
    registrantProfileDigest: "profile-digest-1",
    agreements: requiredAgreements()
  });
  order = await execute("quote", {
    commandId: "spaceship_quote_1",
    orderId: order.id
  });
  assert.equal(order.quote.price.amountMinor, 1900);
  order = await execute("accept_quote", {
    commandId: "spaceship_accept_1",
    orderId: order.id,
    acceptedAmountMinor: 1900,
    priceConsentEvidenceId: "price_consent_1"
  });
  order = await execute("authorize_payment", {
    commandId: "spaceship_authorize_1",
    orderId: order.id,
    paymentMethodRef: "pm_test"
  });
  order = await execute("revalidate", {
    commandId: "spaceship_revalidate_1",
    orderId: order.id
  });
  order = await execute("confirm", {
    commandId: "spaceship_confirm_1",
    orderId: order.id,
    executionApproval: {
      approvalId: "fake_spaceship_approval_1",
      approvedBy: "customer_1",
      approvedAt: NOW,
      scope: "domain_registration",
      environment: "fake",
      tenantId: "tenant_1",
      orderId: order.id,
      domain: order.domain,
      quoteDigest: digest(order.acceptedQuote)
    }
  });
  assert.equal(order.state, ORDER_STATES.REGISTRATION_PENDING_REVIEW);
  assert.equal(order.registration.providerPrice, null);
  order = await execute("poll_registration", {
    commandId: "spaceship_poll_1",
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.ACTIVE_PAYMENT_REVIEW);
  assert.equal(order.review.reason, "active_domain_provider_charge_unknown");
  assert.equal(fake.calls.capture, 0);
});

test("readiness is held by default and can become ready without provider or vault access", () => {
  const held = assessSpaceshipStagingReadiness();
  assert.equal(held.ready, false);
  assert.equal(held.provider, "held");
  assert.equal(held.providerCalls, 0);
  assert.equal(held.billedMutations, 0);
  assert.equal(held.credentialsRead, false);
  assert.ok(held.missing.includes("providerWrittenResaleConsentRef"));

  const ready = assessSpaceshipStagingReadiness({
    provider: "spaceship",
    environment: "staging",
    ownerApprovalId: "owner-approved",
    publicationReleaseApprovalId: "release-approved",
    providerWrittenResaleConsentRef: "spaceship-legal-letter-1",
    credentialVaultRef: "vault://spaceship/credentials",
    contactVaultRef: "vault://spaceship/contacts",
    pricePreviewBridgeRef: "service://spaceship-price-preview",
    pricePreviewSource: SPACESHIP_MCP_PREVIEW_SOURCE,
    domainTermsVersion: "spaceship-domain-2025-02-10",
    privacyTermsVersion: "spaceship-whois-2024-12-13",
    registrantDisclosureVersion: "sitesourcery-domain-disclosure-1",
    scopes: SPACESHIP_REQUIRED_SCOPES
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
  assert.equal(ready.providerCalls, 0);
});

function adapter({
  fetchImpl,
  vault = createVault(),
  pricePreview,
  omitPricePreview = false,
  eventSink,
  config
} = {}) {
  return createSpaceshipRegistrarAdapter({
    mode: "contract_test",
    testOnly: true,
    fetchImpl:
      fetchImpl ??
      (async () => {
        throw new Error("unexpected provider request");
      }),
    clock: clock(),
    vault,
    pricePreview: omitPricePreview ? undefined : pricePreview ?? defaultPricePreview(),
    eventSink,
    config
  });
}

function clock() {
  return { now: () => NOW };
}

function defaultPricePreview() {
  return {
    async previewRegistration(input) {
      return exactPreview({ domain: input.domain, years: input.years });
    }
  };
}

function exactPreview({ domain = "cedar.example", years = 1 } = {}) {
  return {
    source: SPACESHIP_MCP_PREVIEW_SOURCE,
    noCharge: true,
    status: "confirmation_required",
    domain,
    years,
    observedAt: NOW,
    evidenceId: "preview-evidence-1",
    price: { amountMinor: 1900, currency: "USD" }
  };
}

function registrationInput(overrides = {}) {
  return {
    tenantId: "tenant_1",
    domain: "cedar.example",
    years: 1,
    autoRenew: false,
    privacy: { level: "high", userConsent: true },
    contacts: CONTACT_IDS,
    expectedPrice: { amountMinor: 1900, currency: "USD" },
    ...overrides
  };
}

function requiredAgreements() {
  return [
    "agency_authorization",
    "spaceship_disclosure",
    "customer_is_registrant",
    "irreversible_registration",
    "domain_price",
    "privacy_processing",
    "transfer_rights"
  ].map((key) => ({
    key,
    documentVersion: "2026-07-28",
    documentDigest: `${key}-digest`,
    acceptedAt: NOW
  }));
}

function domainReadback(domain, overrides = {}) {
  return {
    name: domain,
    unicodeName: domain,
    isPremium: false,
    autoRenew: false,
    registrationDate: "2025-01-01T00:00:00.000Z",
    expirationDate: "2027-01-01T00:00:00.000Z",
    lifecycleStatus: "registered",
    verificationStatus: "success",
    eppStatuses: [],
    suspensions: [],
    privacyProtection: { level: "high", contactForm: true },
    nameservers: {
      provider: "basic",
      hosts: ["ns1.spaceship.example", "ns2.spaceship.example"]
    },
    contacts: {
      registrant: CONTACT_ID,
      admin: CONTACT_ID,
      tech: CONTACT_ID,
      billing: CONTACT_ID,
      attributes: []
    },
    ...overrides
  };
}

function createVault({ readyContactId = null } = {}) {
  const contacts = new Map();
  const claims = new Map();
  const state = {
    completed: 0,
    released: 0,
    unknown: 0,
    credentialsRead: 0
  };
  if (readyContactId) contacts.set("all", readyContactId);
  return {
    state,
    async readProviderCredentials() {
      state.credentialsRead += 1;
      return { apiKey: "test-api-key", apiSecret: "test-api-secret" };
    },
    async readRegistrantProfile() {
      return {
        digest: "profile-digest-1",
        roles: {
          registrant: CONTACT,
          admin: CONTACT,
          tech: CONTACT,
          billing: CONTACT
        }
      };
    },
    async claimProviderContact({ contactFingerprint }) {
      if (contacts.has(contactFingerprint)) {
        return { state: "ready", contactId: contacts.get(contactFingerprint) };
      }
      if (contacts.has("all")) {
        return { state: "ready", contactId: contacts.get("all") };
      }
      if (claims.has(contactFingerprint)) return claims.get(contactFingerprint);
      const claim = {
        state: "claimed",
        claimId: `claim-${claims.size + 1}`,
        contactFingerprint
      };
      claims.set(contactFingerprint, claim);
      return claim;
    },
    async completeProviderContact({ claimId, contactId }) {
      const found = [...claims.values()].find((claim) => claim.claimId === claimId);
      assert.ok(found);
      contacts.set(found.contactFingerprint, contactId);
      claims.delete(found.contactFingerprint);
      state.completed += 1;
    },
    async releaseProviderContactClaim({ claimId }) {
      const found = [...claims.values()].find((claim) => claim.claimId === claimId);
      if (found) claims.delete(found.contactFingerprint);
      state.released += 1;
    },
    async markProviderContactUnknown({ claimId }) {
      const found = [...claims.values()].find((claim) => claim.claimId === claimId);
      if (found) {
        claims.set(found.contactFingerprint, {
          state: "unknown",
          claimId,
          contactFingerprint: found.contactFingerprint
        });
      }
      state.unknown += 1;
    }
  };
}

function json(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function problem(status) {
  return new Response(JSON.stringify({ detail: "provider detail must not leak" }), {
    status,
    headers: { "content-type": "application/problem+json" }
  });
}

function sequence(responses) {
  return async () => {
    assert.ok(responses.length > 0, "unexpected provider request");
    return responses.shift();
  };
}
