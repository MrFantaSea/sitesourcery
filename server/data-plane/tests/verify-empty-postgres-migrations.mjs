import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";
import { createHostedEngagementBootstrap } from
  "../../hosted/engagement-bootstrap.mjs";
import { createPostgresEngagementBootstrapRepository } from
  "../../hosted/engagement-bootstrap-postgres.mjs";
import { createProjectLegalAuthorityV4 } from
  "../../hosted/project-legal-authority.mjs";
import { createMailLifecycle } from
  "../../hosted/mail-lifecycle.mjs";
import { createPostgresMailLifecycleRepository } from
  "../../hosted/mail-lifecycle-postgres.mjs";
import { createSupportCaseService } from
  "../../hosted/support-cases.mjs";
import { createPostgresSupportCaseRepository } from
  "../../hosted/support-cases-postgres.mjs";
import { createOperatorWorkQueue } from
  "../../hosted/operator-work-queue.mjs";
import { createPostgresOperatorWorkQueueRepository } from
  "../../hosted/operator-work-queue-postgres.mjs";
import { resolveMigrationVerificationInventory } from
  "./migration-verification-inventory.mjs";

const { Pool } = pg;
export const MIGRATION_TEST_URL_ENV =
  "SITESOURCERY_PG_MIGRATION_TEST_URL";
export const CORE_RELEASE_ADMIN_URL_ENV =
  "SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL";
const EXPECTED_POSTGRES_MAJOR = 16;
const MIGRATIONS = new URL(
  "../supabase/migrations/",
  import.meta.url
);
const PRIVACY_RELEASE = Object.freeze({
  version: "SS-HOSTED-PRIVACY-2026-08-09-V3",
  contentDigest:
    "5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967",
  contentUri:
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/",
  effectiveAt: "2026-08-09T15:25:59.000Z",
  byteCount: 29_610,
  artifactUri:
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/"
});
const WEBSITE_TERMS_RELEASE = Object.freeze({
  version: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3",
  contentDigest:
    "b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602",
  artifactUri:
    "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/",
  byteCount: 26_171
});
const JOINT_LEGAL_RELEASE_DOCUMENTS = Object.freeze([
  Object.freeze({
    kind: "privacy",
    version: PRIVACY_RELEASE.version,
    contentDigest: PRIVACY_RELEASE.contentDigest,
    contentUri: PRIVACY_RELEASE.contentUri,
    effectiveAt: PRIVACY_RELEASE.effectiveAt
  }),
  Object.freeze({
    kind: "product",
    version: WEBSITE_TERMS_RELEASE.version,
    contentDigest: WEBSITE_TERMS_RELEASE.contentDigest,
    contentUri:
      "https://sitesourcery.com/legal/website-terms/#self-service",
    effectiveAt: PRIVACY_RELEASE.effectiveAt
  }),
  Object.freeze({
    kind: "website",
    version: WEBSITE_TERMS_RELEASE.version,
    contentDigest: WEBSITE_TERMS_RELEASE.contentDigest,
    contentUri: "https://sitesourcery.com/legal/website-terms/",
    effectiveAt: PRIVACY_RELEASE.effectiveAt
  })
]);
const JOINT_LEGAL_RELEASE_AUTHORITY_DIGEST =
  "ae52bb144a3cb9bd09709cd58ce43878ec2a03d650a19ff197532ea51cd4d1cf";
const JOINT_LEGAL_RELEASE_AUTHORITY = Object.freeze({
  schema: "sitesourcery.project-legal-authority/v3",
  documents: JOINT_LEGAL_RELEASE_DOCUMENTS,
  documentBindings: Object.freeze([
    Object.freeze({ id: "00000000-0000-4000-8000-000000000048" }),
    Object.freeze({ id: "00000000-0000-4000-8000-000000000103" }),
    Object.freeze({ id: "00000000-0000-4000-8000-000000000104" })
  ]),
  artifactBindings: Object.freeze([
    Object.freeze({
      artifactUri: PRIVACY_RELEASE.artifactUri,
      artifactSha256: PRIVACY_RELEASE.contentDigest,
      byteCount: PRIVACY_RELEASE.byteCount,
      mediaType: "text/html; charset=utf-8"
    }),
    Object.freeze({ artifactUri: null }),
    Object.freeze({
      artifactUri: WEBSITE_TERMS_RELEASE.artifactUri,
      artifactSha256: WEBSITE_TERMS_RELEASE.contentDigest,
      byteCount: WEBSITE_TERMS_RELEASE.byteCount,
      mediaType: "text/html; charset=utf-8"
    })
  ]),
  authorityDigest: JOINT_LEGAL_RELEASE_AUTHORITY_DIGEST
});
const JOINT_LEGAL_V4_RELEASE_AUTHORITY_DIGEST =
  "ba2871701541ca78e29a9fef313a3e335e7fed571590eb319667c763a7cd3968";
const JOINT_LEGAL_V4_RELEASE_AUTHORITY = Object.freeze({
  schema: "sitesourcery.project-legal-authority/v4",
  documents: Object.freeze([
    Object.freeze({
      kind: "privacy",
      version: "SS-HOSTED-PRIVACY-2026-08-09-V4",
      contentDigest:
        "2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99",
      contentUri:
        "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/",
      effectiveAt: "2026-08-09T21:42:11.000Z"
    }),
    Object.freeze({
      kind: "product",
      version: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4",
      contentDigest:
        "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642",
      contentUri: "https://sitesourcery.com/legal/website-terms/#self-service",
      effectiveAt: "2026-08-09T21:42:11.000Z"
    }),
    Object.freeze({
      kind: "website",
      version: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4",
      contentDigest:
        "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642",
      contentUri: "https://sitesourcery.com/legal/website-terms/",
      effectiveAt: "2026-08-09T21:42:11.000Z"
    })
  ]),
  documentBindings: Object.freeze([
    Object.freeze({ id: "00000000-0000-4000-8000-000000000049" }),
    Object.freeze({ id: "00000000-0000-4000-8000-000000000105" }),
    Object.freeze({ id: "00000000-0000-4000-8000-000000000106" })
  ]),
  artifactBindings: Object.freeze([
    Object.freeze({
      artifactUri:
        "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/",
      artifactSha256:
        "2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99",
      byteCount: 31_451,
      mediaType: "text/html; charset=utf-8"
    }),
    Object.freeze({ artifactUri: null }),
    Object.freeze({
      artifactUri:
        "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4/",
      artifactSha256:
        "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642",
      byteCount: 26_215,
      mediaType: "text/html; charset=utf-8"
    })
  ]),
  authorityDigest: JOINT_LEGAL_V4_RELEASE_AUTHORITY_DIGEST
});

function releasedJointLegalV4Authority() {
  const [privacy, , website] = JOINT_LEGAL_V4_RELEASE_AUTHORITY.documents;
  const [privacyArtifact, , websiteArtifact] =
    JOINT_LEGAL_V4_RELEASE_AUTHORITY.artifactBindings;
  return createProjectLegalAuthorityV4({
    privacyV4: {
      version: privacy.version,
      contentDigest: privacy.contentDigest,
      contentUri: privacy.contentUri,
      effectiveAt: privacy.effectiveAt,
      byteCount: privacyArtifact.byteCount,
      artifactUri: privacyArtifact.artifactUri
    },
    websiteTermsV4: {
      version: website.version,
      contentDigest: website.contentDigest,
      contentUri: websiteArtifact.artifactUri,
      effectiveAt: website.effectiveAt,
      byteCount: websiteArtifact.byteCount,
      artifactUri: websiteArtifact.artifactUri
    },
    authorityDigest: JOINT_LEGAL_V4_RELEASE_AUTHORITY_DIGEST
  });
}

function optionalEnvironmentValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parsePostgresUrl(value, environmentName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${environmentName} must be a PostgreSQL URL`);
  }
  assert.match(
    parsed.protocol,
    /^postgres(?:ql)?:$/u,
    `${environmentName} must use postgres:// or postgresql://`
  );
  assert.equal(
    parsed.hash,
    "",
    `${environmentName} must not contain a fragment`
  );
  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error(`${environmentName} has an invalid database path`);
  }
  assert.ok(
    databaseName.length > 0
      && !databaseName.includes("/")
      && !databaseName.includes("\0"),
    `${environmentName} must name one explicit database`
  );
  return Object.freeze({
    connectionString: value,
    databaseName,
    parsed
  });
}

export function resolveMigrationDatabasePlan({
  environment = process.env,
  uuid = randomUUID
} = {}) {
  const targetUrl = optionalEnvironmentValue(
    environment,
    MIGRATION_TEST_URL_ENV
  );
  const adminUrl = optionalEnvironmentValue(
    environment,
    CORE_RELEASE_ADMIN_URL_ENV
  );
  assert.ok(
    !(targetUrl && adminUrl),
    `${MIGRATION_TEST_URL_ENV} and ${CORE_RELEASE_ADMIN_URL_ENV} ` +
      "are mutually exclusive"
  );
  if (targetUrl) {
    const target = parsePostgresUrl(
      targetUrl,
      MIGRATION_TEST_URL_ENV
    );
    return Object.freeze({
      ownership: "caller",
      adminUrl: null,
      databaseName: target.databaseName,
      databaseUrl: target.connectionString
    });
  }

  assert.ok(
    adminUrl,
    `${MIGRATION_TEST_URL_ENV} (caller-owned database) or ` +
      `${CORE_RELEASE_ADMIN_URL_ENV} (standalone disposable database) ` +
      "is required"
  );
  const admin = parsePostgresUrl(
    adminUrl,
    CORE_RELEASE_ADMIN_URL_ENV
  );
  const nonce = uuid().replaceAll("-", "").toLowerCase();
  assert.match(nonce, /^[a-f0-9]{32}$/u, "UUID source returned an invalid value");
  const databaseName = `ss_privacy_v3_${nonce}`;
  const databaseUrl = new URL(admin.parsed.href);
  databaseUrl.pathname = `/${databaseName}`;
  return Object.freeze({
    ownership: "verifier",
    adminDatabaseName: admin.databaseName,
    adminUrl: admin.connectionString,
    databaseName,
    databaseUrl: databaseUrl.href
  });
}

export async function assertPostgres16(
  pool,
  { expectedDatabase, label }
) {
  const identity = await pool.query(`
    select
      current_database() as database_name,
      current_setting('server_version_num')::integer as server_version_num
  `);
  assert.equal(
    identity.rows[0]?.database_name,
    expectedDatabase,
    `${label} reached an unexpected database`
  );
  const versionNumber = Number(identity.rows[0]?.server_version_num);
  assert.ok(
    Number.isSafeInteger(versionNumber) && versionNumber > 0,
    `${label} returned an invalid PostgreSQL server version`
  );
  assert.equal(
    Math.floor(versionNumber / 10000),
    EXPECTED_POSTGRES_MAJOR,
    `${label} must run on PostgreSQL ${EXPECTED_POSTGRES_MAJOR}`
  );
  return Object.freeze({
    databaseName: expectedDatabase,
    major: EXPECTED_POSTGRES_MAJOR,
    serverVersionNumber: versionNumber
  });
}

