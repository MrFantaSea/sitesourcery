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

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_MS = 30 * 60 * 1000;
const DEFAULT_RATE_LIMIT = Object.freeze({
  attempts: 6,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000
});

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
  rateLimit = DEFAULT_RATE_LIMIT
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
      recoveryTtlMs > 0,
    "IDENTITY_CONFIGURATION_ERROR",
    "Identity token lifetimes are invalid.",
    { status: 500 }
  );
  const configuredRateLimit = {
    ...DEFAULT_RATE_LIMIT,
    ...rateLimit
  };
  const query = (text, values) =>
    authority
      ? authority.service({}, (client) => client.query(text, values))
      : pool.query(text, values);
  const transact = (work) =>
    authority ? authority.service({}, work) : transaction(pool, work);

  async function pepperFor(version) {
    if (version === pepperVersion) return pepper;
    const prior = previousPeppers[version];
    return Buffer.isBuffer(prior) ? prior : null;
  }

  function subjectDigest(scope, email, throttleKey = "") {
    return createHmac("sha256", pepper)
      .update(`${scope}\u0000${email}\u0000${String(throttleKey)}`, "utf8")
      .digest("hex");
  }

  async function checkRate(scope, email, throttleKey) {
    const now = iso(clock());
    const selected = subjectDigest(scope, email, throttleKey);
    const result = await query(
      `select blocked_until
         from ss.hosted_auth_rate_limits
        where scope = $1 and subject_digest = $2`,
      [scope, selected]
    );
    if (
      result.rows[0]?.blocked_until &&
      Date.parse(result.rows[0].blocked_until) > Date.parse(now)
    ) {
      throw genericAuthFailure(429);
    }
    return { now, subjectDigest: selected };
  }

  async function recordFailure(scope, selected, now) {
    await transact(async (client) => {
      const existing = await client.query(
        `select window_started_at, attempt_count
           from ss.hosted_auth_rate_limits
          where scope = $1 and subject_digest = $2
          for update`,
        [scope, selected]
      );
      const row = existing.rows[0];
      const freshWindow =
        !row ||
        Date.parse(row.window_started_at) + configuredRateLimit.windowMs <=
          Date.parse(now);
      const attempts = freshWindow ? 1 : Number(row.attempt_count) + 1;
      const windowStartedAt = freshWindow
        ? now
        : new Date(row.window_started_at).toISOString();
      const blockedUntil =
        attempts >= configuredRateLimit.attempts
          ? addMs(now, configuredRateLimit.blockMs)
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
        [scope, selected, windowStartedAt, attempts, blockedUntil]
      );
    });
  }

  async function clearRate(scope, selected) {
    await query(
      `delete from ss.hosted_auth_rate_limits
        where scope = $1 and subject_digest = $2`,
      [scope, selected]
    );
  }

  async function issueSession(client, userId, now, reauthenticated = true) {
    const rawToken = randomBytes(32).toString("base64url");
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
      password: rawPassword
    }) {
      const email = normalizeEmail(rawEmail);
      const displayName = text(name, "Name", 100);
      const orgName = text(organizationName, "Organization name", 120, 2);
      const gate = await checkRate("registration", email, "");
      const encoded = await hashPasswordWithPepper(rawPassword, {
        pepper,
        pepperVersion,
        randomBytes
      });
      try {
        const result = await transact(async (client) => {
          const userId = randomUUID();
          const organizationId = randomUUID();
          const created = await client.query(
            `insert into auth.users (id, email, created_at, updated_at)
             values ($1, $2, $3, $3)
             on conflict do nothing
             returning id, email, created_at`,
            [userId, email, gate.now]
          );
          invariant(
            created.rowCount === 1,
            "ACCOUNT_UNAVAILABLE",
            "That account cannot be created.",
            { status: 409 }
          );
          await client.query(
            `insert into ss.hosted_account_profiles (
               user_id, display_name, state, created_at, updated_at
             ) values ($1, $2, 'active', $3, $3)`,
            [userId, displayName, gate.now]
          );
          await client.query(
            `insert into ss.hosted_password_credentials (
               user_id, password_phc, pepper_version, revision,
               created_at, updated_at, rotated_at
             ) values ($1, $2, $3, 1, $4, $4, $4)`,
            [userId, encoded, pepperVersion, gate.now]
          );
          await client.query(
            `insert into ss.organizations (
               id, created_by_user_id, name, state, created_at, updated_at
             ) values ($1, $2, $3, 'active', $4, $4)`,
            [organizationId, userId, orgName, gate.now]
          );
          await client.query(
            `insert into ss.organization_memberships (
               organization_id, user_id, role, state, accepted_at,
               created_at, updated_at
             ) values ($1, $2, 'owner', 'active', $3, $3, $3)`,
            [organizationId, userId, gate.now]
          );
          const session = await issueSession(client, userId, gate.now);
          return {
            user: {
              id: userId,
              name: displayName,
              email,
              createdAt: gate.now
            },
            organization: {
              id: organizationId,
              name: orgName,
              role: "owner",
              state: "active",
              createdAt: gate.now
            },
            ...session
          };
        });
        await clearRate("registration", gate.subjectDigest);
        return result;
      } catch (error) {
        await recordFailure(
          "registration",
          gate.subjectDigest,
          gate.now
        );
        throw error;
      }
    },

    async signIn({ email: rawEmail, password: rawPassword, throttleKey = "" }) {
      const email = normalizeEmail(rawEmail);
      password(rawPassword);
      const gate = await checkRate("sign_in", email, throttleKey);
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
        await recordFailure("sign_in", gate.subjectDigest, gate.now);
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

    async reauthenticate(actor, rawPassword, { throttleKey = "" } = {}) {
      invariant(actor?.userId && actor?.sessionDigest, "AUTHENTICATION_REQUIRED", "Sign in to continue.", {
        status: 401
      });
      password(rawPassword);
      const gate = await checkRate(
        "reauthentication",
        actor.userId,
        throttleKey
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
        await recordFailure(
          "reauthentication",
          gate.subjectDigest,
          gate.now
        );
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

    async issueRecoveryForOperator(rawEmail) {
      const email = normalizeEmail(rawEmail);
      const now = iso(clock());
      const result = await query(
        `select users.id
           from auth.users users
           join ss.hosted_account_profiles profile
             on profile.user_id = users.id
          where lower(users.email) = $1
            and users.disabled_at is null
            and profile.state = 'active'
          limit 1`,
        [email]
      );
      if (!result.rows[0]) return { accepted: true, manualDelivery: null };
      const rawToken = randomBytes(32).toString("base64url");
      const tokenDigest = sha256(rawToken);
      await query(
        `insert into ss.hosted_recovery_tokens (
           user_id, token_digest, created_at, expires_at
         ) values ($1, $2, $3, $4)`,
        [result.rows[0].id, tokenDigest, now, addMs(now, recoveryTtlMs)]
      );
      return {
        accepted: true,
        manualDelivery: {
          userId: result.rows[0].id,
          email,
          token: rawToken
        }
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
        sessions: sessions.rowCount,
        recoveryTokens: recovery.rowCount
      };
    }
  });
}
