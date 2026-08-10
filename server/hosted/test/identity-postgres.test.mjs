import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  createPostgresIdentityBridge,
  hashPasswordWithPepper,
  verifyPasswordWithPepper
} from "../identity-postgres.mjs";
import {
  createHeldRegistrationMailPort
} from "../registration-mail-port.mjs";

const PEPPER = randomBytes(32);
const PRIOR = randomBytes(32);

test("peppered scrypt credentials use unique per-password salts", async () => {
  let sequence = 0;
  const randomBytes = (length) =>
    Buffer.alloc(length, sequence++ === 0 ? 0x11 : 0x22);
  const first = await hashPasswordWithPepper("correct horse battery", {
    pepper: PEPPER,
    pepperVersion: "current",
    randomBytes
  });
  const second = await hashPasswordWithPepper("correct horse battery", {
    pepper: PEPPER,
    pepperVersion: "current",
    randomBytes
  });
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$32768\$8\$1\$current\$/u);
  assert.equal(
    await verifyPasswordWithPepper(
      "correct horse battery",
      first,
      async (version) => (version === "current" ? PEPPER : null)
    ),
    true
  );
  assert.equal(
    await verifyPasswordWithPepper(
      "wrong password value",
      first,
      async () => PEPPER
    ),
    false
  );
});

test("credential verification supports explicit pepper rotation only", async () => {
  const encoded = await hashPasswordWithPepper("correct horse battery", {
    pepper: PRIOR,
    pepperVersion: "prior",
    randomBytes: (length) => Buffer.alloc(length, 0x33)
  });
  assert.equal(
    await verifyPasswordWithPepper(
      "correct horse battery",
      encoded,
      async (version) => (version === "prior" ? PRIOR : null)
    ),
    true
  );
  assert.equal(
    await verifyPasswordWithPepper(
      "correct horse battery",
      encoded,
      async () => null
    ),
    false
  );
});

test("identity bridge refuses missing PostgreSQL and weak pepper configuration", () => {
  assert.throws(
    () =>
      createPostgresIdentityBridge({
        pool: null,
        pepper: PEPPER
      }),
    (error) => error?.code === "IDENTITY_CONFIGURATION_ERROR"
  );
  assert.throws(
    () =>
      createPostgresIdentityBridge({
        pool: {
          query() {},
          connect() {}
        },
        pepper: randomBytes(8)
      }),
    (error) => error?.code === "IDENTITY_CONFIGURATION_ERROR"
  );
  assert.throws(
    () =>
      createPostgresIdentityBridge({
        pool: {
          query() {},
          connect() {}
        },
        pepper: PEPPER,
        rateLimit: {
          attempts: 0
        }
      }),
    (error) => error?.code === "IDENTITY_CONFIGURATION_ERROR"
  );
});

test("held registration rejects before any identity query or transaction", async () => {
  const calls = [];
  const identity = createPostgresIdentityBridge({
    pool: {
      async query(...input) {
        calls.push(["query", ...input]);
        return { rowCount: 0, rows: [] };
      },
      async connect() {
        calls.push(["connect"]);
        throw new Error(
          "held registration must not open a transaction"
        );
      }
    },
    pepper: PEPPER,
    registrationMailPort:
      createHeldRegistrationMailPort()
  });
  await assert.rejects(
    identity.register({
      name: "Test Owner",
      organizationName: "Test Company",
      email: "owner@example.test",
      password: "correct horse battery staple",
      commandId: "registration-command-held"
    }),
    (error) =>
      error?.code === "ACCOUNT_REGISTRATION_HELD" &&
      error?.status === 503
  );
  assert.deepEqual(calls, []);
});

test("production identity queries run through the canonical service-role authority", async () => {
  const directCalls = [];
  const serviceCalls = [];
  const pool = {
    async query() {
      directCalls.push("query");
      throw new Error("direct pool query bypassed canonical authority");
    },
    async connect() {
      directCalls.push("connect");
      throw new Error("direct pool transaction bypassed canonical authority");
    }
  };
  const authority = {
    pool,
    async service(options, work) {
      serviceCalls.push(options);
      return work({
        async query() {
          return { rowCount: 2, rows: [] };
        }
      });
    }
  };
  const identity = createPostgresIdentityBridge({
    pool,
    authority,
    pepper: PEPPER
  });
  assert.deepEqual(await identity.cleanup(), {
    registrationRequests: 2,
    sessions: 2,
    recoveryTokens: 2
  });
  assert.deepEqual(directCalls, []);
  assert.deepEqual(serviceCalls, [{}, {}, {}]);
});
