import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createPostgresIdentityBridge, hashPasswordWithPepper } from "../identity-postgres.mjs";

const NOW = "2026-10-21T01:00:00.000Z";
const PEPPER = Buffer.alloc(32, 0x73);
const PASSWORD = "synthetic correct password only";
const WRONG = "synthetic incorrect password only";
const ENCODED = await hashPasswordWithPepper(PASSWORD, { pepper: PEPPER, pepperVersion: "v1" });
const rows = (selected = []) => ({ rowCount: selected.length, rows: selected });
const limit = (attempts) => ({ attempts, windowMs: 60_000, blockMs: 60_000 });
const digest = (scope, subject) => createHmac("sha256", PEPPER).update(`${scope}\0${subject}`).digest("hex");

function fixture({ subject = 100, perIp = 100, global = 100, account = null, eligible = false } = {}) {
  const calls = [];
  const rates = new Map();
  const pool = { query() { throw Error("authority bypass"); }, connect() { throw Error("authority bypass"); } };
  const client = { async query(statement, values = []) {
    const sql = String(statement).replace(/\s+/gu, " ").trim().toLowerCase();
    calls.push({ sql, values });
    if (sql.includes("pg_advisory_xact_lock")) return rows();
    if (sql.startsWith("select window_started_at")) {
      const value = rates.get(`${values[0]}:${values[1]}`);
      return rows(value ? [value] : []);
    }
    if (sql.startsWith("insert into ss.hosted_auth_rate_limits")) {
      rates.set(`${values[0]}:${values[1]}`, { window_started_at: values[2], attempt_count: values[3], blocked_until: values[4] });
      return rows();
    }
    if (sql.startsWith("delete from ss.hosted_auth_rate_limits")) {
      rates.delete(`${values[0]}:${values[1]}`); return rows();
    }
    if (sql.includes("from auth.users users")) return rows(account ? [{
      id: "00000000-0000-4000-8000-000000000001", email: values[0], created_at: NOW,
      display_name: "Synthetic", state: "active", disabled_at: null,
      password_phc: ENCODED, revision: "1", ...account
    }] : []);
    if (sql.startsWith("select id from auth.users")) return rows([{ id: values[0] }]);
    if (sql.startsWith("select password_phc, revision")) return rows([{ password_phc: ENCODED, revision: "1" }]);
    if (sql.startsWith("insert into ss.hosted_sessions")) return rows();
    if (sql.startsWith("select token.id from ss.hosted_recovery_tokens")) return rows(eligible ? [{ id: "synthetic-token-id" }] : []);
    if (sql.includes("from ss.hosted_recovery_tokens token") && sql.includes("for update of token, delivery")) return rows();
    throw Error(`Unexpected query: ${sql.slice(0, 100)}`);
  }};
  const authority = { pool, async service(_options, work) {
    const snapshot = structuredClone(rates);
    try { return await work(client); }
    catch (error) { rates.clear(); for (const [k,v] of snapshot) rates.set(k,v); throw error; }
  }};
  const identity = createPostgresIdentityBridge({ pool, authority, pepper: PEPPER, clock: () => new Date(NOW), rateLimit: limit(subject), registrationRecoveryRateLimit: { perIp: limit(perIp), global: limit(global) } });
  return { identity, calls, rates };
}

async function countKdfs(work) {
  let count = 0;
  const hook = createHook({ init(_id, type) { if (type === "SCRYPTREQUEST") count += 1; } });
  hook.enable();
  try { await work(); } finally { hook.disable(); }
  return count;
}
const invalidSignin = (error) => error.code === "AUTHENTICATION_FAILED" && error.status === 401;
const limitedSignin = (error) => error.code === "AUTHENTICATION_FAILED" && error.status === 429;
const invalidRecovery = (error) => error.code === "RECOVERY_TOKEN_INVALID" && error.status === 409;
const limitedRecovery = (error) => error.code === "RECOVERY_RATE_LIMITED" && error.status === 429;

