import {
  createHash,
  createHmac,
  randomBytes as systemRandomBytes,
  randomUUID as systemRandomUUID,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

import { HostedError, invariant } from "./errors.mjs";
import {
  createHeldRegistrationMailPort
} from "./registration-mail-port.mjs";
import { DEFAULT_INGRESS_POLICY } from "./ingress-policy.mjs";

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_MS = 30 * 60 * 1000;
const REGISTRATION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT = DEFAULT_INGRESS_POLICY.identity.subject;

function iso(value) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity clock returned an invalid time.",
    { status: 500 }
  );
  return selected.toISOString();
}

function addMs(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  invariant(
    email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email),
    "INVALID_INPUT",
    "Enter a valid email address.",
    { status: 400 }
  );
  return email;
}

function password(value) {
  const selected = String(value ?? "");
  invariant(
    selected.length >= 12 && selected.length <= 256,
    "INVALID_INPUT",
    "Password must be between 12 and 256 characters.",
    { status: 400 }
  );
  return selected;
}

function text(value, field, maximum, minimum = 1) {
  const selected = String(value ?? "").trim();
  invariant(
    selected.length >= minimum && selected.length <= maximum,
    "INVALID_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pepperedPassword(value, pepper) {
  return createHmac("sha256", pepper).update(value, "utf8").digest();
}

function decodeCredential(encoded) {
  const parts = String(encoded ?? "").split("$");
  if (
    parts.length !== 7 ||
    parts[0] !== "scrypt" ||
    Number(parts[1]) !== SCRYPT_N ||
    Number(parts[2]) !== SCRYPT_R ||
    Number(parts[3]) !== SCRYPT_P
  ) {
    return null;
  }
  try {
    const salt = Buffer.from(parts[5], "base64url");
    const verifier = Buffer.from(parts[6], "base64url");
    if (salt.byteLength !== 16 || verifier.byteLength !== SCRYPT_BYTES) return null;
    return {
      pepperVersion: parts[4],
      salt,
      verifier
    };
  } catch {
    return null;
  }
}

export async function hashPasswordWithPepper(
  rawPassword,
  {
    pepper,
    pepperVersion,
    randomBytes = systemRandomBytes
  }
) {
  const selected = password(rawPassword);
  invariant(
    Buffer.isBuffer(pepper) && pepper.byteLength >= 32,
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity pepper must contain at least 32 bytes.",
    { status: 500 }
  );
  const version = text(pepperVersion, "Pepper version", 80);
  const salt = randomBytes(16);
  invariant(
    Buffer.isBuffer(salt) && salt.byteLength === 16,
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity salt generator returned invalid bytes.",
    { status: 500 }
  );
  const verifier = await scrypt(
    pepperedPassword(selected, pepper),
    salt,
    SCRYPT_BYTES,
    {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024
    }
  );
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    version,
    salt.toString("base64url"),
    Buffer.from(verifier).toString("base64url")
  ].join("$");
}

export async function verifyPasswordWithPepper(
  rawPassword,
  encoded,
  pepperByVersion
) {
  const credential = decodeCredential(encoded);
  if (!credential) return false;
  const pepper = await pepperByVersion(credential.pepperVersion);
  if (!Buffer.isBuffer(pepper) || pepper.byteLength < 32) return false;
  let actual;
  try {
    actual = await scrypt(
      pepperedPassword(String(rawPassword ?? ""), pepper),
      credential.salt,
      SCRYPT_BYTES,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 64 * 1024 * 1024
      }
    );
  } catch {
    return false;
  }
  return timingSafeEqual(credential.verifier, Buffer.from(actual));
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the authoritative transaction error.
    }
    throw error;
  } finally {
    client.release();
  }
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function genericAuthFailure(status = 401) {
  return new HostedError(
    "AUTHENTICATION_FAILED",
    "Email or password is incorrect.",
    { status }
  );
}

