const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export class DataPlaneError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DataPlaneError";
    this.code = code;
  }
}

function requireUuid(value, field) {
  const candidate = String(value || "");
  if (!UUID_PATTERN.test(candidate)) {
    throw new DataPlaneError("INVALID_ID", `${field} must be a UUID.`);
  }
  return candidate.toLowerCase();
}

function requireSha256(value, field) {
  const candidate = String(value || "").toLowerCase();
  if (!SHA256_PATTERN.test(candidate)) {
    throw new DataPlaneError("INVALID_DIGEST", `${field} must be a SHA-256 digest.`);
  }
  return candidate;
}

function requireIdempotencyKey(value) {
  const candidate = String(value || "").trim();
  if (candidate.length < 8 || candidate.length > 200) {
    throw new DataPlaneError(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be 8–200 characters.",
    );
  }
  return candidate;
}

function requireText(value, field, minimumLength = 1) {
  const candidate = String(value || "").trim();
  if (candidate.length < minimumLength) {
    throw new DataPlaneError("INVALID_INPUT", `${field} is required.`);
  }
  return candidate;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(String(value));
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", asBytes(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function resultChanges(result) {
  return Number(result?.meta?.changes || 0);
}

function nowFrom(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DataPlaneError("INVALID_TIME", "Clock returned an invalid time.");
  }
  return date.toISOString();
}

function addSeconds(isoTime, seconds) {
  return new Date(new Date(isoTime).getTime() + Number(seconds) * 1000).toISOString();
}

function uuidFrom(factory) {
  return requireUuid(factory(), "generated id");
}