async function applyMigrations(pool, expectedMigrationNames = null) {
  const namespace = await pool.query(
    "select to_regnamespace('ss') is not null as migrated"
  );
  assert.equal(
    namespace.rows[0].migrated,
    false,
    "migration verification requires an empty database without ss"
  );

  const names = (await readdir(MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const {
    releaseIndex,
    releaseName,
    postPrivacyNames
  } = resolveMigrationVerificationInventory(
    names,
    expectedMigrationNames
  );

  for (const name of names.slice(0, releaseIndex)) {
    try {
      await pool.query(
        await readFile(new URL(name, MIGRATIONS), "utf8")
      );
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }

  return {
    appliedNames: names.slice(0, releaseIndex),
    releaseName,
    releaseSql: await readFile(new URL(releaseName, MIGRATIONS), "utf8"),
    postPrivacyNames
  };
}

async function applyPostPrivacyMigrations(
  pool,
  postPrivacyNames
) {
  for (const name of postPrivacyNames) {
    try {
      await pool.query(
        await readFile(new URL(name, MIGRATIONS), "utf8")
      );
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
}

async function verifyDurableMailLifecycle(pool) {
  const scope = (await pool.query(`
    select
      receipt.user_id,
      receipt.organization_id,
      receipt.project_id
    from ss.project_legal_acceptance_receipts receipt
    join ss.projects project
      on project.organization_id = receipt.organization_id
     and project.id = receipt.project_id
     and project.lifecycle = 'active'
    order by receipt.created_at
    limit 1
  `)).rows[0];
  assert.ok(scope, "mail proof requires one active customer project scope");
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1, $2, 'owner', 'active', clock_timestamp())
     on conflict (organization_id, user_id) do update
       set role = 'owner', state = 'active', removed_at = null`,
    [scope.organization_id, scope.user_id]
  );

  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresMailLifecycleRepository({ authority });
  assert.equal((await repository.readiness()).ready, true);
  let current = "2026-08-10T14:00:00.000Z";
  const lifecycle = createMailLifecycle({
    repository,
    clock: { now: () => current }
  });
  const sha = (character) => character.repeat(64);
  const common = {
    recipientDigest: sha("1"),
    subjectReferenceDigest: sha("2"),
    contentDigest: sha("3"),
    templateVersion: "mail_v1",
    expiresAt: "2026-08-10T15:00:00.000Z"
  };
  const activation = await lifecycle.reserve({
    commandId: "mail.pg.activation.0001",
    messageType: "account_activation",
    organizationId: null,
    projectId: null,
    customerUserId: null,
    ...common
  });
  const recovery = await lifecycle.reserve({
    commandId: "mail.pg.recovery.0001",
    messageType: "account_recovery",
    organizationId: null,
    projectId: null,
    customerUserId: scope.user_id,
    ...common,
    recipientDigest: sha("4")
  });
  const support = await lifecycle.reserve({
    commandId: "mail.pg.support.0001",
    messageType: "support_notification",
    organizationId: scope.organization_id,
    projectId: scope.project_id,
    customerUserId: scope.user_id,
    ...common,
    recipientDigest: sha("5"),
    expiresAt: "2026-08-10T14:30:00.000Z"
  });
  const bounced = await lifecycle.reserve({
    commandId: "mail.pg.activation.0002",
    messageType: "account_activation",
    organizationId: null,
    projectId: null,
    customerUserId: null,
    ...common,
    recipientDigest: sha("6")
  });
  assert.deepEqual(
    [activation.state, recovery.state, support.state, bounced.state],
    ["pending", "pending", "pending", "pending"]
  );

  current = "2026-08-10T14:02:00.000Z";
  const acceptance = await lifecycle.recordProviderAcceptance({
    commandId: "mail.pg.accept.0001",
    messageId: activation.messageId,
    provider: "resend",
    providerMessageIdDigest: sha("7"),
    evidenceDigest: sha("8"),
    acceptedAt: "2026-08-10T14:01:00.000Z"
  });
  assert.equal(acceptance.acceptanceState, "provider_accepted");
  assert.equal(acceptance.currentState, "provider_accepted");
  const acceptedProjection = await pool.query(
    `select state from ss.hosted_mail_deliveries where id = $1`,
    [activation.messageId]
  );
  assert.equal(acceptedProjection.rows[0].state, "provider_accepted");

  current = "2026-08-10T14:04:00.000Z";
  const deliveredInput = {
    provider: "resend",
    providerEventIdDigest: sha("9"),
    providerMessageIdDigest: sha("7"),
    eventKind: "delivered",
    signatureVerificationDigest: sha("a"),
    evidenceDigest: sha("b"),
    occurredAt: "2026-08-10T14:03:00.000Z"
  };
  assert.equal(
    (await lifecycle.ingestProviderEvent(deliveredInput)).currentState,
    "delivered"
  );
  current = "2026-08-10T14:05:00.000Z";
  assert.equal(
    (await lifecycle.ingestProviderEvent(deliveredInput)).eventState,
    "applied"
  );
  await assert.rejects(
    lifecycle.ingestProviderEvent({
      ...deliveredInput,
      evidenceDigest: sha("c")
    }),
    (error) => error.code === "MAIL_PROVIDER_EVENT_IDEMPOTENCY_CONFLICT"
  );

  current = "2026-08-10T14:07:00.000Z";
  await lifecycle.ingestProviderEvent({
    ...deliveredInput,
    providerEventIdDigest: sha("d"),
    eventKind: "complained",
    evidenceDigest: sha("e"),
    occurredAt: "2026-08-10T14:06:00.000Z"
  });
  current = "2026-08-10T14:09:00.000Z";
  assert.equal((await lifecycle.ingestProviderEvent({
    ...deliveredInput,
    providerEventIdDigest: sha("f"),
    eventKind: "suppressed",
    evidenceDigest: sha("0"),
    occurredAt: "2026-08-10T14:08:00.000Z"
  })).currentState, "suppressed");

  current = "2026-08-10T14:04:00.000Z";
  const earlyDelivery = await lifecycle.ingestProviderEvent({
    provider: "resend",
    providerEventIdDigest: "ab".repeat(32),
    providerMessageIdDigest: "bc".repeat(32),
    eventKind: "delivered",
    signatureVerificationDigest: "cd".repeat(32),
    evidenceDigest: "de".repeat(32),
    occurredAt: "2026-08-10T14:03:00.000Z"
  });
  assert.equal(earlyDelivery.eventState, "pending");
  current = "2026-08-10T14:05:00.000Z";
  const recoveryAcceptance = await lifecycle.recordProviderAcceptance({
    commandId: "mail.pg.accept.0002",
    messageId: recovery.messageId,
    provider: "resend",
    providerMessageIdDigest: "bc".repeat(32),
    evidenceDigest: "ef".repeat(32),
    acceptedAt: "2026-08-10T14:02:00.000Z"
  });
  assert.equal(recoveryAcceptance.acceptanceState, "provider_accepted");
  assert.equal(recoveryAcceptance.currentState, "delivered");

  current = "2026-08-10T14:02:00.000Z";
  await lifecycle.recordProviderAcceptance({
    commandId: "mail.pg.accept.0003",
    messageId: bounced.messageId,
    provider: "resend",
    providerMessageIdDigest: "12".repeat(32),
    evidenceDigest: "23".repeat(32),
    acceptedAt: "2026-08-10T14:01:00.000Z"
  });
  current = "2026-08-10T14:04:00.000Z";
  assert.equal((await lifecycle.ingestProviderEvent({
    provider: "resend",
    providerEventIdDigest: "34".repeat(32),
    providerMessageIdDigest: "12".repeat(32),
    eventKind: "bounced",
    signatureVerificationDigest: "45".repeat(32),
    evidenceDigest: "56".repeat(32),
    occurredAt: "2026-08-10T14:03:00.000Z"
  })).currentState, "bounced");

  current = "2026-08-10T14:31:00.000Z";
  assert.equal((await lifecycle.expire({
    commandId: "mail.pg.expire.0001",
    messageId: support.messageId
  })).state, "expired");

  const lifecycleCounts = await pool.query(`
    select
      count(*) filter (where state = 'suppressed') = 1 as suppressed_ready,
      count(*) filter (where state = 'delivered') = 1 as delivered_ready,
      count(*) filter (where state = 'bounced') = 1 as bounced_ready,
      count(*) filter (where state = 'expired') = 1 as expired_ready,
      (select count(*) = 1
         from ss.hosted_mail_recipient_suppressions) as suppression_ready,
      (select count(*) = 0
         from ss.hosted_mail_provider_event_inbox
        where state = 'pending') as inbox_drained,
      (select count(*) >= 3
         from ss.hosted_mail_exception_projection
        where state = 'open') as exceptions_ready
    from ss.hosted_mail_deliveries
  `);
  for (const [facet, ready] of Object.entries(lifecycleCounts.rows[0])) {
    assert.equal(ready, true, `MAIL-01 PostgreSQL proof failed: ${facet}`);
  }

  await pool.query(
    `insert into ss.hosted_account_profiles (
       user_id, display_name, state
     ) values ($1, 'MAIL-01 operator', 'active')
     on conflict (user_id) do update set state = 'active'`,
    [scope.user_id]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'MAIL-01 operator', 'held', $1, clock_timestamp())
     on conflict (user_id) do nothing`,
    [scope.user_id]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values ($1, 'service_case_manage', 'held', $1, clock_timestamp())
     on conflict (operator_user_id, capability) do nothing`,
    [scope.user_id]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at, expires_at,
       created_at
     ) values ($1, 'service_case_manage', 1, 'grant', null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp())`,
    [scope.user_id]
  );
  const capability = await pool.query(
    `select
       clock_timestamp() as observed_at,
       ss.service_operator_has_capability(
         $1, 'service_case_manage', clock_timestamp()
       ) as allowed`,
    [scope.user_id]
  );
  assert.equal(
    capability.rows[0].allowed,
    true,
    "MAIL-01 operator capability grant did not become current"
  );
  current = capability.rows[0].observed_at.toISOString();
  const ownerQueue = await lifecycle.listOwnerExceptions({
    actorId: scope.user_id,
    organizationId: scope.organization_id
  });
  assert.ok(ownerQueue.items.length >= 3);
  assert.equal(
    ownerQueue.items.some((item) =>
      "recipientDigest" in item || "providerMessageIdDigest" in item),
    false
  );

  let rlsError = null;
  await pool.query("begin");
  try {
    await pool.query("set local role authenticated");
    await pool.query("select * from ss.hosted_mail_deliveries limit 1");
  } catch (error) {
    rlsError = error;
  } finally {
    await pool.query("rollback");
  }
  assert.equal(rlsError?.code, "42501");

  const columns = await pool.query(`
    select column_name
      from information_schema.columns
     where table_schema = 'ss'
       and table_name like 'hosted_mail_%'
  `);
  assert.equal(
    columns.rows.some(({ column_name: name }) =>
      /email|body|subject_text|token|raw_payload|action_url/u.test(name)),
    false
  );
}

async function verifySupportPrivacyCaseLifecycle(pool) {
  const scope = (await pool.query(`
    select
      receipt.user_id,
      receipt.organization_id,
      receipt.project_id
    from ss.project_legal_acceptance_receipts receipt
    join ss.organization_memberships membership
      on membership.organization_id = receipt.organization_id
     and membership.user_id = receipt.user_id
     and membership.state = 'active'
    join ss.operator_profiles operator
      on operator.user_id = receipt.user_id
    order by receipt.created_at
    limit 1
  `)).rows[0];
  assert.ok(scope, "support case proof requires the MAIL-01 operator/customer fixture");
  const authority = createCanonicalPostgresAuthority({ pool });
  const supportRepository = createPostgresSupportCaseRepository({ authority });
  const mailRepository = createPostgresMailLifecycleRepository({ authority });
  let current = "2026-08-10T16:00:00.000Z";
  const clock = { now: () => current };
  const mailLifecycle = createMailLifecycle({ repository: mailRepository, clock });
  const supportCases = createSupportCaseService({
    repository: supportRepository,
    mailLifecycle,
    clock
  });
  assert.equal((await supportCases.readiness()).ready, true);
  const sha = (pair) => pair.repeat(32);
  const customerOpening = ({ commandId, requestKind, parentCaseId = null }) => ({
    actorId: scope.user_id,
    commandId,
    evidenceDigests: [sha("11")],
    organizationId: scope.organization_id,
    parentCaseId,
    projectId: scope.project_id,
    requestKind,
    requesterReferenceDigest: sha("12"),
    requesterUserId: scope.user_id,
    scopeKind: "project"
  });
  const operatorBase = (caseId, commandId, expectedRevision) => ({
    actorId: scope.user_id,
    caseId,
    commandId,
    expectedRevision,
    operatorOrganizationId: scope.organization_id
  });

  const exportCountBefore = Number((await pool.query(
    `select count(*) from ss.export_requests`
  )).rows[0].count);
  const accountCountBefore = Number((await pool.query(
    `select count(*) from auth.users where id = $1`, [scope.user_id]
  )).rows[0].count);
  const deletion = await supportCases.openAuthenticated(customerOpening({
    commandId: "support.pg.deletion.open.0001",
    requestKind: "deletion"
  }));
  assert.equal(deletion.state, "open");
  assert.equal(deletion.identityState, "session_authenticated");
  assert.equal("requesterReferenceDigest" in deletion, false);
  current = "2026-08-10T16:01:00.000Z";
  assert.equal((await supportCases.openAuthenticated(customerOpening({
    commandId: "support.pg.deletion.open.0001",
    requestKind: "deletion"
  }))).id, deletion.id);
  await assert.rejects(
    supportCases.openAuthenticated(customerOpening({
      commandId: "support.pg.deletion.open.0001",
      requestKind: "export"
    })),
    (error) => error.code === "SUPPORT_CASE_IDEMPOTENCY_CONFLICT"
  );

  current = "2026-08-10T16:02:00.000Z";
  let ownerCase = await supportCases.assign({
    ...operatorBase(deletion.id, "support.pg.deletion.assign.0001", 1),
    assignedOperatorId: scope.user_id
  });
  assert.equal(ownerCase.state, "assigned");
  current = "2026-08-10T16:03:00.000Z";
  ownerCase = await supportCases.updateIdentity({
    ...operatorBase(deletion.id, "support.pg.deletion.identity.0001", 2),
    evidenceDigest: sha("13"),
    identityState: "verified"
  });
  assert.equal(ownerCase.identityState, "verified");
  current = "2026-08-10T16:04:00.000Z";
  ownerCase = await supportCases.setDeadline({
    ...operatorBase(deletion.id, "support.pg.deletion.deadline.0001", 3),
    basisDigest: sha("14"),
    responseDueAt: "2026-08-20T16:00:00.000Z"
  });
  assert.equal(ownerCase.deadline.status, "active");
  current = "2026-08-10T16:05:00.000Z";
  ownerCase = await supportCases.startReview(
    operatorBase(deletion.id, "support.pg.deletion.review.0001", 4)
  );
  assert.equal(ownerCase.state, "in_review");
  current = "2026-08-10T16:06:00.000Z";
  ownerCase = await supportCases.deny({
    ...operatorBase(deletion.id, "support.pg.deletion.deny.0001", 5),
    appealAvailable: true,
    appealBasisDigest: sha("15"),
    appealDueAt: "2026-09-01T16:00:00.000Z",
    denialExplanationDigest: sha("16"),
    denialReasonCode: "legal_exception"
  });
  assert.equal(ownerCase.state, "denied");
  assert.equal(ownerCase.deadline.status, "met");

  current = "2026-08-10T16:07:00.000Z";
  const appeal = await supportCases.openAuthenticated(customerOpening({
    commandId: "support.pg.appeal.open.0001",
    requestKind: "appeal",
    parentCaseId: deletion.id
  }));
  assert.equal(appeal.requestKind, "appeal");
  assert.equal((await supportCases.readCustomerCase({
    actorId: scope.user_id,
    organizationId: scope.organization_id,
    caseId: deletion.id
  })).state, "appeal_pending");

  current = "2026-08-10T16:08:00.000Z";
  await supportCases.assign({
    ...operatorBase(appeal.id, "support.pg.appeal.assign.0001", 1),
    assignedOperatorId: scope.user_id
  });
  current = "2026-08-10T16:09:00.000Z";
  await supportCases.updateIdentity({
    ...operatorBase(appeal.id, "support.pg.appeal.identity.0001", 2),
    evidenceDigest: sha("17"),
    identityState: "verified"
  });
  current = "2026-08-10T16:10:00.000Z";
  await supportCases.setDeadline({
    ...operatorBase(appeal.id, "support.pg.appeal.deadline.0001", 3),
    basisDigest: sha("18"),
    responseDueAt: "2026-08-25T16:00:00.000Z"
  });
  current = "2026-08-10T16:11:00.000Z";
  await supportCases.startReview(
    operatorBase(appeal.id, "support.pg.appeal.review.0001", 4)
  );
  current = "2026-08-10T16:12:00.000Z";
  await supportCases.respond({
    ...operatorBase(appeal.id, "support.pg.appeal.respond.0001", 5),
    responseDigest: sha("19")
  });
  current = "2026-08-10T16:13:00.000Z";
  await supportCases.close({
    ...operatorBase(appeal.id, "support.pg.appeal.close.0001", 6),
    closureEvidenceDigest: sha("1a"),
    closureReasonCode: "completed"
  });
  current = "2026-08-10T16:14:00.000Z";
  const parentClosed = await supportCases.close({
    ...operatorBase(deletion.id, "support.pg.deletion.close.0001", 7),
    closureEvidenceDigest: sha("1b"),
    closureReasonCode: "completed"
  });
  assert.equal(parentClosed.state, "closed");

  current = "2026-08-10T16:15:00.000Z";
  const phone = await supportCases.recordManual({
    actorId: scope.user_id,
    commandId: "support.pg.phone.open.0001",
    evidenceDigests: [sha("21")],
    intakeChannel: "phone",
    organizationId: null,
    operatorOrganizationId: scope.organization_id,
    parentCaseId: null,
    projectId: null,
    requestKind: "access",
    requesterReferenceDigest: sha("22"),
    requesterUserId: null,
    scopeKind: "general"
  });
  assert.equal(phone.intakeChannel, "phone");
  current = "2026-08-10T16:16:00.000Z";
  await supportCases.assign({
    ...operatorBase(phone.id, "support.pg.phone.assign.0001", 1),
    assignedOperatorId: scope.user_id
  });
  current = "2026-08-10T16:17:00.000Z";
  await supportCases.updateIdentity({
    ...operatorBase(phone.id, "support.pg.phone.identity.0001", 2),
    evidenceDigest: sha("23"),
    identityState: "unable_to_verify"
  });
  current = "2026-08-10T16:18:00.000Z";
  await supportCases.setDeadline({
    ...operatorBase(phone.id, "support.pg.phone.deadline.0001", 3),
    basisDigest: sha("24"),
    responseDueAt: "2026-08-20T16:00:00.000Z"
  });
  current = "2026-08-10T16:19:00.000Z";
  await supportCases.deny({
    ...operatorBase(phone.id, "support.pg.phone.deny.0001", 4),
    appealAvailable: false,
    appealBasisDigest: null,
    appealDueAt: null,
    denialExplanationDigest: sha("25"),
    denialReasonCode: "identity_not_verified"
  });
  current = "2026-08-10T16:20:00.000Z";
  await supportCases.close({
    ...operatorBase(phone.id, "support.pg.phone.close.0001", 5),
    closureEvidenceDigest: sha("26"),
    closureReasonCode: "no_further_action"
  });

  current = "2026-08-10T16:21:00.000Z";
  const manual = await supportCases.recordManual({
    actorId: scope.user_id,
    commandId: "support.pg.manual.open.0001",
    evidenceDigests: [sha("31")],
    intakeChannel: "manual",
    organizationId: scope.organization_id,
    operatorOrganizationId: scope.organization_id,
    parentCaseId: null,
    projectId: scope.project_id,
    requestKind: "support",
    requesterReferenceDigest: sha("32"),
    requesterUserId: scope.user_id,
    scopeKind: "project"
  });
  current = "2026-08-10T16:22:00.000Z";
  await supportCases.assign({
    ...operatorBase(manual.id, "support.pg.manual.assign.0001", 1),
    assignedOperatorId: scope.user_id
  });
  current = "2026-08-10T16:23:00.000Z";
  await supportCases.updateIdentity({
    ...operatorBase(manual.id, "support.pg.manual.identity.0001", 2),
    evidenceDigest: sha("33"),
    identityState: "not_required"
  });
  current = "2026-08-10T16:24:00.000Z";
  await supportCases.setDeadline({
    ...operatorBase(manual.id, "support.pg.manual.deadline.0001", 3),
    basisDigest: sha("34"),
    responseDueAt: "2026-08-15T16:00:00.000Z"
  });
  current = "2026-08-10T16:25:00.000Z";
  await supportCases.startReview(
    operatorBase(manual.id, "support.pg.manual.review.0001", 4)
  );
  current = "2026-08-10T16:26:00.000Z";
  await supportCases.respond({
    ...operatorBase(manual.id, "support.pg.manual.respond.0001", 5),
    responseDigest: sha("35")
  });
  current = "2026-08-10T16:27:00.000Z";
  const notified = await supportCases.reserveNotification({
    ...operatorBase(manual.id, "support.pg.manual.notify.0001", 6),
    notificationKind: "response",
    mailCommandId: "support.pg.mail.reserve.0001",
    projectId: scope.project_id,
    customerUserId: scope.user_id,
    recipientDigest: sha("36"),
    subjectReferenceDigest: sha("37"),
    contentDigest: sha("38"),
    templateVersion: "support_v1",
    expiresAt: "2026-08-10T17:00:00.000Z"
  });
  assert.deepEqual(notified.notifications.map((entry) => entry.state), ["reserved"]);
  const mailTruth = await pool.query(`
    select delivery.state, delivery.message_type
      from ss.hosted_support_case_mail_reservations reservation
      join ss.hosted_mail_deliveries delivery
        on delivery.id = reservation.mail_message_id
     where reservation.case_id = $1
  `, [manual.id]);
  assert.deepEqual(mailTruth.rows[0], {
    state: "pending",
    message_type: "support_notification"
  });

  current = "2026-08-10T16:28:00.000Z";
  const email = await supportCases.recordManual({
    actorId: scope.user_id,
    commandId: "support.pg.email.open.0001",
    evidenceDigests: [sha("41")],
    intakeChannel: "email",
    organizationId: null,
    operatorOrganizationId: scope.organization_id,
    parentCaseId: null,
    projectId: null,
    requestKind: "correction",
    requesterReferenceDigest: sha("42"),
    requesterUserId: null,
    scopeKind: "general"
  });
  assert.equal(email.intakeChannel, "email");
  current = "2026-08-10T16:29:00.000Z";
  await supportCases.openAuthenticated(customerOpening({
    commandId: "support.pg.export.open.0001",
    requestKind: "export"
  }));

  assert.equal(Number((await pool.query(
    `select count(*) from ss.export_requests`
  )).rows[0].count), exportCountBefore);
  assert.equal(Number((await pool.query(
    `select count(*) from auth.users where id = $1`, [scope.user_id]
  )).rows[0].count), accountCountBefore);

  const customer = await supportCases.readCustomerCase({
    actorId: scope.user_id,
    organizationId: scope.organization_id,
    caseId: manual.id
  });
  for (const forbidden of [
    "requesterReferenceDigest", "assignedOperatorId",
    "identityEvidenceDigest", "deadlineBasisDigest", "evidence"
  ]) assert.equal(Object.hasOwn(customer, forbidden), false);
  const ownerQueue = await supportCases.listOperatorCases({
    actorId: scope.user_id,
    operatorOrganizationId: scope.organization_id
  });
  assert.ok(ownerQueue.cases.some((entry) => entry.id === email.id));

  let immutableError = null;
  try {
    await pool.query(
      `update ss.hosted_support_case_events
          set event_kind = 'closed'
        where id = (select id from ss.hosted_support_case_events limit 1)`
    );
  } catch (error) {
    immutableError = error;
  }
  assert.equal(immutableError?.code, "55000");
  let rlsError = null;
  await pool.query("begin");
  try {
    await pool.query("set local role authenticated");
    await pool.query("select * from ss.hosted_support_cases limit 1");
  } catch (error) {
    rlsError = error;
  } finally {
    await pool.query("rollback");
  }
  assert.equal(rlsError?.code, "42501");

  const unsafeColumns = await pool.query(`
    select column_name
      from information_schema.columns
     where table_schema = 'ss'
       and table_name like 'hosted_support_case%'
       and column_name ~ '(email|phone|body|subject|token|raw|document|export_bytes|deletion)'
  `);
  assert.equal(unsafeColumns.rowCount, 0);
}

async function verifyOperatorWorkQueue(pool) {
  const contract = await pool.query(`
    select
      ss.hosted_operator_work_queue_contract_v1() =
        'canonical-operator-work-queue-v1-source-authoritative-held'
        as contract_ready,
      (
        select count(*) = 2
          from pg_class relation
         where relation.oid = any(array[
           'ss.operator_work_queue_items'::regclass,
           'ss.stripe_invoice_finalization_failures'::regclass
         ])
           and relation.relrowsecurity
           and relation.relforcerowsecurity
      ) as forced_rls,
      not has_table_privilege(
        'authenticated', 'ss.operator_work_queue_items', 'SELECT'
      ) as authenticated_read_denied,
      not has_table_privilege(
        'service_role', 'ss.operator_work_queue_items',
        'INSERT,UPDATE,DELETE'
      ) as direct_projection_mutation_denied,
      not exists (
        select 1
          from information_schema.columns
         where table_schema = 'ss'
           and table_name in (
             'operator_work_queue_items',
             'stripe_invoice_finalization_failures'
           )
           and column_name in (
             'raw_payload', 'email_address', 'phone_number',
             'message_body', 'provider_error_message'
           )
      ) as unsafe_columns_absent
  `);
  for (const [name, ready] of Object.entries(contract.rows[0])) {
    assert.equal(ready, true, `operator queue contract failed: ${name}`);
  }

  const operatorId = randomUUID();
  const authorizerId = randomUUID();
  const operatorOrganizationId = randomUUID();
  await pool.query(
    `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
    [
      operatorId, `queue-operator-${operatorId}@example.test`,
      authorizerId, `queue-authorizer-${authorizerId}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Queue Operator', 'active'),
            ($2, 'Queue Authorizer', 'active')`,
    [operatorId, authorizerId]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Queue Operator', 'held', $2, clock_timestamp())`,
    [operatorId, authorizerId]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values (
       $1, 'service_management_manage', 'held', $2, clock_timestamp()
     )`,
    [operatorId, authorizerId]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at,
       expires_at, created_at
     ) values (
       $1, 'service_management_manage', 1, 'grant', null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp()
     )`,
    [operatorId]
  );

  const database = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresOperatorWorkQueueRepository({
    authority: database
  });
  let observedAt = new Date().toISOString();
  const queue = createOperatorWorkQueue({
    repository,
    reversalRepair: {
      async reconcileEvidence() {
        assert.fail("invoice finalization evidence has no repair command");
      }
    },
    clock: { now: () => observedAt }
  });
  const evidenceInput = {
    commandId: "pg-invoice-finalization-001",
    providerEventIdDigest: "b".repeat(64),
    invoiceIdDigest: "c".repeat(64),
    payloadDigest: "a".repeat(64),
    signatureVerificationDigest: "d".repeat(64),
    reasonCode: "unknown_review",
    providerCreatedAt: new Date(Date.now() - 60_000).toISOString()
  };
  const evidence = await queue.recordInvoiceFinalizationFailure(evidenceInput);
  const replay = await queue.recordInvoiceFinalizationFailure(evidenceInput);
  assert.equal(replay.id, evidence.id);

  const scope = { actorId: operatorId, operatorOrganizationId };
  const first = await queue.refresh(scope);
  assert.ok(first.items.length >= 1);
  assert.equal(first.items.every((item) =>
    typeof item.source.table === "string" &&
    typeof item.source.id === "string" &&
    Number.isSafeInteger(item.source.revision) &&
    /^[0-9a-f]{64}$/u.test(item.source.digest)
  ), true);
  const firstEvidenceItem = first.items.find((item) => item.source.id === evidence.id);
  assert.ok(firstEvidenceItem);
  assert.deepEqual(firstEvidenceItem.source, {
    table: "ss.stripe_invoice_finalization_failures",
    id: evidence.id,
    revision: 1,
    digest: evidenceInput.payloadDigest,
    state: "open"
  });
  assert.equal(firstEvidenceItem.kind, "invoice_finalization_failure");
  assert.equal(firstEvidenceItem.repair, null);
  observedAt = new Date(Date.now() + 1000).toISOString();
  const second = await queue.refresh(scope);
  const secondEvidenceItem = second.items.find((item) =>
    item.source.id === evidence.id
  );
  assert.equal(secondEvidenceItem.revision, firstEvidenceItem.revision);
  assert.equal(secondEvidenceItem.digest, firstEvidenceItem.digest);
  assert.deepEqual(await queue.list(scope), second);
}

async function verifyJointLegalV4ReleaseState(pool) {
  const result = await pool.query(`
    select
      ss.hosted_runtime_contract_v53() =
        'canonical-ss-v53-joint-legal-v4-authority'
        as v53_contract_ready,
      ss.hosted_runtime_contract_v54() =
        'canonical-ss-v54-durable-mail-lifecycle'
        as v54_contract_ready,
      (
        select count(*) = 3
          from ss.legal_documents document
         where (
           document.id = '00000000-0000-4000-8000-000000000049'::uuid
           and document.kind = 'privacy'
           and document.version = 'SS-HOSTED-PRIVACY-2026-08-09-V4'
           and document.content_digest =
             '2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99'
           and document.content_uri =
             'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/'
           and document.effective_at =
             '2026-08-09T21:42:11.000Z'::timestamptz
           and document.retired_at is null
         ) or (
           document.id = '00000000-0000-4000-8000-000000000105'::uuid
           and document.kind = 'product'
           and document.version = 'SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4'
           and document.content_digest =
             '4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642'
           and document.content_uri =
             'https://sitesourcery.com/legal/website-terms/#self-service'
           and document.effective_at =
             '2026-08-09T21:42:11.000Z'::timestamptz
           and document.retired_at is null
         ) or (
           document.id = '00000000-0000-4000-8000-000000000106'::uuid
           and document.kind = 'website'
           and document.version = 'SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4'
           and document.content_digest =
             '4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642'
           and document.content_uri =
             'https://sitesourcery.com/legal/website-terms/'
           and document.effective_at =
             '2026-08-09T21:42:11.000Z'::timestamptz
           and document.retired_at is null
         )
      ) as v4_documents_ready,
      (
        select count(*) = 2
          from ss.legal_document_artifacts artifact
         where (
           artifact.document_id =
             '00000000-0000-4000-8000-000000000049'::uuid
           and artifact.artifact_uri =
             'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/'
           and artifact.artifact_sha256 =
             '2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99'
           and artifact.byte_count = 31451
           and artifact.media_type = 'text/html; charset=utf-8'
         ) or (
           artifact.document_id =
             '00000000-0000-4000-8000-000000000106'::uuid
           and artifact.artifact_uri =
             'https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4/'
           and artifact.artifact_sha256 =
             '4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642'
           and artifact.byte_count = 26215
           and artifact.media_type = 'text/html; charset=utf-8'
         )
      ) and not exists (
        select 1 from ss.legal_document_artifacts artifact
         where artifact.document_id =
           '00000000-0000-4000-8000-000000000105'::uuid
      ) as v4_artifacts_ready,
      (
        select ss.project_legal_json_digest(jsonb_build_object(
          'documents', jsonb_build_array(
            jsonb_build_object(
              'kind', privacy.kind,
              'version', privacy.version,
              'contentDigest', privacy.content_digest,
              'contentUri', privacy.content_uri,
              'effectiveAt', to_char(privacy.effective_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ),
            jsonb_build_object(
              'kind', product.kind,
              'version', product.version,
              'contentDigest', product.content_digest,
              'contentUri', product.content_uri,
              'effectiveAt', to_char(product.effective_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ),
            jsonb_build_object(
              'kind', website.kind,
              'version', website.version,
              'contentDigest', website.content_digest,
              'contentUri', website.content_uri,
              'effectiveAt', to_char(website.effective_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
          ),
          'schema', 'sitesourcery.project-legal-authority/v4'
        )) = 'ba2871701541ca78e29a9fef313a3e335e7fed571590eb319667c763a7cd3968'
          from ss.legal_documents privacy
          cross join ss.legal_documents product
          cross join ss.legal_documents website
         where privacy.id = '00000000-0000-4000-8000-000000000049'::uuid
           and product.id = '00000000-0000-4000-8000-000000000105'::uuid
           and website.id = '00000000-0000-4000-8000-000000000106'::uuid
      ) as v4_authority_digest_ready,
      (
        select count(*) = 1
          from pg_constraint constraint_row
          join pg_class relation on relation.oid = constraint_row.conrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname = 'project_legal_acceptance_receipts'
           and constraint_row.conname =
             'project_legal_acceptance_receipts_schema_version_v4_check'
           and pg_get_constraintdef(constraint_row.oid, false) =
             'CHECK ((schema_version = ANY (ARRAY[' ||
             '''sitesourcery.project-legal-acceptance/v3''::text, ' ||
             '''sitesourcery.project-legal-acceptance/v4''::text])))'
      ) as v4_receipt_schema_ready
  `);
  for (const [name, ready] of Object.entries(result.rows[0])) {
    assert.equal(ready, true, `Joint legal V4 release state failed: ${name}`);
  }
}

async function verifyCustomerEngagementBootstrapState(pool) {
  const result = await pool.query(`
    select
      ss.hosted_runtime_contract_v106() =
        'canonical-ss-v106-customer-engagement-bootstrap'
        as v106_contract_ready,
      to_regclass('ss.customer_engagement_invitations') is not null
        as invitations_ready,
      to_regclass('ss.customer_engagements') is not null
        as engagements_ready,
      (
        select relrowsecurity and relforcerowsecurity
          from pg_class
         where oid = 'ss.customer_engagement_invitations'::regclass
      ) as invitations_default_deny,
      (
        select relrowsecurity and relforcerowsecurity
          from pg_class
         where oid = 'ss.customer_engagements'::regclass
      ) as engagements_default_deny,
      not has_table_privilege(
        'anon', 'ss.customer_engagement_invitations', 'SELECT'
      ) as anonymous_invitation_denied,
      not has_table_privilege(
        'authenticated', 'ss.customer_engagement_invitations', 'SELECT'
      ) as authenticated_invitation_denied,
      has_table_privilege(
        'service_role', 'ss.customer_engagement_invitations',
        'SELECT,INSERT,UPDATE'
      ) as service_invitation_contract_ready,
      has_table_privilege(
        'service_role', 'ss.customer_engagements', 'SELECT,INSERT'
      ) as service_engagement_contract_ready,
      not has_table_privilege(
        'service_role', 'ss.customer_engagements', 'UPDATE,DELETE'
      ) as service_engagement_immutable,
      exists (
        select 1 from pg_trigger
         where tgrelid = 'ss.customer_engagement_invitations'::regclass
           and tgname = 'customer_engagement_invitations_guard'
           and not tgisinternal
      ) as invitation_guard_ready,
      exists (
        select 1 from pg_trigger
         where tgrelid = 'ss.customer_engagements'::regclass
           and tgname = 'customer_engagements_guard'
           and not tgisinternal
      ) as engagement_guard_ready
  `);
  for (const [name, ready] of Object.entries(result.rows[0])) {
    assert.equal(
      ready,
      true,
      `Customer engagement bootstrap contract failed: ${name}`
    );
  }
}

async function verifyCustomerEngagementBootstrapJourney(pool) {
  const operatorUserId = randomUUID();
  const authorizerUserId = randomUUID();
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, $2), ($3, $4)`,
    [
      operatorUserId,
      `engagement-operator-${operatorUserId}@example.test`,
      authorizerUserId,
      `engagement-authorizer-${authorizerUserId}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (
       user_id, display_name, state
     ) values
       ($1, 'Engagement Operator', 'active'),
       ($2, 'Engagement Authorizer', 'active')`,
    [operatorUserId, authorizerUserId]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state,
       authorized_by_user_id, authorized_at
     ) values ($1, 'Engagement Operator', 'held', $2, $3)`,
    [operatorUserId, authorizerUserId, "2026-08-10T00:00:00.000Z"]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state,
       granted_by_user_id, granted_at
     ) values (
       $1, 'service_case_manage', 'held', $2, $3
     )`,
    [operatorUserId, authorizerUserId, "2026-08-10T00:00:00.000Z"]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence,
       event_kind, predecessor_event_id, recorded_by_kind,
       effective_at, expires_at, created_at
     ) values (
       $1, 'service_case_manage', 99, 'grant', null,
       'deployment_control', $2, $3, $2
     )`,
    [
      operatorUserId,
      "2026-08-10T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z"
    ]
  );

  const invitationStart = Date.now() + 60_000;
  let currentTime = new Date(invitationStart).toISOString();
  const legalAuthority = releasedJointLegalV4Authority();
  const database = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresEngagementBootstrapRepository({
    authority: database,
    legalAuthority,
    pepper: randomBytes(32),
    pepperVersion: "engagement-proof-v1",
    clock: () => new Date(currentTime)
  });
  const engagement = createHostedEngagementBootstrap({
    repository,
    legalAuthority,
    tokenSecret: Buffer.alloc(32, 42),
    clock: () => new Date(currentTime)
  });
  const legalAcceptance = {
    schema: legalAuthority.acceptanceSchema,
    acceptanceStatement: legalAuthority.acceptanceStatement,
    authorityDigest: legalAuthority.authorityDigest,
    documents: legalAuthority.documents.map((document) => ({ ...document }))
  };
  const issue = {
    commandId: "pg-engagement-issue-001",
    customerEmail: "pg-engagement-customer@example.test",
    customerName: "PG Engagement Customer",
    organizationId: null,
    organizationName: "PG Engagement Company",
    projectName: "PG Canonical New Site",
    provenance: "direct_custom_inquiry",
    site: { kind: "new_site" },
    sourceAssessmentReportId: null
  };
  const invitation = await engagement.issueInvitation(
    { userId: operatorUserId },
    issue
  );
  const issueReplay = await engagement.issueInvitation(
    { userId: operatorUserId },
    issue
  );
  assert.equal(issueReplay.claimToken, invitation.claimToken);
  assert.equal(issueReplay.invitationId, invitation.invitationId);
  assert.equal(issueReplay.replayed, true);
  const beforeClaim = await pool.query(
    `select count(*)::integer as project_count
       from ss.projects where id = $1`,
    [invitation.project.id]
  );
  assert.equal(beforeClaim.rows[0].project_count, 0);

  const expiredInvitation = await engagement.issueInvitation(
    { userId: operatorUserId },
    {
      ...issue,
      commandId: "pg-engagement-issue-expired",
      customerEmail: "pg-engagement-expired@example.test",
      customerName: "Expired Engagement Customer",
      organizationName: "Expired Engagement Company",
      projectName: "Expired Engagement Site"
    }
  );
  currentTime = new Date(
    invitationStart + 4 * 24 * 60 * 60 * 1000
  ).toISOString();
  const claimBase = {
    commandId: "pg-engagement-claim-001",
    legalAcceptance,
    password: "a correct engagement proof password",
    userAgentDigest: "d".repeat(64)
  };
  const publicFailures = [];
  for (const token of [expiredInvitation.claimToken, "Z".repeat(43)]) {
    try {
      await engagement.claimInvitation({ ...claimBase, token });
      assert.fail("invalid engagement claim unexpectedly succeeded");
    } catch (error) {
      publicFailures.push({
        code: error.code,
        status: error.status,
        message: error.message
      });
    }
  }
  assert.deepEqual(publicFailures[0], publicFailures[1]);
  assert.equal(publicFailures[0].code, "ENGAGEMENT_CLAIM_FAILED");

  currentTime = new Date(
    invitationStart + 60 * 60 * 1000
  ).toISOString();
  const claim = await engagement.claimInvitation({
    ...claimBase,
    token: invitation.claimToken
  });
  const claimReplay = await engagement.claimInvitation({
    ...claimBase,
    token: invitation.claimToken
  });
  assert.equal(claimReplay.engagementId, claim.engagementId);
  assert.equal(claimReplay.sessionToken, claim.sessionToken);
  assert.equal(claimReplay.replayed, true);
  assert.equal(claim.project.id, invitation.project.id);
  assert.equal(claim.organization.id, invitation.organization.id);
  assert.equal(claim.provenance, "direct_custom_inquiry");

  currentTime = new Date(
    invitationStart + 2 * 60 * 60 * 1000
  ).toISOString();
  const existingInvitation = await engagement.issueInvitation(
    { userId: operatorUserId },
    {
      ...issue,
      commandId: "pg-engagement-issue-existing",
      organizationId: claim.organization.id,
      organizationName: null,
      projectName: "PG Canonical External Site",
      site: {
        kind: "external_site",
        publicUrl: "https://customer.example.test/"
      }
    }
  );
  assert.equal(existingInvitation.accountMode, "existing_account");
  const existingClaim = await engagement.claimInvitation({
    ...claimBase,
    commandId: "pg-engagement-claim-existing",
    token: existingInvitation.claimToken
  });
  assert.equal(existingClaim.user.id, claim.user.id);
  assert.equal(existingClaim.organization.id, claim.organization.id);
  const externalProfile = await pool.query(
    `select origin, observed_hostname
       from ss.service_project_profiles
      where project_id = $1`,
    [existingClaim.project.id]
  );
  assert.deepEqual(externalProfile.rows[0], {
    origin: "external",
    observed_hostname: "customer.example.test"
  });

  const stored = await pool.query(
    `select
       invitation.state,
       invitation.token_digest,
       invitation.claim_receipt_digest,
       engagement.engagement_digest,
       project.lifecycle,
       profile.origin,
       profile.observed_hostname,
       receipt.authority_digest,
       count(acceptance.id)::integer as acceptance_count,
       count(required.acceptance_id)::integer as required_count
     from ss.customer_engagement_invitations invitation
     join ss.customer_engagements engagement
       on engagement.invitation_id = invitation.id
     join ss.projects project on project.id = engagement.project_id
     join ss.service_project_profiles profile
       on profile.project_id = project.id
     join ss.project_legal_acceptance_receipts receipt
       on receipt.id = engagement.project_legal_receipt_id
     join ss.term_acceptances acceptance
       on acceptance.legal_receipt_id = receipt.id
     join ss.project_required_terms required
       on required.acceptance_id = acceptance.id
    where invitation.id = $1
    group by
      invitation.state, invitation.token_digest,
      invitation.claim_receipt_digest, engagement.engagement_digest,
      project.lifecycle, profile.origin, profile.observed_hostname,
      receipt.authority_digest`,
    [invitation.invitationId]
  );
  assert.deepEqual(
    {
      state: stored.rows[0].state,
      lifecycle: stored.rows[0].lifecycle,
      origin: stored.rows[0].origin,
      observedHostname: stored.rows[0].observed_hostname,
      authorityDigest: stored.rows[0].authority_digest,
      acceptanceCount: stored.rows[0].acceptance_count,
      requiredCount: stored.rows[0].required_count
    },
    {
      state: "claimed",
      lifecycle: "active",
      origin: "sitesourcery_custom",
      observedHostname: null,
      authorityDigest: legalAuthority.authorityDigest,
      acceptanceCount: 3,
      requiredCount: 3
    }
  );
  assert.match(stored.rows[0].token_digest, /^[a-f0-9]{64}$/u);
  assert.match(stored.rows[0].claim_receipt_digest, /^[a-f0-9]{64}$/u);
  assert.match(stored.rows[0].engagement_digest, /^[a-f0-9]{64}$/u);
  assert.equal(
    await database.tenant(
      {
        userId: claim.user.id,
        organizationId: claim.organization.id,
        readOnly: true
      },
      async (client) => {
        const visible = await client.query(
          `select count(*)::integer as count
             from ss.customer_engagements
            where id = $1`,
          [claim.engagementId]
        );
        return visible.rows[0].count;
      }
    ),
    1
  );
  await assert.rejects(
    database.tenant(
      {
        userId: claim.user.id,
        organizationId: claim.organization.id,
        readOnly: true
      },
      (client) => client.query(
        "select id from ss.customer_engagement_invitations limit 1"
      )
    ),
    /permission denied/iu
  );
}