test("admitted missing, inactive, disabled and active wrong-password accounts all perform one real KDF", async () => {
  for (const account of [null, { state: "pending" }, { disabled_at: NOW }, {}, { password_phc: "invalid" }]) {
    const f = fixture({ account });
    assert.equal(await countKdfs(() => assert.rejects(f.identity.signIn({ email: "fixture@example.test", password: WRONG }, { clientAddress: "192.0.2.1" }), invalidSignin)), 1);
    assert.equal(f.calls.filter(c => c.sql.startsWith("insert into ss.hosted_auth_rate_limits")).length, 3);
    assert.equal(f.calls.some(c => c.sql.startsWith("insert into ss.hosted_sessions")), false);
    assert.doesNotMatch(JSON.stringify(f.calls), /192\.0\.2\.1/u);
  }
});

test("sign-in preserves subject admission and adds shared client/global gates before lookup or KDF", async () => {
  for (const scenario of [
    { config: { subject: 1 }, first: ["same@example.test", "192.0.2.1"], second: ["same@example.test", "192.0.2.2"] },
    { config: { perIp: 1 }, first: ["one@example.test", "192.0.2.1"], second: ["two@example.test", "192.0.2.1"] },
    { config: { global: 1 }, first: ["one@example.test", "192.0.2.1"], second: ["two@example.test", "192.0.2.2"] }
  ]) {
    const f = fixture(scenario.config);
    await assert.rejects(f.identity.signIn({ email: scenario.first[0], password: WRONG }, { clientAddress: scenario.first[1] }), invalidSignin);
    const before = f.calls.length;
    assert.equal(await countKdfs(() => assert.rejects(f.identity.signIn({ email: scenario.second[0], password: WRONG, throttleKey: "new-caller-value" }, { clientAddress: scenario.second[1] }), limitedSignin)), 0);
    assert.equal(f.calls.slice(before).some(c => c.sql.includes("from auth.users")), false);
  }
});

test("successful sign-in clears only the email subject and never replenishes aggregate budgets", async () => {
  const f = fixture({ account: {}, perIp: 2 });
  for (let i = 0; i < 2; i++) {
    const result = await f.identity.signIn({ email: "fixture@example.test", password: PASSWORD }, { clientAddress: "192.0.2.1" });
    assert.ok(result.sessionToken.length >= 32);
    assert.equal(f.rates.has(`sign_in:${digest("sign_in", "fixture@example.test")}`), false);
    for (const subject of ["client:192.0.2.1", "global"]) assert.equal(f.rates.get(`sign_in:${digest("sign_in", subject)}`).attempt_count, i + 1);
  }
  assert.equal(await countKdfs(() => assert.rejects(f.identity.signIn({ email: "fixture@example.test", password: PASSWORD }, { clientAddress: "192.0.2.1" }), limitedSignin)), 0);
});

test("invalid recovery tokens consume aggregate admission but never start password hashing", async () => {
  for (const selected of [{ perIp: 1 }, { global: 1 }]) {
    const f = fixture(selected);
    assert.equal(await countKdfs(() => assert.rejects(f.identity.completeRecovery("a".repeat(43), PASSWORD, { clientAddress: "192.0.2.1" }), invalidRecovery)), 0);
    const before = f.calls.length;
    assert.equal(await countKdfs(() => assert.rejects(f.identity.completeRecovery("b".repeat(43), PASSWORD, { clientAddress: selected.global ? "192.0.2.2" : "192.0.2.1" }), limitedRecovery)), 0);
    assert.equal(f.calls.slice(before).some(c => c.sql.includes("hosted_recovery_tokens")), false);
    assert.doesNotMatch(JSON.stringify([...f.rates]), /192\.0\.2|a{43}|b{43}/u);
  }
});

test("a positive recovery precheck is not completion authority after hashing", async () => {
  const f = fixture({ eligible: true });
  assert.equal(await countKdfs(() => assert.rejects(f.identity.completeRecovery("a".repeat(43), PASSWORD, { clientAddress: "192.0.2.1" }), invalidRecovery)), 1);
  assert.equal(f.calls.filter(c => c.sql.includes("hosted_recovery_tokens token")).length, 2);
  assert.equal(f.calls.some(c => c.sql.startsWith("update ss.hosted_password_credentials")), false);
});
