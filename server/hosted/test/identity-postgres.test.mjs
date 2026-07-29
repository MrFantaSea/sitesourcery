import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresIdentityBridge,
  hashPasswordWithPepper,
  verifyPasswordWithPepper
} from "../identity-postgres.mjs";

const PEPPER = Buffer.alloc(32, 0x5a);
const PRIOR = Buffer.alloc(32, 0x2a);

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
        pepper: Buffer.alloc(8)
      }),
    (error) => error?.code === "IDENTITY_CONFIGURATION_ERROR"
  );
});