async function v2AuthorityFingerprint(pool) {
  const result = await pool.query(`
    select
      document.xmin::text as row_version,
      encode(extensions.digest(
        convert_to(to_jsonb(document)::text, 'UTF8'),
        'sha256'
      ), 'hex') as row_digest,
      document.id,
      document.kind,
      document.version,
      document.content_digest,
      document.content_uri,
      document.effective_at,
      document.retired_at,
      document.created_at
    from ss.legal_documents document
    where document.id = '00000000-0000-4000-8000-000000000022'
  `);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function applyJointLegalV3Release(pool, releaseSql) {
  await pool.query(releaseSql);
  const artifacts = await pool.query(`
    select document_id, artifact_uri, artifact_sha256, byte_count, media_type
      from ss.legal_document_artifacts
     order by document_id
  `);
  assert.deepEqual(artifacts.rows, [
    {
      document_id: "00000000-0000-4000-8000-000000000022",
      artifact_uri:
        "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/",
      artifact_sha256:
        "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b",
      byte_count: "19935",
      media_type: "text/html; charset=utf-8"
    },
    {
      document_id: "00000000-0000-4000-8000-000000000023",
      artifact_uri:
        "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/",
      artifact_sha256:
        "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196",
      byte_count: "21380",
      media_type: "text/html; charset=utf-8"
    },
    {
      document_id: "00000000-0000-4000-8000-000000000048",
      artifact_uri: PRIVACY_RELEASE.artifactUri,
      artifact_sha256: PRIVACY_RELEASE.contentDigest,
      byte_count: String(PRIVACY_RELEASE.byteCount),
      media_type: "text/html; charset=utf-8"
    },
    {
      document_id: "00000000-0000-4000-8000-000000000104",
      artifact_uri: WEBSITE_TERMS_RELEASE.artifactUri,
      artifact_sha256: WEBSITE_TERMS_RELEASE.contentDigest,
      byte_count: String(WEBSITE_TERMS_RELEASE.byteCount),
      media_type: "text/html; charset=utf-8"
    }
  ]);
}

async function verifyReceiptRejectsFourthAcceptance(pool) {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const receiptId = randomUUID();
  const requestId = randomUUID();
  const acceptedAt = PRIVACY_RELEASE.effectiveAt;
  const documentIds = [
    "00000000-0000-4000-8000-000000000103",
    "00000000-0000-4000-8000-000000000048",
    "00000000-0000-4000-8000-000000000104"
  ];

  await pool.query("begin");
  try {
    await pool.query(
      `insert into auth.users (id, email)
       values ($1, $2)`,
      [userId, `${userId}@privacy-v3-proof.invalid`]
    );
    await pool.query(
      `insert into ss.organizations (id, created_by_user_id, name)
       values ($1, $2, 'Privacy V3 proof')`,
      [organizationId, userId]
    );
    await pool.query(
      `insert into ss.projects (
         id, organization_id, created_by_user_id, billing_policy_id, name
       ) values (
         $1, $2, $3, '00000000-0000-4000-8000-000000000014',
         'Privacy V3 proof'
       )`,
      [projectId, organizationId, userId]
    );
    await pool.query(
      `insert into ss.project_legal_acceptance_receipts (
         id, organization_id, project_id, user_id, request_id,
         schema_version, acceptance_statement, authority_digest,
         accepted_at
       ) values (
         $1, $2, $3, $4, $5,
         'sitesourcery.project-legal-acceptance/v3',
         'accepted_exact_project_terms_and_acknowledged_privacy',
         $6, $7
       )`,
      [
        receiptId,
        organizationId,
        projectId,
        userId,
        requestId,
        JOINT_LEGAL_RELEASE_AUTHORITY_DIGEST,
        acceptedAt
      ]
    );
    for (const documentId of documentIds) {
      await pool.query(
        `insert into ss.term_acceptances (
           id, organization_id, project_id, user_id, document_id,
           accepted_at, request_id, legal_receipt_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          organizationId,
          projectId,
          userId,
          documentId,
          acceptedAt,
          requestId,
          receiptId
        ]
      );
    }
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }

  let rogueError = null;
  await pool.query("begin");
  try {
    await pool.query(
      `insert into ss.term_acceptances (
         id, organization_id, project_id, user_id, document_id,
         accepted_at, request_id, legal_receipt_id
       ) values (
         $1, $2, $3, $4,
         '00000000-0000-4000-8000-000000000022',
         $5, $6, $7
       )`,
      [
        randomUUID(),
        organizationId,
        projectId,
        userId,
        acceptedAt,
        requestId,
        receiptId
      ]
    );
    await pool.query("commit");
  } catch (error) {
    rogueError = error;
    await pool.query("rollback");
  }
  assert.ok(rogueError, "a fourth receipt acceptance must fail");
  assert.equal(rogueError.code, "23514");
  assert.match(rogueError.message, /exact reviewed three-document bundle/u);

  const count = await pool.query(
    `select count(*)::integer as acceptance_count
       from ss.term_acceptances
      where legal_receipt_id = $1`,
    [receiptId]
  );
  assert.equal(count.rows[0].acceptance_count, 3);
}

async function verifyV4ReceiptRejectsFourthAcceptance(pool) {
  const existing = await pool.query(`
    select organization_id, project_id, user_id, accepted_at
      from ss.project_legal_acceptance_receipts
     where schema_version = 'sitesourcery.project-legal-acceptance/v3'
     order by created_at
     limit 1
  `);
  assert.equal(existing.rowCount, 1);
  const receiptId = randomUUID();
  const requestId = randomUUID();
  const acceptedAt = "2026-08-09T21:42:11.000Z";
  const documentIds = [
    "00000000-0000-4000-8000-000000000105",
    "00000000-0000-4000-8000-000000000049",
    "00000000-0000-4000-8000-000000000106"
  ];
  await pool.query("begin");
  try {
    await pool.query(
      `insert into ss.project_legal_acceptance_receipts (
         id, organization_id, project_id, user_id, request_id,
         schema_version, acceptance_statement, authority_digest,
         accepted_at
       ) values (
         $1, $2, $3, $4, $5,
         'sitesourcery.project-legal-acceptance/v4',
         'accepted_exact_project_terms_and_acknowledged_privacy',
         $6, $7
       )`,
      [
        receiptId,
        existing.rows[0].organization_id,
        existing.rows[0].project_id,
        existing.rows[0].user_id,
        requestId,
        JOINT_LEGAL_V4_RELEASE_AUTHORITY_DIGEST,
        acceptedAt,
      ],
    );
    for (const documentId of documentIds) {
      await pool.query(
        `insert into ss.term_acceptances (
           id, organization_id, project_id, user_id, document_id,
           accepted_at, request_id, legal_receipt_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          existing.rows[0].organization_id,
          existing.rows[0].project_id,
          existing.rows[0].user_id,
          documentId,
          acceptedAt,
          requestId,
          receiptId,
        ],
      );
    }
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }

  let rogueError = null;
  await pool.query("begin");
  try {
    await pool.query(
      `insert into ss.term_acceptances (
         id, organization_id, project_id, user_id, document_id,
         accepted_at, request_id, legal_receipt_id
       ) values (
         $1, $2, $3, $4,
         '00000000-0000-4000-8000-000000000022',
         $5, $6, $7
       )`,
      [
        randomUUID(),
        existing.rows[0].organization_id,
        existing.rows[0].project_id,
        existing.rows[0].user_id,
        acceptedAt,
        requestId,
        receiptId,
      ],
    );
    await pool.query("commit");
  } catch (error) {
    rogueError = error;
    await pool.query("rollback");
  }
  assert.equal(rogueError?.code, "23514");
  assert.match(rogueError.message, /exact reviewed three-document bundle/u);
  const retained = await pool.query(
    `select count(*)::integer as count
       from ss.term_acceptances
      where legal_receipt_id = $1`,
    [receiptId],
  );
  assert.equal(retained.rows[0].count, 3);
}

async function verifyPreJointLegalV3State(pool) {
  const result = await pool.query(`
    select
      to_regclass('ss.legal_document_artifacts') is null
        as artifact_table_absent,
      to_regclass('ss.project_legal_acceptance_receipts') is null
        as receipt_table_absent,
      to_regprocedure('ss.hosted_runtime_contract_v48()') is null
        as contract_absent,
      not exists (
        select 1
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'term_acceptances'
           and column_record.column_name = 'legal_receipt_id'
      ) as receipt_link_absent,
      not exists (
        select 1
          from ss.legal_documents document
         where document.id = '00000000-0000-4000-8000-000000000048'
      ) as v3_document_absent,
      exists (
        select 1
          from ss.legal_documents document
         where document.id = '00000000-0000-4000-8000-000000000022'
           and document.kind = 'privacy'
           and document.version = 'SS-HOSTED-PRIVACY-2026-07-30-V2'
           and document.content_digest =
             'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b'
           and document.content_uri =
             'https://sitesourcery.com/legal/privacy/'
           and document.effective_at =
             '2026-07-30T00:00:00Z'::timestamptz
           and document.retired_at is null
      ) as v2_authority_unchanged
  `);
  for (const [name, ready] of Object.entries(result.rows[0])) {
    assert.equal(
      ready,
      true,
      `Pre-joint-legal-V3 state failed: ${name}`
    );
  }
}

async function verifyProjectLegalReadiness(pool, expectedReady) {
  let queryError = null;
  const legalDiagnostics = {};
  const diagnosticPool = {
    connect: (...args) => pool.connect(...args),
    async query(...args) {
      try {
        const result = await pool.query(...args);
        if (args[0].includes("v48_catalog_immutability_triggers")) {
          legalDiagnostics.catalog = result.rows[0] ?? null;
        } else if (args[0].includes("as v2_artifact_ready")) {
          legalDiagnostics.data = result.rows[0] ?? null;
        }
        return result;
      } catch (error) {
        queryError = error;
        throw error;
      }
    }
  };
  const authority = createCanonicalPostgresAuthority({
    pool: diagnosticPool
  });
  const readiness = await authority.readiness();
  if (queryError) throw queryError;
  if (expectedReady && readiness.projectCreationLegal.ready !== true) {
    const functions = await pool.query(`
      select
        procedure_record.proname,
        procedure_record.provolatile,
        procedure_record.prosecdef,
        procedure_record.proisstrict,
        procedure_record.proparallel,
        procedure_record.prorettype::regtype::text as return_type,
        btrim(procedure_record.prosrc) as source,
        procedure_record.proacl::text as acl
      from pg_proc procedure_record
      join pg_namespace namespace
        on namespace.oid = procedure_record.pronamespace
      where namespace.nspname = 'ss'
        and procedure_record.proname in (
          'hosted_runtime_contract_v48',
          'project_legal_json_digest'
        )
      order by procedure_record.proname
    `);
    const constraints = await pool.query(`
      select relation.relname, pg_get_constraintdef(constraint_record.oid)
        as definition
      from pg_constraint constraint_record
      join pg_class relation on relation.oid = constraint_record.conrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'ss'
        and relation.relname in (
          'legal_document_artifacts',
          'project_legal_acceptance_receipts',
          'term_acceptances'
        )
      order by relation.relname, definition
    `);
    legalDiagnostics.functions = functions.rows;
    legalDiagnostics.constraints = constraints.rows;
  }
  assert.equal(
    readiness.projectCreationLegal.ready,
    expectedReady,
    `project legal readiness failed: ${JSON.stringify({
      readiness,
      legalDiagnostics
    })}`
  );
  for (const key of [
    "contract",
    "v2Artifact",
    "v3Artifact",
    "receipts",
    "authority"
  ]) {
    assert.equal(
      readiness.projectCreationLegal[key],
      expectedReady,
      `project legal readiness mismatch: ${key}`
    );
  }
  if (expectedReady) {
    assert.equal(
      await authority.projectLegalAuthorityMatches(
        JOINT_LEGAL_RELEASE_AUTHORITY
      ),
      true
    );
    assert.equal(
      await authority.projectLegalAuthorityMatches(
        JOINT_LEGAL_V4_RELEASE_AUTHORITY
      ),
      true
    );
  }
  return {
    globalReady: readiness.ready,
    missing: readiness.missing ?? [],
    ...readiness.projectCreationLegal
  };
}

async function verifyPlatformSchema(pool) {
  const result = await pool.query(`
    select
      to_regclass('ss.alakazam_subscriptions') is not null
        as subscriptions,
      to_regclass('ss.alakazam_change_quotes') is not null
        as change_quotes,
      to_regclass('ss.alakazam_checkout_dispatches') is not null
        as checkout_dispatches,
      to_regclass('ss.alakazam_payment_receipts') is not null
        as payment_receipts,
      to_regclass('ss.alakazam_downgrade_schedules') is not null
        as downgrade_schedules,
      to_regprocedure('ss.hosted_runtime_contract_v23()') is not null
        as subscription_runtime_contract,
      to_regclass('ss.alakazam_customer_provisions') is not null
        as customer_provisions,
      to_regprocedure('ss.hosted_runtime_contract_v24()') is not null
        as customer_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v25()') is not null
        as checkout_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v26()') is not null
        as payment_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v27()') is not null
        as activation_runtime_contract,
      to_regclass('ss.alakazam_upgrade_applications') is not null
        as upgrade_applications,
      to_regprocedure('ss.hosted_runtime_contract_v28()') is not null
        as upgrade_runtime_contract,
      to_regclass('ss.alakazam_one_upgrade_activation') is not null
        as upgrade_activation_index,
      to_regprocedure('ss.hosted_runtime_contract_v29()') is not null
        as upgrade_activation_runtime_contract,
      to_regclass('ss.alakazam_one_downgrade_schedule_event')
        is not null as downgrade_schedule_event_index,
      to_regprocedure('ss.hosted_runtime_contract_v30()') is not null
        as downgrade_dispatch_runtime_contract,
      to_regclass('ss.alakazam_one_downgrade_activation')
        is not null as downgrade_activation_index,
      to_regprocedure('ss.hosted_runtime_contract_v31()') is not null
        as downgrade_activation_runtime_contract,
      to_regclass('ss.alakazam_fulfillment_intents') is not null
        as fulfillment_intents,
      to_regclass('ss.alakazam_fulfillment_operations') is not null
        as fulfillment_operations,
      to_regclass('ss.alakazam_fulfillment_projection') is not null
        as fulfillment_projection,
      to_regprocedure('ss.hosted_runtime_contract_v32()') is not null
        as fulfillment_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v33()') is not null
        as tier_fulfillment_runtime_contract,
      to_regclass('ss.service_catalog_policies') is not null
        as service_catalog_policies,
      to_regclass('ss.service_catalog_coverage') is not null
        as service_catalog_coverage,
      to_regclass('ss.service_project_profiles') is not null
        as service_project_profiles,
      to_regclass('ss.service_cases') is not null
        as service_cases,
      to_regclass('ss.service_case_offerings') is not null
        as service_case_offerings,
      to_regclass('ss.service_intakes') is not null
        as service_intakes,
      to_regclass('ss.service_documents') is not null
        as service_documents,
      to_regclass('ss.service_access_requests') is not null
        as service_access_requests,
      to_regclass('ss.operator_profiles') is not null
        as operator_profiles,
      to_regclass('ss.operator_permissions') is not null
        as operator_permissions,
      to_regprocedure('ss.hosted_runtime_contract_v34()') is not null
        as custom_services_foundation_runtime_contract,
      to_regclass('ss.service_operator_authority_events') is not null
        as service_operator_authority_events,
      to_regclass('ss.service_quotes') is not null
        as service_quotes,
      to_regclass('ss.service_quote_revisions') is not null
        as service_quote_revisions,
      to_regclass('ss.service_quote_lines') is not null
        as service_quote_lines,
      to_regclass('ss.service_quote_line_coverages') is not null
        as service_quote_line_coverages,
      to_regclass('ss.service_quote_review_targets') is not null
        as service_quote_review_targets,
      to_regclass('ss.service_quote_installments') is not null
        as service_quote_installments,
      to_regclass('ss.service_quote_acceptances') is not null
        as service_quote_acceptances,
      to_regprocedure('ss.hosted_runtime_contract_v35()') is not null
        as custom_service_quotes_runtime_contract,
      to_regprocedure('ss.hosted_runtime_contract_v36()') is not null
        as custom_service_customer_commands_runtime_contract,
      to_regclass('ss.service_invoices') is not null
        as service_invoices,
      to_regclass('ss.service_invoice_lines') is not null
        as service_invoice_lines,
      to_regclass('ss.service_payment_reservations') is not null
        as service_payment_reservations,
      to_regprocedure('ss.hosted_runtime_contract_v37()') is not null
        as custom_service_invoices_runtime_contract,
      to_regclass('ss.service_assessment_checkout_attempts') is not null
        as service_assessment_checkout_attempts,
      to_regprocedure('ss.hosted_runtime_contract_v38()') is not null
        as custom_service_assessment_checkout_runtime_contract,
      to_regprocedure(
        'ss.guard_service_assessment_checkout_attempt()'
      ) is not null as service_assessment_checkout_guard,
      to_regclass('ss.service_assessment_stripe_events') is not null
        as service_assessment_stripe_events,
      to_regclass('ss.service_assessment_payment_receipts') is not null
        as service_assessment_payment_receipts,
      to_regclass('ss.service_assessment_jobs') is not null
        as service_assessment_jobs,
      to_regprocedure('ss.hosted_runtime_contract_v39()') is not null
        as custom_service_assessment_settlement_runtime_contract,
      to_regprocedure(
        'ss.guard_service_assessment_stripe_event()'
      ) is not null as service_assessment_stripe_event_guard,
      to_regprocedure(
        'ss.guard_service_assessment_settlement_insert()'
      ) is not null as service_assessment_settlement_insert_guard,
      to_regclass('ss.service_document_payloads') is not null
        as service_document_payloads,
      to_regclass('ss.service_assessment_evidence') is not null
        as service_assessment_evidence,
      to_regclass('ss.service_assessment_finding_drafts') is not null
        as service_assessment_finding_drafts,
      to_regclass('ss.service_assessment_reports') is not null
        as service_assessment_reports,
      to_regclass('ss.service_assessment_report_findings') is not null
        as service_assessment_report_findings,
      to_regclass('ss.service_credit_grants') is not null
        as service_credit_grants,
      to_regprocedure('ss.hosted_runtime_contract_v40()') is not null
        as custom_service_assessment_delivery_runtime_contract,
      to_regprocedure(
        'ss.materialize_service_assessment_delivery()'
      ) is not null as service_assessment_delivery_materializer,
      to_regclass('ss.service_custom_build_quotes') is not null
        as service_custom_build_quotes,
      to_regclass('ss.service_custom_build_quote_revisions') is not null
        as service_custom_build_quote_revisions,
      to_regclass('ss.service_custom_build_quote_base_lines') is not null
        as service_custom_build_quote_base_lines,
      to_regclass('ss.service_custom_build_quote_installments') is not null
        as service_custom_build_quote_installments,
      to_regclass('ss.service_custom_build_quote_commands') is not null
        as service_custom_build_quote_commands,
      to_regclass('ss.service_custom_build_quote_acceptances') is not null
        as service_custom_build_quote_acceptances,
      to_regclass('ss.service_credit_applications') is not null
        as service_credit_applications,
      to_regclass('ss.service_custom_build_quote_voids') is not null
        as service_custom_build_quote_voids,
      to_regprocedure('ss.hosted_runtime_contract_v41()') is not null
        as custom_build_quote_credit_runtime_contract,
      to_regclass('ss.service_custom_build_invoices') is not null
        as service_custom_build_invoices,
      to_regclass('ss.service_custom_build_invoice_lines') is not null
        as service_custom_build_invoice_lines,
      to_regclass('ss.service_custom_build_checkout_attempts') is not null
        as service_custom_build_checkout_attempts,
      to_regclass('ss.service_custom_build_stripe_events') is not null
        as service_custom_build_stripe_events,
      to_regclass('ss.service_custom_build_payment_receipts') is not null
        as service_custom_build_payment_receipts,
      to_regclass('ss.service_custom_build_jobs') is not null
        as service_custom_build_jobs,
      to_regprocedure('ss.hosted_runtime_contract_v42()') is not null
        as custom_build_start_payment_runtime_contract,
      to_regclass('ss.service_custom_build_progress_updates') is not null
        as service_custom_build_progress_updates,
      to_regclass('ss.service_custom_build_work_requests') is not null
        as service_custom_build_work_requests,
      to_regprocedure('ss.hosted_runtime_contract_v43()') is not null
        as custom_build_progress_runtime_contract,
      to_regclass('ss.service_custom_build_change_orders') is not null
        as service_custom_build_change_orders,
      to_regclass('ss.service_custom_build_change_acceptances') is not null
        as service_custom_build_change_acceptances,
      to_regclass('ss.service_custom_build_change_declines') is not null
        as service_custom_build_change_declines,
      to_regclass('ss.service_custom_build_change_voids') is not null
        as service_custom_build_change_voids,
      to_regclass('ss.service_custom_build_change_expirations') is not null
        as service_custom_build_change_expirations,
      to_regclass('ss.service_custom_build_completion_evidence') is not null
        as service_custom_build_completion_evidence,
      to_regclass('ss.service_custom_build_completion_packages') is not null
        as service_custom_build_completion_packages,
      to_regprocedure('ss.hosted_runtime_contract_v44()') is not null
        as custom_build_change_completion_runtime_contract,
      to_regclass('ss.service_custom_build_change_invoices') is not null
        as service_custom_build_change_invoices,
      to_regclass('ss.service_custom_build_change_invoice_lines') is not null
        as service_custom_build_change_invoice_lines,
      to_regclass(
        'ss.service_custom_build_change_checkout_attempts'
      ) is not null as service_custom_build_change_checkout_attempts,
      to_regclass(
        'ss.service_custom_build_change_reconciliation_commands'
      ) is not null as service_custom_build_change_reconciliation_commands,
      to_regclass('ss.service_custom_build_change_stripe_events') is not null
        as service_custom_build_change_stripe_events,
      to_regclass(
        'ss.service_custom_build_change_payment_receipts'
      ) is not null as service_custom_build_change_payment_receipts,
      to_regprocedure('ss.hosted_runtime_contract_v45()') is not null
        as custom_build_change_payment_runtime_contract,
      to_regclass('ss.service_custom_build_stripe_payment_claims') is not null
        as service_custom_build_stripe_payment_claims,
      to_regclass('ss.service_custom_build_final_obligations') is not null
        as service_custom_build_final_obligations,
      to_regclass('ss.service_custom_build_final_invoices') is not null
        as service_custom_build_final_invoices,
      to_regclass('ss.service_custom_build_final_invoice_lines') is not null
        as service_custom_build_final_invoice_lines,
      to_regclass(
        'ss.service_custom_build_final_zero_balance_clearances'
      ) is not null as service_custom_build_final_zero_balance_clearances,
      to_regclass(
        'ss.service_custom_build_final_checkout_attempts'
      ) is not null as service_custom_build_final_checkout_attempts,
      to_regclass(
        'ss.service_custom_build_final_reconciliation_commands'
      ) is not null as service_custom_build_final_reconciliation_commands,
      to_regclass('ss.service_custom_build_final_stripe_events') is not null
        as service_custom_build_final_stripe_events,
      to_regclass(
        'ss.service_custom_build_final_payment_receipts'
      ) is not null as service_custom_build_final_payment_receipts,
      to_regprocedure('ss.hosted_runtime_contract_v46()') is not null
        as custom_build_final_payment_runtime_contract,
      to_regclass(
        'ss.service_custom_build_handoff_receipts'
      ) is not null as service_custom_build_handoff_receipts,
      to_regprocedure(
        'ss.create_service_custom_build_handoff(uuid,text,uuid,ss.sha256_hex,ss.sha256_hex,text,jsonb)'
      ) is not null as custom_build_handoff_callable,
      to_regprocedure('ss.hosted_runtime_contract_v47()') is not null
        as custom_build_handoff_runtime_contract,
      to_regclass(
        'ss.alakazam_customer_publication_commands'
      ) is not null as alakazam_customer_publication_commands,
      to_regprocedure(
        'ss.hosted_alakazam_publication_contract()'
      ) is not null as alakazam_customer_publication_runtime_contract,
      to_regclass('ss.alakazam_35_photo_assets') is not null
        as alakazam_35_photo_assets,
      to_regclass('ss.alakazam_35_configurations') is not null
        as alakazam_35_configurations,
      to_regclass('ss.alakazam_35_care_requests') is not null
        as alakazam_35_care_requests,
      to_regprocedure('ss.hosted_alakazam_35_contract()') is not null
        as alakazam_35_runtime_contract,
      to_regclass('ss.alakazam_50_configurations') is not null
        as alakazam_50_configurations,
      to_regclass('ss.alakazam_50_care_requests') is not null
        as alakazam_50_care_requests,
      to_regprocedure('ss.hosted_alakazam_50_contract()') is not null
        as alakazam_50_runtime_contract,
      to_regclass('ss.publication_control_commands') is not null
        as publication_control_commands,
      to_regprocedure(
        'ss.hosted_publication_control_contract()'
      ) is not null as publication_control_runtime_contract,
      to_regprocedure(
        'ss.validate_service_case_offering_terminal_state()'
      ) is not null as custom_service_terminal_state_validator,
      to_regclass('ss.service_intake_drafts') is not null
        as service_intake_drafts,
      to_regprocedure('ss.guard_service_intake_draft_insert()') is not null
        as service_intake_draft_insert_guard,
      to_regprocedure('ss.bump_service_intake_draft_revision()') is not null
        as service_intake_draft_revision_guard
  `);
  for (const [name, exists] of Object.entries(result.rows[0])) {
    assert.equal(exists, true, `missing platform schema object: ${name}`);
  }

  const customServices = await pool.query(`
    select
      ss.hosted_runtime_contract_v34() =
        'canonical-ss-v34-custom-services-foundation'
        as exact_runtime_marker,
      (
        select count(*) = 1
          from ss.service_catalog_policies policy
          join ss.legal_documents document
            on document.id = policy.legal_document_id
         where policy.id = '00000000-0000-4000-8000-000000000341'
           and policy.service_key = 'website_assessment_standard'
           and policy.unit_amount_minor = 20000
           and policy.currency = 'USD'
           and policy.publication_state = 'held'
           and policy.scope_boundary = jsonb_build_object(
             'expandedAssessmentState', 'separately_quoted',
             'maximumFindings', 10,
             'maximumRepresentativePagesOrTypes', 5,
             'maximumWebsites', 1,
             'requiredViewports', jsonb_build_array('desktop', 'phone')
           )
           and policy.scope_boundary_digest =
             ss.service_json_digest(policy.scope_boundary)
           and document.kind = 'custom_services'
           and document.version = 'SS-CUSTOM-SERVICES-2026-08-05.1'
           and document.content_digest =
             '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
           and (
             select count(*) = 4
               from ss.service_catalog_coverage coverage
              where coverage.policy_id = policy.id
                and coverage.boundary_digest = policy.scope_boundary_digest
           )
      ) as exact_held_assessment,
      (
        select count(*) = 10
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            not has_table_privilege(
              'authenticated',
              format('ss.%I', relation.relname),
              'SELECT'
            )
            and not has_table_privilege(
              'anon',
              format('ss.%I', relation.relname),
              'INSERT'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'DELETE'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'TRUNCATE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_catalog_policies',
             'service_catalog_coverage',
             'service_project_profiles',
             'operator_profiles',
             'operator_permissions',
             'service_cases',
             'service_case_offerings',
             'service_intakes',
             'service_documents',
             'service_access_requests'
           )
      ) as exact_security_boundary,
      not exists (
        select 1
          from information_schema.columns
         where table_schema = 'ss'
           and table_name = 'service_intakes'
           and data_type = 'jsonb'
      ) and exists (
        select 1
          from information_schema.columns
         where table_schema = 'ss'
           and table_name = 'service_intakes'
           and column_name = 'facts_digest'
           and is_generated = 'ALWAYS'
      ) as typed_database_digested_intake,
      not exists (
        select 1
          from pg_constraint constraint_record
          join pg_class relation
            on relation.oid = constraint_record.conrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname like 'service_%'
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys,
      not has_table_privilege(
        'service_role',
        'ss.operator_profiles',
        'INSERT'
      ) and not has_table_privilege(
        'service_role',
        'ss.operator_permissions',
        'INSERT'
      ) and not has_table_privilege(
        'service_role',
        'ss.service_documents',
        'UPDATE'
      ) and has_table_privilege(
        'service_role',
        'ss.service_documents',
        'INSERT'
      ) and has_table_privilege(
        'service_role',
        'ss.service_access_requests',
        'INSERT'
      ) and not has_table_privilege(
        'service_role',
        'ss.service_access_requests',
        'UPDATE'
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_access_requests'::regclass
          and trigger_record.tgname =
            'service_access_requests_custom_build_guard'
          and not trigger_record.tgisinternal
      ) as held_authority_is_read_only
  `);
  for (const [name, ready] of Object.entries(customServices.rows[0])) {
    assert.equal(
      ready,
      true,
      `custom-services migration contract failed: ${name}`
    );
  }

  const customServiceQuotes = await pool.query(`
    select
      ss.hosted_runtime_contract_v35() =
        'canonical-ss-v35-custom-service-quotes'
        as exact_runtime_marker,
      ss.hosted_runtime_contract_v36() =
        'canonical-ss-v36-custom-service-customer-commands'
        as exact_customer_commands_runtime_marker,
      ss.hosted_runtime_contract_v37() =
        'canonical-ss-v37-custom-service-held-invoices'
        as exact_held_invoice_runtime_marker,
      ss.hosted_runtime_contract_v38() =
        'canonical-ss-v38-custom-service-assessment-checkout'
        as exact_assessment_checkout_runtime_marker,
      ss.hosted_runtime_contract_v39() =
        'canonical-ss-v39-custom-service-assessment-settlement'
        as exact_assessment_settlement_runtime_marker,
      (
        select count(*) = 1
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role', relation.oid, 'SELECT'
            )
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            )
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'TRUNCATE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname =
             'service_assessment_checkout_attempts'
      )
        and (
          select count(*) = 2
            and array_agg(
              trigger_record.tgname
              order by trigger_record.tgname
            ) = array[
              'service_assessment_checkout_attempt_guard',
              'service_assessment_checkout_attempt_no_delete'
            ]::name[]
            and bool_and(trigger_record.tgenabled = 'O')
            and bool_and(
              case trigger_record.tgname
                when 'service_assessment_checkout_attempt_guard' then
                  trigger_record.tgfoid = to_regprocedure(
                    'ss.guard_service_assessment_checkout_attempt()'
                  )
                  and trigger_record.tgtype = 23
                  and pg_get_triggerdef(
                    trigger_record.oid, false
                  ) =
                    'CREATE TRIGGER service_assessment_checkout_attempt_guard BEFORE INSERT OR UPDATE ON ss.service_assessment_checkout_attempts FOR EACH ROW EXECUTE FUNCTION ss.guard_service_assessment_checkout_attempt()'
                when 'service_assessment_checkout_attempt_no_delete' then
                  trigger_record.tgfoid = to_regprocedure(
                    'ss.reject_update()'
                  )
                  and trigger_record.tgtype = 11
                  and pg_get_triggerdef(
                    trigger_record.oid, false
                  ) =
                    'CREATE TRIGGER service_assessment_checkout_attempt_no_delete BEFORE DELETE ON ss.service_assessment_checkout_attempts FOR EACH ROW EXECUTE FUNCTION ss.reject_update()'
                else false
              end
            )
            from pg_trigger trigger_record
            join pg_class trigger_relation
              on trigger_relation.oid = trigger_record.tgrelid
            join pg_namespace trigger_namespace
              on trigger_namespace.oid =
                trigger_relation.relnamespace
           where trigger_namespace.nspname = 'ss'
             and trigger_relation.relname =
               'service_assessment_checkout_attempts'
             and not trigger_record.tgisinternal
        )
        and exists (
          select 1
            from pg_constraint constraint_record
            join pg_class constraint_relation
              on constraint_relation.oid =
                constraint_record.conrelid
            join pg_namespace constraint_namespace
              on constraint_namespace.oid =
                constraint_relation.relnamespace
           where constraint_namespace.nspname = 'ss'
             and constraint_relation.relname =
               'service_assessment_checkout_attempts'
             and constraint_record.contype = 'u'
             and pg_get_constraintdef(
               constraint_record.oid
             ) = 'UNIQUE (checkout_session_id)'
        )
        and (
          select count(*) = 1
            and bool_and(index_record.indisunique)
            and bool_and(index_record.indisvalid)
            and bool_and(index_record.indisready)
            and bool_and(index_record.indislive)
            and bool_and(not index_record.indnullsnotdistinct)
            and bool_and(index_record.indnkeyatts = 1)
            and bool_and(index_record.indnatts = 1)
            and bool_and(index_record.indexprs is null)
            and bool_and(
              index_record.indkey[0] =
                indexed_attribute.attnum
            )
            and bool_and(index_method.amname = 'btree')
            and bool_and(
              pg_get_expr(
                index_record.indpred,
                index_record.indrelid,
                false
              ) =
                '(state = ANY (ARRAY[''provider_pending''::text, ''ready''::text, ''persistence_unknown''::text]))'
            )
            from pg_index index_record
            join pg_class index_relation
              on index_relation.oid = index_record.indexrelid
            join pg_class indexed_relation
              on indexed_relation.oid = index_record.indrelid
            join pg_namespace index_namespace
              on index_namespace.oid =
                index_relation.relnamespace
            join pg_am index_method
              on index_method.oid = index_relation.relam
            join pg_attribute indexed_attribute
              on indexed_attribute.attrelid =
                indexed_relation.oid
             and indexed_attribute.attname = 'invoice_id'
             and not indexed_attribute.attisdropped
           where index_namespace.nspname = 'ss'
             and indexed_relation.relnamespace =
               index_namespace.oid
             and indexed_relation.relname =
               'service_assessment_checkout_attempts'
             and index_relation.relname =
               'service_assessment_checkout_one_active'
        ) as exact_assessment_checkout_security,
      (
        select count(*) = 3
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role', relation.oid, 'SELECT'
            )
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            )
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = (
              relation.relname =
                'service_assessment_stripe_events'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'anon', relation.oid, 'UPDATE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_assessment_stripe_events',
             'service_assessment_payment_receipts',
             'service_assessment_jobs'
           )
      )
        and (
          select count(*) = 6
            from pg_trigger trigger_record
            join pg_class trigger_relation
              on trigger_relation.oid = trigger_record.tgrelid
            join pg_namespace trigger_namespace
              on trigger_namespace.oid =
                trigger_relation.relnamespace
           where trigger_namespace.nspname = 'ss'
             and trigger_relation.relname in (
               'service_assessment_stripe_events',
               'service_assessment_payment_receipts',
               'service_assessment_jobs'
             )
             and not trigger_record.tgisinternal
        )
        and not exists (
          select 1
            from pg_constraint constraint_record
            join pg_class constraint_relation
              on constraint_relation.oid =
                constraint_record.conrelid
            join pg_namespace constraint_namespace
              on constraint_namespace.oid =
                constraint_relation.relnamespace
           where constraint_namespace.nspname = 'ss'
             and constraint_relation.relname in (
               'service_assessment_stripe_events',
               'service_assessment_payment_receipts',
               'service_assessment_jobs'
             )
             and constraint_record.contype = 'f'
             and constraint_record.confdeltype = 'c'
        ) as exact_assessment_settlement_security,
      (
        select count(*) = 11
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'SELECT'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'UPDATE'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'DELETE'
            )
            and not has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'TRUNCATE'
            )
            and has_table_privilege(
              'service_role',
              format('ss.%I', relation.relname),
              'INSERT'
            ) = (
              relation.relname in (
                'service_quotes',
                'service_quote_revisions',
                'service_quote_acceptances'
              )
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_operator_authority_events',
             'service_quotes',
             'service_quote_revisions',
             'service_quote_lines',
             'service_quote_line_coverages',
             'service_quote_review_targets',
             'service_quote_installments',
             'service_quote_acceptances',
             'service_invoices',
             'service_invoice_lines',
             'service_payment_reservations'
           )
      ) as exact_security_boundary,
      not exists (
        select 1
          from pg_constraint constraint_record
          join pg_class relation
            on relation.oid = constraint_record.conrelid
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_operator_authority_events',
             'service_quotes',
             'service_quote_revisions',
             'service_quote_lines',
             'service_quote_line_coverages',
             'service_quote_review_targets',
             'service_quote_installments',
             'service_quote_acceptances',
             'service_invoices',
             'service_invoice_lines',
             'service_payment_reservations'
           )
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys,
      (
        select count(*) = 3
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'SELECT'
            )
            and not has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'INSERT'
            )
            and not has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'UPDATE'
            )
            and not has_table_privilege(
              'service_role', format('ss.%I', relation.relname), 'DELETE'
            )
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_invoices',
             'service_invoice_lines',
             'service_payment_reservations'
           )
      )
        and not has_function_privilege(
          'service_role',
          'ss.ensure_service_assessment_invoice(uuid)',
          'EXECUTE'
        )
        and not has_function_privilege(
          'service_role',
          'ss.materialize_service_assessment_invoice()',
          'EXECUTE'
        ) as held_invoice_authority,
      (
        select count(*) = 2
          and bool_and(column_record.is_generated = 'ALWAYS')
          and bool_and(
            column_record.generation_expression like
              '%service_quote_digest%'
          )
          and bool_or(
            column_record.column_name = 'quote_digest'
            and column_record.generation_expression like '%snapshot%'
          )
          and bool_or(
            column_record.column_name = 'disclosure_digest'
            and column_record.generation_expression like
              '%customer_disclosure%'
          )
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_quote_revisions'
           and column_record.column_name in (
             'quote_digest',
             'disclosure_digest'
           )
      ) as database_generated_quote_digests,
      (
        select
          constraint_contract.definitions ~
            'service_amount_minor = 20000'
          and constraint_contract.definitions ~
            'subtotal_minor = 20000'
          and constraint_contract.definitions ~
            'currency = ''USD'''
          and constraint_contract.definitions ~
            'tax_state = ''calculation_required'''
          and constraint_contract.definitions ~
            'payment_schedule = ''full_before_work'''
          and constraint_contract.definitions ~
            'maximum_websites = 1'
          and constraint_contract.definitions ~
            'maximum_representative_pages_or_types = 5'
          and constraint_contract.definitions ~
            'maximum_findings = 10'
          and constraint_contract.definitions like
            '%CHECK (desktop_review_included)%'
          and constraint_contract.definitions like
            '%CHECK (phone_review_included)%'
          and constraint_contract.definitions ~
            'expanded_assessment_state = ''separately_quoted'''
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.service_amount_minor := 20000%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.tax_state := ''calculation_required''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.payment_schedule := ''full_before_work''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.maximum_websites := 1%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.maximum_representative_pages_or_types := 5%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.maximum_findings := 10%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.desktop_review_included := true%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%new.phone_review_included := true%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like
            '%new.expanded_assessment_state := ''separately_quoted''%'
          and lower(
            pg_get_functiondef(
              'ss.materialize_standard_assessment_quote()'::regprocedure
            )
          ) like '%''website_assessment_standard''%'
          and lower(
            pg_get_functiondef(
              'ss.materialize_standard_assessment_quote()'::regprocedure
            )
          ) like '%''before_work''%'
          and lower(
            pg_get_functiondef(
              'ss.service_quote_review_targets_are_canonical(text[])'::regprocedure
            )
          ) like '%cardinality(value) between 1 and 5%'
          from (
            select string_agg(
              pg_get_constraintdef(constraint_record.oid),
              E'\n'
              order by constraint_record.oid
            ) as definitions
              from pg_constraint constraint_record
             where constraint_record.conrelid =
               'ss.service_quote_revisions'::regclass
               and constraint_record.contype = 'c'
          ) constraint_contract
      ) as exact_standard_assessment_terms,
      (
        select
          procedure_record.prosecdef
          and not has_function_privilege(
            'service_role',
            'ss.prepare_service_operator_authority_event()',
            'EXECUTE'
          )
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%event.event_kind = ''grant''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%order by event.event_sequence desc%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote()'::regprocedure
            )
          ) like '%''service_quote_author''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_revision()'::regprocedure
            )
          ) like '%''service_quote_author''%'
          and exists (
            select 1
              from pg_trigger trigger_record
             where trigger_record.tgrelid =
               'ss.service_operator_authority_events'::regclass
               and trigger_record.tgname =
                 'service_operator_authority_events_prepare'
               and not trigger_record.tgisinternal
          )
          and exists (
            select 1
              from pg_trigger trigger_record
             where trigger_record.tgrelid =
               'ss.service_operator_authority_events'::regclass
               and trigger_record.tgname =
                 'service_operator_authority_events_immutable'
               and not trigger_record.tgisinternal
          )
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.service_operator_has_capability(uuid,text,timestamp with time zone)'::regprocedure
      ) as deployment_controlled_operator_authority,
      (
        select
          acceptance_contract.definitions ~
            'source = ''account'''
          and acceptance_contract.definitions ~
            'acceptance_statement = ''accepted_exact_quote_and_delivery_date'''
          and acceptance_contract.definitions ~
            'accepted_by_user_id = customer_user_id'
          and (
            select procedure_record.prosecdef
              from pg_proc procedure_record
             where procedure_record.oid =
               'ss.prepare_service_quote_acceptance()'::regprocedure
          )
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%claimed_quote_digest is distinct from revision_record.quote_digest%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%claimed_disclosure_digest is distinct from revision_record.disclosure_digest%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%ss.current_service_actor_kind() <> ''customer''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%service_case.state = ''submitted''%'
          and lower(
            pg_get_functiondef(
              'ss.prepare_service_quote_acceptance()'::regprocedure
            )
          ) like '%offering.state = ''requested''%'
          and exists (
            select 1
              from pg_trigger trigger_record
             where trigger_record.tgrelid =
               'ss.service_quote_acceptances'::regclass
               and trigger_record.tgname =
                 'service_quote_acceptances_account_authority'
               and trigger_record.tgfoid =
                 'ss.validate_service_account_authority()'::regprocedure
               and not trigger_record.tgisinternal
          )
          from (
            select string_agg(
              pg_get_constraintdef(constraint_record.oid),
              E'\n'
              order by constraint_record.oid
            ) as definitions
              from pg_constraint constraint_record
             where constraint_record.conrelid =
               'ss.service_quote_acceptances'::regclass
               and constraint_record.contype in ('c', 'u')
          ) acceptance_contract
      ) as exact_account_bound_acceptance,
      exists (
        select 1
          from pg_index index_record
          join pg_class index_relation
            on index_relation.oid = index_record.indexrelid
         where index_relation.relnamespace = 'ss'::regnamespace
           and index_relation.relname =
             'service_cases_one_current_assessment'
           and index_record.indrelid = 'ss.service_cases'::regclass
           and index_record.indisunique
           and index_record.indpred is not null
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%draft%'
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%submitted%'
      ) as one_current_assessment_case,
      (
        select count(*) = 2
          and bool_and(trigger_record.tgdeferrable)
          and bool_and(trigger_record.tginitdeferred)
          and bool_and(
            trigger_record.tgfoid =
              'ss.validate_service_case_offering_terminal_state()'::regprocedure
          )
          from pg_trigger trigger_record
         where trigger_record.tgname in (
           'service_cases_offering_terminal_state',
           'service_case_offerings_terminal_state'
         )
           and not trigger_record.tgisinternal
      ) as withdrawn_offering_fence,
      exists (
        select 1
          from pg_class relation
         where relation.oid = 'ss.service_intake_drafts'::regclass
           and relation.relrowsecurity
           and relation.relforcerowsecurity
           and has_table_privilege(
             'service_role', relation.oid, 'SELECT'
           )
           and has_table_privilege(
             'service_role', relation.oid, 'INSERT'
           )
           and has_table_privilege(
             'service_role', relation.oid, 'UPDATE'
           )
           and not has_table_privilege(
             'service_role', relation.oid, 'DELETE'
           )
           and not has_table_privilege(
             'service_role', relation.oid, 'TRUNCATE'
           )
           and not has_table_privilege(
             'authenticated', relation.oid, 'SELECT'
           )
           and not has_table_privilege(
             'anon', relation.oid, 'SELECT'
           )
      ) as intake_draft_security,
      (
        select count(*) = 3
          and bool_and(not trigger_record.tgisinternal)
          from pg_trigger trigger_record
         where trigger_record.tgrelid =
           'ss.service_intake_drafts'::regclass
           and trigger_record.tgname in (
             'service_intake_drafts_insert_guard',
             'service_intake_drafts_revision',
             'service_intake_drafts_account_authority'
           )
      ) as intake_draft_triggers,
      exists (
        select 1
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_intake_drafts'
           and column_record.column_name = 'facts_digest'
           and column_record.is_generated = 'ALWAYS'
           and column_record.generation_expression like
             '%service_intake_facts_digest%'
      ) as intake_draft_digest
  `);
  for (const [name, ready] of Object.entries(customServiceQuotes.rows[0])) {
    assert.equal(
      ready,
      true,
      `custom-service quote migration contract failed: ${name}`
    );
  }

  const assessmentDelivery = await pool.query(`
    select
      ss.hosted_runtime_contract_v40() =
        'canonical-ss-v40-custom-service-assessment-delivery'
        as exact_runtime_marker,
      (
        select count(*) = 6
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and not has_table_privilege('service_role', relation.oid, 'DELETE')
            and not has_table_privilege('service_role', relation.oid, 'TRUNCATE')
            and not has_table_privilege('authenticated', relation.oid, 'SELECT')
            and not has_table_privilege('authenticated', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and has_table_privilege('service_role', relation.oid, 'INSERT') =
              relation.relname in (
                'service_document_payloads',
                'service_assessment_evidence',
                'service_assessment_finding_drafts',
                'service_assessment_reports'
              )
            and has_table_privilege('service_role', relation.oid, 'UPDATE') =
              (relation.relname = 'service_assessment_finding_drafts')
          )
          from pg_class relation
          join pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relkind = 'r'
           and relation.relname in (
             'service_document_payloads',
             'service_assessment_evidence',
             'service_assessment_finding_drafts',
             'service_assessment_reports',
             'service_assessment_report_findings',
             'service_credit_grants'
           )
      ) as exact_security_boundary,
      has_table_privilege(
        'service_role', 'ss.service_documents', 'INSERT'
      )
        and not has_table_privilege(
          'service_role', 'ss.service_documents', 'UPDATE'
        )
        and not has_table_privilege(
          'service_role', 'ss.service_documents', 'DELETE'
        )
        and not has_table_privilege(
          'service_role', 'ss.service_documents', 'TRUNCATE'
        ) as append_only_document_authority,
      (
        select count(*) = 2
          and bool_and(column_record.is_generated = 'ALWAYS')
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_document_payloads'
           and column_record.column_name in ('content_digest', 'byte_count')
      ) as payload_facts_are_database_generated,
      (
        select count(*) = 15
          from pg_trigger trigger_record
          join pg_class relation on relation.oid = trigger_record.tgrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_documents',
             'service_document_payloads',
             'service_assessment_evidence',
             'service_assessment_finding_drafts',
             'service_assessment_reports',
             'service_assessment_report_findings',
             'service_credit_grants'
           )
           and trigger_record.tgname in (
             'service_documents_immutable',
             'service_documents_assessment_guard',
             'service_document_payloads_immutable',
             'service_document_payloads_guard',
             'service_assessment_evidence_guard',
             'service_assessment_evidence_immutable',
             'service_assessment_finding_drafts_guard',
             'service_assessment_finding_drafts_no_delete',
             'service_assessment_reports_guard',
             'service_assessment_reports_immutable',
             'service_assessment_reports_materialize',
             'service_assessment_report_findings_immutable',
             'service_assessment_report_findings_guard',
             'service_credit_grants_guard',
             'service_credit_grants_immutable'
           )
           and not trigger_record.tgisinternal
      ) as retained_work_triggers,
      (
        select procedure_record.prosecdef
          and not has_function_privilege(
            'service_role',
            'ss.materialize_service_assessment_delivery()',
            'EXECUTE'
          )
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_credit_grants%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_assessment_report_findings%'
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.materialize_service_assessment_delivery()'::regprocedure
      ) as atomic_report_credit_materializer,
      not exists (
        select 1
          from pg_constraint constraint_record
          join pg_class relation on relation.oid = constraint_record.conrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'ss'
           and relation.relname in (
             'service_document_payloads',
             'service_assessment_evidence',
             'service_assessment_finding_drafts',
             'service_assessment_reports',
             'service_assessment_report_findings',
             'service_credit_grants'
           )
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(assessmentDelivery.rows[0])) {
    assert.equal(
      ready,
      true,
      `assessment delivery migration contract failed: ${name}`
    );
  }

  const customBuildQuoteCredit = await pool.query(`
    with
    expected_tables(table_name, directly_insertable, directly_updatable) as (
      values
        ('service_custom_build_quotes', true, false),
        ('service_custom_build_quote_revisions', true, false),
        ('service_custom_build_quote_base_lines', false, false),
        ('service_custom_build_quote_installments', false, false),
        ('service_custom_build_quote_commands', true, false),
        ('service_custom_build_quote_acceptances', true, false),
        ('service_credit_applications', false, true),
        ('service_custom_build_quote_voids', true, false)
    ),
    expected_functions(function_signature, service_role_execute) as (
      values
        ('ss.custom_build_amount_minor(text,integer)', true),
        ('ss.custom_build_payment_schedule(text)', true),
        ('ss.custom_build_scale_units(integer,integer,integer,integer,integer)', true),
        ('ss.custom_build_footprint_is_valid(text,integer,integer,integer,integer,integer,integer)', true),
        ('ss.custom_build_policy_id(text)', true),
        ('ss.custom_build_tier_label(text)', true),
        ('ss.prepare_service_custom_build_quote()', true),
        ('ss.guard_service_custom_build_quote_update()', true),
        ('ss.prepare_service_custom_build_quote_revision()', true),
        ('ss.materialize_service_custom_build_quote()', false),
        ('ss.prepare_service_custom_build_quote_command()', true),
        ('ss.validate_service_custom_build_quote_revision()', true),
        ('ss.prepare_service_custom_build_quote_acceptance()', true),
        ('ss.guard_service_credit_application()', true),
        ('ss.materialize_service_custom_build_acceptance()', false),
        ('ss.prepare_service_custom_build_quote_void()', true),
        ('ss.materialize_service_custom_build_quote_void()', false),
        ('ss.hosted_runtime_contract_v41()', true)
    ),
    expected_triggers(
      table_name,
      trigger_name,
      function_signature,
      is_deferrable
    ) as (
      values
        ('service_custom_build_quotes', 'service_custom_build_quotes_prepare', 'ss.prepare_service_custom_build_quote()', false),
        ('service_custom_build_quotes', 'service_custom_build_quotes_update_guard', 'ss.guard_service_custom_build_quote_update()', false),
        ('service_custom_build_quotes', 'service_custom_build_quotes_no_delete', 'ss.reject_update()', false),
        ('service_custom_build_quotes', 'service_custom_build_quotes_exact_revision', 'ss.validate_service_custom_build_quote_revision()', true),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_prepare', 'ss.prepare_service_custom_build_quote_revision()', false),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_materialize', 'ss.materialize_service_custom_build_quote()', false),
        ('service_custom_build_quote_revisions', 'service_custom_build_quote_revisions_exact_append', 'ss.validate_service_custom_build_quote_revision()', true),
        ('service_custom_build_quote_base_lines', 'service_custom_build_quote_base_lines_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_installments', 'service_custom_build_quote_installments_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_commands', 'service_custom_build_quote_commands_prepare', 'ss.prepare_service_custom_build_quote_command()', false),
        ('service_custom_build_quote_commands', 'service_custom_build_quote_commands_immutable', 'ss.reject_update()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_prepare', 'ss.prepare_service_custom_build_quote_acceptance()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_account_authority', 'ss.validate_service_account_authority()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_materialize', 'ss.materialize_service_custom_build_acceptance()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_payment_invoice', 'ss.materialize_service_custom_build_invoice()', false),
        ('service_custom_build_quote_acceptances', 'service_custom_build_quote_acceptances_immutable', 'ss.reject_update()', false),
        ('service_credit_applications', 'service_credit_applications_guard', 'ss.guard_service_credit_application()', false),
        ('service_custom_build_quote_voids', 'service_custom_build_quote_voids_prepare', 'ss.prepare_service_custom_build_quote_void()', false),
        ('service_custom_build_quote_voids', 'service_custom_build_quote_voids_materialize', 'ss.materialize_service_custom_build_quote_void()', false),
        ('service_custom_build_quote_voids', 'service_custom_build_quote_voids_immutable', 'ss.reject_update()', false)
    ),
    expected_policies(
      policy_id,
      tier_id,
      display_name,
      pricing_mode,
      amount_minor,
      maximum_pages,
      maximum_sections,
      maximum_layouts,
      maximum_words,
      maximum_media
    ) as (
      values
        ('00000000-0000-4000-8000-000000000411'::uuid, 'card', 'Card Custom website build', 'fixed', 40000::bigint, 1, 5, 1, 500, 2),
        ('00000000-0000-4000-8000-000000000412'::uuid, 'card-plus', 'Card Plus Custom website build', 'fixed', 65000::bigint, 1, 8, 1, 900, 8),
        ('00000000-0000-4000-8000-000000000413'::uuid, 'site', 'Site Custom website build', 'fixed', 120000::bigint, 4, 16, 4, 1800, 12),
        ('00000000-0000-4000-8000-000000000414'::uuid, 'site-plus', 'Site Plus Custom website build', 'fixed', 180000::bigint, 7, 28, 7, 3000, 24),
        ('00000000-0000-4000-8000-000000000415'::uuid, 'signature', 'Signature Custom website build', 'fixed', 280000::bigint, 10, 40, 10, 4500, 36),
        ('00000000-0000-4000-8000-000000000416'::uuid, 'flagship', 'Flagship Custom website build', 'fixed', 400000::bigint, 15, 60, 15, 7000, 60),
        ('00000000-0000-4000-8000-000000000417'::uuid, 'scale', 'Scale Custom website build', 'banded', null::bigint, 30, 120, 30, 14500, 120)
    )
    select
      ss.hosted_runtime_contract_v40() =
        'canonical-ss-v40-custom-service-assessment-delivery'
        as retained_v40_runtime_marker,
      ss.hosted_runtime_contract_v41() =
        'canonical-ss-v41-custom-build-quote-credit'
        as exact_v41_runtime_marker,
      (
        select count(*) = 8
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            ) = expected.directly_insertable
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = expected.directly_updatable
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'REFERENCES'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRIGGER'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
            and not has_table_privilege('anon', relation.oid, 'DELETE')
            and not has_table_privilege('anon', relation.oid, 'TRUNCATE')
          )
          from expected_tables expected
          join pg_class relation
            on relation.oid = format(
              'ss.%I', expected.table_name
            )::regclass
           and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      (
        select count(*) = 18
          and bool_and(procedure_record.oid is not null)
          and bool_and(
            has_function_privilege(
              'service_role', procedure_record.oid, 'EXECUTE'
            ) = expected.service_role_execute
          )
          and bool_and(not has_function_privilege(
            'authenticated', procedure_record.oid, 'EXECUTE'
          ))
          and bool_and(not has_function_privilege(
            'anon', procedure_record.oid, 'EXECUTE'
          ))
          from expected_functions expected
          join pg_proc procedure_record
            on procedure_record.oid =
              to_regprocedure(expected.function_signature)
      ) as exact_function_boundary,
      (
        select count(*) = 21
          and bool_and(not trigger_record.tgisinternal)
          and bool_and(
            trigger_record.tgdeferrable = expected.is_deferrable
          )
          and bool_and(
            trigger_record.tginitdeferred = expected.is_deferrable
          )
          and (
            select count(*)
              from pg_trigger all_trigger
             where not all_trigger.tgisinternal
               and all_trigger.tgrelid in (
                 select format(
                   'ss.%I', table_record.table_name
                 )::regclass
                   from expected_tables table_record
               )
          ) = 21
          from expected_triggers expected
          join pg_trigger trigger_record
            on trigger_record.tgrelid = format(
              'ss.%I', expected.table_name
            )::regclass
           and trigger_record.tgname = expected.trigger_name
           and trigger_record.tgfoid =
             to_regprocedure(expected.function_signature)
      ) as exact_trigger_boundary,
      (
        select count(*) = 7
          and bool_and(policy.catalog_version = 'SS-PROFESSIONAL-2026.2')
          and bool_and(
            policy.service_key =
              'custom_build_' || replace(expected.tier_id, '-', '_')
          )
          and bool_and(policy.display_name = expected.display_name)
          and bool_and(policy.pricing_mode = expected.pricing_mode)
          and bool_and(policy.billing_cadence = 'one_time')
          and bool_and(policy.currency = 'USD')
          and bool_and(
            policy.unit_amount_minor is not distinct from expected.amount_minor
          )
          and bool_and(policy.unit_label = 'base build')
          and bool_and(policy.minimum_quantity = 1)
          and bool_and(policy.maximum_quantity = 1)
          and bool_and(policy.publication_state = 'held')
          and bool_and(
            policy.scope_boundary_digest =
              ss.service_json_digest(policy.scope_boundary)
          )
          and bool_and(
            policy.scope_boundary #>> '{baseBuild,tierId}' =
              expected.tier_id
          )
          and bool_and(
            policy.scope_boundary #>> '{baseBuild,amountMinor}'
              is not distinct from expected.amount_minor::text
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,craftedPages}')::integer =
                expected.maximum_pages
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,sections}')::integer =
                expected.maximum_sections
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,uniqueLayouts}')::integer =
                expected.maximum_layouts
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,contentWords}')::integer =
                expected.maximum_words
          )
          and bool_and(
            (policy.scope_boundary #>>
              '{baseBuild,limits,suppliedMedia}')::integer =
                expected.maximum_media
          )
          and bool_and(
            policy.scope_boundary -> 'assessmentCredit' =
              jsonb_build_object(
                'amountMinor', 20000,
                'applicationScope', 'custom_base_build',
                'currency', 'USD',
                'maximumApplications', 1,
                'nonCash', true,
                'sameOrganizationAndProjectOnly', true
              )
          )
          and bool_and(
            policy.scope_boundary ->> 'publicCatalogDigest' =
              'c1259ad9efe9fd0909bf431e2f008feb8e6f1fc1e53acd0b34304312358fe1a1'
          )
          and bool_and(
            (policy.scope_boundary ->> 'workmanshipCorrectionDays')::integer = 30
          )
          and bool_and(
            policy.commercial_contract_id =
              'SS-CUSTOM-SERVICES-2026-08-05.1'
          )
          and bool_and(
            policy.commercial_contract_digest =
              '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
          )
          and bool_and((
            select count(*) = 4
              from ss.service_catalog_coverage coverage
             where coverage.policy_id = policy.id
               and coverage.boundary_digest = policy.scope_boundary_digest
               and coverage.coverage_mode = 'includes'
               and coverage.scope_identity_kind = 'project'
          ))
          and (
            select count(*) = 8
              from ss.service_catalog_policies custom_policy
             where custom_policy.service_key like 'custom_build_%'
          )
          from expected_policies expected
          join ss.service_catalog_policies policy
            on policy.id = expected.policy_id
      ) as exact_held_catalog,
      ss.custom_build_amount_minor('card', null) = 40000
        and ss.custom_build_amount_minor('card-plus', null) = 65000
        and ss.custom_build_amount_minor('site', null) = 120000
        and ss.custom_build_amount_minor('site-plus', null) = 180000
        and ss.custom_build_amount_minor('signature', null) = 280000
        and ss.custom_build_amount_minor('flagship', null) = 400000
        and ss.custom_build_amount_minor('scale', 1) = 427000
        and ss.custom_build_amount_minor('scale', 15) = 805000
        and ss.custom_build_amount_minor('scale', 0) is null
        and ss.custom_build_amount_minor('scale', 16) is null
        as exact_database_pricing,
      ss.custom_build_scale_units(16, 60, 15, 7000, 60) = 1
        and ss.custom_build_scale_units(15, 64, 15, 7000, 60) = 1
        and ss.custom_build_scale_units(15, 60, 15, 7500, 60) = 1
        and ss.custom_build_scale_units(30, 120, 30, 14500, 120) = 15
        and ss.custom_build_footprint_is_valid(
          'scale', 15, 30, 120, 30, 14500, 120
        )
        and not ss.custom_build_footprint_is_valid(
          'scale', 1, 30, 120, 30, 14500, 120
        )
        and ss.custom_build_payment_schedule('card') = 'full_before_work'
        and ss.custom_build_payment_schedule('site') =
          'half_before_work_half_before_handoff'
        as independently_derived_scale_authority,
      (
        select count(*) = 2
          and bool_and(column_record.is_nullable = 'NO')
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name = 'service_custom_build_quotes'
           and column_record.column_name in (
             'source_job_id', 'source_report_id'
           )
      )
        and exists (
          select 1
            from pg_constraint constraint_record
           where constraint_record.conrelid =
             'ss.service_custom_build_quotes'::regclass
             and constraint_record.confrelid =
               'ss.service_assessment_reports'::regclass
             and constraint_record.contype = 'f'
             and pg_get_constraintdef(constraint_record.oid) like
               '%organization_id, source_job_id, source_report_id%'
        )
        and (
          select procedure_record.prosecdef
            and lower(pg_get_functiondef(procedure_record.oid)) like
              '%from ss.service_assessment_reports report%'
            and lower(pg_get_functiondef(procedure_record.oid)) like
              '%service_quote_author%'
            and lower(pg_get_functiondef(procedure_record.oid)) like
              '%eligible delivered assessment%'
            from pg_proc procedure_record
           where procedure_record.oid =
             'ss.prepare_service_custom_build_quote()'::regprocedure
        ) as assessment_backed_quote_only,
      (
        select count(*) = 2
          and bool_and(column_record.is_generated = 'ALWAYS')
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name =
             'service_custom_build_quote_revisions'
           and column_record.column_name in (
             'quote_digest', 'disclosure_digest'
           )
      ) as immutable_revision_digests,
      (
        select procedure_record.prosecdef
          and not has_function_privilege(
            'service_role', procedure_record.oid, 'EXECUTE'
          )
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_quote_base_lines%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_quote_installments%'
          from pg_proc procedure_record
         where procedure_record.oid =
           'ss.materialize_service_custom_build_quote()'::regprocedure
      ) as normalized_line_installment_materializer,
      (
        select acceptance_materializer.prosecdef
          and acceptance_preparer.prosecdef
          and not has_function_privilege(
            'service_role', acceptance_materializer.oid, 'EXECUTE'
          )
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%claimed_quote_digest is distinct from revision_record.quote_digest%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%claimed_disclosure_digest is distinct from revision_record.disclosure_digest%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.organization_id = revision_record.organization_id%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.project_id = revision_record.project_id%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.credit_digest = revision_record.credit_digest%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%credit.acceptance_cutoff = revision_record.credit_acceptance_cutoff%'
          and lower(pg_get_functiondef(acceptance_preparer.oid)) like
            '%for update of credit%'
          and lower(pg_get_functiondef(acceptance_materializer.oid)) like
            '%insert into ss.service_credit_applications%'
          and lower(pg_get_functiondef(acceptance_materializer.oid)) like
            '%''reserved''%'
          and lower(pg_get_functiondef(acceptance_materializer.oid)) like
            '%update ss.service_custom_build_quotes%'
          from pg_proc acceptance_preparer
          cross join pg_proc acceptance_materializer
         where acceptance_preparer.oid =
           'ss.prepare_service_custom_build_quote_acceptance()'::regprocedure
           and acceptance_materializer.oid =
             'ss.materialize_service_custom_build_acceptance()'::regprocedure
      ) as exact_atomic_customer_reservation,
      exists (
        select 1
          from pg_index index_record
          join pg_class index_relation
            on index_relation.oid = index_record.indexrelid
         where index_relation.relnamespace = 'ss'::regnamespace
           and index_relation.relname =
             'service_credit_applications_one_active_grant'
           and index_record.indrelid =
             'ss.service_credit_applications'::regclass
           and index_record.indisunique
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%reserved%'
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%settled%'
           and pg_get_expr(
             index_record.indpred,
             index_record.indrelid
           ) like '%reconciliation_required%'
      ) as one_active_credit_application,
      (
        select void_preparer.prosecdef
          and void_materializer.prosecdef
          and credit_guard.prosecdef is false
          and lower(pg_get_functiondef(void_preparer.oid)) like
            '%application_record.state <> ''reserved''%'
          and lower(pg_get_functiondef(void_preparer.oid)) like
            '%cannot release a consumed or uncertain credit%'
          and lower(pg_get_functiondef(void_materializer.oid)) like
            '%state = ''released''%'
          and lower(pg_get_functiondef(void_materializer.oid)) like
            '%and state = ''reserved''%'
          and lower(pg_get_functiondef(credit_guard.oid)) like
            '%service_operator_has_capability%'
          and lower(pg_get_functiondef(credit_guard.oid)) like
            '%service_custom_build_quote_voids%'
          from pg_proc void_preparer
          cross join pg_proc void_materializer
          cross join pg_proc credit_guard
         where void_preparer.oid =
           'ss.prepare_service_custom_build_quote_void()'::regprocedure
           and void_materializer.oid =
             'ss.materialize_service_custom_build_quote_void()'::regprocedure
           and credit_guard.oid =
             'ss.guard_service_credit_application()'::regprocedure
      ) as safe_operator_void_release,
      (
        select count(*) = 1
          from information_schema.columns column_record
         where column_record.table_schema = 'ss'
           and column_record.table_name =
             'service_custom_build_quote_revisions'
           and column_record.column_name = 'tax_state'
           and column_record.column_default is null
      )
        and exists (
          select 1
            from pg_constraint constraint_record
           where constraint_record.conrelid =
             'ss.service_custom_build_quote_revisions'::regclass
             and constraint_record.contype = 'c'
             and pg_get_constraintdef(constraint_record.oid) like
               '%tax_state%calculation_required%'
        )
        and not exists (
          select 1
            from information_schema.columns column_record
           where column_record.table_schema = 'ss'
             and column_record.table_name in (
               select table_name from expected_tables
             )
             and column_record.column_name in ('tax_minor', 'total_minor')
        )
        and not exists (
          select 1
            from expected_functions expected
            join pg_proc procedure_record
              on procedure_record.oid =
                to_regprocedure(expected.function_signature)
           where lower(pg_get_functiondef(procedure_record.oid)) ~
             '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+ss\\.(service_invoices|service_invoice_lines|service_payment_reservations|service_assessment_jobs|alakazam_[a-z_]+)'
        ) as no_tax_job_payment_or_provider_effect,
      not exists (
        select 1
          from pg_constraint constraint_record
         where constraint_record.conrelid in (
           select format('ss.%I', table_name)::regclass
             from expected_tables
         )
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(customBuildQuoteCredit.rows[0])) {
    assert.equal(
      ready,
      true,
      `custom build quote/credit migration contract failed: ${name}`
    );
  }

  const customBuildStartPayment = await pool.query(`
    with expected_tables(table_name, insertable, updatable) as (
      values
        ('service_custom_build_invoices', false, false),
        ('service_custom_build_invoice_lines', false, false),
        ('service_custom_build_checkout_attempts', true, true),
        ('service_custom_build_stripe_events', true, true),
        ('service_custom_build_payment_receipts', true, false),
        ('service_custom_build_jobs', true, false)
    )
    select
      ss.hosted_runtime_contract_v42() =
        'canonical-ss-v42-custom-build-start-payment'
        as exact_v42_runtime_marker,
      (
        select count(*) = 6
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            ) = expected.insertable
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = expected.updatable
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
          )
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
         and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      not has_function_privilege(
        'service_role',
        'ss.ensure_service_custom_build_invoice(uuid)',
        'EXECUTE'
      ) and not has_function_privilege(
        'service_role',
        'ss.materialize_service_custom_build_invoice()',
        'EXECUTE'
      ) as materialization_not_directly_callable,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%revision.start_due_minor > 0%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%application.state = ''reserved''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%accepted.accepted_at + interval ''7 days''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_invoice_lines%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.ensure_service_custom_build_invoice(uuid)'::regprocedure
      ) as exact_invoice_materialization,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_custom_build_quote_acceptances'::regclass
          and trigger_record.tgname =
            'service_custom_build_quote_acceptances_payment_invoice'
          and trigger_record.tgfoid =
            'ss.materialize_service_custom_build_invoice()'::regprocedure
          and not trigger_record.tgisinternal
      ) as acceptance_materializes_invoice,
      exists (
        select 1
        from pg_index index_record
        join pg_class index_relation
          on index_relation.oid = index_record.indexrelid
        where index_relation.relnamespace = 'ss'::regnamespace
          and index_relation.relname =
            'service_custom_build_checkout_one_active'
          and index_record.indisunique
          and pg_get_expr(
            index_record.indpred, index_record.indrelid
          ) like '%provider_pending%'
          and pg_get_expr(
            index_record.indpred, index_record.indrelid
          ) like '%persistence_unknown%'
          and pg_get_expr(
            index_record.indpred, index_record.indrelid
          ) like '%paid%'
      ) as one_active_checkout,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%current_service_actor_kind() <> ''customer''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%invoice.payment_deadline > clock_timestamp()%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%old.state = ''ready''%new.state = ''paid''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_checkout_attempt()'::regprocedure
      ) as exact_checkout_transition_guard,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.state = ''settled''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_payment_receipts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.state = ''reconciliation_required''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_stripe_events%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_credit_application()'::regprocedure
      ) as exact_credit_payment_transitions,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_checkout_attempts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%attempt.state not in (''failed'', ''expired'')%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_payment_receipts%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.prepare_service_custom_build_quote_void()'::regprocedure
      ) as provider_effect_blocks_credit_release,
      exists (
        select 1 from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_jobs'::regclass
          and constraint_record.contype = 'c'
          and pg_get_constraintdef(constraint_record.oid) like
            '%final_due_minor%final_payment_state%'
      ) as job_retains_final_handoff_amount,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid in (
          select format('ss.%I', table_name)::regclass
          from expected_tables
        )
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(customBuildStartPayment.rows[0])) {
    assert.equal(
      ready,
      true,
      `Custom build start-payment migration contract failed: ${name}`
    );
  }

  const customBuildProgress = await pool.query(`
    with expected_tables(table_name, updatable) as (
      values
        ('service_custom_build_progress_updates', false),
        ('service_custom_build_work_requests', true)
    )
    select
      ss.hosted_runtime_contract_v43() =
        'canonical-ss-v43-custom-build-progress'
        as exact_v43_runtime_marker,
      (
        select count(*) = 2
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege('service_role', relation.oid, 'INSERT')
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = expected.updatable
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
          )
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
         and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      exists (
        select 1
        from pg_index index_record
        join pg_class index_relation
          on index_relation.oid = index_record.indexrelid
        where index_relation.relnamespace = 'ss'::regnamespace
          and index_relation.relname =
            'service_custom_build_work_requests_one_active'
          and index_record.indisunique
          and pg_get_expr(
            index_record.indpred, index_record.indrelid
          ) like '%state = ANY%open%answered%'
      ) as one_active_customer_request,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%custom build progress cannot move backward%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%expected_revision <> coalesce(prior_update.revision, 0)%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_job_manage%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.prepare_service_custom_build_progress_update()'::regprocedure
      ) as monotonic_progress_authority,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%current_service_actor_kind() = ''customer''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%old.state <> ''open''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.state <> ''answered''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.state in (''resolved'', ''withdrawn'')%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_work_request()'::regprocedure
      ) as exact_request_transitions,
      has_table_privilege(
        'service_role', 'ss.service_access_requests', 'INSERT'
      ) and not has_table_privilege(
        'service_role', 'ss.service_access_requests', 'UPDATE'
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_access_requests'::regclass
          and trigger_record.tgname =
            'service_access_requests_custom_build_guard'
          and trigger_record.tgfoid =
            'ss.guard_service_custom_build_access_request()'::regprocedure
          and not trigger_record.tgisinternal
      ) as bounded_delegated_access_authority,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid in (
          select format('ss.%I', table_name)::regclass
          from expected_tables
        )
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(customBuildProgress.rows[0])) {
    assert.equal(
      ready,
      true,
      `Custom build progress migration contract failed: ${name}`
    );
  }

  const customBuildChangeCompletion = await pool.query(`
    with expected_tables(table_name, updatable) as (
      values
        ('service_custom_build_change_orders', true),
        ('service_custom_build_change_acceptances', false),
        ('service_custom_build_change_declines', false),
        ('service_custom_build_change_voids', false),
        ('service_custom_build_change_expirations', false),
        ('service_custom_build_completion_evidence', false),
        ('service_custom_build_completion_packages', false)
    )
    select
      ss.hosted_runtime_contract_v44() =
        'canonical-ss-v44-custom-build-change-completion'
        as exact_v44_runtime_marker,
      (
        select count(*) = 1
          from ss.service_catalog_policies policy
          join ss.legal_documents document
            on document.id = policy.legal_document_id
         where policy.id = '00000000-0000-4000-8000-000000000441'
           and policy.catalog_version = 'SS-PROFESSIONAL-2026.3'
           and policy.service_key = 'custom_build_change_unit'
           and policy.pricing_mode = 'unit'
           and policy.billing_cadence = 'one_time'
           and policy.currency = 'USD'
           and policy.unit_amount_minor = 12500
           and policy.minimum_quantity = 1
           and policy.maximum_quantity = 40
           and policy.publication_state = 'held'
           and policy.scope_boundary ->> 'addedWorkOnly' = 'true'
           and policy.scope_boundary ->> 'originalScopeRemains' = 'true'
           and policy.scope_boundary ->> 'assessmentCreditApplied' = 'false'
           and policy.scope_boundary ->> 'cashRefund' = 'false'
           and policy.scope_boundary ->> 'negativeLine' = 'false'
           and policy.scope_boundary ->> 'unitAmountMinor' = '12500'
           and document.kind = 'custom_services'
           and document.version = 'SS-CUSTOM-SERVICES-2026-08-05.1'
           and document.content_digest =
             '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
           and (
             select count(*) = 1
               from ss.service_catalog_coverage coverage
              where coverage.policy_id = policy.id
                and coverage.coverage_key = 'custom_build_added_work'
                and coverage.coverage_mode = 'includes'
                and coverage.scope_identity_kind = 'project'
                and coverage.boundary_digest = policy.scope_boundary_digest
           )
      ) as exact_held_change_unit,
      (
        select count(*) = 7
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege('service_role', relation.oid, 'INSERT')
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = expected.updatable
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
          )
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
         and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      exists (
        select 1
        from pg_index index_record
        join pg_class index_relation
          on index_relation.oid = index_record.indexrelid
        where index_relation.relnamespace = 'ss'::regnamespace
          and index_relation.relname =
            'service_custom_build_change_orders_one_active'
          and index_record.indisunique
          and pg_get_expr(
            index_record.indpred, index_record.indrelid
          ) like '%issued%accepted_payment_required%'
      ) as one_active_change_order,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%unit_count not between 1 and 40%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%requested_expires_at > recorded_at + interval ''14 days''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_quote_author%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_effective_scope_snapshot%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.prepare_service_custom_build_change_order()'::regprocedure
      ) as bounded_change_issue_authority,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%selected_change.expires_at <= recorded_at%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%accepted_exact_change_order_and_payment_requirement%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%accepted_quote_digest%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%accepted_disclosure_digest%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.prepare_service_custom_build_change_acceptance()'::regprocedure
      ) as exact_customer_acceptance,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%recorded_at < selected_change.expires_at%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_quote_author%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%expired_quote_digest%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.prepare_service_custom_build_change_expiration()'::regprocedure
      ) as exact_expiration_authority,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%document_kind = ''job_evidence''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_job_manage%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%/custom-build-jobs/%/evidence/%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%document_kind = ''handoff''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_handoff_receipts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.media_type <> ''application/json''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_assessment_document()'::regprocedure
      ) as bounded_existing_job_evidence_and_handoff_kinds,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%selected_progress.stage <> ''checking''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%document.byte_count between 1 and 716800%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.progress_revision := selected_progress.revision%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.effective_scope_digest := scope_snapshot.effective_scope_digest%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service-image-evidence/v1%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_completion_evidence()'::regprocedure
      ) as current_bounded_completion_evidence,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%ss-custom-build-h1m:%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_completion_packages%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_after_completion()'::regprocedure
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgname =
          'service_custom_build_progress_updates_completion_guard'
          and not trigger_record.tgisinternal
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgname =
          'service_custom_build_work_requests_completion_guard'
          and not trigger_record.tgisinternal
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgname =
          'service_access_requests_custom_build_completion_guard'
          and not trigger_record.tgisinternal
      ) as completion_closes_work_writes,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%selected_progress.stage <> ''checking''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%structure_milestone <> ''done''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%content_milestone <> ''done''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%responsive_milestone <> ''done''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%quality_milestone <> ''done''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%request.state in (''open'', ''answered'')%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%''issued'', ''accepted_payment_required''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%includes_desktop%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%includes_phone%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%evidence.progress_revision = selected_progress.revision%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%phone_evidence.content_digest = desktop_evidence.content_digest%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_completion_package()'::regprocedure
      ) as exact_completion_gate,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid in (
          select format('ss.%I', table_name)::regclass
          from expected_tables
        )
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (
    const [name, ready] of Object.entries(
      customBuildChangeCompletion.rows[0]
    )
  ) {
    assert.equal(
      ready,
      true,
      `Custom build change/completion migration contract failed: ${name}`
    );
  }

  const customBuildChangePayment = await pool.query(`
    with expected_tables(table_name, insertable, updatable) as (
      values
        ('service_custom_build_change_invoices', false, false),
        ('service_custom_build_change_invoice_lines', false, false),
        ('service_custom_build_change_checkout_attempts', true, true),
        ('service_custom_build_change_reconciliation_commands', true, true),
        ('service_custom_build_change_stripe_events', true, true),
        ('service_custom_build_change_payment_receipts', true, false)
    )
    select
      ss.hosted_runtime_contract_v45() =
        'canonical-ss-v45-custom-build-change-payment'
        as exact_v45_runtime_marker,
      (
        select count(*) = 6
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            ) = expected.insertable
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = expected.updatable
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
          )
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
         and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_change_invoices'::regclass
          and constraint_record.contype = 'u'
          and pg_get_constraintdef(constraint_record.oid) =
            'UNIQUE (change_order_id)'
      ) and exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_change_invoices'::regclass
          and constraint_record.contype = 'u'
          and pg_get_constraintdef(constraint_record.oid) =
            'UNIQUE (change_acceptance_id)'
      ) as one_invoice_per_accepted_change,
      exists (
        select 1
        from pg_index index_record
        join pg_class index_relation
          on index_relation.oid = index_record.indexrelid
        where index_relation.relnamespace = 'ss'::regnamespace
          and index_relation.relname =
            'service_custom_build_change_checkout_one_active'
          and index_record.indisunique
          and pg_get_expr(
            index_record.indpred, index_record.indrelid
          ) like '%provider_pending%ready%persistence_unknown%paid%'
      ) as one_active_change_checkout,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_change_checkout_attempts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%provider_pending%ready%persistence_unknown%paid%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_change_stripe_events%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_change_payment_receipts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%receipt.change_order_id = selected_change_order_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) not like
            '%return false%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.service_custom_build_change_has_payment_evidence(uuid)'::regprocedure
      ) as named_payment_evidence_gate,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%old.state = ''accepted_payment_required''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.state = ''effective''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_change_payment_receipts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%current_service_actor_kind() in (''system'', ''operator'')%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%assert_service_custom_build_change_payment_lock(old.job_id)%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_change_order_update()'::regprocedure
      ) as provider_receipt_only_effective_transition,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%change_order.state = ''accepted_payment_required''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%attempt.state = ''ready''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%event.state in (''pending'', ''reconciliation_required'')%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%attempt.purpose_digest = new.purpose_digest%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%invoice.change_acceptance_id = new.change_acceptance_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%custom_build_change_provider_facts_digest(%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%jsonb_object_keys(new.provider_facts)%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.receipt_source = ''provider_readback''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%assert_service_custom_build_change_payment_lock(new.job_id)%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_change_payment_receipt()'::regprocedure
      ) as exact_receipt_binding,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%from pg_catalog.pg_locks held%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%held.pid = pg_catalog.pg_backend_pid()%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%held.mode = ''exclusivelock''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.assert_service_custom_build_change_payment_lock(uuid)'::regprocedure
      ) as mutation_requires_preheld_job_lock,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_payment_reconcile%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%assert_service_custom_build_change_payment_lock(new.job_id)%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_change_reconciliation_command()'::regprocedure
      ) as durable_owner_reconciliation_command,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_custom_build_change_payment_receipts'::regclass
          and trigger_record.tgname =
            'service_custom_build_change_payment_materialize'
          and not trigger_record.tgisinternal
      ) and (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%set state = ''effective''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%set state = ''paid''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%state = ''processed''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.materialize_service_custom_build_change_payment()'::regprocedure
      ) as atomic_receipt_materialization,
      not has_function_privilege(
        'service_role',
        'ss.ensure_service_custom_build_change_invoice(uuid)',
        'EXECUTE'
      ) as invoice_materializer_not_directly_callable,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid in (
          select format('ss.%I', table_name)::regclass
          from expected_tables
        )
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (
    const [name, ready] of Object.entries(
      customBuildChangePayment.rows[0]
    )
  ) {
    assert.equal(
      ready,
      true,
      `Custom build change-payment migration contract failed: ${name}`
    );
  }

  const customBuildFinalPayment = await pool.query(`
    with expected_tables(table_name, insertable, updatable) as (
      values
        ('service_custom_build_stripe_payment_claims', false, false),
        ('service_custom_build_final_obligations', false, false),
        ('service_custom_build_final_invoices', false, false),
        ('service_custom_build_final_invoice_lines', false, false),
        ('service_custom_build_final_zero_balance_clearances', false, false),
        ('service_custom_build_final_checkout_attempts', true, true),
        ('service_custom_build_final_reconciliation_commands', true, true),
        ('service_custom_build_final_stripe_events', true, true),
        ('service_custom_build_final_payment_receipts', true, false)
    )
    select
      ss.hosted_runtime_contract_v46() =
        'canonical-ss-v46-custom-build-final-payment'
        as exact_v46_runtime_marker,
      (
        select count(*) = 9
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(
            has_table_privilege('service_role', relation.oid, 'SELECT')
            and has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            ) = expected.insertable
            and has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) = expected.updatable
            and not has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            )
            and not has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            )
            and not has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            )
            and not has_table_privilege('anon', relation.oid, 'SELECT')
            and not has_table_privilege('anon', relation.oid, 'INSERT')
            and not has_table_privilege('anon', relation.oid, 'UPDATE')
          )
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
         and relation.relkind = 'r'
      ) as exact_table_security_boundary,
      (
        select count(*) = 2
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_stripe_payment_claims'::regclass
          and constraint_record.contype = 'u'
          and pg_get_constraintdef(constraint_record.oid) in (
            'UNIQUE (provider, provider_object_kind, provider_object_id)',
            'UNIQUE (purpose, authority_kind, authority_id, provider_object_kind)'
          )
      ) as both_global_claim_axes,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%provider_object_id = selected_provider_object_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%authority_id = selected_authority_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%when unique_violation%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%re-resolve both axes once%'
          and lower(pg_get_functiondef(procedure_record.oid)) not like
            '% loop%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.claim_service_custom_build_stripe_payment_effect(uuid,text,text,text,text,text,timestamp with time zone)'::regprocedure
      ) as bounded_dual_axis_claim_resolution,
      (
        select count(*) = 9
        from pg_trigger trigger_record
        join pg_class relation on relation.oid = trigger_record.tgrelid
        where relation.relnamespace = 'ss'::regnamespace
          and trigger_record.tgname in (
            'service_custom_build_start_checkout_session_claim',
            'service_custom_build_change_checkout_session_claim',
            'service_custom_build_final_checkout_session_claim',
            'service_custom_build_start_stripe_event_claim',
            'service_custom_build_change_stripe_event_claim',
            'service_custom_build_final_stripe_event_claim',
            'service_custom_build_start_payment_receipt_claim',
            'service_custom_build_change_payment_receipt_claim',
            'service_custom_build_final_payment_receipt_claim'
          )
          and not trigger_record.tgisinternal
      ) as all_three_payment_purposes_claimed,
      (
        select count(*) = 1
        from information_schema.columns column_record
        where column_record.table_schema = 'ss'
          and column_record.table_name =
            'service_custom_build_final_obligations'
          and column_record.column_name = 'obligation_digest'
          and column_record.is_generated = 'ALWAYS'
          and column_record.generation_expression like
            '%custom_build_final_obligation_digest%'
      ) as database_generated_obligation_digest,
      (
        select count(*) = 1
          and bool_and(
            lower(pg_get_functiondef(procedure_record.oid)) like
              '%''customeruserid'', customer_user_id%'
          )
        from pg_proc procedure_record
        where procedure_record.pronamespace = 'ss'::regnamespace
          and procedure_record.proname =
            'custom_build_final_obligation_digest'
      ) as customer_bound_obligation_digest,
      (
        exists (
          select 1
          from pg_constraint constraint_record
          where constraint_record.conrelid = 'ss.stripe_customers'::regclass
            and constraint_record.conname =
              'stripe_customers_organization_stripe_customer_unique'
            and constraint_record.contype = 'u'
        )
        and exists (
          select 1
          from pg_constraint constraint_record
          where constraint_record.conrelid =
            'ss.service_custom_build_final_payment_receipts'::regclass
            and constraint_record.conname =
              'service_custom_build_final_receipt_stripe_customer_org_fk'
            and constraint_record.contype = 'f'
            and lower(pg_get_constraintdef(constraint_record.oid)) like
              '%foreign key (organization_id, stripe_customer_id)%references ss.stripe_customers(organization_id, stripe_customer_id)%'
        )
      ) as organization_bound_stripe_customer_receipt,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%select package.job_id into discovered_job_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%ss-custom-build-h1m:%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%revision_final_due_minor is distinct from source.final_due_minor%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%installment_credit_minor <> 0%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_final_invoices%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_final_zero_balance_clearances%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.ensure_service_custom_build_final_obligation(uuid)'::regprocedure
      ) as exact_completion_obligation_materializer,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_custom_build_completion_packages'::regclass
          and trigger_record.tgname =
            'service_custom_build_completion_final_obligation'
          and not trigger_record.tgisinternal
      ) as completion_bound_materialization,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%chargecaptured%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%amountrefundedminor%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%disputed%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%attempt.state = ''ready''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%line.component_key = ''custom_build_final_installment''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%custom_build_final_provider_facts_digest%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_final_payment_receipt()'::regprocedure
      ) as captured_unrefunded_uncontested_receipt,
      not has_function_privilege(
        'service_role',
        'ss.ensure_service_custom_build_final_obligation(uuid)',
        'EXECUTE'
      ) and not has_function_privilege(
        'service_role',
        'ss.claim_service_custom_build_stripe_payment_effect(uuid,text,text,text,text,text,timestamp with time zone)',
        'EXECUTE'
      ) as trigger_only_materialization_authority,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid in (
          select format('ss.%I', table_name)::regclass
          from expected_tables
        )
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (
    const [name, ready] of Object.entries(
      customBuildFinalPayment.rows[0]
    )
  ) {
    assert.equal(
      ready,
      true,
      `Custom build final-payment migration contract failed: ${name}`
    );
  }

  const customBuildHandoff = await pool.query(`
    select
      ss.hosted_runtime_contract_v47() =
        'canonical-ss-v47-custom-build-handoff'
        as exact_v47_runtime_marker,
      (
        select relation.relrowsecurity
          and relation.relforcerowsecurity
          and has_table_privilege(
            'service_role', relation.oid, 'SELECT'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'INSERT'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'UPDATE'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'DELETE'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'TRUNCATE'
          )
          and not has_table_privilege(
            'authenticated', relation.oid, 'SELECT'
          )
          and not has_table_privilege(
            'authenticated', relation.oid, 'INSERT'
          )
          and not has_table_privilege('anon', relation.oid, 'SELECT')
          and not has_table_privilege('anon', relation.oid, 'INSERT')
        from pg_class relation
        where relation.oid =
          'ss.service_custom_build_handoff_receipts'::regclass
      ) as exact_append_only_table_security,
      (
        select count(*) = 1
        from information_schema.columns column_record
        where column_record.table_schema = 'ss'
          and column_record.table_name =
            'service_custom_build_handoff_receipts'
          and column_record.column_name = 'handoff_digest'
          and column_record.is_generated = 'ALWAYS'
          and column_record.generation_expression like
            '%service_custom_build_handoff_digest%'
      ) as database_generated_handoff_digest,
      (
        select count(*) = 7
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_handoff_receipts'::regclass
          and constraint_record.contype = 'u'
          and pg_get_constraintdef(constraint_record.oid) in (
            'UNIQUE (job_id)',
            'UNIQUE (completion_package_id)',
            'UNIQUE (final_obligation_id)',
            'UNIQUE (final_payment_receipt_id)',
            'UNIQUE (zero_balance_clearance_id)',
            'UNIQUE (document_id)',
            'UNIQUE (handed_off_by_operator_user_id, job_id, command_id)'
          )
      ) as one_handoff_and_durable_command_axes,
      (
        select count(*) = 2
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_handoff_receipts'::regclass
          and constraint_record.contype = 'f'
          and constraint_record.condeferrable
          and constraint_record.condeferred
          and constraint_record.confrelid in (
            'ss.service_documents'::regclass,
            'ss.service_document_payloads'::regclass
          )
      ) as deferred_atomic_document_identity,
      (
        select
          procedure_record.prosecdef
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%select job.id into discovered_job_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%ss-custom-build-h1m:%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_job_manage%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_document_manage%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%request_digest is distinct from%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%expected_completion_package_digest%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%expected_final_obligation_digest%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_final_payment_receipts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_final_zero_balance_clearances%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%command.state = ''running''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%attempt.state in (%''provider_pending'', ''ready'', ''persistence_unknown''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%event.state in (''pending'', ''reconciliation_required'')%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_custom_build_handoff_receipts%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_documents%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%insert into ss.service_document_payloads%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%/custom-build-jobs/%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%/handoff/%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%selected_document_id::text%''.json''%'
          and lower(pg_get_functiondef(procedure_record.oid)) not like
            '%checkout_session_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) not like
            '%payment_intent_id%'
          and lower(pg_get_functiondef(procedure_record.oid)) not like
            '%stripe_customer_id%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.create_service_custom_build_handoff(uuid,text,uuid,ss.sha256_hex,ss.sha256_hex,text,jsonb)'::regprocedure
      ) as exact_atomic_handoff_callable,
      has_function_privilege(
        'service_role',
        'ss.create_service_custom_build_handoff(uuid,text,uuid,ss.sha256_hex,ss.sha256_hex,text,jsonb)',
        'EXECUTE'
      ) and not has_function_privilege(
        'authenticated',
        'ss.create_service_custom_build_handoff(uuid,text,uuid,ss.sha256_hex,ss.sha256_hex,text,jsonb)',
        'EXECUTE'
      ) and not has_function_privilege(
        'anon',
        'ss.create_service_custom_build_handoff(uuid,text,uuid,ss.sha256_hex,ss.sha256_hex,text,jsonb)',
        'EXECUTE'
      ) as owner_service_only_callable,
      ss.service_custom_build_workmanship_end(
        '2026-03-01T12:00:00-05'::timestamptz
      ) - '2026-03-01T12:00:00-05'::timestamptz =
        interval '720 hours'
      and ss.service_custom_build_workmanship_end(
        '2026-10-15T12:00:00-04'::timestamptz
      ) - '2026-10-15T12:00:00-04'::timestamptz =
        interval '720 hours'
        as exact_elapsed_workmanship_across_dst,
      (
        select count(*) = 4
        from pg_trigger trigger_record
        where trigger_record.tgname in (
          'service_custom_build_progress_updates_00_handoff_guard',
          'service_custom_build_work_requests_00_handoff_guard',
          'service_access_requests_00_custom_build_handoff_guard',
          'service_custom_build_final_checkout_00_handoff_guard'
        )
          and not trigger_record.tgisinternal
      ) as explicit_post_handoff_closure,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%document_kind = ''job_evidence''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%document_kind = ''handoff''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.media_type <> ''application/json''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%new.byte_count not between 1 and 65536%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_handoff_receipts%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_assessment_document()'::regprocedure
      ) as narrow_receipt_bound_document_guard,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%convert_from(new.payload, ''utf8'')::jsonb%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%service_custom_build_handoff_canonical_json(decoded_payload)%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%<> new.payload%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%octet_length(new.payload) not between 1 and 65536%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.guard_service_custom_build_completion_payload()'::regprocedure
      ) as canonical_bounded_json_payload_guard,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_custom_build_handoff_receipts'::regclass
          and trigger_record.tgname =
            'service_custom_build_handoff_receipts_immutable'
          and not trigger_record.tgisinternal
      ) as immutable_handoff_receipt,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_custom_build_handoff_receipts'::regclass
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retention_safe_foreign_keys
  `);
  for (const [name, ready] of Object.entries(customBuildHandoff.rows[0])) {
    assert.equal(
      ready,
      true,
      `Custom build handoff migration contract failed: ${name}`
    );
  }
  const alakazam50 = await pool.query(`
    with expected_tables(table_name) as (
      values
        ('alakazam_50_care_requests'),
        ('alakazam_50_configurations')
    ), expected_triggers(
      table_name, trigger_name, function_name,
      constraint_trigger, deferrable_trigger, initially_deferred
    ) as (
      values
        ('alakazam_50_care_requests', 'alakazam_50_care_requests_immutable', 'reject_alakazam_50_evidence_mutation', false, false, false),
        ('alakazam_50_care_requests', 'alakazam_50_care_requests_validate', 'validate_alakazam_50_care_request', true, true, true),
        ('alakazam_50_configurations', 'alakazam_50_configurations_immutable', 'reject_alakazam_50_evidence_mutation', false, false, false),
        ('alakazam_50_configurations', 'alakazam_50_configurations_validate', 'validate_alakazam_50_configuration', true, true, true)
    )
    select
      ss.hosted_alakazam_50_contract() =
        'canonical-alakazam-50-held-v1'
        as exact_runtime_marker,
      (
        select count(*) = 2
          and bool_and(relation.relkind = 'r')
          and bool_and(relation.relpersistence = 'p')
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(has_table_privilege(
            'service_role', relation.oid, 'SELECT'
          ))
          and bool_and(has_table_privilege(
            'service_role', relation.oid, 'INSERT'
          ))
          and bool_and(not has_table_privilege(
            'service_role', relation.oid, 'UPDATE'
          ))
          and bool_and(not has_table_privilege(
            'service_role', relation.oid, 'DELETE'
          ))
          and bool_and(not has_table_privilege(
            'authenticated', relation.oid, 'SELECT'
          ))
          and bool_and(not has_table_privilege(
            'anon', relation.oid, 'SELECT'
          ))
          and bool_and(not exists (
            select 1 from pg_policy policy
             where policy.polrelid = relation.oid
          ))
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
      ) as exact_append_only_table_security,
      (
        select count(*) = 4
          and bool_and(trigger_record.tgenabled = 'O')
          and bool_and(
            (trigger_record.tgconstraint <> 0) = expected.constraint_trigger
          )
          and bool_and(
            trigger_record.tgdeferrable = expected.deferrable_trigger
          )
          and bool_and(
            trigger_record.tginitdeferred = expected.initially_deferred
          )
        from expected_triggers expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
        join pg_trigger trigger_record
          on trigger_record.tgrelid = relation.oid
         and trigger_record.tgname = expected.trigger_name
         and not trigger_record.tgisinternal
        join pg_proc function_record
          on function_record.oid = trigger_record.tgfoid
         and function_record.proname = expected.function_name
      ) as exact_trigger_set,
      (
        select count(*) = 8
          and bool_and(constraint_record.confdeltype <> 'c')
        from pg_constraint constraint_record
       where constraint_record.conrelid in (
         'ss.alakazam_50_configurations'::regclass,
         'ss.alakazam_50_care_requests'::regclass
       )
         and constraint_record.contype = 'f'
      ) as exact_non_cascading_foreign_keys,
      not has_function_privilege(
        'authenticated',
        'ss.validate_alakazam_50_subscription_authority(uuid,uuid,uuid,uuid,bigint)',
        'EXECUTE'
      ) and not has_function_privilege(
        'anon',
        'ss.hosted_alakazam_50_contract()',
        'EXECUTE'
      ) and has_function_privilege(
        'service_role',
        'ss.valid_alakazam_50_menu(jsonb)',
        'EXECUTE'
      ) as exact_function_security
  `);
  for (const [name, ready] of Object.entries(alakazam50.rows[0])) {
    assert.equal(
      ready,
      true,
      `Alakazam 50 migration contract failed: ${name}`
    );
  }

  const alakazamPublication = await pool.query(`
    select
      ss.hosted_alakazam_publication_contract() =
        'canonical-alakazam-customer-publication-held-v1'
        as exact_runtime_marker,
      (
        select relation.relrowsecurity
          and relation.relforcerowsecurity
          and has_table_privilege(
            'service_role', relation.oid, 'SELECT'
          )
          and has_table_privilege(
            'service_role', relation.oid, 'INSERT'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'UPDATE'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'DELETE'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'TRUNCATE'
          )
          and not has_table_privilege(
            'authenticated', relation.oid, 'SELECT'
          )
          and not has_table_privilege(
            'authenticated', relation.oid, 'INSERT'
          )
          and not has_table_privilege('anon', relation.oid, 'SELECT')
          and not has_table_privilege('anon', relation.oid, 'INSERT')
        from pg_class relation
        where relation.oid =
          'ss.alakazam_customer_publication_commands'::regclass
      ) as exact_held_table_security,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.alakazam_customer_publication_commands'::regclass
          and trigger_record.tgname =
            'alakazam_customer_publication_commands_validate'
          and trigger_record.tgconstraint <> 0
          and not trigger_record.tgisinternal
      ) as deferred_authority_validation,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.alakazam_customer_publication_commands'::regclass
          and trigger_record.tgname =
            'alakazam_customer_publication_commands_immutable'
          and not trigger_record.tgisinternal
      ) as immutable_command_evidence,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%subscription.status in (''active'', ''grace'')%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%subscription.revision = new.subscription_revision%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%version_state.state = ''accepted_release''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%operation.state = ''published''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.validate_alakazam_customer_publication_command()'::regprocedure
      ) as exact_active_revision_and_history_authority,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.alakazam_customer_publication_commands'::regclass
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as retained_command_evidence
  `);
  for (
    const [name, ready] of Object.entries(
      alakazamPublication.rows[0]
    )
  ) {
    assert.equal(
      ready,
      true,
      `Alakazam publication migration contract failed: ${name}`
    );
  }

  const publicationControls = await pool.query(`
    select
      ss.hosted_publication_control_contract() =
        'canonical-publication-control-held-v1'
        as exact_runtime_marker,
      (
        select relation.relrowsecurity
          and relation.relforcerowsecurity
          and has_table_privilege(
            'service_role', relation.oid, 'SELECT'
          )
          and has_table_privilege(
            'service_role', relation.oid, 'INSERT'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'UPDATE'
          )
          and not has_table_privilege(
            'service_role', relation.oid, 'DELETE'
          )
          and not has_table_privilege(
            'authenticated', relation.oid, 'SELECT'
          )
          and not has_table_privilege(
            'anon', relation.oid, 'INSERT'
          )
          and not exists (
            select 1 from pg_policy policy
             where policy.polrelid = relation.oid
          )
        from pg_class relation
        where relation.oid =
          'ss.publication_control_commands'::regclass
      ) as exact_held_table_security,
      exists (
        select 1
          from pg_trigger trigger_record
         where trigger_record.tgrelid =
           'ss.publication_control_commands'::regclass
           and trigger_record.tgname =
             'publication_control_commands_validate'
           and trigger_record.tgconstraint <> 0
           and trigger_record.tgdeferrable
           and trigger_record.tginitdeferred
           and not trigger_record.tgisinternal
      ) as deferred_exact_authority_validation,
      exists (
        select 1
          from pg_trigger trigger_record
         where trigger_record.tgrelid =
           'ss.publication_control_commands'::regclass
           and trigger_record.tgname =
             'publication_control_commands_immutable'
           and not trigger_record.tgisinternal
      ) as immutable_command_evidence,
      (
        select
          lower(pg_get_functiondef(procedure_record.oid)) like
            '%subscription.revision = new.entitlement_revision%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%operation.capability = new.capability%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%version_state.state = ''accepted_release''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%screening.stage = ''pre_publication''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%screening.passed%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%address.kind = ''licensed''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
            '%operation.serving_revision = new.target_serving_revision%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.validate_publication_control_command()'::regprocedure
      ) as exact_persisted_authority,
      not exists (
        select 1
          from pg_constraint constraint_record
         where constraint_record.conrelid =
           'ss.publication_control_commands'::regclass
           and constraint_record.contype = 'f'
           and constraint_record.confdeltype = 'c'
      ) as retained_command_evidence,
      not has_function_privilege(
        'authenticated',
        'ss.validate_publication_control_command()',
        'EXECUTE'
      ) and not has_function_privilege(
        'anon',
        'ss.hosted_publication_control_contract()',
        'EXECUTE'
      ) as exact_function_security
  `);
  for (
    const [name, ready] of Object.entries(
      publicationControls.rows[0]
    )
  ) {
    assert.equal(
      ready,
      true,
      `generic publication-control migration contract failed: ${name}`
    );
  }

  const alakazam35 = await pool.query(`
    with expected_tables(table_name) as (
      values
        ('alakazam_35_photo_assets'),
        ('alakazam_35_configurations'),
        ('alakazam_35_care_requests')
    ), expected_triggers(table_name, trigger_name, function_name) as (
      values
        ('alakazam_35_photo_assets', 'alakazam_35_photo_assets_immutable', 'reject_alakazam_35_evidence_mutation'),
        ('alakazam_35_photo_assets', 'alakazam_35_photo_assets_validate', 'validate_alakazam_35_photo_asset'),
        ('alakazam_35_configurations', 'alakazam_35_configurations_immutable', 'reject_alakazam_35_evidence_mutation'),
        ('alakazam_35_configurations', 'alakazam_35_configurations_validate', 'validate_alakazam_35_configuration'),
        ('alakazam_35_care_requests', 'alakazam_35_care_requests_immutable', 'reject_alakazam_35_evidence_mutation'),
        ('alakazam_35_care_requests', 'alakazam_35_care_requests_validate', 'validate_alakazam_35_care_request')
    )
    select
      ss.hosted_alakazam_35_contract() =
        'canonical-alakazam-35-held-v1'
        as exact_runtime_marker,
      (
        select count(*) = 3
          and bool_and(relation.relkind = 'r')
          and bool_and(relation.relpersistence = 'p')
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(has_table_privilege(
            'service_role', relation.oid, 'SELECT'
          ))
          and bool_and(has_table_privilege(
            'service_role', relation.oid, 'INSERT'
          ))
          and bool_and(not has_table_privilege(
            'service_role', relation.oid, 'UPDATE'
          ))
          and bool_and(not has_table_privilege(
            'service_role', relation.oid, 'DELETE'
          ))
          and bool_and(not has_table_privilege(
            'authenticated', relation.oid, 'SELECT'
          ))
          and bool_and(not has_table_privilege(
            'anon', relation.oid, 'SELECT'
          ))
          and bool_and(not exists (
            select 1 from pg_policy policy
             where policy.polrelid = relation.oid
          ))
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
      ) as exact_append_only_table_security,
      (
        select count(*) = 6
          and bool_and(trigger_record.tgenabled = 'O')
        from expected_triggers expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
        join pg_trigger trigger_record
          on trigger_record.tgrelid = relation.oid
         and trigger_record.tgname = expected.trigger_name
         and not trigger_record.tgisinternal
        join pg_proc function_record
          on function_record.oid = trigger_record.tgfoid
         and function_record.proname = expected.function_name
      ) as exact_trigger_set,
      (
        select count(*) = 13
          and bool_and(constraint_record.confdeltype <> 'c')
        from pg_constraint constraint_record
       where constraint_record.conrelid in (
         'ss.alakazam_35_photo_assets'::regclass,
         'ss.alakazam_35_configurations'::regclass,
         'ss.alakazam_35_care_requests'::regclass
       )
         and constraint_record.contype = 'f'
      ) as exact_non_cascading_foreign_keys,
      not has_function_privilege(
        'authenticated',
        'ss.validate_alakazam_35_subscription_authority(uuid,uuid,uuid,uuid,bigint)',
        'EXECUTE'
      ) and not has_function_privilege(
        'anon',
        'ss.hosted_alakazam_35_contract()',
        'EXECUTE'
      ) as exact_function_security
  `);
  for (const [name, ready] of Object.entries(alakazam35.rows[0])) {
    assert.equal(
      ready,
      true,
      `Alakazam 35 migration contract failed: ${name}`
    );
  }

  const retainedPremium = await pool.query(`
    with expected_tables(table_name) as (
      values
        ('alakazam_50_premium_restorations'),
        ('alakazam_premium_purge_receipts'),
        ('alakazam_premium_retention_windows')
    ), expected_triggers(table_name, trigger_name, function_name) as (
      values
        ('alakazam_50_premium_restorations', 'alakazam_50_premium_restorations_immutable', 'reject_alakazam_retained_premium_evidence_mutation'),
        ('alakazam_50_premium_restorations', 'alakazam_50_premium_restorations_validate', 'validate_alakazam_50_premium_restoration'),
        ('alakazam_premium_purge_receipts', 'alakazam_premium_purge_receipts_immutable', 'reject_alakazam_retained_premium_evidence_mutation'),
        ('alakazam_premium_retention_windows', 'alakazam_premium_retention_windows_guard_update', 'guard_alakazam_premium_retention_window'),
        ('alakazam_premium_retention_windows', 'alakazam_premium_retention_windows_immutable', 'reject_alakazam_retained_premium_evidence_mutation'),
        ('alakazam_premium_retention_windows', 'alakazam_premium_retention_windows_validate', 'validate_alakazam_premium_retention_window')
    )
    select
      ss.hosted_alakazam_retained_premium_contract() =
        'canonical-alakazam-retained-premium-held-v1'
        as exact_runtime_marker,
      (
        select count(*) = 3
          and bool_and(relation.relkind = 'r')
          and bool_and(relation.relpersistence = 'p')
          and bool_and(relation.relrowsecurity)
          and bool_and(relation.relforcerowsecurity)
          and bool_and(not exists (
            select 1 from pg_policy policy
             where policy.polrelid = relation.oid
          ))
          and bool_and(not has_table_privilege(
            'authenticated', relation.oid, 'SELECT'
          ))
          and bool_and(not has_table_privilege(
            'anon', relation.oid, 'SELECT'
          ))
          and bool_and(not has_table_privilege(
            'service_role', relation.oid, 'UPDATE'
          ))
          and bool_and(not has_table_privilege(
            'service_role', relation.oid, 'DELETE'
          ))
        from expected_tables expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
      ) as exact_held_table_security,
      (
        select count(*) = 6
          and bool_and(trigger_record.tgenabled = 'O')
        from expected_triggers expected
        join pg_class relation
          on relation.oid = format('ss.%I', expected.table_name)::regclass
        join pg_trigger trigger_record
          on trigger_record.tgrelid = relation.oid
         and trigger_record.tgname = expected.trigger_name
         and not trigger_record.tgisinternal
        join pg_proc function_record
          on function_record.oid = trigger_record.tgfoid
         and function_record.proname = expected.function_name
      ) as exact_trigger_set,
      has_table_privilege(
        'service_role',
        'ss.alakazam_50_premium_restorations',
        'SELECT,INSERT'
      ) and has_table_privilege(
        'service_role',
        'ss.alakazam_premium_purge_receipts',
        'SELECT'
      ) and has_table_privilege(
        'service_role',
        'ss.alakazam_premium_retention_windows',
        'SELECT'
      ) as exact_service_grants,
      has_function_privilege(
        'service_role',
        'ss.apply_alakazam_premium_retained_exit_policy(uuid,uuid,uuid,uuid,timestamptz)',
        'EXECUTE'
      ) and has_function_privilege(
        'service_role',
        'ss.purge_expired_alakazam_premium(uuid,uuid,uuid,uuid,timestamptz)',
        'EXECUTE'
      ) and not has_function_privilege(
        'service_role',
        'ss.purge_alakazam_premium_rows(uuid,uuid,uuid,uuid,text,timestamptz)',
        'EXECUTE'
      ) and not has_function_privilege(
        'authenticated',
        'ss.hosted_alakazam_retained_premium_contract()',
        'EXECUTE'
      ) as exact_function_security,
      (
        select lower(pg_get_functiondef(procedure_record.oid)) like
          '%subscription.status = ''active''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.validate_alakazam_50_subscription_authority(uuid,uuid,uuid,uuid,bigint)'::regprocedure
      ) and (
        select lower(pg_get_functiondef(procedure_record.oid)) like
          '%subscription.status = ''active''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.validate_alakazam_35_subscription_authority(uuid,uuid,uuid,uuid,bigint)'::regprocedure
      ) and exists (
        select 1 from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.alakazam_customer_publication_commands'::regclass
          and trigger_record.tgname =
            'alakazam_customer_publication_commands_00_active'
          and not trigger_record.tgisinternal
      ) as no_grace_write_authority,
      (
        select lower(pg_get_functiondef(procedure_record.oid)) like
          '%interval ''7 days''%'
          and lower(pg_get_functiondef(procedure_record.oid)) like
          '%interval ''30 days''%'
        from pg_proc procedure_record
        where procedure_record.oid =
          'ss.apply_alakazam_premium_retained_exit_policy(uuid,uuid,uuid,uuid,timestamptz)'::regprocedure
      ) as exact_retention_timing,
      (
        select pg_get_constraintdef(constraint_record.oid) like
          '%terminal_customer_deletion%'
          and pg_get_constraintdef(constraint_record.oid) like
          '%retained_exit_expiry%'
          and pg_get_constraintdef(constraint_record.oid) not like
          '%payment_grace_expiry%'
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.alakazam_premium_purge_receipts'::regclass
          and constraint_record.conname =
            'alakazam_premium_purge_reason_check'
      ) as exact_purge_reasons,
      (
        select pg_get_constraintdef(constraint_record.oid) like
          '%restored_configuration_id = id%'
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.alakazam_50_premium_restorations'::regclass
          and constraint_record.conname =
            'alakazam_premium_restore_command_binding_check'
      ) as exact_restoration_command_binding,
      not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conrelid in (
          'ss.alakazam_50_premium_restorations'::regclass,
          'ss.alakazam_premium_retention_windows'::regclass
        )
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
      ) as exact_non_cascading_foreign_keys
  `);
  for (const [name, ready] of Object.entries(retainedPremium.rows[0])) {
    assert.equal(
      ready,
      true,
      `Retained Alakazam premium migration contract failed: ${name}`
    );
  }
}

async function verifyProfessionalServicesReversalState(pool) {
  const proof = await pool.query(`
    select
      ss.hosted_runtime_contract_v108() =
        'canonical-ss-v108-professional-services-reversals'
        as exact_runtime_contract,
      to_regclass('ss.service_professional_payment_lifecycles') is not null
        and to_regclass('ss.service_professional_reversal_evidence') is not null
        and to_regclass(
          'ss.service_professional_reversal_reconciliations'
        ) is not null as exact_tables,
      to_regprocedure(
        'ss.service_professional_payment_binding_by_intent(uuid,text)'
      ) is not null
        and to_regprocedure(
          'ss.record_service_professional_reversal(uuid,uuid,text,uuid,text,text,text,text,text,text,bigint,bigint,text,jsonb,ss.sha256_hex,timestamptz,timestamptz)'
        ) is not null
        and to_regprocedure(
          'ss.reconcile_service_professional_reversal(uuid,uuid,uuid,uuid,text,bigint,text,jsonb,ss.sha256_hex,timestamptz,text,timestamptz)'
        ) is not null as exact_entry_points,
      (
        select count(*) = 4
        from pg_constraint constraint_record
        where constraint_record.conrelid =
          'ss.service_professional_payment_lifecycles'::regclass
          and constraint_record.contype = 'f'
          and constraint_record.confrelid in (
            'ss.service_assessment_payment_receipts'::regclass,
            'ss.service_custom_build_payment_receipts'::regclass,
            'ss.service_custom_build_change_payment_receipts'::regclass,
            'ss.service_custom_build_final_payment_receipts'::regclass
          )
      ) as exact_receipt_foreign_keys,
      not exists (
        select 1
        from pg_class table_record
        where table_record.oid in (
          'ss.service_professional_payment_lifecycles'::regclass,
          'ss.service_professional_reversal_evidence'::regclass,
          'ss.service_professional_reversal_reconciliations'::regclass
        ) and not (
          table_record.relrowsecurity and table_record.relforcerowsecurity
        )
      ) as exact_forced_rls,
      has_table_privilege(
        'service_role',
        'ss.service_professional_payment_lifecycles',
        'SELECT'
      ) and not has_table_privilege(
        'service_role',
        'ss.service_professional_payment_lifecycles',
        'INSERT,UPDATE,DELETE'
      ) and not has_table_privilege(
        'authenticated',
        'ss.service_professional_reversal_evidence',
        'SELECT'
      ) and not has_table_privilege(
        'anon',
        'ss.service_professional_reversal_reconciliations',
        'SELECT'
      ) as exact_privileges,
      exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_professional_payment_lifecycles'::regclass
          and trigger_record.tgname = 'service_professional_lifecycle_guard'
          and not trigger_record.tgisinternal
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_professional_reversal_evidence'::regclass
          and trigger_record.tgname =
            'service_professional_reversal_evidence_immutable'
          and not trigger_record.tgisinternal
      ) and exists (
        select 1
        from pg_trigger trigger_record
        where trigger_record.tgrelid =
          'ss.service_professional_reversal_reconciliations'::regclass
          and trigger_record.tgname =
            'service_professional_reconciliation_immutable'
          and not trigger_record.tgisinternal
      ) as exact_guards
  `);
  for (const [name, ready] of Object.entries(proof.rows[0])) {
    assert.equal(
      ready,
      true,
      `Professional-services reversal migration contract failed: ${name}`
    );
  }
}

export async function runMigrationVerification({
  environment = process.env,
  PoolImpl = Pool,
  uuid = randomUUID,
  writeOutput = (value) => process.stdout.write(value),
  expectedMigrationNames = null
} = {}) {
  const plan = resolveMigrationDatabasePlan({ environment, uuid });
  const adminPool = plan.ownership === "verifier"
    ? new PoolImpl({
        connectionString: plan.adminUrl,
        max: 1
      })
    : null;
  let databaseCreated = false;
  let databaseAbsent = false;
  let failure = null;
  let pool = null;
  let proof = null;
  try {
    if (adminPool) {
      await assertPostgres16(adminPool, {
        expectedDatabase: plan.adminDatabaseName,
        label: "Migration verifier admin connection"
      });
      await adminPool.query(`create database "${plan.databaseName}"`);
      databaseCreated = true;
    }
    pool = new PoolImpl({
      connectionString: plan.databaseUrl,
      max: 1
    });
    const identity = await assertPostgres16(pool, {
      expectedDatabase: plan.databaseName,
      label: "Migration verifier candidate connection"
    });
    const {
      appliedNames,
      releaseName,
      releaseSql,
      postPrivacyNames
    } = await applyMigrations(pool, expectedMigrationNames);
    await verifyPreJointLegalV3State(pool);
    const v2Before = await v2AuthorityFingerprint(pool);
    const readinessBefore = await verifyProjectLegalReadiness(pool, false);
    await applyJointLegalV3Release(pool, releaseSql);
    await applyPostPrivacyMigrations(
      pool,
      postPrivacyNames
    );
    await verifyJointLegalV4ReleaseState(pool);
    await verifyCustomerEngagementBootstrapState(pool);
    await verifyCustomerEngagementBootstrapJourney(pool);
    await verifyPlatformSchema(pool);
    await verifyProfessionalServicesReversalState(pool);
    const readinessAfter = await verifyProjectLegalReadiness(pool, true);
    await verifyReceiptRejectsFourthAcceptance(pool);
    await verifyV4ReceiptRejectsFourthAcceptance(pool);
    await verifyDurableMailLifecycle(pool);
    await verifySupportPrivacyCaseLifecycle(pool);
    await verifyOperatorWorkQueue(pool);
    const v2After = await v2AuthorityFingerprint(pool);
    assert.deepEqual(v2After, v2Before);
    writeOutput(
      `Applied ${appliedNames.length} migrations before ${releaseName}; project creation remained held.\n`
    );
    writeOutput(
      `Applied ${appliedNames.length + 1 + postPrivacyNames.length} migrations with the exact joint legal V3 production tuple.\n`
    );
    writeOutput(
      `projectCreationLegalBefore ${JSON.stringify(readinessBefore)}\n`
    );
    writeOutput(
      `projectCreationLegalAfter ${JSON.stringify(readinessAfter)}\n`
    );
    writeOutput(
      `v2EvidenceByteIdentical ${v2After.row_digest === v2Before.row_digest &&
        v2After.row_version === v2Before.row_version}\n`
    );
    writeOutput("rogueFourthAcceptanceRejected true\n");
    writeOutput("jointLegalV4ReceiptAcceptedAndFourthRejected true\n");
    writeOutput("customerEngagementBootstrapJourney true\n");
    writeOutput("durableMailLifecyclePostgresProof true\n");
    writeOutput("supportPrivacyCaseLifecyclePostgresProof true\n");
    writeOutput("operatorWorkQueuePostgresProof true\n");
    proof = Object.freeze({
      ownership: plan.ownership,
      databaseName: plan.databaseName,
      postgresMajor: identity.major,
      migrationsApplied:
        appliedNames.length + 1 +
        postPrivacyNames.length
    });
  } catch (error) {
    failure = error;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        failure ??= error;
      }
    }
    if (databaseCreated && adminPool) {
      try {
        await adminPool.query(
          `select pg_terminate_backend(pid)
             from pg_stat_activity
            where datname = $1
              and pid <> pg_backend_pid()`,
          [plan.databaseName]
        );
        await adminPool.query(
          `drop database if exists "${plan.databaseName}"`
        );
      } catch (error) {
        failure ??= error;
      }
    }
    if (adminPool) {
      try {
        const absence = await adminPool.query(
          `select not exists (
             select 1 from pg_database where datname = $1
           ) as database_absent`,
          [plan.databaseName]
        );
        databaseAbsent = absence.rows[0].database_absent === true;
      } catch (error) {
        failure ??= error;
      }
      try {
        await adminPool.end();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure) throw failure;
  if (plan.ownership === "caller") {
    writeOutput("databaseOwnership caller\n");
    writeOutput("databaseRetainedForCustomJourneys true\n");
  } else {
    writeOutput(`databaseAbsent ${databaseAbsent}\n`);
    assert.equal(databaseAbsent, true);
  }
  return Object.freeze({
    ...proof,
    databaseAbsent:
      plan.ownership === "verifier" ? databaseAbsent : null,
    databaseRetainedForCustomJourneys:
      plan.ownership === "caller"
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runMigrationVerification();
}