export function createPostgresIdentityBridge({
  pool,
  authority = null,
  pepper,
  pepperVersion = "v1",
  previousPeppers = {},
  clock = () => new Date(),
  randomBytes = systemRandomBytes,
  randomUUID = systemRandomUUID,
  sessionTtlMs = SESSION_MS,
  recoveryTtlMs = RECOVERY_MS,
  registrationTtlMs = REGISTRATION_MS,
  registrationMailPort =
    createHeldRegistrationMailPort(),
  rateLimit = DEFAULT_RATE_LIMIT,
  registrationRecoveryRateLimit = {
    perIp: DEFAULT_INGRESS_POLICY.identity.perIp,
    global: DEFAULT_INGRESS_POLICY.identity.global
  }
} = {}) {
  invariant(
    pool &&
      typeof pool.query === "function" &&
      typeof pool.connect === "function" &&
      (
        authority === null ||
        (
          typeof authority?.service === "function" &&
          authority.pool === pool
        )
      ),
    "IDENTITY_CONFIGURATION_ERROR",
    "A PostgreSQL pool is required for identity.",
    { status: 500 }
  );
  invariant(
    Buffer.isBuffer(pepper) && pepper.byteLength >= 32,
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity pepper must contain at least 32 bytes.",
    { status: 500 }
  );
  invariant(
    Number.isInteger(sessionTtlMs) &&
      sessionTtlMs > 0 &&
      Number.isInteger(recoveryTtlMs) &&
      recoveryTtlMs > 0 &&
      Number.isInteger(registrationTtlMs) &&
      registrationTtlMs > 0 &&
      registrationTtlMs <= 24 * 60 * 60 * 1000,
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity token lifetimes are invalid.",
    { status: 500 }
  );
  invariant(
    registrationMailPort &&
      typeof registrationMailPort.readiness ===
        "function" &&
      typeof registrationMailPort.deliver === "function",
    "IDENTITY_CONFIGURATION_ERROR",
    "A registration verification mail port is required.",
    { status: 500 }
  );
  const configuredRateLimit = {
    ...DEFAULT_RATE_LIMIT,
    ...rateLimit
  };
  invariant(
    Number.isInteger(configuredRateLimit.attempts) &&
      configuredRateLimit.attempts >= 1 &&
      configuredRateLimit.attempts <= 100 &&
      Number.isInteger(configuredRateLimit.windowMs) &&
      configuredRateLimit.windowMs >= 1_000 &&
      configuredRateLimit.windowMs <= 24 * 60 * 60 * 1000 &&
      Number.isInteger(configuredRateLimit.blockMs) &&
      configuredRateLimit.blockMs >= 1_000 &&
      configuredRateLimit.blockMs <= 24 * 60 * 60 * 1000,
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity rate limits are invalid.",
    { status: 500 }
  );
  const configuredRegistrationRecoveryRateLimit = {
    perIp: {
      ...DEFAULT_INGRESS_POLICY.identity.perIp,
      ...registrationRecoveryRateLimit?.perIp
    },
    global: {
      ...DEFAULT_INGRESS_POLICY.identity.global,
      ...registrationRecoveryRateLimit?.global
    }
  };
  for (const selected of Object.values(configuredRegistrationRecoveryRateLimit)) {
    invariant(
      Number.isInteger(selected.attempts) &&
        selected.attempts >= 1 && selected.attempts <= 10_000 &&
        Number.isInteger(selected.windowMs) &&
        selected.windowMs >= 1_000 && selected.windowMs <= 24 * 60 * 60 * 1000 &&
        Number.isInteger(selected.blockMs) &&
        selected.blockMs >= 1_000 && selected.blockMs <= 24 * 60 * 60 * 1000,
      "IDENTITY_CONFIGURATION_ERROR",
      "Registration and recovery rate limits are invalid.",
      { status: 500 }
    );
  }
  const query = (text, values) =>
    authority
      ? authority.service({}, (client) => client.query(text, values))
      : pool.query(text, values);
  const transact = (work) =>
    authority ? authority.service({}, work) : transaction(pool, work);
  const rateTransact = (work) =>
    authority
      ? authority.service(
          { isolation: "read-committed" },
          work
        )
      : transaction(pool, work);

  async function pepperFor(version) {
    if (version === pepperVersion) return pepper;
    const prior = previousPeppers[version];
    return Buffer.isBuffer(prior) ? prior : null;
  }

  function subjectDigest(scope, subject) {
    return createHmac("sha256", pepper)
      .update(`${scope}\u0000${subject}`, "utf8")
      .digest("hex");
  }

  function rateLimitError(scope) {
    if (scope === "recovery") {
      return new HostedError(
        "RECOVERY_RATE_LIMITED",
        "Wait before asking for another recovery email.",
        { status: 429 }
      );
    }
    if (scope === "registration") {
      return new HostedError(
        "REGISTRATION_RATE_LIMITED",
        "Wait before asking for another account verification email.",
        { status: 429 }
      );
    }
    return genericAuthFailure(429);
  }

  async function consumeRateAttempts(scope, buckets) {
    const now = iso(clock());
    const selectedBuckets = buckets
      .map(({ subject, limit }) => ({
        subjectDigest: subjectDigest(scope, subject),
        limit
      }))
      .sort((left, right) =>
        left.subjectDigest.localeCompare(right.subjectDigest)
      );
    await rateTransact(async (client) => {
      for (const bucket of selectedBuckets) {
        await client.query(
          `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`sitesourcery.identity-rate:${scope}:${bucket.subjectDigest}`]
        );
        const existing = await client.query(
          `select window_started_at, attempt_count, blocked_until
             from ss.hosted_auth_rate_limits
            where scope = $1 and subject_digest = $2
            for update`,
          [scope, bucket.subjectDigest]
        );
        const row = existing.rows[0];
        if (row?.blocked_until && Date.parse(row.blocked_until) > Date.parse(now)) {
          throw rateLimitError(scope);
        }
        const freshWindow = !row ||
          (row.blocked_until && Date.parse(row.blocked_until) <= Date.parse(now)) ||
          Date.parse(row.window_started_at) + bucket.limit.windowMs <= Date.parse(now);
        const attempts = freshWindow ? 1 : Number(row.attempt_count) + 1;
        const windowStartedAt = freshWindow ? now : iso(row.window_started_at);
        const blockedUntil = attempts >= bucket.limit.attempts
          ? addMs(now, bucket.limit.blockMs)
          : null;
        await client.query(
          `insert into ss.hosted_auth_rate_limits (
             scope, subject_digest, window_started_at, attempt_count,
             blocked_until, updated_at
           ) values ($1, $2, $3, $4, $5, $3)
           on conflict (scope, subject_digest) do update
             set window_started_at = excluded.window_started_at,
                 attempt_count = excluded.attempt_count,
                 blocked_until = excluded.blocked_until,
                 updated_at = excluded.updated_at`,
          [scope, bucket.subjectDigest, windowStartedAt, attempts, blockedUntil]
        );
      }
    });
    return { now, subjectDigest: selectedBuckets[0].subjectDigest };
  }

  function consumeRateAttempt(scope, subject) {
    return consumeRateAttempts(scope, [{
      subject,
      limit: configuredRateLimit
    }]);
  }

  function consumeRegistrationRecoveryRate(scope, email, requestContext) {
    const clientAddress = String(requestContext?.clientAddress ?? "unavailable");
    return consumeRateAttempts(scope, [
      { subject: email, limit: configuredRateLimit },
      { subject: `client:${clientAddress}`, limit: configuredRegistrationRecoveryRateLimit.perIp },
      { subject: "global", limit: configuredRegistrationRecoveryRateLimit.global }
    ]);
  }

  async function clearRate(scope, selected) {
    await query(
      `delete from ss.hosted_auth_rate_limits
        where scope = $1 and subject_digest = $2`,
      [scope, selected]
    );
  }

  async function issueSession(
    client,
    userId,
    now,
    reauthenticated = true,
    suppliedRawToken = null
  ) {
    const rawToken =
      suppliedRawToken ??
      randomBytes(32).toString("base64url");
    invariant(
      typeof rawToken === "string" &&
        rawToken.length >= 32 &&
        rawToken.length <= 512,
      "IDENTITY_CONFIGURATION_ERROR",
      "Identity session token generator returned invalid bytes.",
      { status: 500 }
    );
    const tokenDigest = sha256(rawToken);
    const sessionId = randomUUID();
    const expiresAt = addMs(now, sessionTtlMs);
    await client.query(
      `insert into ss.hosted_sessions (
         id, user_id, token_digest, created_at, expires_at,
         reauthenticated_at, rotation
       ) values ($1, $2, $3, $4, $5, $6, 1)`,
      [
        sessionId,
        userId,
        tokenDigest,
        now,
        expiresAt,
        reauthenticated ? now : null
      ]
    );
    return {
      sessionToken: rawToken,
      session: {
        id: sessionId,
        tokenDigest,
        userId,
        createdAt: now,
        expiresAt,
        reauthenticatedAt: reauthenticated ? now : null
      }
    };
  }

  return Object.freeze({
    async register({
      name,
      organizationName,
      email: rawEmail,
      password: rawPassword,
      commandId
    }, requestContext = {}) {
      const email = normalizeEmail(rawEmail);
      const displayName = text(name, "Name", 100);
      const orgName = text(organizationName, "Organization name", 120, 2);
      const selectedPassword = password(rawPassword);
      const selectedCommandId = text(
        commandId,
        "Registration idempotency key",
        200,
        8
      );
      const mailReadiness =
        await registrationMailPort.readiness();
      invariant(
        mailReadiness?.ready === true &&
          mailReadiness?.verified === true,
        "ACCOUNT_REGISTRATION_HELD",
        "New account registration is not open yet. Contact Site Sourcery for help.",
        {
          status: 503,
          details: {
            delivery: "held",
            emailSent: false
          }
        }
      );
      const requestDigest = createHmac("sha256", pepper)
        .update(
          JSON.stringify({
            schema:
              "sitesourcery.registration-request/v1",
            commandId: selectedCommandId,
            displayName,
            organizationName: orgName,
            email,
            password: selectedPassword
          }),
          "utf8"
        )
        .digest("hex");
      const prior = await query(
        `select
           id, request_digest, state, expires_at
         from ss.hosted_registration_requests
        where command_id = $1
        limit 1`,
        [selectedCommandId]
      );
      if (prior.rows[0]) {
        invariant(
          prior.rows[0].request_digest === requestDigest,
          "REGISTRATION_IDEMPOTENCY_CONFLICT",
          "That registration request key was already used for different details.",
          { status: 409 }
        );
        invariant(
          ["delivered", "activated"].includes(
            prior.rows[0].state
          ),
          "REGISTRATION_DELIVERY_RECONCILIATION_REQUIRED",
          "That registration email may not have completed. Contact Site Sourcery before trying again.",
          { status: 409 }
        );
        return {
          accepted: true,
          verificationRequired: true,
          delivery:
            prior.rows[0].state === "delivered"
              ? "email"
              : "already_verified",
          emailSent:
            prior.rows[0].state === "delivered",
          expiresAt: iso(prior.rows[0].expires_at),
          replayed: true
        };
      }
      const gate = await consumeRegistrationRecoveryRate(
        "registration",
        email,
        requestContext
      );
      const encoded = await hashPasswordWithPepper(selectedPassword, {
        pepper,
        pepperVersion,
        randomBytes
      });
      const tokenBytes = randomBytes(32);
      invariant(
        Buffer.isBuffer(tokenBytes) &&
          tokenBytes.byteLength === 32,
        "IDENTITY_CONFIGURATION_ERROR",
        "Identity registration token generator returned invalid bytes.",
        { status: 500 }
      );
      const rawToken = tokenBytes.toString("base64url");
      const tokenDigest = sha256(rawToken);
      const registrationId = randomUUID();
      const expiresAt = addMs(gate.now, registrationTtlMs);
      const deliveryIdempotencyKey =
        `registration_${registrationId}`;
      try {
        const staged = await transact(async (client) => {
          await client.query(
            `select pg_advisory_xact_lock(
               hashtextextended($1, 0)
             )`,
            [
              `sitesourcery.registration.command:${selectedCommandId}`
            ]
          );
          await client.query(
            `select pg_advisory_xact_lock(
               hashtextextended($1, 0)
             )`,
            [
              `sitesourcery.registration.email:${email}`
            ]
          );
          const concurrent = await client.query(
            `select request_digest, state, expires_at
               from ss.hosted_registration_requests
              where command_id = $1
              limit 1
              for update`,
            [selectedCommandId]
          );
          if (concurrent.rows[0]) {
            invariant(
              concurrent.rows[0].request_digest ===
                requestDigest,
              "REGISTRATION_IDEMPOTENCY_CONFLICT",
              "That registration request key was already used for different details.",
              { status: 409 }
            );
            return {
              replayed: true,
              state: concurrent.rows[0].state,
              expiresAt: iso(
                concurrent.rows[0].expires_at
              )
            };
          }
          const existingUser = await client.query(
            `select id
               from auth.users
              where lower(email) = $1
              limit 1
              for update`,
            [email]
          );
          invariant(
            existingUser.rowCount === 0,
            "ACCOUNT_UNAVAILABLE",
            "That account cannot be created.",
            { status: 409 }
          );
          await client.query(
            `update ss.hosted_registration_requests
                set state = 'superseded',
                    superseded_at = $2
              where lower(email) = $1
                and state in (
                  'pending_delivery',
                  'delivered',
                  'delivery_unknown'
                )
                and expires_at <= $2`,
            [email, gate.now]
          );
          const pending = await client.query(
            `select state, expires_at
               from ss.hosted_registration_requests
              where lower(email) = $1
                and state in (
                  'pending_delivery',
                  'delivered',
                  'delivery_unknown'
                )
              limit 1
              for update`,
            [email]
          );
          invariant(
            pending.rowCount === 0,
            "REGISTRATION_ALREADY_PENDING",
            "A verification request is already pending for that email. Use the verification message already sent or wait for it to expire.",
            { status: 409 }
          );
          const inserted = await client.query(
            `insert into ss.hosted_registration_requests (
               id, command_id, request_digest, email,
               display_name, organization_name, password_phc,
               pepper_version, token_digest, state,
               created_at, expires_at
             ) values (
               $1, $2, $3, $4,
               $5, $6, $7,
               $8, $9, 'pending_delivery',
               $10, $11
             )`,
            [
              registrationId,
              selectedCommandId,
              requestDigest,
              email,
              displayName,
              orgName,
              encoded,
              pepperVersion,
              tokenDigest,
              gate.now,
              expiresAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "REGISTRATION_STAGE_FAILED",
            "The registration request could not be staged.",
            { status: 500 }
          );
          return {
            replayed: false,
            state: "pending_delivery",
            expiresAt
          };
        });
        if (staged.replayed) {
          invariant(
            ["delivered", "activated"].includes(
              staged.state
            ),
            "REGISTRATION_DELIVERY_RECONCILIATION_REQUIRED",
            "That registration email may not have completed. Contact Site Sourcery before trying again.",
            { status: 409 }
          );
          return {
            accepted: true,
            verificationRequired: true,
            delivery:
              staged.state === "delivered"
                ? "email"
                : "already_verified",
            emailSent: staged.state === "delivered",
            expiresAt: staged.expiresAt,
            replayed: true
          };
        }
        let receipt;
        try {
          receipt = await registrationMailPort.deliver({
            idempotencyKey: deliveryIdempotencyKey,
            recipient: email,
            token: rawToken,
            requestedAt: gate.now,
            expiresAt
          });
        } catch (error) {
          await query(
            `update ss.hosted_registration_requests
                set state = 'delivery_unknown'
              where id = $1
                and state = 'pending_delivery'`,
            [registrationId]
          );
          throw error;
        }
        invariant(
          receipt?.state === "delivered" &&
            receipt.idempotencyKey ===
              deliveryIdempotencyKey &&
            receipt.expiresAt === expiresAt &&
            /^[a-f0-9]{64}$/u.test(receipt.receiptId) &&
            /^[a-f0-9]{64}$/u.test(receipt.payloadDigest),
          "REGISTRATION_DELIVERY_RECEIPT_INVALID",
          "Registration transport returned an invalid delivery receipt.",
          { status: 502 }
        );
        const receiptFacts = {
          schema:
            "sitesourcery.registration-delivery-evidence/v1",
          receiptId: receipt.receiptId,
          mode: receipt.mode,
          provider: receipt.provider,
          providerMessageId: receipt.providerMessageId,
          idempotencyKey: receipt.idempotencyKey,
          payloadDigest: receipt.payloadDigest,
          acceptedAt: receipt.acceptedAt,
          expiresAt: receipt.expiresAt
        };
        const receiptDigest = sha256(
          JSON.stringify(receiptFacts)
        );
        await transact(async (client) => {
          const locked = await client.query(
            `select
               request_digest, token_digest, state, expires_at
             from ss.hosted_registration_requests
            where id = $1
            for update`,
            [registrationId]
          );
          invariant(
            locked.rowCount === 1 &&
              locked.rows[0].request_digest ===
                requestDigest &&
              locked.rows[0].token_digest ===
                tokenDigest &&
              locked.rows[0].state ===
                "pending_delivery" &&
              iso(locked.rows[0].expires_at) === expiresAt,
            "REGISTRATION_DELIVERY_RECONCILIATION_REQUIRED",
            "Registration state changed while email was being delivered.",
            { status: 409 }
          );
          const finalized = await client.query(
            `update ss.hosted_registration_requests
                set state = 'delivered',
                    delivery_provider = $2,
                    delivery_receipt = $3::jsonb,
                    delivery_receipt_digest = $4,
                    delivered_at = $5
              where id = $1
                and state = 'pending_delivery'`,
            [
              registrationId,
              receipt.provider,
              JSON.stringify(receiptFacts),
              receiptDigest,
              receipt.acceptedAt
            ]
          );
          invariant(
            finalized.rowCount === 1,
            "REGISTRATION_DELIVERY_RECONCILIATION_REQUIRED",
            "Registration delivery could not be finalized.",
            { status: 409 }
          );
        });
        return {
          accepted: true,
          verificationRequired: true,
          delivery: "email",
          emailSent: true,
          expiresAt,
          replayed: false
        };
      } catch (error) {
        await query(
          `update ss.hosted_registration_requests
              set state = 'delivery_unknown'
            where id = $1
              and state = 'pending_delivery'`,
          [registrationId]
        );
        throw error;
      }
    },

    async completeRegistration({
      token: rawToken,
      commandId: rawCommandId
    } = {}) {
      const selectedRawToken = text(
        rawToken,
        "Registration verification token",
        512,
        32
      );
      const selectedCommandId = text(
        rawCommandId,
        "Registration activation idempotency key",
        200,
        8
      );
      const tokenDigest = sha256(selectedRawToken);
      const sessionToken = createHmac("sha256", pepper)
        .update(
          `sitesourcery.registration-session/v1\u0000${selectedRawToken}`,
          "utf8"
        )
        .digest("base64url");
      const sessionTokenDigest = sha256(sessionToken);
      const activatedAt = iso(clock());
      const result = await transact(async (client) => {
        const selected = await client.query(
          `select *
             from ss.hosted_registration_requests
            where token_digest = $1
              and state in ('delivered', 'activated')
              and expires_at > $2
            for update`,
          [tokenDigest, activatedAt]
        );
        invariant(
          selected.rowCount === 1,
          "REGISTRATION_TOKEN_INVALID",
          "That account verification link is invalid or expired.",
          { status: 409 }
        );
        const registration = selected.rows[0];
        if (registration.state === "activated") {
          invariant(
            registration.activation_command_id ===
              selectedCommandId,
            "REGISTRATION_ALREADY_COMPLETED",
            "That account is verified. Sign in to continue.",
            { status: 409 }
          );
          const replay = await client.query(
            `select
               users.id,
               users.email,
               users.created_at,
               profile.display_name,
               organization.id as organization_id,
               organization.name as organization_name,
               organization.state as organization_state,
               organization.created_at as organization_created_at,
               membership.role as organization_role,
               session.id as session_id,
               session.created_at as session_created_at,
               session.expires_at as session_expires_at,
               session.reauthenticated_at
             from auth.users users
             join ss.hosted_account_profiles profile
               on profile.user_id = users.id
             join ss.organizations organization
               on organization.id = $2
             join ss.organization_memberships membership
               on membership.organization_id =
                  organization.id
              and membership.user_id = users.id
             join ss.hosted_sessions session
               on session.user_id = users.id
              and session.token_digest = $3
              and session.revoked_at is null
              and session.expires_at > $4
            where users.id = $1
              and users.disabled_at is null
              and profile.state = 'active'
              and organization.state = 'active'
              and membership.state = 'active'
            limit 1`,
            [
              registration.activated_user_id,
              registration.activated_organization_id,
              sessionTokenDigest,
              activatedAt
            ]
          );
          invariant(
            replay.rowCount === 1,
            "REGISTRATION_ALREADY_COMPLETED",
            "That account is verified. Sign in to continue.",
            { status: 409 }
          );
          const row = replay.rows[0];
          return {
            email: row.email,
            user: {
              id: row.id,
              name: row.display_name,
              email: row.email,
              createdAt: iso(row.created_at)
            },
            organization: {
              id: row.organization_id,
              name: row.organization_name,
              role: row.organization_role,
              state: row.organization_state,
              createdAt: iso(
                row.organization_created_at
              )
            },
            sessionToken,
            session: {
              id: row.session_id,
              tokenDigest: sessionTokenDigest,
              userId: row.id,
              createdAt: iso(
                row.session_created_at
              ),
              expiresAt: iso(
                row.session_expires_at
              ),
              reauthenticatedAt:
                row.reauthenticated_at
                  ? iso(row.reauthenticated_at)
                  : null
            },
            replayed: true
          };
        }
        const userId = randomUUID();
        const organizationId = randomUUID();
        const created = await client.query(
          `insert into auth.users (
             id, email, created_at, updated_at
           ) values ($1, $2, $3, $3)
           on conflict do nothing
           returning id`,
          [userId, registration.email, activatedAt]
        );
        invariant(
          created.rowCount === 1,
          "ACCOUNT_UNAVAILABLE",
          "That account cannot be created.",
          { status: 409 }
        );
        const profile = await client.query(
          `insert into ss.hosted_account_profiles (
             user_id, display_name, state,
             created_at, updated_at
           ) values ($1, $2, 'active', $3, $3)`,
          [
            userId,
            registration.display_name,
            activatedAt
          ]
        );
        const credential = await client.query(
          `insert into ss.hosted_password_credentials (
             user_id, password_phc, pepper_version, revision,
             created_at, updated_at, rotated_at
           ) values ($1, $2, $3, 1, $4, $4, $4)`,
          [
            userId,
            registration.password_phc,
            registration.pepper_version,
            activatedAt
          ]
        );
        const organization = await client.query(
          `insert into ss.organizations (
             id, created_by_user_id, name, state,
             created_at, updated_at
           ) values ($1, $2, $3, 'active', $4, $4)`,
          [
            organizationId,
            userId,
            registration.organization_name,
            activatedAt
          ]
        );
        const membership = await client.query(
          `insert into ss.organization_memberships (
             organization_id, user_id, role, state,
             accepted_at, created_at, updated_at
           ) values (
             $1, $2, 'owner', 'active', $3, $3, $3
           )`,
          [organizationId, userId, activatedAt]
        );
        invariant(
          profile.rowCount === 1 &&
            credential.rowCount === 1 &&
            organization.rowCount === 1 &&
            membership.rowCount === 1,
          "REGISTRATION_ACTIVATION_FAILED",
          "The verified account could not be activated.",
          { status: 500 }
        );
        const consumed = await client.query(
          `update ss.hosted_registration_requests
              set state = 'activated',
                  activated_at = $2,
                  activated_user_id = $3,
                  activated_organization_id = $4,
                  activation_command_id = $5
            where id = $1
              and state = 'delivered'`,
          [
            registration.id,
            activatedAt,
            userId,
            organizationId,
            selectedCommandId
          ]
        );
        invariant(
          consumed.rowCount === 1,
          "REGISTRATION_ACTIVATION_FAILED",
          "The verification token could not be consumed.",
          { status: 409 }
        );
        const session = await issueSession(
          client,
          userId,
          activatedAt,
          true,
          sessionToken
        );
        return {
          email: registration.email,
          user: {
            id: userId,
            name: registration.display_name,
            email: registration.email,
            createdAt: activatedAt
          },
          organization: {
            id: organizationId,
            name: registration.organization_name,
            role: "owner",
            state: "active",
            createdAt: activatedAt
          },
          ...session,
          replayed: false
        };
      });
      await clearRate(
        "registration",
        subjectDigest("registration", result.email)
      );
      const { email: _email, ...safe } = result;
      return safe;
    },

    registrationReadiness() {
      return registrationMailPort.readiness();
    },

    async signIn({ email: rawEmail, password: rawPassword }) {
      const email = normalizeEmail(rawEmail);
      password(rawPassword);
      const gate = await consumeRateAttempt(
        "sign_in",
        email
      );
      const found = await query(
        `select
           users.id,
           users.email,
           users.created_at,
           users.disabled_at,
           profile.display_name,
           profile.state,
           credential.password_phc
         from auth.users users
         join ss.hosted_account_profiles profile on profile.user_id = users.id
         join ss.hosted_password_credentials credential
           on credential.user_id = users.id
        where lower(users.email) = $1
        limit 1`,
        [email]
      );
      const row = found.rows[0] ?? null;
      const valid =
        row &&
        !row.disabled_at &&
        row.state === "active" &&
        (await verifyPasswordWithPepper(
          rawPassword,
          row.password_phc,
          pepperFor
        ));
      if (!valid) {
        throw genericAuthFailure();
      }
      const session = await transact((client) =>
        issueSession(client, row.id, gate.now)
      );
      await clearRate("sign_in", gate.subjectDigest);
      return { user: publicUser(row), ...session };
    },

    async authenticate(rawToken) {
      if (typeof rawToken !== "string" || rawToken.length < 32) return null;
      const result = await query(
        `select
           session.id as session_id,
           session.token_digest,
           session.user_id,
           session.created_at as session_created_at,
           session.expires_at,
           session.reauthenticated_at,
           users.id,
           users.email,
           users.created_at,
           users.disabled_at,
           profile.display_name,
           profile.state
         from ss.hosted_sessions session
         join auth.users users on users.id = session.user_id
         join ss.hosted_account_profiles profile on profile.user_id = users.id
        where session.token_digest = $1
          and session.revoked_at is null
          and session.expires_at > clock_timestamp()
        limit 1`,
        [sha256(rawToken)]
      );
      const row = result.rows[0];
      if (!row || row.disabled_at || row.state !== "active") return null;
      return {
        userId: row.user_id,
        sessionId: row.session_id,
        sessionDigest: row.token_digest,
        expiresAt: new Date(row.expires_at).toISOString(),
        reauthenticatedAt: row.reauthenticated_at
          ? new Date(row.reauthenticated_at).toISOString()
          : null,
        user: publicUser(row)
      };
    },

    async signOut(actor) {
      invariant(actor?.sessionDigest, "AUTHENTICATION_REQUIRED", "Sign in to continue.", {
        status: 401
      });
      await query(
        `update ss.hosted_sessions
            set revoked_at = coalesce(revoked_at, clock_timestamp())
          where user_id = $1 and token_digest = $2`,
        [actor.userId, actor.sessionDigest]
      );
      return { signedOut: true };
    },

    async reauthenticate(actor, rawPassword) {
      invariant(actor?.userId && actor?.sessionDigest, "AUTHENTICATION_REQUIRED", "Sign in to continue.", {
        status: 401
      });
      password(rawPassword);
      const gate = await consumeRateAttempt(
        "reauthentication",
        actor.userId
      );
      const found = await query(
        `select password_phc
           from ss.hosted_password_credentials
          where user_id = $1`,
        [actor.userId]
      );
      const valid =
        found.rows[0] &&
        (await verifyPasswordWithPepper(
          rawPassword,
          found.rows[0].password_phc,
          pepperFor
        ));
      if (!valid) {
        throw genericAuthFailure();
      }
      const updated = await query(
        `update ss.hosted_sessions
            set reauthenticated_at = $3
          where user_id = $1
            and token_digest = $2
            and revoked_at is null
            and expires_at > $3
        returning id`,
        [actor.userId, actor.sessionDigest, gate.now]
      );
      invariant(updated.rowCount === 1, "AUTHENTICATION_REQUIRED", "Sign in to continue.", {
        status: 401
      });
      await clearRate("reauthentication", gate.subjectDigest);
      return { reauthenticatedAt: gate.now };
    },

    async requireRecentReauthentication(actor, maximumAgeMs = 10 * 60 * 1000) {
      invariant(
        actor?.reauthenticatedAt &&
          Date.parse(actor.reauthenticatedAt) + maximumAgeMs >
            Date.parse(iso(clock())),
        "REAUTHENTICATION_REQUIRED",
        "Confirm your password again to continue.",
        { status: 403 }
      );
      return true;
    },

    async issueRecoveryForDelivery(
      rawEmail,
      { commandId } = {},
      requestContext = {}
    ) {
      const email = normalizeEmail(rawEmail);
      const selectedCommandId = text(
        commandId,
        "Recovery idempotency key",
        200,
        8
      );
      const rawToken = createHmac("sha256", pepper)
        .update(
          `sitesourcery.recovery-token/v1\u0000${email}\u0000${selectedCommandId}`,
          "utf8"
        )
        .digest("base64url");
      const tokenDigest = sha256(rawToken);
      const replay = await query(
        `select
           token.id,
           token.created_at,
           token.expires_at,
           users.email
         from ss.hosted_recovery_tokens token
         join auth.users users on users.id = token.user_id
        where token.token_digest = $1
        limit 1`,
        [tokenDigest]
      );
      if (replay.rows[0]) {
        return {
          accepted: true,
          recipient: email,
          delivery: {
            tokenId: replay.rows[0].id,
            email: replay.rows[0].email,
            token: rawToken,
            createdAt: iso(replay.rows[0].created_at),
            expiresAt: iso(replay.rows[0].expires_at),
            replayed: true
          }
        };
      }
      const gate = await consumeRegistrationRecoveryRate(
        "recovery",
        email,
        requestContext
      );
      const delivery = await transact(async (client) => {
        const result = await client.query(
          `select users.id, users.email
             from auth.users users
             join ss.hosted_account_profiles profile
               on profile.user_id = users.id
            where lower(users.email) = $1
              and users.disabled_at is null
              and profile.state = 'active'
            limit 1
            for update of users`,
          [email]
        );
        if (!result.rows[0]) return null;
        const expiresAt = addMs(gate.now, recoveryTtlMs);
        await client.query(
          `update ss.hosted_recovery_tokens
              set used_at = coalesce(used_at, $2)
            where user_id = $1
              and token_digest <> $3
              and used_at is null`,
          [result.rows[0].id, gate.now, tokenDigest]
        );
        const inserted = await client.query(
          `insert into ss.hosted_recovery_tokens (
             user_id, token_digest, created_at, expires_at
           ) values ($1, $2, $3, $4)
           on conflict (token_digest) do nothing
           returning id, created_at, expires_at`,
          [
            result.rows[0].id,
            tokenDigest,
            gate.now,
            expiresAt
          ]
        );
        const token =
          inserted.rows[0] ??
          (
            await client.query(
              `select id, created_at, expires_at
                 from ss.hosted_recovery_tokens
                where token_digest = $1`,
              [tokenDigest]
            )
          ).rows[0];
        return {
          tokenId: token.id,
          email: result.rows[0].email,
          token: rawToken,
          createdAt: iso(token.created_at),
          expiresAt: iso(token.expires_at),
          replayed: inserted.rowCount === 0
        };
      });
      return {
        accepted: true,
        recipient: email,
        delivery
      };
    },

    async completeRecovery(rawToken, rawPassword) {
      const tokenDigest = sha256(text(rawToken, "Recovery token", 512, 32));
      const encoded = await hashPasswordWithPepper(rawPassword, {
        pepper,
        pepperVersion,
        randomBytes
      });
      const now = iso(clock());
      return transact(async (client) => {
        const token = await client.query(
          `select user_id
             from ss.hosted_recovery_tokens
            where token_digest = $1
              and used_at is null
              and expires_at > $2
            for update`,
          [tokenDigest, now]
        );
        invariant(
          token.rowCount === 1,
          "RECOVERY_TOKEN_INVALID",
          "That recovery link is invalid or expired.",
          { status: 409 }
        );
        const userId = token.rows[0].user_id;
        await client.query(
          `update ss.hosted_password_credentials
              set password_phc = $2,
                  pepper_version = $3,
                  revision = revision + 1,
                  rotated_at = $4
            where user_id = $1`,
          [userId, encoded, pepperVersion, now]
        );
        await client.query(
          `update ss.hosted_recovery_tokens
              set used_at = $2
            where token_digest = $1`,
          [tokenDigest, now]
        );
        await client.query(
          `update ss.hosted_sessions
              set revoked_at = coalesce(revoked_at, $2)
            where user_id = $1`,
          [userId, now]
        );
        return { completed: true };
      });
    },

    async rotatePassword(actor, currentPassword, nextPassword) {
      invariant(actor?.userId, "AUTHENTICATION_REQUIRED", "Sign in to continue.", {
        status: 401
      });
      const found = await query(
        `select password_phc
           from ss.hosted_password_credentials
          where user_id = $1`,
        [actor.userId]
      );
      const valid =
        found.rows[0] &&
        (await verifyPasswordWithPepper(
          currentPassword,
          found.rows[0].password_phc,
          pepperFor
        ));
      if (!valid) throw genericAuthFailure();
      const encoded = await hashPasswordWithPepper(nextPassword, {
        pepper,
        pepperVersion,
        randomBytes
      });
      const now = iso(clock());
      await transact(async (client) => {
        await client.query(
          `update ss.hosted_password_credentials
              set password_phc = $2,
                  pepper_version = $3,
                  revision = revision + 1,
                  rotated_at = $4
            where user_id = $1`,
          [actor.userId, encoded, pepperVersion, now]
        );
        await client.query(
          `update ss.hosted_sessions
              set revoked_at = coalesce(revoked_at, $2)
            where user_id = $1`,
          [actor.userId, now]
        );
      });
      return { rotated: true, sessionsRevoked: true };
    },

    async cleanup() {
      const registrations = await query(
        `delete from ss.hosted_registration_requests
          where expires_at <= clock_timestamp()
             or (
               state = 'superseded'
               and superseded_at <
                 clock_timestamp() - interval '24 hours'
             )`
      );
      const sessions = await query(
        `delete from ss.hosted_sessions
          where expires_at <= clock_timestamp()
             or (
               revoked_at is not null
               and revoked_at < clock_timestamp() - interval '30 days'
             )`
      );
      const recovery = await query(
        `delete from ss.hosted_recovery_tokens
          where expires_at <= clock_timestamp()
             or used_at is not null`
      );
      return {
        registrationRequests: registrations.rowCount,
        sessions: sessions.rowCount,
        recoveryTokens: recovery.rowCount
      };
    }
  });
}
