import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import {
  createDevelopmentRegistrationMailSink
} from "../registration-mail-port.mjs";

const NOW = "2026-07-30T12:00:00.000Z";
const PEPPER = randomBytes(32);
const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD =
  "correct horse battery staple";

function normalized(statement) {
  return String(statement)
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function rows(selected = []) {
  return {
    rowCount: selected.length,
    rows: selected
  };
}

function createIdentityAuthorityModel() {
  const calls = [];
  const rateLimits = new Map();
  const sessions = [];
  let registration = null;
  let user = null;
  let profile = null;
  let credential = null;
  let organization = null;
  let membership = null;

  const pool = {
    async query() {
      throw new Error(
        "identity bypassed the canonical authority"
      );
    },
    async connect() {
      throw new Error(
        "identity bypassed the canonical authority"
      );
    }
  };

  const client = {
    async query(statement, values = []) {
      const sql = normalized(statement);
      calls.push({
        sql,
        values: structuredClone(values)
      });

      if (sql.includes("pg_advisory_xact_lock")) {
        return rows([{ locked: true }]);
      }

      if (
        sql.includes(
          "from ss.hosted_auth_rate_limits"
        ) &&
        sql.includes("for update")
      ) {
        const selected =
          rateLimits.get(`${values[0]}:${values[1]}`);
        return rows(selected ? [selected] : []);
      }
      if (
        sql.startsWith(
          "insert into ss.hosted_auth_rate_limits"
        )
      ) {
        rateLimits.set(
          `${values[0]}:${values[1]}`,
          {
            window_started_at: values[2],
            attempt_count: values[3],
            blocked_until: values[4]
          }
        );
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "delete from ss.hosted_auth_rate_limits"
        )
      ) {
        rateLimits.delete(
          `${values[0]}:${values[1]}`
        );
        return { rowCount: 1, rows: [] };
      }

      if (
        sql.startsWith(
          "select id, request_digest, state, expires_at from ss.hosted_registration_requests"
        )
      ) {
        return rows(
          registration?.command_id === values[0]
            ? [
                {
                  id: registration.id,
                  request_digest:
                    registration.request_digest,
                  state: registration.state,
                  expires_at:
                    registration.expires_at
                }
              ]
            : []
        );
      }
      if (
        sql.startsWith(
          "select request_digest, state, expires_at from ss.hosted_registration_requests"
        )
      ) {
        return rows(
          registration?.command_id === values[0]
            ? [
                {
                  request_digest:
                    registration.request_digest,
                  state: registration.state,
                  expires_at:
                    registration.expires_at
                }
              ]
            : []
        );
      }
      if (
        sql.startsWith(
          "select id from auth.users where lower(email)"
        )
      ) {
        return rows(
          user?.email === values[0]
            ? [{ id: user.id }]
            : []
        );
      }
      if (
        sql.startsWith(
          "update ss.hosted_registration_requests set state = 'superseded'"
        )
      ) {
        if (
          registration &&
          registration.email === values[0] &&
          Date.parse(registration.expires_at) <=
            Date.parse(values[1]) &&
          [
            "pending_delivery",
            "provider_accepted",
            "delivered",
            "delivery_unknown"
          ].includes(registration.state)
        ) {
          registration.state = "superseded";
          registration.superseded_at = values[1];
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (
        sql.startsWith(
          "select state, expires_at from ss.hosted_registration_requests"
        )
      ) {
        const pending =
          registration &&
          registration.email === values[0] &&
          [
            "pending_delivery",
            "provider_accepted",
            "delivered",
            "delivery_unknown"
          ].includes(registration.state);
        return rows(
          pending
            ? [
                {
                  state: registration.state,
                  expires_at:
                    registration.expires_at
                }
              ]
            : []
        );
      }
      if (
        sql.startsWith(
          "insert into ss.hosted_registration_requests"
        )
      ) {
        registration = {
          id: values[0],
          command_id: values[1],
          request_digest: values[2],
          email: values[3],
          display_name: values[4],
          organization_name: values[5],
          password_phc: values[6],
          pepper_version: values[7],
          token_digest: values[8],
          state: "pending_delivery",
          created_at: values[9],
          expires_at: values[10],
          delivered_at: null,
          activated_at: null,
          activated_user_id: null,
          activated_organization_id: null,
          activation_command_id: null,
          mail_delivery_id: null,
          provider_accepted_at: null,
          delivery_lineage_version: null,
          possession_evidence_digest: null,
          possession_proven_at: null
        };
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "select request_digest, token_digest, state, expires_at from ss.hosted_registration_requests"
        )
      ) {
        return rows(
          registration?.id === values[0]
            ? [
                {
                  request_digest:
                    registration.request_digest,
                  token_digest:
                    registration.token_digest,
                  state: registration.state,
                  expires_at:
                    registration.expires_at
                }
              ]
            : []
        );
      }
      if (
        sql.startsWith(
          "update ss.hosted_registration_requests set state = $2"
        )
      ) {
        if (
          registration?.id !== values[0] ||
          registration.state !==
            "pending_delivery"
        ) {
          return { rowCount: 0, rows: [] };
        }
        registration.state = values[1];
        registration.delivery_provider = values[2];
        registration.delivery_receipt =
          JSON.parse(values[3]);
        registration.delivery_receipt_digest =
          values[4];
        registration.mail_delivery_id = values[5];
        registration.provider_accepted_at = values[6];
        registration.delivery_lineage_version = values[7];
        registration.delivered_at = values[8];
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "update ss.hosted_registration_requests set state = 'delivery_unknown'"
        )
      ) {
        if (
          registration?.id === values[0] &&
          registration.state ===
            "pending_delivery"
        ) {
          registration.state =
            "delivery_unknown";
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (
        sql.startsWith(
          "select * from ss.hosted_registration_requests"
        )
      ) {
        const eligible =
          registration &&
          registration.token_digest === values[0] &&
          ["provider_accepted", "delivered", "activated"].includes(
            registration.state
          ) &&
          Date.parse(registration.expires_at) >
            Date.parse(values[1]);
        return rows(eligible ? [{ ...registration }] : []);
      }
      if (
        sql.includes("join ss.hosted_sessions session") &&
        sql.includes("organization.id = $2")
      ) {
        const session = sessions.find(
          (entry) =>
            entry.user_id === values[0] &&
            entry.token_digest === values[2] &&
            Date.parse(entry.expires_at) >
              Date.parse(values[3])
        );
        const valid =
          user?.id === values[0] &&
          organization?.id === values[1] &&
          session;
        return rows(
          valid
            ? [
                {
                  id: user.id,
                  email: user.email,
                  created_at: user.created_at,
                  display_name:
                    profile.display_name,
                  organization_id:
                    organization.id,
                  organization_name:
                    organization.name,
                  organization_state:
                    organization.state,
                  organization_created_at:
                    organization.created_at,
                  organization_role:
                    membership.role,
                  session_id: session.id,
                  session_created_at:
                    session.created_at,
                  session_expires_at:
                    session.expires_at,
                  reauthenticated_at:
                    session.reauthenticated_at
                }
              ]
            : []
        );
      }

      if (sql.startsWith("insert into auth.users")) {
        if (user) return { rowCount: 0, rows: [] };
        user = {
          id: values[0],
          email: values[1],
          created_at: values[2],
          disabled_at: null
        };
        return rows([{ id: user.id }]);
      }
      if (
        sql.startsWith(
          "insert into ss.hosted_account_profiles"
        )
      ) {
        profile = {
          user_id: values[0],
          display_name: values[1],
          state: "active",
          created_at: values[2]
        };
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "insert into ss.hosted_password_credentials"
        )
      ) {
        credential = {
          user_id: values[0],
          password_phc: values[1],
          pepper_version: values[2]
        };
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "insert into ss.organizations"
        )
      ) {
        organization = {
          id: values[0],
          created_by_user_id: values[1],
          name: values[2],
          state: "active",
          created_at: values[3]
        };
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "insert into ss.organization_memberships"
        )
      ) {
        membership = {
          organization_id: values[0],
          user_id: values[1],
          role: "owner",
          state: "active",
          created_at: values[2]
        };
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "update ss.hosted_registration_requests set state = 'activated'"
        )
      ) {
        if (
          registration?.id !== values[0] ||
          !["provider_accepted", "delivered"].includes(
            registration.state
          )
        ) {
          return { rowCount: 0, rows: [] };
        }
        registration.state = "activated";
        registration.delivered_at = values[1];
        registration.possession_evidence_digest =
          values[5];
        registration.possession_proven_at = values[1];
        registration.activated_at = values[1];
        registration.activated_user_id =
          values[2];
        registration.activated_organization_id =
          values[3];
        registration.activation_command_id =
          values[4];
        return { rowCount: 1, rows: [] };
      }
      if (
        sql.startsWith(
          "insert into ss.hosted_sessions"
        )
      ) {
        sessions.push({
          id: values[0],
          user_id: values[1],
          token_digest: values[2],
          created_at: values[3],
          expires_at: values[4],
          reauthenticated_at: values[5],
          revoked_at: null
        });
        return { rowCount: 1, rows: [] };
      }

      if (
        sql.includes(
          "credential.password_phc"
        ) &&
        sql.includes("where lower(users.email) = $1")
      ) {
        return rows(
          user?.email === values[0]
            ? [
                {
                  ...user,
                  display_name:
                    profile.display_name,
                  state: profile.state,
                  password_phc:
                    credential.password_phc
                }
              ]
            : []
        );
      }
      if (
        sql.includes(
          "from ss.hosted_recovery_tokens token"
        ) &&
        sql.includes("join auth.users users")
      ) {
        return rows([]);
      }
      if (
        sql.startsWith(
          "select users.id, users.email from auth.users users"
        ) &&
        sql.includes("for update of users")
      ) {
        return rows(
          user?.email === values[0]
            ? [
                {
                  id: user.id,
                  email: user.email
                }
              ]
            : []
        );
      }
      if (
        sql.includes(
          "from ss.hosted_sessions session"
        ) &&
        sql.includes(
          "where session.token_digest = $1"
        )
      ) {
        const session = sessions.find(
          (entry) =>
            entry.token_digest === values[0] &&
            entry.revoked_at === null
        );
        return rows(
          session
            ? [
                {
                  session_id: session.id,
                  token_digest:
                    session.token_digest,
                  user_id: session.user_id,
                  session_created_at:
                    session.created_at,
                  expires_at:
                    session.expires_at,
                  reauthenticated_at:
                    session.reauthenticated_at,
                  ...user,
                  display_name:
                    profile.display_name,
                  state: profile.state
                }
              ]
            : []
        );
      }

      throw new Error(
        `Unexpected identity SQL in contract model: ${sql}`
      );
    }
  };

  return {
    pool,
    calls,
    state() {
      return {
        registration:
          registration
            ? structuredClone(registration)
            : null,
        user: user ? structuredClone(user) : null,
        organization:
          organization
            ? structuredClone(organization)
            : null,
        sessions: structuredClone(sessions)
      };
    },
    authority: {
      pool,
      async service(options, work) {
        calls.push({
          authorityOptions:
            structuredClone(options)
        });
        return work(client);
      }
    }
  };
}

