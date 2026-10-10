import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import pg from "pg";

import {
  createPostgresIdentityBridge,
  hashPasswordWithPepper
} from "../identity-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_IDENTITY_FENCE_TEST_URL;
const OLD_PASSWORD = "fixture original password only";
const NEW_PASSWORD = "fixture replacement password only";
const LOST_PASSWORD = "fixture stale replacement only";
const PEPPER = randomBytes(32);

// Pause real PostgreSQL results, never synthesize SQL responses. Both pool-only
// and canonical service-role transactions use the same controlled interleaving.
function controlledPool(pool) {
  let nextGate = null;
  async function query(execute, sql, values) {
    const gate = nextGate?.matches(sql) ? nextGate : null;
    if (gate) nextGate = null;
    if (gate?.before) await gate.pause();
    const result = await execute(sql, values);
    if (gate && !gate.before) await gate.pause();
    return result;
  }
  return {
    query: (sql, values) => query(pool.query.bind(pool), sql, values),
    async connect() {
      const client = await pool.connect();
      return {
        query: (sql, values) => query(client.query.bind(client), sql, values),
        release: (...args) => client.release(...args)
      };
    },
    pauseNext(matches, { before = false } = {}) {
      assert.equal(nextGate, null);
      const reached = Promise.withResolvers();
      const released = Promise.withResolvers();
      nextGate = {
        matches,
        before,
        async pause() {
          reached.resolve();
          await released.promise;
        }
      };
      return { reached: reached.promise, release: released.resolve };
    }
  };
}

const credentialSnapshot = (sql) =>
  /select[\s\S]*password_phc/iu.test(sql) && !/for update/iu.test(sql);
const rejectedCredential = (error) =>
  ["AUTHENTICATION_FAILED", "AUTHENTICATION_REQUIRED", "40001"].includes(error?.code);

