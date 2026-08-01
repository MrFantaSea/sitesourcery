import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecoveryTransport,
  createRegistrationTransport,
  createResendMailTransport
} from "../resend-mail-transport.mjs";
import { createProductionRecoveryMailPort } from "../recovery-mail-port.mjs";
import { createProductionRegistrationMailPort } from "../registration-mail-port.mjs";

const API_KEY = [
  "re",
  "example",
  "key",
  "for",
  "tests",
  "only",
  "123456"
].join("_");
const DOMAIN_ID =
  "d91cd9bd-1176-453e-8fc1-35364d380206";
const NOW = "2026-08-01T18:30:00.000Z";
const ENVIRONMENT = Object.freeze({
  SITESOURCERY_RESEND_API_KEY: API_KEY,
  SITESOURCERY_RESEND_DOMAIN_ID: DOMAIN_ID
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function readyDomain(overrides = {}) {
  return {
    object: "domain",
    id: DOMAIN_ID,
    name: "sitesourcery.com",
    status: "verified",
    open_tracking: false,
    click_tracking: false,
    capabilities: {
      sending: "enabled",
      receiving: "disabled"
    },
    records: [
      {
        record: "SPF",
        type: "MX",
        status: "verified"
      },
      {
        record: "SPF",
        type: "TXT",
        status: "verified"
      },
      {
        record: "DKIM",
        type: "TXT",
        status: "verified"
      }
    ],
    ...overrides
  };
}

function registrationInput(overrides = {}) {
  return {
    schema:
      "sitesourcery.registration-verification-email/v1",
    template: "registration_verification",
    idempotencyKey:
      "registration_5df4bf26-294c-4bc8-9b44-c4488db94356",
    payloadDigest: "a".repeat(64),
    recipient: "owner@example.test",
    verificationUrl:
      "https://sitesourcery.com/abracadabra/app/#verify-registration=private-test-token-abcdefghijklmnopqrstuvwxyz",
    requestedAt: "2026-08-01T18:29:00.000Z",
    expiresAt: "2026-08-02T18:29:00.000Z",
    ...overrides
  };
}

function recoveryInput(overrides = {}) {
  return {
    schema: "sitesourcery.recovery-email/v1",
    template: "password_recovery",
    idempotencyKey:
      "recovery_221a58ce-b15f-4a36-92e0-b3c6ef03fc83",
    payloadDigest: "b".repeat(64),
    recipient: "owner@example.test",
    recoveryUrl:
      "https://sitesourcery.com/abracadabra/app/#recovery=private-test-token-abcdefghijklmnopqrstuvwxyz",
    requestedAt: "2026-08-01T18:29:00.000Z",
    expiresAt: "2026-08-01T20:29:00.000Z",
    ...overrides
  };
}

test("Resend transport requires only reviewed explicit credentials", () => {
  assert.throws(
    () => createResendMailTransport({ environment: {} }),
    (error) =>
      error?.code === "RESEND_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () =>
      createResendMailTransport({
        environment: {
          SITESOURCERY_RESEND_API_KEY: API_KEY,
          SITESOURCERY_RESEND_DOMAIN_ID: "not-a-domain-id"
        }
      }),
    (error) =>
      error?.code === "RESEND_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () =>
      createResendMailTransport({
        environment: ENVIRONMENT,
        timeoutMs: 60_000
      }),
    (error) =>
      error?.code === "RESEND_CONFIGURATION_REQUIRED"
  );
});

test("Resend readiness proves the exact domain, authentication records, and disabled tracking", async () => {
  const calls = [];
  const transport = createResendMailTransport({
    environment: ENVIRONMENT,
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return jsonResponse(readyDomain());
    }
  });

  assert.deepEqual(await transport.readiness(), {
    ready: true,
    verified: true,
    provider: "resend"
  });
  assert.deepEqual(await transport.readiness(), {
    ready: true,
    verified: true,
    provider: "resend"
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.resend.com/domains/${DOMAIN_ID}`
  );
  assert.equal(calls[0].init.method, "GET");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(
    headers.get("authorization"),
    `Bearer ${API_KEY}`
  );
  assert.equal(
    headers.get("user-agent"),
    "sitesourcery-hosted/1.0"
  );
  assert.equal(calls[0].init.body, undefined);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("Resend coalesces concurrent verified-domain checks", async () => {
  let calls = 0;
  let release;
  const responseReady = new Promise((resolve) => {
    release = resolve;
  });
  const transport = createResendMailTransport({
    environment: ENVIRONMENT,
    async fetchImpl() {
      calls += 1;
      await responseReady;
      return jsonResponse(readyDomain());
    }
  });

  const first = transport.readiness();
  const second = transport.readiness();
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    {
      ready: true,
      verified: true,
      provider: "resend"
    },
    {
      ready: true,
      verified: true,
      provider: "resend"
    }
  ]);
  assert.equal(calls, 1);
});

test("Resend readiness fails closed for every unverified provider state", async (t) => {
  const cases = [
    {
      name: "wrong domain",
      body: readyDomain({ name: "other.example" }),
      code: "RESEND_DOMAIN_MISMATCH"
    },
    {
      name: "pending domain",
      body: readyDomain({ status: "pending" }),
      code: "RESEND_DOMAIN_UNVERIFIED"
    },
    {
      name: "sending disabled",
      body: readyDomain({
        capabilities: {
          sending: "disabled",
          receiving: "disabled"
        }
      }),
      code: "RESEND_DOMAIN_UNVERIFIED"
    },
    {
      name: "SPF incomplete",
      body: readyDomain({
        records: [
          {
            record: "SPF",
            type: "TXT",
            status: "pending"
          },
          {
            record: "DKIM",
            type: "TXT",
            status: "verified"
          }
        ]
      }),
      code: "RESEND_DOMAIN_UNVERIFIED"
    },
    {
      name: "tracking enabled",
      body: readyDomain({ open_tracking: true }),
      code: "RESEND_TRACKING_MUST_BE_DISABLED"
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const transport = createResendMailTransport({
        environment: ENVIRONMENT,
        async fetchImpl() {
          return jsonResponse(entry.body);
        }
      });
      assert.deepEqual(await transport.readiness(), {
        ready: false,
        verified: false,
        provider: "resend",
        code: entry.code
      });
    });
  }

  for (const fetchImpl of [
    async () => {
      throw new Error("network unavailable");
    },
    async () => jsonResponse({ type: "invalid_api_key" }, 403),
    async () => new Response("not-json", { status: 200 })
  ]) {
    const transport = createResendMailTransport({
      environment: ENVIRONMENT,
      fetchImpl
    });
    assert.deepEqual(await transport.readiness(), {
      ready: false,
      verified: false,
      provider: "resend",
      code: "RESEND_READINESS_UNAVAILABLE"
    });
  }
});

test("Resend sends one exact registration message with provider idempotency", async () => {
  const calls = [];
  const transport = createRegistrationTransport({
    environment: ENVIRONMENT,
    clock: { now: () => NOW },
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return jsonResponse({
        id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
      });
    }
  });
  const input = registrationInput();

  assert.deepEqual(
    await transport.sendRegistration(input),
    {
      accepted: true,
      provider: "resend",
      providerMessageId:
        "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
      idempotencyKey: input.idempotencyKey,
      payloadDigest: input.payloadDigest,
      acceptedAt: NOW
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(
    headers.get("idempotency-key"),
    `sitesourcery-registration/${input.idempotencyKey}`
  );
  const body = JSON.parse(calls[0].init.body);
  assert.equal(
    body.from,
    "Site Sourcery <accounts@sitesourcery.com>"
  );
  assert.deepEqual(body.to, [input.recipient]);
  assert.equal(body.reply_to, "sitesourcery@proton.me");
  assert.equal(
    body.subject,
    "Verify your Site Sourcery account"
  );
  assert.match(body.html, /Verify my account/u);
  assert.match(body.html, /#verify-registration=/u);
  assert.match(body.text, /#verify-registration=/u);
  assert.deepEqual(body.tags, [
    {
      name: "message_type",
      value: "account_verification"
    }
  ]);
  assert.ok(!calls[0].init.body.includes(API_KEY));
});

test("Resend sends recovery with a separate idempotency namespace", async () => {
  const calls = [];
  const transport = createRecoveryTransport({
    environment: ENVIRONMENT,
    clock: { now: () => NOW },
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return jsonResponse({
        id: "aa81316d-9f01-4a15-84ca-3bcd30d0ea40"
      });
    }
  });
  const input = recoveryInput();

  const receipt = await transport.sendRecovery(input);
  assert.equal(receipt.provider, "resend");
  assert.equal(receipt.idempotencyKey, input.idempotencyKey);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(
    headers.get("idempotency-key"),
    `sitesourcery-recovery/${input.idempotencyKey}`
  );
  const body = JSON.parse(calls[0].init.body);
  assert.equal(
    body.subject,
    "Reset your Site Sourcery password"
  );
  assert.match(body.html, /Reset my password/u);
  assert.match(body.text, /#recovery=/u);
  assert.deepEqual(body.tags, [
    {
      name: "message_type",
      value: "password_recovery"
    }
  ]);
});

test("Resend rejects off-site action links before any provider call", async () => {
  let calls = 0;
  const transport = createRecoveryTransport({
    environment: ENVIRONMENT,
    async fetchImpl() {
      calls += 1;
      return jsonResponse({
        id: "aa81316d-9f01-4a15-84ca-3bcd30d0ea40"
      });
    }
  });
  await assert.rejects(
    transport.sendRecovery(
      recoveryInput({
        recoveryUrl:
          "https://attacker.example/reset#recovery=private"
      })
    ),
    (error) => error?.code === "RESEND_DELIVERY_INVALID"
  );
  assert.equal(calls, 0);
});

test("Resend failures expose no provider body, recipient, token, or key", async () => {
  const input = recoveryInput();
  const transport = createRecoveryTransport({
    environment: ENVIRONMENT,
    async fetchImpl() {
      return jsonResponse(
        {
          type: "validation_error",
          message:
            `${API_KEY} ${input.recipient} ${input.recoveryUrl}`
        },
        403
      );
    }
  });
  await assert.rejects(
    transport.sendRecovery(input),
    (error) => {
      assert.equal(error?.code, "RESEND_API_REJECTED");
      assert.ok(!error.message.includes(API_KEY));
      assert.ok(!error.message.includes(input.recipient));
      assert.ok(!error.message.includes("private-test-token"));
      return true;
    }
  );
});

test("Resend requires an exact provider message receipt", async () => {
  const transport = createRegistrationTransport({
    environment: ENVIRONMENT,
    async fetchImpl() {
      return jsonResponse({ id: "not-a-message-id" });
    }
  });
  await assert.rejects(
    transport.sendRegistration(registrationInput()),
    (error) => error?.code === "RESEND_RESPONSE_INVALID"
  );
});

test("Resend composes with both narrow production mail ports", async () => {
  const calls = [];
  const transport = createResendMailTransport({
    environment: ENVIRONMENT,
    clock: { now: () => NOW },
    async fetchImpl(url, init) {
      calls.push({ url, init });
      if (url.includes("/domains/")) {
        return jsonResponse(readyDomain());
      }
      return jsonResponse({
        id:
          calls.filter((call) =>
            call.url.endsWith("/emails")
          ).length === 1
            ? "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
            : "aa81316d-9f01-4a15-84ca-3bcd30d0ea40"
      });
    }
  });
  const registration = createProductionRegistrationMailPort({
    transport,
    clock: { now: () => NOW }
  });
  const recovery = createProductionRecoveryMailPort({
    transport,
    clock: { now: () => NOW }
  });

  assert.equal(
    (await registration.readiness()).provider,
    "resend"
  );
  const registrationReceipt = await registration.deliver({
    idempotencyKey:
      "registration_5df4bf26-294c-4bc8-9b44-c4488db94356",
    recipient: "owner@example.test",
    token: "registration-private-token-abcdefghijklmnopqrstuvwxyz",
    requestedAt: "2026-08-01T18:29:00.000Z",
    expiresAt: "2026-08-02T18:29:00.000Z"
  });
  assert.equal(registrationReceipt.provider, "resend");
  assert.equal(registrationReceipt.state, "delivered");

  assert.equal((await recovery.readiness()).provider, "resend");
  const recoveryReceipt = await recovery.deliver({
    idempotencyKey:
      "recovery_221a58ce-b15f-4a36-92e0-b3c6ef03fc83",
    recipient: "owner@example.test",
    token: "recovery-private-token-abcdefghijklmnopqrstuvwxyz",
    requestedAt: "2026-08-01T18:29:00.000Z",
    expiresAt: "2026-08-01T20:29:00.000Z"
  });
  assert.equal(recoveryReceipt.provider, "resend");
  assert.equal(recoveryReceipt.state, "delivered");
  assert.equal(
    calls.filter((call) => call.url.endsWith("/emails"))
      .length,
    2
  );
});