test("registration stages no active identity until exact token activation, then supports replay and sign-in", async () => {
  const model = createIdentityAuthorityModel();
  const registrationSink =
    createDevelopmentRegistrationMailSink({
      clock: { now: () => NOW }
    });
  const identity = createPostgresIdentityBridge({
    pool: model.pool,
    authority: model.authority,
    pepper: PEPPER,
    pepperVersion: "contract-v1",
    clock: () => new Date(NOW),
    registrationMailPort: registrationSink
  });

  const staged = await identity.register({
    name: "Test Owner",
    organizationName: "Test Organization",
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    commandId: "registration-command-001"
  });
  assert.deepEqual(staged, {
    accepted: true,
    verificationRequired: true,
    delivery: "email",
    emailSent: true,
    expiresAt: "2026-07-30T14:00:00.000Z",
    replayed: false
  });
  assert.doesNotMatch(
    JSON.stringify(staged),
    /owner@example\.test|verify-registration|session/iu
  );
  assert.equal(model.state().user, null);
  assert.equal(model.state().organization, null);
  assert.deepEqual(model.state().sessions, []);
  assert.equal(
    model.state().registration.state,
    "delivered"
  );
  const stagedReplay = await identity.register({
    name: "Test Owner",
    organizationName: "Test Organization",
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    commandId: "registration-command-001"
  });
  assert.deepEqual(stagedReplay, {
    ...staged,
    replayed: true
  });
  assert.equal(
    registrationSink.readForTest(OWNER_EMAIL)
      .length,
    1
  );
  await assert.rejects(
    identity.register({
      name: "Test Owner",
      organizationName: "Test Organization",
      email: OWNER_EMAIL,
      password:
        "different correct horse battery staple",
      commandId: "registration-command-001"
    }),
    (error) =>
      error?.code ===
      "REGISTRATION_IDEMPOTENCY_CONFLICT"
  );

  const message =
    registrationSink.readForTest(OWNER_EMAIL)[0];
  const verificationUrl = new URL(
    message.verificationUrl
  );
  const token = decodeURIComponent(
    verificationUrl.hash.slice(
      "#verify-registration=".length
    )
  );
  assert.ok(token.length >= 32);

  const activated =
    await identity.completeRegistration({
      token,
      commandId:
        "registration-activation-command-001"
    });
  assert.equal(activated.replayed, false);
  assert.equal(activated.user.email, OWNER_EMAIL);
  assert.equal(
    activated.organization.role,
    "owner"
  );
  assert.ok(activated.sessionToken.length >= 32);
  assert.equal(
    model.state().registration.state,
    "activated"
  );
  assert.equal(
    model.state().registration
      .activation_command_id,
    "registration-activation-command-001"
  );

  const replay =
    await identity.completeRegistration({
      token,
      commandId:
        "registration-activation-command-001"
    });
  assert.equal(replay.replayed, true);
  assert.equal(
    replay.sessionToken,
    activated.sessionToken
  );
  assert.deepEqual(replay.user, activated.user);
  assert.deepEqual(
    replay.organization,
    activated.organization
  );

  await assert.rejects(
    identity.completeRegistration({
      token,
      commandId:
        "registration-activation-foreign-001"
    }),
    (error) =>
      error?.code ===
      "REGISTRATION_ALREADY_COMPLETED"
  );

  const signedIn = await identity.signIn({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    throttleKey: "caller-controlled-value"
  });
  assert.equal(signedIn.user.email, OWNER_EMAIL);
  assert.ok(signedIn.sessionToken.length >= 32);
  const actor = await identity.authenticate(
    signedIn.sessionToken
  );
  assert.equal(actor.user.email, OWNER_EMAIL);
  await identity.signIn({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    throttleKey:
      "different-caller-controlled-value"
  });

  const signInRateDigests = model.calls
    .filter(
      (call) =>
        call.sql?.startsWith(
          "insert into ss.hosted_auth_rate_limits"
        ) &&
        call.values[0] === "sign_in"
    )
    .map((call) => call.values[1]);
  assert.equal(signInRateDigests.length, 2);
  assert.equal(
    new Set(signInRateDigests).size,
    1
  );
  assert.match(
    signInRateDigests[0],
    /^[a-f0-9]{64}$/u
  );

  for (const [commandId, throttleKey] of [
    [
      "recovery-command-unknown-001",
      "caller-controlled-recovery-a"
    ],
    [
      "recovery-command-unknown-002",
      "caller-controlled-recovery-b"
    ]
  ]) {
    const recovery =
      await identity.issueRecoveryForDelivery(
        "unknown@example.test",
        { commandId, throttleKey }
      );
    assert.deepEqual(recovery, {
      accepted: true,
      recipient: "unknown@example.test",
      delivery: null
    });
  }
  const recoveryRateDigests = model.calls
    .filter(
      (call) =>
        call.sql?.startsWith(
          "insert into ss.hosted_auth_rate_limits"
        ) &&
        call.values[0] === "recovery"
    )
    .map((call) => call.values[1]);
  assert.equal(recoveryRateDigests.length, 6);
  assert.equal(
    new Set(recoveryRateDigests).size,
    3
  );
  assert.ok(
    model.calls.some(
      (call) =>
        call.authorityOptions?.isolation ===
        "read-committed"
    )
  );
});