export class SiteSourceryD1Repository {
  constructor(db, options = {}) {
    if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
      throw new TypeError("A D1-compatible database binding is required.");
    }
    this.db = db;
    this.clock = options.clock || (() => new Date());
    this.randomUUID = options.randomUUID || (() => crypto.randomUUID());
  }

  async requireMember(organizationId, userId, allowedRoles) {
    const orgId = requireUuid(organizationId, "organizationId");
    const actorId = requireUuid(userId, "userId");
    const roles = Array.isArray(allowedRoles) && allowedRoles.length
      ? allowedRoles
      : ["owner", "admin", "editor", "billing", "viewer"];
    const placeholders = roles.map(() => "?").join(",");
    const membership = await this.db
      .prepare(
        `SELECT role
           FROM organization_memberships
          WHERE organization_id = ?
            AND user_id = ?
            AND state = 'active'
            AND role IN (${placeholders})
          LIMIT 1`,
      )
      .bind(orgId, actorId, ...roles)
      .first();
    if (!membership) {
      throw new DataPlaneError("TENANT_ACCESS_DENIED", "Organization membership not found.");
    }
    return membership.role;
  }

  async getProject(organizationId, projectId) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const project = await this.db
      .prepare(
        `SELECT *
           FROM projects
          WHERE organization_id = ?
            AND id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetId)
      .first();
    if (!project) {
      throw new DataPlaneError("PROJECT_NOT_FOUND", "Project not found.");
    }
    return project;
  }

  async saveDraft({
    organizationId,
    projectId,
    userId,
    expectedRevision,
    rawFacts,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const actorId = requireUuid(userId, "userId");
    const revision = Number(expectedRevision);
    if (!Number.isInteger(revision) || revision < 0) {
      throw new DataPlaneError("INVALID_REVISION", "expectedRevision must be nonnegative.");
    }
    if (!rawFacts || typeof rawFacts !== "object" || Array.isArray(rawFacts)) {
      throw new DataPlaneError("INVALID_FACTS", "rawFacts must be an object.");
    }
    const updatedAt = nowFrom(this.clock);
    const nextRevision = revision + 1;

    const statements = [
      this.db
        .prepare(
          `INSERT INTO project_drafts (
             organization_id,
             project_id,
             raw_facts_json,
             revision,
             updated_by_user_id,
             updated_at
           )
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM projects project
              WHERE project.organization_id = ?
                AND project.id = ?
                AND project.lifecycle = 'active'
           )
           AND EXISTS (
             SELECT 1 FROM organization_memberships membership
              WHERE membership.organization_id = ?
                AND membership.user_id = ?
                AND membership.state = 'active'
                AND membership.role IN ('owner', 'admin', 'editor')
           )
           AND (
             (? = 0 AND NOT EXISTS (
               SELECT 1 FROM project_drafts draft
                WHERE draft.organization_id = ?
                  AND draft.project_id = ?
             ))
             OR EXISTS (
               SELECT 1 FROM project_drafts draft
                WHERE draft.organization_id = ?
                  AND draft.project_id = ?
                  AND draft.revision = ?
             )
           )
           ON CONFLICT(project_id) DO UPDATE
             SET raw_facts_json = excluded.raw_facts_json,
                 revision = excluded.revision,
                 updated_by_user_id = excluded.updated_by_user_id,
                 updated_at = excluded.updated_at
           WHERE project_drafts.organization_id = excluded.organization_id
             AND project_drafts.revision = ?`,
        )
        .bind(
          orgId,
          targetId,
          JSON.stringify(rawFacts),
          nextRevision,
          actorId,
          updatedAt,
          orgId,
          targetId,
          orgId,
          actorId,
          revision,
          orgId,
          targetId,
          orgId,
          targetId,
          revision,
          revision,
        ),
      this.db
        .prepare(
          `UPDATE projects
              SET revision = revision + 1,
                  updated_at = ?
            WHERE organization_id = ?
              AND id = ?
              AND EXISTS (
                SELECT 1 FROM project_drafts draft
                 WHERE draft.organization_id = ?
                   AND draft.project_id = ?
                   AND draft.revision = ?
              )`,
        )
        .bind(updatedAt, orgId, targetId, orgId, targetId, nextRevision),
    ];

    const results = await this.db.batch(statements);
    if (resultChanges(results[0]) !== 1) {
      throw new DataPlaneError(
        "REVISION_CONFLICT",
        "The draft changed; reload before writing again.",
      );
    }
    return {
      organizationId: orgId,
      projectId: targetId,
      revision: nextRevision,
      updatedAt,
    };
  }

  async saveCompiledVersion({
    organizationId,
    projectId,
    userId,
    normalizedFacts,
    contentFacts,
    offerings = [],
    rawFacts,
    html,
    compilerSchema,
    compilerRevision,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const actorId = requireUuid(userId, "userId");
    await this.requireMember(orgId, actorId, ["owner", "admin", "editor"]);
    const project = await this.getProject(orgId, targetId);
    if (project.lifecycle !== "active") {
      throw new DataPlaneError("PROJECT_CLOSED", "Project cannot accept versions.");
    }
    if (!normalizedFacts || typeof normalizedFacts !== "object") {
      throw new DataPlaneError("INVALID_FACTS", "normalizedFacts must be an object.");
    }
    if (!Array.isArray(offerings) || offerings.length > 6) {
      throw new DataPlaneError("INVALID_OFFERINGS", "At most six offerings are allowed.");
    }

    const htmlBytes = asBytes(html);
    if (htmlBytes.byteLength < 64 || htmlBytes.byteLength > 250000) {
      throw new DataPlaneError("INVALID_ARTIFACT", "Artifact must be 64–250000 bytes.");
    }

    const artifactDigest = await sha256Hex(htmlBytes);
    const normalizedDigest = await sha256Hex(stableJson(normalizedFacts));
    const contentDigest = await sha256Hex(stableJson(contentFacts || normalizedFacts));
    const createdAt = nowFrom(this.clock);
    const factSetId = uuidFrom(this.randomUUID);
    const artifactId = uuidFrom(this.randomUUID);
    const versionId = uuidFrom(this.randomUUID);
    const eventId = uuidFrom(this.randomUUID);
    const nextVersion = Number(
      (
        await this.db
          .prepare(
            `SELECT coalesce(max(version_number), 0) + 1 AS next_version
               FROM site_versions
              WHERE organization_id = ?
                AND project_id = ?`,
          )
          .bind(orgId, targetId)
          .first()
      )?.next_version || 1,
    );

    const fact = normalizedFacts;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO fact_sets (
             id, organization_id, project_id, schema_version, theme,
             business_name, summary, about, offerings_count, location, hours,
             phone_display, phone_href, email_display, email_href,
             website_display, website_href, primary_action,
             content_digest, normalized_digest, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM projects project
              WHERE project.organization_id = ?
                AND project.id = ?
                AND project.lifecycle = 'active'
           )
           AND EXISTS (
             SELECT 1 FROM organization_memberships membership
              WHERE membership.organization_id = ?
                AND membership.user_id = ?
                AND membership.state = 'active'
                AND membership.role IN ('owner', 'admin', 'editor')
           )`,
        )
        .bind(
          factSetId,
          orgId,
          targetId,
          fact.schema || "abracadabra.spark/v1",
          fact.theme,
          fact.businessName,
          fact.summary,
          fact.about || null,
          offerings.length,
          fact.location || null,
          fact.hours || null,
          fact.phone?.display || null,
          fact.phone?.href || null,
          fact.email?.display || null,
          fact.email?.href || null,
          fact.website?.display || null,
          fact.website?.href || null,
          fact.primaryAction || "none",
          contentDigest,
          normalizedDigest,
          createdAt,
          orgId,
          targetId,
          orgId,
          actorId,
        ),
      ...offerings.map((offering, index) =>
        this.db
          .prepare(
            `INSERT INTO fact_offerings (
               organization_id, fact_set_id, position, offering
             ) VALUES (?, ?, ?, ?)`,
          )
          .bind(orgId, factSetId, index + 1, String(offering)),
      ),
      this.db
        .prepare(
          `INSERT INTO artifacts (
             id, organization_id, project_id, media_type, html_bytes,
             artifact_digest, byte_count, created_at
           ) VALUES (?, ?, ?, 'text/html; charset=utf-8', ?, ?, ?, ?)`,
        )
        .bind(
          artifactId,
          orgId,
          targetId,
          htmlBytes,
          artifactDigest,
          htmlBytes.byteLength,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO site_versions (
             id, organization_id, project_id, version_number, fact_set_id,
             artifact_id, raw_facts_json, compiler_schema, compiler_revision,
             created_by_user_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          versionId,
          orgId,
          targetId,
          nextVersion,
          factSetId,
          artifactId,
          JSON.stringify(rawFacts || normalizedFacts),
          String(compilerSchema),
          String(compilerRevision),
          actorId,
          createdAt,
        ),
      this.db
        .prepare(
          `INSERT INTO version_state_events (
             id, organization_id, project_id, version_id, state,
             actor_user_id, occurred_at
           ) VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
        )
        .bind(eventId, orgId, targetId, versionId, actorId, createdAt),
      this.db
        .prepare(
          `INSERT INTO version_state_projection (
             organization_id, project_id, version_id, state, last_event_id, updated_at
           ) VALUES (?, ?, ?, 'draft', ?, ?)`,
        )
        .bind(orgId, targetId, versionId, eventId, createdAt),
    ];

    const results = await this.db.batch(statements);
    if (resultChanges(results[0]) !== 1) {
      throw new DataPlaneError("TENANT_ACCESS_DENIED", "Version write was rejected.");
    }
    return {
      versionId,
      versionNumber: nextVersion,
      factSetId,
      artifactId,
      artifactDigest,
      contentDigest,
      normalizedDigest,
      byteCount: htmlBytes.byteLength,
    };
  }

  async transitionVersion({
    organizationId,
    projectId,
    versionId,
    userId,
    nextState,
    screeningId = null,
    attestationId = null,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetProjectId = requireUuid(projectId, "projectId");
    const targetVersionId = requireUuid(versionId, "versionId");
    const actorId = requireUuid(userId, "userId");
    if (!["ready", "accepted_release", "rejected"].includes(nextState)) {
      throw new DataPlaneError("INVALID_STATE", "Unsupported version transition.");
    }
    const eventId = uuidFrom(this.randomUUID);
    const occurredAt = nowFrom(this.clock);
    const expectedState = nextState === "ready" ? "draft" : "ready";
    const screening = screeningId ? requireUuid(screeningId, "screeningId") : null;
    const attestation = attestationId
      ? requireUuid(attestationId, "attestationId")
      : null;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO version_state_events (
             id, organization_id, project_id, version_id, state,
             screening_id, attestation_id, actor_user_id, occurred_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM version_state_projection current
              WHERE current.organization_id = ?
                AND current.project_id = ?
                AND current.version_id = ?
                AND current.state = ?
           )
           AND EXISTS (
             SELECT 1 FROM organization_memberships membership
              WHERE membership.organization_id = ?
                AND membership.user_id = ?
                AND membership.state = 'active'
                AND membership.role IN ('owner', 'admin', 'editor')
           )`,
        )
        .bind(
          eventId,
          orgId,
          targetProjectId,
          targetVersionId,
          nextState,
          screening,
          attestation,
          actorId,
          occurredAt,
          orgId,
          targetProjectId,
          targetVersionId,
          expectedState,
          orgId,
          actorId,
        ),
      this.db
        .prepare(
          `UPDATE version_state_projection
              SET state = ?,
                  last_event_id = ?,
                  updated_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND version_id = ?
              AND EXISTS (
                SELECT 1 FROM version_state_events event
                 WHERE event.organization_id = ?
                   AND event.id = ?
              )`,
        )
        .bind(
          nextState,
          eventId,
          occurredAt,
          orgId,
          targetProjectId,
          targetVersionId,
          orgId,
          eventId,
        ),
    ];
    const results = await this.db.batch(statements);
    if (resultChanges(results[0]) !== 1) {
      throw new DataPlaneError("INVALID_VERSION_STATE", "Version transition rejected.");
    }
    return { eventId, state: nextState };
  }

  async reserveIdempotency({
    organizationId,
    principalId,
    routeKey,
    idempotencyKey,
    requestBody,
    ttlSeconds = 86400,
  }) {
    const orgId = organizationId ? requireUuid(organizationId, "organizationId") : null;
    const actorId = requireUuid(principalId, "principalId");
    const digest = await sha256Hex(stableJson(requestBody));
    const existing = await this.db
      .prepare(
        `SELECT *
           FROM idempotency_keys
          WHERE principal_id = ?
            AND route_key = ?
            AND idempotency_key = ?
            AND (organization_id = ? OR (organization_id IS NULL AND ? IS NULL))
          LIMIT 1`,
      )
      .bind(actorId, routeKey, idempotencyKey, orgId, orgId)
      .first();
    if (existing) {
      if (existing.request_digest !== digest) {
        throw new DataPlaneError(
          "IDEMPOTENCY_MISMATCH",
          "Idempotency key was used with another request.",
        );
      }
      return { replay: true, record: existing };
    }
    const createdAt = nowFrom(this.clock);
    const id = uuidFrom(this.randomUUID);
    await this.db
      .prepare(
        `INSERT INTO idempotency_keys (
           id, organization_id, principal_id, route_key, idempotency_key,
           request_digest, state, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
      )
      .bind(
        id,
        orgId,
        actorId,
        routeKey,
        idempotencyKey,
        digest,
        createdAt,
        addSeconds(createdAt, ttlSeconds),
      )
      .run();
    return { replay: false, record: { id, request_digest: digest, state: "running" } };
  }

  async recordVerifiedStripeWebhook({
    stripeEventId,
    eventType,
    livemode,
    apiVersion = null,
    payload,
    signatureVerifiedAt,
  }) {
    if (!signatureVerifiedAt) {
      throw new DataPlaneError(
        "STRIPE_SIGNATURE_REQUIRED",
        "Webhook must be verified before persistence.",
      );
    }
    const payloadJson = stableJson(payload);
    const payloadDigest = await sha256Hex(payloadJson);
    const existing = await this.db
      .prepare(
        `SELECT id, payload_digest
           FROM stripe_events
          WHERE stripe_event_id = ?
          LIMIT 1`,
      )
      .bind(String(stripeEventId))
      .first();
    if (existing) {
      if (existing.payload_digest !== payloadDigest) {
        throw new DataPlaneError(
          "STRIPE_EVENT_COLLISION",
          "Stripe event id was reused with different bytes.",
        );
      }
      return { duplicate: true, eventRowId: existing.id, payloadDigest };
    }

    const eventRowId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const receivedAt = nowFrom(this.clock);
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO stripe_events (
             id, stripe_event_id, event_type, livemode, api_version,
             payload_digest, payload_json, signature_verified_at, received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          eventRowId,
          String(stripeEventId),
          String(eventType),
          livemode ? 1 : 0,
          apiVersion,
          payloadDigest,
          payloadJson,
          new Date(signatureVerifiedAt).toISOString(),
          receivedAt,
        ),
      this.db
        .prepare(
          `INSERT INTO stripe_event_processing (
             stripe_event_row_id, state, attempt_count, updated_at
           ) VALUES (?, 'received', 0, ?)`,
        )
        .bind(eventRowId, receivedAt),
      this.db
        .prepare(
          `INSERT INTO transactional_outbox (
             id, organization_id, aggregate_type, aggregate_id, event_type,
             payload_json, dedupe_key, available_at, created_at
           ) VALUES (?, NULL, 'stripe_event', ?, 'stripe.event_received', ?, ?, ?, ?)`,
        )
        .bind(
          outboxId,
          eventRowId,
          JSON.stringify({ stripeEventRowId: eventRowId }),
          `stripe.process:${stripeEventId}`,
          receivedAt,
          receivedAt,
        ),
    ]);
    if (resultChanges(results[0]) !== 1 || resultChanges(results[2]) !== 1) {
      throw new DataPlaneError("STRIPE_EVENT_WRITE_FAILED", "Webhook transaction failed.");
    }
    return { duplicate: false, eventRowId, payloadDigest, outboxId };
  }

  async createDomainRegistrationIntent({
    organizationId,
    projectId,
    userId,
    quoteId,
    registrantSnapshotId,
    agentConsentId,
    paymentAllocationId,
    idempotencyKey,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetProjectId = requireUuid(projectId, "projectId");
    const actorId = requireUuid(userId, "userId");
    const targetQuoteId = requireUuid(quoteId, "quoteId");
    const targetRegistrantId = requireUuid(
      registrantSnapshotId,
      "registrantSnapshotId",
    );
    const targetConsentId = requireUuid(agentConsentId, "agentConsentId");
    const targetPaymentId = requireUuid(
      paymentAllocationId,
      "paymentAllocationId",
    );
    const key = requireIdempotencyKey(idempotencyKey);
    await this.requireMember(orgId, actorId, ["owner", "admin", "billing"]);

    const requestDigest = await sha256Hex(
      stableJson({
        organizationId: orgId,
        projectId: targetProjectId,
        userId: actorId,
        quoteId: targetQuoteId,
        registrantSnapshotId: targetRegistrantId,
        agentConsentId: targetConsentId,
        paymentAllocationId: targetPaymentId,
      }),
    );
    const existing = await this.db
      .prepare(
        `SELECT id, project_id, request_digest, state
           FROM domain_registration_intents
          WHERE organization_id = ?
            AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(orgId, key)
      .first();
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        throw new DataPlaneError(
          "IDEMPOTENCY_MISMATCH",
          "Registration idempotency key was used with other evidence.",
        );
      }
      return {
        replay: true,
        registrationIntentId: existing.id,
        state: existing.state,
      };
    }

    const quote = await this.db
      .prepare(
        `SELECT domain_name, provider_code
           FROM domain_quotes
          WHERE organization_id = ?
            AND project_id = ?
            AND id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetProjectId, targetQuoteId)
      .first();
    if (!quote) {
      throw new DataPlaneError("DOMAIN_QUOTE_NOT_FOUND", "Domain quote not found.");
    }

    const registrationIntentId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const auditId = uuidFrom(this.randomUUID);
    const createdAt = nowFrom(this.clock);
    const auditHash = await sha256Hex(
      stableJson({
        action: "domain.registration_intent.created",
        actorId,
        organizationId: orgId,
        projectId: targetProjectId,
        quoteId: targetQuoteId,
        registrationIntentId,
        at: createdAt,
      }),
    );

    let results;
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO domain_registration_intents (
               id, organization_id, project_id, requested_by_user_id,
               quote_id, registrant_snapshot_id, agent_consent_id,
               payment_allocation_id, domain_name, provider_code, state,
               idempotency_key, request_digest, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_confirmation',
                       ?, ?, ?, ?)`,
          )
          .bind(
            registrationIntentId,
            orgId,
            targetProjectId,
            actorId,
            targetQuoteId,
            targetRegistrantId,
            targetConsentId,
            targetPaymentId,
            quote.domain_name,
            quote.provider_code,
            key,
            requestDigest,
            createdAt,
            createdAt,
          ),
        this.db
          .prepare(
            `INSERT INTO transactional_outbox (
               id, organization_id, aggregate_type, aggregate_id, event_type,
               payload_json, dedupe_key, available_at, created_at
             ) VALUES (?, ?, 'domain_registration_intent', ?,
                       'domain.registration_confirmation_required',
                       json_object('registrationIntentId', ?, 'projectId', ?),
                       ?, ?, ?)`,
          )
          .bind(
            outboxId,
            orgId,
            registrationIntentId,
            registrationIntentId,
            targetProjectId,
            `domain.confirm:${registrationIntentId}`,
            createdAt,
            createdAt,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, organization_id, project_id, actor_kind, actor_id, action,
               target_type, target_id, metadata_json, event_hash, occurred_at
             ) VALUES (?, ?, ?, 'user', ?, 'domain.registration_intent.created',
                       'domain_registration_intent', ?,
                       json_object('quoteId', ?), ?, ?)`,
          )
          .bind(
            auditId,
            orgId,
            targetProjectId,
            actorId,
            registrationIntentId,
            targetQuoteId,
            auditHash,
            createdAt,
          ),
      ]);
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT id, request_digest, state
             FROM domain_registration_intents
            WHERE organization_id = ?
              AND idempotency_key = ?
            LIMIT 1`,
        )
        .bind(orgId, key)
        .first();
      if (raced) {
        if (raced.request_digest !== requestDigest) {
          throw new DataPlaneError(
            "IDEMPOTENCY_MISMATCH",
            "Registration idempotency key was used with other evidence.",
          );
        }
        return {
          replay: true,
          registrationIntentId: raced.id,
          state: raced.state,
        };
      }
      throw new DataPlaneError(
        "DOMAIN_REGISTRATION_PREREQUISITES",
        `Registration evidence was rejected: ${error.message}`,
      );
    }
    if (
      resultChanges(results[0]) !== 1
      || resultChanges(results[1]) !== 1
      || resultChanges(results[2]) !== 1
    ) {
      throw new DataPlaneError(
        "DOMAIN_REGISTRATION_WRITE_FAILED",
        "Registration intent transaction failed.",
      );
    }
    return {
      replay: false,
      registrationIntentId,
      state: "awaiting_confirmation",
      requestDigest,
      outboxId,
    };
  }

  async confirmDomainRegistration({
    organizationId,
    projectId,
    userId,
    registrationIntentId,
    confirmationStatementVersion,
    confirmationEvidence,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetProjectId = requireUuid(projectId, "projectId");
    const actorId = requireUuid(userId, "userId");
    const targetIntentId = requireUuid(
      registrationIntentId,
      "registrationIntentId",
    );
    const statementVersion = requireText(
      confirmationStatementVersion,
      "confirmationStatementVersion",
      3,
    );
    await this.requireMember(orgId, actorId, ["owner", "admin", "billing"]);
    const confirmationEvidenceDigest = await sha256Hex(
      stableJson({
        registrationIntentId: targetIntentId,
        statementVersion,
        evidence: confirmationEvidence,
      }),
    );

    const prior = await this.db
      .prepare(
        `SELECT confirmation.id, confirmation.confirmed_by_user_id,
                confirmation.confirmation_statement_version,
                confirmation.confirmation_evidence_digest, intent.state
           FROM domain_irreversible_confirmations confirmation
           JOIN domain_registration_intents intent
             ON intent.organization_id = confirmation.organization_id
            AND intent.id = confirmation.registration_intent_id
          WHERE confirmation.organization_id = ?
            AND confirmation.project_id = ?
            AND confirmation.registration_intent_id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetProjectId, targetIntentId)
      .first();
    if (prior) {
      if (
        prior.confirmed_by_user_id !== actorId
        || prior.confirmation_statement_version !== statementVersion
        || prior.confirmation_evidence_digest !== confirmationEvidenceDigest
      ) {
        throw new DataPlaneError(
          "IRREVERSIBLE_CONFIRMATION_MISMATCH",
          "Registration was already confirmed with different evidence.",
        );
      }
      return {
        replay: true,
        confirmationId: prior.id,
        registrationIntentId: targetIntentId,
        state: prior.state,
      };
    }

    const intent = await this.db
      .prepare(
        `SELECT intent.state, intent.requested_by_user_id, quote.quote_digest
           FROM domain_registration_intents intent
           JOIN domain_quotes quote
             ON quote.organization_id = intent.organization_id
            AND quote.id = intent.quote_id
          WHERE intent.organization_id = ?
            AND intent.project_id = ?
            AND intent.id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetProjectId, targetIntentId)
      .first();
    if (!intent || intent.requested_by_user_id !== actorId) {
      throw new DataPlaneError(
        "DOMAIN_INTENT_NOT_FOUND",
        "Registration intent not found for confirming customer.",
      );
    }
    if (intent.state !== "awaiting_confirmation") {
      throw new DataPlaneError(
        "IRREVERSIBLE_CONFIRMATION_CLOSED",
        "Registration intent is not awaiting confirmation.",
      );
    }

    const confirmationId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const auditId = uuidFrom(this.randomUUID);
    const confirmedAt = nowFrom(this.clock);
    const auditHash = await sha256Hex(
      stableJson({
        action: "domain.registration.confirmed",
        actorId,
        organizationId: orgId,
        projectId: targetProjectId,
        registrationIntentId: targetIntentId,
        confirmationEvidenceDigest,
        at: confirmedAt,
      }),
    );
    let results;
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO domain_irreversible_confirmations (
               id, organization_id, project_id, registration_intent_id,
               confirmed_by_user_id, confirmation_statement_version,
               confirmation_evidence_digest, quote_digest, confirmed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            confirmationId,
            orgId,
            targetProjectId,
            targetIntentId,
            actorId,
            statementVersion,
            confirmationEvidenceDigest,
            intent.quote_digest,
            confirmedAt,
          ),
        this.db
          .prepare(
            `UPDATE domain_registration_intents
                SET state = 'confirmed',
                    irreversible_confirmed_at = ?,
                    confirmed_by_user_id = ?,
                    updated_at = ?
              WHERE organization_id = ?
                AND project_id = ?
                AND id = ?
                AND state = 'awaiting_confirmation'`,
          )
          .bind(
            confirmedAt,
            actorId,
            confirmedAt,
            orgId,
            targetProjectId,
            targetIntentId,
          ),
        this.db
          .prepare(
            `INSERT INTO transactional_outbox (
               id, organization_id, aggregate_type, aggregate_id, event_type,
               payload_json, dedupe_key, available_at, created_at
             ) VALUES (?, ?, 'domain_registration_intent', ?,
                       'domain.registration_confirmed',
                       json_object('registrationIntentId', ?, 'projectId', ?),
                       ?, ?, ?)`,
          )
          .bind(
            outboxId,
            orgId,
            targetIntentId,
            targetIntentId,
            targetProjectId,
            `domain.confirmed:${targetIntentId}`,
            confirmedAt,
            confirmedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, organization_id, project_id, actor_kind, actor_id, action,
               target_type, target_id, metadata_json, event_hash, occurred_at
             ) VALUES (?, ?, ?, 'user', ?, 'domain.registration.confirmed',
                       'domain_registration_intent', ?,
                       json_object('confirmationId', ?), ?, ?)`,
          )
          .bind(
            auditId,
            orgId,
            targetProjectId,
            actorId,
            targetIntentId,
            confirmationId,
            auditHash,
            confirmedAt,
          ),
      ]);
    } catch (error) {
      throw new DataPlaneError(
        "IRREVERSIBLE_CONFIRMATION_REJECTED",
        `Irreversible confirmation was rejected: ${error.message}`,
      );
    }
    if (results.some((result) => resultChanges(result) !== 1)) {
      throw new DataPlaneError(
        "IRREVERSIBLE_CONFIRMATION_WRITE_FAILED",
        "Confirmation transaction failed.",
      );
    }
    return {
      replay: false,
      confirmationId,
      registrationIntentId: targetIntentId,
      state: "confirmed",
      confirmationEvidenceDigest,
      outboxId,
    };
  }

  async enqueueConfirmedDomainRegistration({
    organizationId,
    projectId,
    registrationIntentId,
    idempotencyKey,
    providerRequest,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetProjectId = requireUuid(projectId, "projectId");
    const targetIntentId = requireUuid(
      registrationIntentId,
      "registrationIntentId",
    );
    const key = requireIdempotencyKey(idempotencyKey);
    const intent = await this.db
      .prepare(
        `SELECT intent.provider_code, intent.state
           FROM domain_registration_intents intent
           JOIN domain_irreversible_confirmations confirmation
             ON confirmation.organization_id = intent.organization_id
            AND confirmation.registration_intent_id = intent.id
          WHERE intent.organization_id = ?
            AND intent.project_id = ?
            AND intent.id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetProjectId, targetIntentId)
      .first();
    if (!intent) {
      throw new DataPlaneError(
        "DOMAIN_CONFIRMATION_REQUIRED",
        "Confirmed registration intent not found.",
      );
    }
    const requestDigest = await sha256Hex(
      stableJson({
        registrationIntentId: targetIntentId,
        providerCode: intent.provider_code,
        providerRequest,
      }),
    );
    const existing = await this.db
      .prepare(
        `SELECT id, request_digest, state
           FROM domain_provider_operations
          WHERE subject_kind = 'registration'
            AND subject_id = ?
            AND operation_kind = 'register'
            AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(targetIntentId, key)
      .first();
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        throw new DataPlaneError(
          "IDEMPOTENCY_MISMATCH",
          "Provider-operation key was used with a different request.",
        );
      }
      return {
        replay: true,
        operationId: existing.id,
        state: existing.state,
      };
    }
    if (intent.state !== "confirmed") {
      throw new DataPlaneError(
        "DOMAIN_OPERATION_ALREADY_ENQUEUED",
        "Registration is no longer in the confirmed state.",
      );
    }

    const operationId = uuidFrom(this.randomUUID);
    const eventId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const auditId = uuidFrom(this.randomUUID);
    const requestedAt = nowFrom(this.clock);
    const auditHash = await sha256Hex(
      stableJson({
        action: "domain.registration.submitted",
        organizationId: orgId,
        projectId: targetProjectId,
        registrationIntentId: targetIntentId,
        operationId,
        at: requestedAt,
      }),
    );
    let results;
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO domain_provider_operations (
               id, organization_id, project_id, subject_kind, subject_id,
               operation_kind, provider_code, idempotency_key, request_digest,
               state, requested_at, updated_at
             ) VALUES (?, ?, ?, 'registration', ?, 'register', ?, ?, ?,
                       'queued', ?, ?)`,
          )
          .bind(
            operationId,
            orgId,
            targetProjectId,
            targetIntentId,
            intent.provider_code,
            key,
            requestDigest,
            requestedAt,
            requestedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO domain_provider_operation_events (
               id, organization_id, project_id, operation_id, state, occurred_at
             ) VALUES (?, ?, ?, ?, 'queued', ?)`,
          )
          .bind(eventId, orgId, targetProjectId, operationId, requestedAt),
        this.db
          .prepare(
            `UPDATE domain_registration_intents
                SET state = 'submitted', updated_at = ?
              WHERE organization_id = ?
                AND project_id = ?
                AND id = ?
                AND state = 'confirmed'`,
          )
          .bind(requestedAt, orgId, targetProjectId, targetIntentId),
        this.db
          .prepare(
            `INSERT INTO transactional_outbox (
               id, organization_id, aggregate_type, aggregate_id, event_type,
               payload_json, dedupe_key, available_at, created_at
             ) VALUES (?, ?, 'domain_provider_operation', ?,
                       'domain.provider_operation_requested',
                       json_object('operationId', ?, 'registrationIntentId', ?,
                                   'providerCode', ?),
                       ?, ?, ?)`,
          )
          .bind(
            outboxId,
            orgId,
            operationId,
            operationId,
            targetIntentId,
            intent.provider_code,
            `domain.operation:${operationId}`,
            requestedAt,
            requestedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, organization_id, project_id, actor_kind, actor_id, action,
               target_type, target_id, metadata_json, event_hash, occurred_at
             ) VALUES (?, ?, ?, 'system', 'domain-orchestrator',
                       'domain.registration.submitted',
                       'domain_provider_operation', ?,
                       json_object('registrationIntentId', ?), ?, ?)`,
          )
          .bind(
            auditId,
            orgId,
            targetProjectId,
            operationId,
            targetIntentId,
            auditHash,
            requestedAt,
          ),
      ]);
    } catch (error) {
      throw new DataPlaneError(
        "DOMAIN_OPERATION_REJECTED",
        `Provider operation was rejected: ${error.message}`,
      );
    }
    if (results.some((result) => resultChanges(result) !== 1)) {
      throw new DataPlaneError(
        "DOMAIN_OPERATION_WRITE_FAILED",
        "Provider operation transaction failed.",
      );
    }
    return {
      replay: false,
      operationId,
      state: "queued",
      requestDigest,
      outboxId,
    };
  }

  async recordDomainRegistrationSuccess({
    organizationId,
    projectId,
    operationId,
    providerReceiptId,
    providerDomainRef,
    registeredAt,
    expiresAt,
    autoRenew = false,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetProjectId = requireUuid(projectId, "projectId");
    const targetOperationId = requireUuid(operationId, "operationId");
    const targetReceiptId = requireUuid(providerReceiptId, "providerReceiptId");
    const providerReference = requireText(providerDomainRef, "providerDomainRef");
    const registrationTime = new Date(registeredAt).toISOString();
    const expirationTime = new Date(expiresAt).toISOString();
    if (expirationTime <= registrationTime) {
      throw new DataPlaneError(
        "INVALID_DOMAIN_EXPIRY",
        "Domain expiry must follow registration.",
      );
    }

    const operation = await this.db
      .prepare(
        `SELECT operation.state, operation.provider_code,
                intent.id AS registration_intent_id,
                intent.registrant_snapshot_id, intent.domain_name,
                quote.renewal_disclosure_digest
           FROM domain_provider_operations operation
           JOIN domain_registration_intents intent
             ON intent.organization_id = operation.organization_id
            AND intent.project_id = operation.project_id
            AND operation.subject_kind = 'registration'
            AND operation.subject_id = intent.id
            AND operation.operation_kind = 'register'
           JOIN domain_quotes quote
             ON quote.organization_id = intent.organization_id
            AND quote.id = intent.quote_id
          WHERE operation.organization_id = ?
            AND operation.project_id = ?
            AND operation.id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetProjectId, targetOperationId)
      .first();
    if (!operation) {
      throw new DataPlaneError(
        "DOMAIN_OPERATION_NOT_FOUND",
        "Registration provider operation not found.",
      );
    }

    const prior = await this.db
      .prepare(
        `SELECT id, provider_domain_ref, registered_at, expires_at, state
           FROM domain_registrations
          WHERE organization_id = ?
            AND project_id = ?
            AND registration_intent_id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetProjectId, operation.registration_intent_id)
      .first();
    if (prior) {
      if (
        prior.provider_domain_ref !== providerReference
        || prior.registered_at !== registrationTime
        || prior.expires_at !== expirationTime
      ) {
        throw new DataPlaneError(
          "DOMAIN_RESULT_MISMATCH",
          "Registration success was already recorded with other evidence.",
        );
      }
      return {
        replay: true,
        registrationId: prior.id,
        operationId: targetOperationId,
        state: prior.state,
      };
    }

    const registrationId = uuidFrom(this.randomUUID);
    const operationEventId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const auditId = uuidFrom(this.randomUUID);
    const recordedAt = nowFrom(this.clock);
    const auditHash = await sha256Hex(
      stableJson({
        action: "domain.registration.succeeded",
        organizationId: orgId,
        projectId: targetProjectId,
        operationId: targetOperationId,
        registrationId,
        providerReceiptId: targetReceiptId,
        at: recordedAt,
      }),
    );
    let results;
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE domain_provider_operations
                SET state = 'succeeded',
                    provider_receipt_id = ?,
                    updated_at = ?,
                    completed_at = ?,
                    failure_code = NULL
              WHERE organization_id = ?
                AND project_id = ?
                AND id = ?
                AND state IN ('queued', 'submitted', 'processing')`,
          )
          .bind(
            targetReceiptId,
            recordedAt,
            recordedAt,
            orgId,
            targetProjectId,
            targetOperationId,
          ),
        this.db
          .prepare(
            `INSERT INTO domain_provider_operation_events (
               id, organization_id, project_id, operation_id, state,
               provider_receipt_id, occurred_at
             ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?)`,
          )
          .bind(
            operationEventId,
            orgId,
            targetProjectId,
            targetOperationId,
            targetReceiptId,
            recordedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO domain_registrations (
               id, organization_id, project_id, registration_intent_id,
               provider_operation_id, registrant_snapshot_id, provider_code,
               provider_domain_ref, domain_name, state, customer_is_registrant,
               site_sourcery_role, auto_renew, registered_at, expires_at,
               current_provider_receipt_id, renewal_disclosure_digest, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1,
                       'authorized_agent', ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            registrationId,
            orgId,
            targetProjectId,
            operation.registration_intent_id,
            targetOperationId,
            operation.registrant_snapshot_id,
            operation.provider_code,
            providerReference,
            operation.domain_name,
            autoRenew ? 1 : 0,
            registrationTime,
            expirationTime,
            targetReceiptId,
            operation.renewal_disclosure_digest,
            recordedAt,
          ),
        this.db
          .prepare(
            `UPDATE domain_registration_intents
                SET state = 'registered', updated_at = ?, failure_code = NULL
              WHERE organization_id = ?
                AND project_id = ?
                AND id = ?
                AND state IN ('submitted', 'processing')`,
          )
          .bind(
            recordedAt,
            orgId,
            targetProjectId,
            operation.registration_intent_id,
          ),
        this.db
          .prepare(
            `INSERT INTO transactional_outbox (
               id, organization_id, aggregate_type, aggregate_id, event_type,
               payload_json, dedupe_key, available_at, created_at
             ) VALUES (?, ?, 'domain_registration', ?,
                       'domain.registration_succeeded',
                       json_object('registrationId', ?, 'projectId', ?,
                                   'domainName', ?),
                       ?, ?, ?)`,
          )
          .bind(
            outboxId,
            orgId,
            registrationId,
            registrationId,
            targetProjectId,
            operation.domain_name,
            `domain.registered:${registrationId}`,
            recordedAt,
            recordedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, organization_id, project_id, actor_kind, actor_id, action,
               target_type, target_id, metadata_json, event_hash, occurred_at
             ) VALUES (?, ?, ?, 'provider', ?,
                       'domain.registration.succeeded',
                       'domain_registration', ?,
                       json_object('operationId', ?, 'providerReceiptId', ?),
                       ?, ?)`,
          )
          .bind(
            auditId,
            orgId,
            targetProjectId,
            operation.provider_code,
            registrationId,
            targetOperationId,
            targetReceiptId,
            auditHash,
            recordedAt,
          ),
      ]);
    } catch (error) {
      throw new DataPlaneError(
        "DOMAIN_RESULT_REJECTED",
        `Provider registration result was rejected: ${error.message}`,
      );
    }
    if (results.some((result) => resultChanges(result) !== 1)) {
      throw new DataPlaneError(
        "DOMAIN_RESULT_WRITE_FAILED",
        "Provider result transaction failed.",
      );
    }
    return {
      replay: false,
      registrationId,
      operationId: targetOperationId,
      state: "active",
      outboxId,
    };
  }

  async createSupportTicket({
    organizationId,
    projectId,
    userId,
    subject,
    message,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const actorId = requireUuid(userId, "userId");
    const ticketId = uuidFrom(this.randomUUID);
    const messageId = uuidFrom(this.randomUUID);
    const createdAt = nowFrom(this.clock);
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO support_tickets (
             id, organization_id, project_id, opened_by_user_id,
             subject, state, created_at, updated_at
           )
           SELECT ?, ?, ?, ?, ?, 'open', ?, ?
           WHERE EXISTS (
             SELECT 1 FROM projects project
              WHERE project.organization_id = ?
                AND project.id = ?
                AND project.lifecycle <> 'deleted'
           )
           AND EXISTS (
             SELECT 1 FROM organization_memberships membership
              WHERE membership.organization_id = ?
                AND membership.user_id = ?
                AND membership.state = 'active'
           )`,
        )
        .bind(
          ticketId,
          orgId,
          targetId,
          actorId,
          String(subject).trim(),
          createdAt,
          createdAt,
          orgId,
          targetId,
          orgId,
          actorId,
        ),
      this.db
        .prepare(
          `INSERT INTO support_messages (
             id, organization_id, project_id, ticket_id, author_kind,
             author_user_id, body, created_at
           )
           SELECT ?, ?, ?, ?, 'customer', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM support_tickets ticket
              WHERE ticket.organization_id = ?
                AND ticket.id = ?
           )`,
        )
        .bind(
          messageId,
          orgId,
          targetId,
          ticketId,
          actorId,
          String(message).trim(),
          createdAt,
          orgId,
          ticketId,
        ),
    ]);
    if (resultChanges(results[0]) !== 1 || resultChanges(results[1]) !== 1) {
      throw new DataPlaneError("TENANT_ACCESS_DENIED", "Support ticket was rejected.");
    }
    return { ticketId, messageId, state: "open" };
  }

  async requestExport({ organizationId, projectId, userId }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const actorId = requireUuid(userId, "userId");
    const exportId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const requestedAt = nowFrom(this.clock);
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO export_requests (
             id, organization_id, project_id, requested_by_user_id,
             state, requested_at
           )
           SELECT ?, ?, ?, ?, 'queued', ?
           WHERE EXISTS (
             SELECT 1 FROM projects project
              WHERE project.organization_id = ?
                AND project.id = ?
                AND project.lifecycle IN ('active', 'cancelled')
           )
           AND EXISTS (
             SELECT 1 FROM organization_memberships membership
              WHERE membership.organization_id = ?
                AND membership.user_id = ?
                AND membership.state = 'active'
           )`,
        )
        .bind(
          exportId,
          orgId,
          targetId,
          actorId,
          requestedAt,
          orgId,
          targetId,
          orgId,
          actorId,
        ),
      this.db
        .prepare(
          `INSERT INTO transactional_outbox (
             id, organization_id, aggregate_type, aggregate_id, event_type,
             payload_json, dedupe_key, available_at, created_at
           )
           SELECT ?, ?, 'export_request', ?, 'export.build_requested',
                  json_object('exportId', ?, 'projectId', ?), ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM export_requests request
              WHERE request.organization_id = ?
                AND request.id = ?
           )`,
        )
        .bind(
          outboxId,
          orgId,
          exportId,
          exportId,
          targetId,
          `export.build:${exportId}`,
          requestedAt,
          requestedAt,
          orgId,
          exportId,
        ),
    ]);
    if (resultChanges(results[0]) !== 1 || resultChanges(results[1]) !== 1) {
      throw new DataPlaneError("TENANT_ACCESS_DENIED", "Export request was rejected.");
    }
    return { exportId, state: "queued", outboxId };
  }

  async resolvePublicSite(hostname) {
    const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/u, "");
    const site = await this.db
      .prepare(
        `SELECT project_id, release_id, version_id, artifact_id,
                artifact_digest, html_bytes
           FROM current_site_resolution
          WHERE hostname = ?
            AND visibility = 'public'
          LIMIT 1`,
      )
      .bind(normalized)
      .first();
    if (!site) {
      throw new DataPlaneError("SITE_NOT_SERVING", "Site is not serving.");
    }
    return site;
  }

  async acknowledgePrivateLifecycle({
    tokenDigest,
    expectedProjectId,
    expectedVersionId,
    expectedArtifactDigest,
    expectedHostname,
    expectedVisibility,
  }) {
    const digest = requireSha256(tokenDigest, "tokenDigest");
    const projectId = requireUuid(expectedProjectId, "expectedProjectId");
    const versionId = requireUuid(expectedVersionId, "expectedVersionId");
    const artifactDigest = requireSha256(
      expectedArtifactDigest,
      "expectedArtifactDigest",
    );
    const hostname = String(expectedHostname || "").trim().toLowerCase();
    if (expectedVisibility !== "private") {
      throw new DataPlaneError("ACCESS_DENIED", "Private tuple did not match.");
    }
    const acknowledged = await this.db
      .prepare(
        `SELECT 1 AS acknowledged
           FROM viewer_sessions viewer
           JOIN current_site_resolution site
             ON site.organization_id = viewer.organization_id
            AND site.project_id = viewer.project_id
            AND site.release_id = viewer.release_id
            AND site.version_id = viewer.version_id
            AND site.artifact_digest = viewer.artifact_digest
            AND site.hostname = viewer.hostname
            AND site.visibility = viewer.visibility
            AND site.credential_id = viewer.credential_id
            AND site.credential_fingerprint = viewer.credential_fingerprint
          WHERE viewer.token_digest = ?
            AND viewer.revoked_at IS NULL
            AND viewer.expires_at > ?
            AND viewer.project_id = ?
            AND viewer.version_id = ?
            AND viewer.artifact_digest = ?
            AND viewer.hostname = ?
            AND viewer.visibility = 'private'
          LIMIT 1`,
      )
      .bind(
        digest,
        nowFrom(this.clock),
        projectId,
        versionId,
        artifactDigest,
        hostname,
      )
      .first();
    if (!acknowledged) {
      throw new DataPlaneError("ACCESS_DENIED", "Private lifecycle not acknowledged.");
    }
    return { acknowledged: true };
  }

  async beginTerminalPurge({
    organizationId,
    projectId,
    policyVersion,
    requestedByUserId = null,
    systemAuthority = false,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const actorId = requestedByUserId
      ? requireUuid(requestedByUserId, "requestedByUserId")
      : null;
    if (actorId) {
      await this.requireMember(orgId, actorId, ["owner", "admin"]);
    } else if (!systemAuthority) {
      throw new DataPlaneError(
        "PURGE_AUTHORITY_REQUIRED",
        "Terminal purge requires owner/admin or system authority.",
      );
    }

    const prior = await this.db
      .prepare(
        `SELECT *
           FROM deletion_requests
          WHERE organization_id = ?
            AND project_id = ?
          LIMIT 1`,
      )
      .bind(orgId, targetId)
      .first();
    if (prior && prior.state !== "failed") {
      return { deletionRequestId: prior.id, state: prior.state, replay: true };
    }

    const project = await this.getProject(orgId, targetId);
    if (project.lifecycle === "deleted") {
      throw new DataPlaneError("PROJECT_DELETED", "Project is already deleted.");
    }

    const deletionId = prior?.id || uuidFrom(this.randomUUID);
    const finalizeJobId = uuidFrom(this.randomUUID);
    const outboxId = uuidFrom(this.randomUUID);
    const auditId = uuidFrom(this.randomUUID);
    const now = nowFrom(this.clock);
    const auditHash = await sha256Hex(
      stableJson({
        action: "project.deletion_sealed",
        organizationId: orgId,
        projectId: targetId,
        policyVersion,
        at: now,
      }),
    );
    const guard = `EXISTS (
      SELECT 1 FROM deletion_requests request
       WHERE request.organization_id = ?
         AND request.project_id = ?
         AND request.id = ?
         AND request.state = 'purging'
    )`;
    const guardBinds = [orgId, targetId, deletionId];
    const statements = [];

    if (prior) {
      statements.push(
        this.db
          .prepare(
            `UPDATE deletion_requests
                SET policy_version = ?,
                    state = 'purging',
                    failure_code = NULL,
                    sealed_at = ?
              WHERE organization_id = ?
                AND project_id = ?
                AND id = ?
                AND state = 'failed'`,
          )
          .bind(policyVersion, now, orgId, targetId, deletionId),
      );
    } else {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO deletion_requests (
               id, organization_id, project_id, requested_by_user_id,
               policy_version, state, accepted_term_ids_json,
               billing_timestamps_json, address_disposition,
               retained_customer_domains_json, removal_counts_json,
               requested_at, sealed_at
             )
             SELECT
               ?, project.organization_id, project.id, ?, ?, 'purging',
               coalesce((
                 SELECT json_group_array(required.acceptance_id)
                   FROM project_required_terms required
                  WHERE required.organization_id = project.organization_id
                    AND required.project_id = project.id
               ), '[]'),
               coalesce((
                 SELECT json_group_array(json_object(
                   'subscriptionId', subscription.id,
                   'status', subscription.status,
                   'firstFailedAt', subscription.first_failed_at,
                   'graceEndsAt', subscription.grace_ends_at,
                   'suspendedAt', subscription.suspended_at,
                   'retentionEndsAt', subscription.retention_ends_at,
                   'cancelledAt', subscription.cancelled_at
                 ))
                   FROM stripe_subscriptions subscription
                  WHERE subscription.organization_id = project.organization_id
                    AND subscription.project_id = project.id
               ), '[]'),
               CASE
                 WHEN EXISTS (
                   SELECT 1 FROM project_addresses address
                    WHERE address.organization_id = project.organization_id
                      AND address.project_id = project.id
                      AND address.ownership = 'customer'
                      AND address.retained_domain IS NOT NULL
                 ) THEN 'customer_domain_retained_detached'
                 WHEN EXISTS (
                   SELECT 1 FROM project_addresses address
                    WHERE address.organization_id = project.organization_id
                      AND address.project_id = project.id
                      AND address.ownership = 'licensed'
                 ) THEN 'licensed_address_released'
                 ELSE 'no_address'
               END,
               coalesce((
                 SELECT json_group_array(address.retained_domain)
                   FROM project_addresses address
                  WHERE address.organization_id = project.organization_id
                    AND address.project_id = project.id
                    AND address.ownership = 'customer'
                    AND address.retained_domain IS NOT NULL
               ), '[]'),
               json_object(
                 'projectName', CASE WHEN project.name IS NULL THEN 0 ELSE 1 END,
                 'draft', (SELECT count(*) FROM project_drafts WHERE organization_id = project.organization_id AND project_id = project.id),
                 'factSets', (SELECT count(*) FROM fact_sets WHERE organization_id = project.organization_id AND project_id = project.id),
                 'versions', (SELECT count(*) FROM site_versions WHERE organization_id = project.organization_id AND project_id = project.id),
                 'artifacts', (SELECT count(*) FROM artifacts WHERE organization_id = project.organization_id AND project_id = project.id),
                 'screeningAttempts', (SELECT count(*) FROM release_screenings WHERE organization_id = project.organization_id AND project_id = project.id),
                 'attestations', (SELECT count(*) FROM version_attestations WHERE organization_id = project.organization_id AND project_id = project.id),
                 'releaseRequests', (SELECT count(*) FROM release_requests WHERE organization_id = project.organization_id AND project_id = project.id),
                 'releases', (SELECT count(*) FROM releases WHERE organization_id = project.organization_id AND project_id = project.id),
                 'accessCredentials', (SELECT count(*) FROM project_access_credentials WHERE organization_id = project.organization_id AND project_id = project.id),
                 'domainProofRecords',
                   (SELECT count(*) FROM domain_verification_requests WHERE organization_id = project.organization_id AND project_id = project.id)
                   + (SELECT count(*) FROM domain_verification_attempts WHERE organization_id = project.organization_id AND project_id = project.id),
                 'supportTickets', (SELECT count(*) FROM support_tickets WHERE organization_id = project.organization_id AND project_id = project.id),
                 'supportMessages', (SELECT count(*) FROM support_messages WHERE organization_id = project.organization_id AND project_id = project.id),
                 'exports', (SELECT count(*) FROM export_requests WHERE organization_id = project.organization_id AND project_id = project.id),
                 'safetyNarratives', (SELECT count(*) FROM safety_events WHERE organization_id = project.organization_id AND project_id = project.id AND narrative IS NOT NULL)
               ),
               ?, ?
             FROM projects project
             WHERE project.organization_id = ?
               AND project.id = ?
               AND project.lifecycle <> 'deleted'
               AND project.revision = ?`,
          )
          .bind(
            deletionId,
            actorId,
            String(policyVersion),
            now,
            now,
            orgId,
            targetId,
            project.revision,
          ),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT OR IGNORE INTO deletion_object_queue (
             deletion_request_id, organization_id, project_id, object_key,
             source_kind, state, created_at
           )
           SELECT ?, artifact.organization_id, artifact.project_id,
                  replica.object_key, 'artifact_replica', 'scheduled', ?
             FROM artifact_replicas replica
             JOIN artifacts artifact
               ON artifact.organization_id = replica.organization_id
              AND artifact.id = replica.artifact_id
            WHERE artifact.organization_id = ?
              AND artifact.project_id = ?
              AND replica.deleted_at IS NULL
           UNION ALL
           SELECT ?, export.organization_id, export.project_id,
                  export.object_key, 'export', 'scheduled', ?
             FROM export_requests export
            WHERE export.organization_id = ?
              AND export.project_id = ?
              AND export.object_key IS NOT NULL`,
        )
        .bind(deletionId, now, orgId, targetId, deletionId, now, orgId, targetId),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO project_retained_events (
             id, organization_id, project_id, kind, actor_kind, actor_id, occurred_at
           )
           SELECT event.id, event.organization_id, event.project_id,
                  event.kind, event.actor_kind, event.actor_id, event.occurred_at
             FROM safety_events event
            WHERE event.organization_id = ?
              AND event.project_id = ?
              AND ${guard}`,
        )
        .bind(orgId, targetId, ...guardBinds),
      this.db
        .prepare(
          `UPDATE project_serving_projection
              SET state = 'dark',
                  current_release_id = NULL,
                  previous_release_id = NULL,
                  resume_state = 'unpublished',
                  updated_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND ${guard}`,
        )
        .bind(now, orgId, targetId, ...guardBinds),
      this.db
        .prepare(
          `UPDATE project_access_projection
              SET visibility = 'closed',
                  current_credential_id = NULL,
                  updated_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND ${guard}`,
        )
        .bind(now, orgId, targetId, ...guardBinds),
      this.db
        .prepare(
          `UPDATE project_address_projection
              SET current_address_id = NULL,
                  updated_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND ${guard}`,
        )
        .bind(now, orgId, targetId, ...guardBinds),
      this.db
        .prepare(
          `UPDATE project_safety_projection
              SET state = 'closed',
                  previous_serving_state = NULL,
                  updated_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND ${guard}`,
        )
        .bind(now, orgId, targetId, ...guardBinds),
    );

    const directDeletes = [
      "viewer_sessions",
      "support_messages",
      "support_tickets",
      "domain_verification_attempts",
      "domain_verification_requests",
      "serving_events",
      "release_events",
      "releases",
      "release_requests",
      "version_state_projection",
      "version_state_events",
      "version_attestations",
      "release_screenings",
      "site_versions",
      "artifacts",
      "fact_sets",
      "project_drafts",
      "project_access_credentials",
      "safety_events",
      "export_requests",
      "checkout_intents",
    ];
    for (const table of directDeletes) {
      statements.push(
        this.db
          .prepare(
            `DELETE FROM ${table}
              WHERE organization_id = ?
                AND project_id = ?
                AND ${guard}`,
          )
          .bind(orgId, targetId, ...guardBinds),
      );
    }

    statements.push(
      this.db
        .prepare(
          `DELETE FROM transactional_outbox
            WHERE organization_id = ?
              AND (
                aggregate_id = ?
                OR json_extract(payload_json, '$.projectId') = ?
              )
              AND ${guard}`,
        )
        .bind(orgId, targetId, targetId, ...guardBinds),
      this.db
        .prepare(
          `UPDATE project_addresses
              SET serving_hostname = NULL,
                  label = CASE WHEN ownership = 'licensed' THEN NULL ELSE label END,
                  state = CASE WHEN ownership = 'licensed' THEN 'released' ELSE 'detached' END,
                  configured_at = NULL,
                  detached_at = CASE WHEN ownership = 'customer' THEN ? ELSE detached_at END,
                  released_at = CASE WHEN ownership = 'licensed' THEN ? ELSE released_at END
            WHERE organization_id = ?
              AND project_id = ?
              AND ${guard}`,
        )
        .bind(now, now, orgId, targetId, ...guardBinds),
      this.db
        .prepare(
          `UPDATE projects
              SET lifecycle = 'deleting',
                  name = NULL,
                  deletion_started_at = coalesce(deletion_started_at, ?),
                  revision = revision + 1,
                  updated_at = ?
            WHERE organization_id = ?
              AND id = ?
              AND revision = ?
              AND ${guard}`,
        )
        .bind(now, now, orgId, targetId, project.revision, ...guardBinds),
      this.db
        .prepare(
          `INSERT INTO lifecycle_jobs (
             id, organization_id, project_id, job_type, dedupe_key,
             state, run_at, payload_json, created_at
           )
           SELECT ?, ?, ?, 'finalize_deletion', ?, 'scheduled', ?,
                  json_object('projectId', ?, 'deletionRequestId', ?), ?
           WHERE ${guard}`,
        )
        .bind(
          finalizeJobId,
          orgId,
          targetId,
          `finalize-deletion:${targetId}`,
          now,
          targetId,
          deletionId,
          now,
          ...guardBinds,
        ),
      this.db
        .prepare(
          `INSERT INTO transactional_outbox (
             id, organization_id, aggregate_type, aggregate_id, event_type,
             payload_json, dedupe_key, available_at, created_at
           )
           SELECT ?, ?, 'project', ?, 'project.deletion_sealed',
                  json_object('projectId', ?, 'deletionRequestId', ?), ?, ?, ?
           WHERE ${guard}`,
        )
        .bind(
          outboxId,
          orgId,
          targetId,
          targetId,
          deletionId,
          `project.delete:${targetId}`,
          now,
          now,
          ...guardBinds,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, organization_id, project_id, actor_kind, actor_id, action,
             target_type, target_id, metadata_json, event_hash, occurred_at
           )
           SELECT ?, ?, ?, ?, ?, 'project.deletion_sealed',
                  'project', ?, json_object('policyVersion', ?), ?, ?
           WHERE ${guard}`,
        )
        .bind(
          auditId,
          orgId,
          targetId,
          actorId ? "user" : "system",
          actorId || "terminal-purge",
          targetId,
          String(policyVersion),
          auditHash,
          now,
          ...guardBinds,
        ),
    );

    const results = await this.db.batch(statements);
    if (resultChanges(results[0]) !== 1) {
      throw new DataPlaneError(
        "PURGE_CONFLICT",
        "Project changed before terminal purge could seal.",
      );
    }
    const sealed = await this.db
      .prepare(
        `SELECT id, state, removal_counts_json
           FROM deletion_requests
          WHERE organization_id = ?
            AND project_id = ?
            AND id = ?`,
      )
      .bind(orgId, targetId, deletionId)
      .first();
    return {
      deletionRequestId: deletionId,
      state: sealed.state,
      replay: false,
      removalCounts: JSON.parse(sealed.removal_counts_json),
    };
  }

  async markDeletionObjectSucceeded({
    organizationId,
    deletionRequestId,
    objectKey,
  }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const deletionId = requireUuid(deletionRequestId, "deletionRequestId");
    const completedAt = nowFrom(this.clock);
    const result = await this.db
      .prepare(
        `UPDATE deletion_object_queue
            SET state = 'succeeded',
                completed_at = ?,
                last_error = NULL
          WHERE organization_id = ?
            AND deletion_request_id = ?
            AND object_key = ?`,
      )
      .bind(completedAt, orgId, deletionId, String(objectKey))
      .run();
    if (resultChanges(result) !== 1) {
      throw new DataPlaneError("DELETE_OBJECT_NOT_FOUND", "Deletion object not found.");
    }
    return { acknowledged: true };
  }

  async finalizeTerminalPurge({ organizationId, projectId }) {
    const orgId = requireUuid(organizationId, "organizationId");
    const targetId = requireUuid(projectId, "projectId");
    const existing = await this.db
      .prepare(
        `SELECT project_id
           FROM project_deletion_tombstones
          WHERE organization_id = ?
            AND project_id = ?`,
      )
      .bind(orgId, targetId)
      .first();
    if (existing) {
      return { projectId: targetId, state: "deleted", replay: true };
    }
    const request = await this.db
      .prepare(
        `SELECT *
           FROM deletion_requests
          WHERE organization_id = ?
            AND project_id = ?
            AND state = 'purging'
          LIMIT 1`,
      )
      .bind(orgId, targetId)
      .first();
    if (!request) {
      throw new DataPlaneError("PURGE_NOT_SEALED", "Deletion is not sealed.");
    }
    const pending = await this.db
      .prepare(
        `SELECT count(*) AS pending
           FROM deletion_object_queue
          WHERE organization_id = ?
            AND project_id = ?
            AND state <> 'succeeded'`,
      )
      .bind(orgId, targetId)
      .first();
    if (Number(pending.pending) !== 0) {
      throw new DataPlaneError(
        "OBJECT_DELETION_INCOMPLETE",
        "External object deletion is incomplete.",
      );
    }

    const eventId = uuidFrom(this.randomUUID);
    const auditId = uuidFrom(this.randomUUID);
    const deletedAt = nowFrom(this.clock);
    const auditHash = await sha256Hex(
      stableJson({
        action: "project.deleted",
        organizationId: orgId,
        projectId: targetId,
        at: deletedAt,
      }),
    );
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO project_deletion_tombstones (
             project_id, organization_id, deletion_request_id, policy_version,
             deleted_at, accepted_term_ids_json, billing_policy_id,
             billing_timestamps_json, address_disposition,
             retained_customer_domains_json, removal_counts_json
           )
           SELECT project.id, project.organization_id, request.id,
                  request.policy_version, ?, request.accepted_term_ids_json,
                  project.billing_policy_id, request.billing_timestamps_json,
                  request.address_disposition,
                  request.retained_customer_domains_json,
                  request.removal_counts_json
             FROM projects project
             JOIN deletion_requests request
               ON request.organization_id = project.organization_id
              AND request.project_id = project.id
            WHERE project.organization_id = ?
              AND project.id = ?
              AND project.lifecycle = 'deleting'
              AND request.state = 'purging'`,
        )
        .bind(deletedAt, orgId, targetId),
      this.db
        .prepare(
          `UPDATE projects
              SET lifecycle = 'deleted',
                  name = NULL,
                  deleted_at = ?,
                  revision = revision + 1,
                  updated_at = ?
            WHERE organization_id = ?
              AND id = ?
              AND EXISTS (
                SELECT 1 FROM project_deletion_tombstones tombstone
                 WHERE tombstone.organization_id = ?
                   AND tombstone.project_id = ?
              )`,
        )
        .bind(deletedAt, deletedAt, orgId, targetId, orgId, targetId),
      this.db
        .prepare(
          `UPDATE project_serving_projection
              SET state = 'deleted',
                  current_release_id = NULL,
                  previous_release_id = NULL,
                  resume_state = 'unpublished',
                  updated_at = ?
            WHERE organization_id = ?
              AND project_id = ?`,
        )
        .bind(deletedAt, orgId, targetId),
      this.db
        .prepare(
          `INSERT INTO serving_events (
             id, organization_id, project_id, event_kind, occurred_at
           ) VALUES (?, ?, ?, 'deleted', ?)`,
        )
        .bind(eventId, orgId, targetId, deletedAt),
      this.db
        .prepare(
          `UPDATE deletion_requests
              SET state = 'completed',
                  completed_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND id = ?`,
        )
        .bind(deletedAt, orgId, targetId, request.id),
      this.db
        .prepare(
          `UPDATE lifecycle_jobs
              SET state = 'succeeded',
                  completed_at = ?
            WHERE organization_id = ?
              AND project_id = ?
              AND job_type = 'finalize_deletion'
              AND state <> 'succeeded'`,
        )
        .bind(deletedAt, orgId, targetId),
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, organization_id, project_id, actor_kind, actor_id, action,
             target_type, target_id, metadata_json, event_hash, occurred_at
           ) VALUES (?, ?, ?, 'system', 'terminal-purge', 'project.deleted',
                     'project', ?, json_object('policyVersion', ?), ?, ?)`,
        )
        .bind(
          auditId,
          orgId,
          targetId,
          targetId,
          request.policy_version,
          auditHash,
          deletedAt,
        ),
    ]);
    if (resultChanges(results[0]) !== 1 || resultChanges(results[1]) !== 1) {
      throw new DataPlaneError("PURGE_FINALIZE_FAILED", "Deletion finalization failed.");
    }
    return { projectId: targetId, state: "deleted", replay: false };
  }
}