test("PostgreSQL password changes fence concurrent credential use", {
  skip: !DATABASE_URL,
  timeout: 60_000
}, async (t) => {
  assert.match(new URL(DATABASE_URL).pathname, /^\/ss_auth_race_[a-z0-9_]+$/u);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
  try {
    const version = await pool.query("show server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);
    const encoded = await hashPasswordWithPepper(OLD_PASSWORD, {
      pepper: PEPPER,
      pepperVersion: "fixture-v1"
    });

    async function fixture(canonical) {
      const userId = randomUUID();
      const email = `credential-fence-${userId}@example.test`;
      await pool.query("insert into auth.users (id, email) values ($1, $2)", [userId, email]);
      await pool.query(
        "insert into ss.hosted_account_profiles (user_id, display_name) values ($1, 'Credential fence fixture')",
        [userId]
      );
      await pool.query(
        `insert into ss.hosted_password_credentials (user_id, password_phc, pepper_version)
         values ($1, $2, 'fixture-v1')`, [userId, encoded]
      );
      const controlled = controlledPool(pool);
      let clockOffset = 0;
      const identity = createPostgresIdentityBridge({
        pool: controlled,
        authority: canonical ? createCanonicalPostgresAuthority({ pool: controlled }) : null,
        pepper: PEPPER,
        pepperVersion: "fixture-v1",
        clock: () => new Date(Date.now() + clockOffset)
      });
      return { userId, email, identity, controlled, advance: (ms) => { clockOffset += ms; } };
    }

    async function recovery(f) {
      const commandId = `fence-recovery-${randomUUID()}`;
      const { delivery } = await f.identity.issueRecoveryForDelivery(f.email, { commandId });
      const requestId = randomUUID();
      const receiptId = randomUUID();
      const facts = JSON.stringify({ fixture: "credential-fence", tokenId: delivery.tokenId });
      const digest = createHash("sha256").update(facts).digest("hex");
      // Existing development sink transition; no fabricated production mail
      // acceptance and no external provider. Real completion proves possession.
      await pool.query(
        `insert into ss.provider_receipts
           (id, provider_code, receipt_kind, external_object_ref, facts, facts_digest, occurred_at)
         values ($1, 'mail:development-sink', 'recovery_delivery_accepted', $2, $3, $4, $5)`,
        [receiptId, commandId, facts, digest, delivery.createdAt]
      );
      await pool.query(
        `insert into ss.hosted_recovery_delivery_requests
           (id, command_id, request_digest, delivery_idempotency_key, delivery_mode,
            delivery_provider, state, requested_at, expires_at, recovery_token_id)
         values ($1, $2, $3, $2, 'dev-sink', 'development-sink', 'pending_delivery', $4, $5, $6)`,
        [requestId, commandId, digest, delivery.createdAt, delivery.expiresAt, delivery.tokenId]
      );
      await pool.query(
        `update ss.hosted_recovery_delivery_requests
            set state = 'delivered', provider_receipt_id = $2,
                delivery_lineage_version = 'development_sink_v1', delivered_at = $3
          where id = $1`, [requestId, receiptId, delivery.createdAt]
      );
      return {
        complete: () => f.identity.completeRecovery(delivery.token, NEW_PASSWORD),
        expiresAt: delivery.expiresAt
      };
    }

    for (const canonical of [false, true]) {
      const mode = canonical ? "canonical SERIALIZABLE" : "pool READ COMMITTED";
      for (const replacement of ["rotation", "recovery"]) {
        for (const operation of ["sign-in", "rotation"]) {
          await t.test(`${mode}: stale ${operation} loses to completed ${replacement}`, async () => {
            const f = await fixture(canonical);
            const replace = replacement === "recovery" ? (await recovery(f)).complete :
              () => f.identity.rotatePassword({ userId: f.userId }, OLD_PASSWORD, NEW_PASSWORD);
            const gate = f.controlled.pauseNext(credentialSnapshot);
            const pending = operation === "sign-in" ?
              f.identity.signIn({ email: f.email, password: OLD_PASSWORD }) :
              f.identity.rotatePassword({ userId: f.userId }, OLD_PASSWORD, LOST_PASSWORD);
            const rejected = assert.rejects(pending, rejectedCredential);
            try {
              await gate.reached;
              await replace();
            } finally {
              gate.release();
            }
            await rejected;
            const state = (await pool.query(
              `select revision, (select count(*)::integer from ss.hosted_sessions
                 where user_id = $1 and revoked_at is null) as live_sessions
               from ss.hosted_password_credentials where user_id = $1`, [f.userId]
            )).rows[0];
            assert.equal(state.revision, "2");
            assert.equal(state.live_sessions, 0);
            const current = await f.identity.signIn({ email: f.email, password: NEW_PASSWORD });
            const actor = await f.identity.authenticate(current.sessionToken);
            assert.equal(actor.userId, f.userId);
            assert.ok((await f.identity.reauthenticate(actor, NEW_PASSWORD)).reauthenticatedAt);
          });
        }
      }

      await t.test(`${mode}: stale reauthentication cannot stamp a revoked session`, async () => {
        const f = await fixture(canonical);
        const session = await f.identity.signIn({ email: f.email, password: OLD_PASSWORD });
        const actor = await f.identity.authenticate(session.sessionToken);
        const gate = f.controlled.pauseNext(credentialSnapshot);
        const rejected = assert.rejects(f.identity.reauthenticate(actor, OLD_PASSWORD), rejectedCredential);
        try {
          await gate.reached;
          await f.identity.rotatePassword(actor, OLD_PASSWORD, NEW_PASSWORD);
        } finally {
          gate.release();
        }
        await rejected;
        assert.equal(await f.identity.authenticate(session.sessionToken), null);
        await assert.rejects(f.identity.reauthenticate(actor, NEW_PASSWORD), rejectedCredential);
      });

      await t.test(`${mode}: session expiration is checked after waiting for the fence`, async () => {
        const f = await fixture(canonical);
        const session = await f.identity.signIn({ email: f.email, password: OLD_PASSWORD });
        const actor = await f.identity.authenticate(session.sessionToken);
        const gate = f.controlled.pauseNext((sql) => /from ss.hosted_password_credentials[\s\S]*for update/iu.test(sql));
        const rejected = assert.rejects(f.identity.reauthenticate(actor, OLD_PASSWORD), rejectedCredential);
        try {
          await gate.reached;
          f.advance(Date.parse(session.session.expiresAt) - Date.now() + 1_000);
        } finally {
          gate.release();
        }
        await rejected;
      });

      await t.test(`${mode}: recovery rechecks token expiry after waiting`, async () => {
        const f = await fixture(canonical);
        const prepared = await recovery(f);
        const gate = f.controlled.pauseNext((sql) => /from ss.hosted_password_credentials[\s\S]*for update/iu.test(sql));
        const rejected = assert.rejects(prepared.complete(), (error) => error.code === "RECOVERY_TOKEN_INVALID");
        try {
          await gate.reached;
          f.advance(Date.parse(prepared.expiresAt) - Date.now() + 1_000);
        } finally {
          gate.release();
        }
        await rejected;
        assert.equal((await pool.query(
          "select revision from ss.hosted_password_credentials where user_id = $1", [f.userId]
        )).rows[0].revision, "1");
      });

      for (const replacement of ["rotation", "recovery"]) {
        await t.test(`${mode}: ${replacement} waits for sign-in, then revokes its session`, async () => {
          const f = await fixture(canonical);
          const replace = replacement === "recovery" ? (await recovery(f)).complete :
            () => f.identity.rotatePassword({ userId: f.userId }, OLD_PASSWORD, NEW_PASSWORD);
          // Hold the credential fence before issueSession reads the clock. The
          // waiting replacement must revoke using a time at least as new as that
          // session, even if its operation started before session issuance.
          const gate = f.controlled.pauseNext((sql) => /from ss.hosted_password_credentials[\s\S]*for update/iu.test(sql));
          const pendingSession = f.identity.signIn({ email: f.email, password: OLD_PASSWORD });
          let replacing;
          try {
            await gate.reached;
            replacing = replace().then((value) => ({ value }), (error) => ({ error }));
            let blocked = false;
            for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
              blocked = (await pool.query(
                `select exists(select 1 from pg_stat_activity
                  where datname = current_database() and pid <> pg_backend_pid()
                    and wait_event_type = 'Lock' and cardinality(pg_blocking_pids(pid)) > 0
                    and query like '%ss.hosted_password_credentials%') as blocked`
              )).rows[0].blocked;
              if (!blocked) await delay(10);
            }
            assert.equal(blocked, true, "replacement must wait on the credential row held by sign-in");
            f.advance(1_000);
          } finally {
            gate.release();
          }
          const session = await pendingSession;
          const result = await replacing;
          if (result.error) {
            if (!canonical) assert.ifError(result.error);
            assert.equal(result.error.code, "40001");
            // Canonical SERIALIZABLE may abort rather than observe a concurrent
            // session insert. Retry the entire operation with a fresh snapshot.
            await replace();
          }
          assert.equal(await f.identity.authenticate(session.sessionToken), null);
        });
      }
    }
  } finally {
    await pool.end();
  }
});