test("recovery enforces HMAC-only client and global buckets before account lookup", async () => {
  const model = createIdentityAuthorityModel();
  const identity = createPostgresIdentityBridge({
    pool: model.pool,
    authority: model.authority,
    pepper: PEPPER,
    clock: () => new Date(NOW),
    registrationMailPort: createDevelopmentRegistrationMailSink({
      clock: { now: () => NOW }
    }),
    rateLimit: { attempts: 100, windowMs: 60_000, blockMs: 60_000 },
    registrationRecoveryRateLimit: {
      perIp: { attempts: 1, windowMs: 60_000, blockMs: 60_000 },
      global: { attempts: 100, windowMs: 60_000, blockMs: 60_000 }
    }
  });
  await identity.issueRecoveryForDelivery(
    "first-unknown@example.test",
    { commandId: "recovery-client-limit-001" },
    { clientAddress: "203.0.113.11" }
  );
  const queryCount = model.calls.length;
  await assert.rejects(
    identity.issueRecoveryForDelivery(
      "second-unknown@example.test",
      { commandId: "recovery-client-limit-002" },
      { clientAddress: "203.0.113.11" }
    ),
    (error) =>
      error?.code === "RECOVERY_RATE_LIMITED" && error?.status === 429
  );
  const laterCalls = model.calls.slice(queryCount);
  assert.equal(
    laterCalls.some((call) => call.sql?.includes("from auth.users users")),
    false
  );
  assert.doesNotMatch(JSON.stringify(model.calls), /203\.0\.113\.11/u);
});

test("recovery global bucket spans distinct client addresses", async () => {
  const model = createIdentityAuthorityModel();
  const identity = createPostgresIdentityBridge({
    pool: model.pool,
    authority: model.authority,
    pepper: PEPPER,
    clock: () => new Date(NOW),
    registrationMailPort: createDevelopmentRegistrationMailSink({
      clock: { now: () => NOW }
    }),
    rateLimit: { attempts: 100, windowMs: 60_000, blockMs: 60_000 },
    registrationRecoveryRateLimit: {
      perIp: { attempts: 100, windowMs: 60_000, blockMs: 60_000 },
      global: { attempts: 2, windowMs: 60_000, blockMs: 60_000 }
    }
  });
  for (let index = 1; index <= 2; index += 1) {
    await identity.issueRecoveryForDelivery(
      `global-${index}@example.test`,
      { commandId: `recovery-global-limit-00${index}` },
      { clientAddress: `203.0.113.${20 + index}` }
    );
  }
  await assert.rejects(
    identity.issueRecoveryForDelivery(
      "global-3@example.test",
      { commandId: "recovery-global-limit-003" },
      { clientAddress: "203.0.113.23" }
    ),
    (error) => error?.code === "RECOVERY_RATE_LIMITED"
  );
});
