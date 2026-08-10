import { randomUUID as systemRandomUUID } from "node:crypto";

import {
  resolveOffer,
  toBrowserSafeCatalog,
  validateOfferCatalog
} from "../commerce/catalog.mjs";
import {
  CANCELLATION_PREVIEW_TTL_MS,
  RETENTION_DAYS
} from "./constants.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  addDays,
  addMs,
  digest,
  hashPassword,
  normalizeEmail,
  normalizeHostname,
  optionalText,
  randomToken,
  requiredText,
  safeRawFacts,
  validatePassword
} from "./security.mjs";
import {
  providerEffectCertainty,
  providerErrorCode,
  validateHostedPaymentProvider
} from "./payment-provider-port.mjs";
import { createStoredZip } from "./zip.mjs";
import { createHeldDomainRuntime } from "./domain-postgres-runtime.mjs";
import { DEFAULT_PLATFORM_BASE_DOMAIN } from "../selfhost/src/hostname.mjs";
import {
  constantTimeDigestEqual,
  publicProjectLegalAuthority,
  validateProjectLegalAcceptance
} from "./project-legal-authority.mjs";
import { DEFAULT_INGRESS_POLICY } from "./ingress-policy.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WRITE_ROLES = new Set(["owner", "admin", "editor"]);
const BILLING_ROLES = new Set(["owner", "admin", "billing"]);
const PRODUCT_TERM_KINDS = Object.freeze(["product", "privacy", "website"]);
const EXPORT_TTL_DAYS = 90;
const DEFAULT_EXPORT_LEASE_MS = 60 * 1000;
const MAXIMUM_EXPORT_LEASE_MS = 5 * 60 * 1000;
const MAXIMUM_EXPORT_BATCH = 100;
const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const RECOVERY_DELIVERY_TTL_MS = 30 * 60 * 1000;
const CHECKOUT_HOST = "checkout.stripe.com";
const BILLING_PORTAL_HOST = "billing.stripe.com";

function uuid(value, field) {
  const selected = String(value ?? "");
  invariant(
    UUID.test(selected),
    "INVALID_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function now(clock) {
  const selected = clock.now();
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)),
    "RUNTIME_CONFIGURATION_ERROR",
    "The hosted service clock is invalid.",
    { status: 500 }
  );
  return selected;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function requiredActor(actor) {
  invariant(
    actor?.userId && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in to continue.",
    { status: 401 }
  );
  return actor;
}

function commandId(value) {
  const selected = String(value ?? "");
  invariant(
    selected.length >= 8 && selected.length <= 200,
    "IDEMPOTENCY_KEY_REQUIRED",
    "A valid idempotency key is required.",
    { status: 400 }
  );
  return selected;
}

function recoveryDeliveryResponse(mode) {
  return mode === "production"
    ? {
        accepted: true,
        delivery: "email",
        emailSent: true
      }
    : {
        accepted: true,
        delivery: "manual_operator",
        emailSent: false
      };
}

function priorRecoveryDelivery(row, requestDigest) {
  invariant(
    row.request_digest === requestDigest,
    "RECOVERY_IDEMPOTENCY_CONFLICT",
    "That recovery request key was already used for another request.",
    { status: 409 }
  );
  invariant(
    [
      "provider_accepted",
      "delivered",
      "recipient_unresolved"
    ].includes(
      row.state
    ),
    "RECOVERY_DELIVERY_RECONCILIATION_REQUIRED",
    "That recovery email may not have completed. Contact Site Sourcery before trying again.",
    { status: 409 }
  );
  return recoveryDeliveryResponse(row.delivery_mode);
}

function exportWorkerIdentity(value) {
  const selected = String(value ?? "");
  invariant(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(selected),
    "EXPORT_WORKER_INVALID",
    "Export worker identity is invalid.",
    { status: 500 }
  );
  return selected;
}

function exportBatchLimit(value) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected > 0 &&
      selected <= MAXIMUM_EXPORT_BATCH,
    "EXPORT_WORKER_INVALID",
    "Export worker batch limit is invalid.",
    { status: 500 }
  );
  return selected;
}

function safeExportCauseCode(error) {
  const selected =
    error instanceof HostedError
      ? error.code
      : typeof error?.code === "string"
        ? error.code
        : "UNEXPECTED_ERROR";
  return /^[A-Z][A-Z0-9_]{0,127}$/u.test(selected)
    ? selected
    : "UNEXPECTED_ERROR";
}

function exportObjectNotFound(error) {
  return error?.code === "ENOENT" ||
    error?.code === "OBJECT_NOT_FOUND";
}

function addressInput(input, licensedBaseDomain) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_INPUT",
    "Address is invalid.",
    { status: 400 }
  );
  if (input.kind === "licensed") {
    const label = requiredText(input.label, "Address label", 63).toLowerCase();
    invariant(
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
      "INVALID_INPUT",
      "Address label is invalid.",
      { status: 400 }
    );
    return {
      kind: "licensed",
      ownership: "licensed",
      path: null,
      label,
      retainedDomain: null,
      hostname: `${label}.${licensedBaseDomain}`,
      state: "configured"
    };
  }
  invariant(
    input.kind === "custom" &&
      (input.path === "purchase" || input.path === "connect"),
    "INVALID_INPUT",
    "Customer domain path is invalid.",
    { status: 400 }
  );
  const hostname = normalizeHostname(input.hostname);
  return {
    kind:
      input.path === "purchase" ? "customer_purchase" : "customer_byod",
    ownership: "customer",
    path: input.path,
    label: null,
    retainedDomain: hostname,
    hostname,
    state: input.path === "purchase" ? "pending" : "pending_review"
  };
}

function addressMode(row) {
  return row?.kind === "licensed" ? "licensed" : "customer_owned";
}

function publicAddress(row) {
  if (!row?.address_id) return null;
  const custom = row.address_kind !== "licensed";
  return {
    id: row.address_id,
    kind: custom ? "custom" : "licensed",
    mode: custom ? "customer_owned" : "licensed",
    path:
      row.address_kind === "customer_purchase"
        ? "purchase"
        : row.address_kind === "customer_byod"
          ? "connect"
          : null,
    label: row.address_label,
    hostname: row.serving_hostname,
    state:
      row.address_state === "configured"
        ? "configured"
        : row.address_state,
    verified: row.address_state === "configured",
    revision: Number(row.address_revision ?? 0),
    verificationRequest: row.verification_id
      ? {
          id: row.verification_id,
          method: row.verification_method,
          state: row.verification_state,
          requestedAt: iso(row.verification_requested_at)
        }
      : null
  };
}

function publicSubscription(row) {
  if (!row?.subscription_id) {
    if (row?.ownership_entitlement_id) {
      return {
        id: row.ownership_entitlement_id,
        projectId: row.id,
        status:
          row.ownership_entitlement_state ===
          "completed"
            ? "paid"
            : row.ownership_entitlement_state,
        offerId: row.ownership_offer_key,
        productId: "spark",
        tenureId: row.ownership_tenure_id,
        revision: 1,
        currentPeriodEndsAt: null,
        cancelAt: null,
        retentionEndsAt:
          row.retention_ends_at
            ? iso(row.retention_ends_at)
            : null,
        provider: "stripe",
        kind: "ownership",
        completedAt: iso(
          row.ownership_completed_at
        )
      };
    }
    return {
      id: null,
      projectId: row.id,
      status: "inactive",
      offerId: null,
      productId: null,
      tenureId: null,
      revision: 0,
      currentPeriodEndsAt: null,
      cancelAt: null,
      retentionEndsAt: row.retention_ends_at
        ? iso(row.retention_ends_at)
        : null,
      provider: null
    };
  }
  return {
    id: row.subscription_id,
    projectId: row.id,
    status: row.subscription_status,
    offerId: row.subscription_offer_key,
    productId: "spark",
    tenureId: row.subscription_tenure_id,
    revision: Number(row.subscription_revision),
    currentPeriodEndsAt: iso(row.current_period_ends_at),
    cancelAt: iso(row.cancelled_at),
    retentionEndsAt: iso(row.subscription_retention_ends_at),
    provider: "stripe"
  };
}

function publicDownloadEntitlements(
  row,
  acceptedVersionId
) {
  if (
    !row?.download_entitlement_id ||
    !acceptedVersionId
  ) {
    return [];
  }
  return [
    {
      id: row.download_entitlement_id,
      entitlementId:
        row.download_entitlement_id,
      projectId: row.id,
      kind: "spark_download",
      entitlementKind: "spark_download",
      scope: "editor_project",
      state: "active",
      activatedAt: iso(
        row.download_entitlement_activated_at
      ),
      expiresAt: null,
      acceptedDisclosureDigest:
        row.download_accepted_disclosure_digest,
      downloadUrl:
        `/api/v1/projects/${encodeURIComponent(row.id)}` +
        `/versions/${encodeURIComponent(acceptedVersionId)}` +
        "/download",
      payment: {
        status: "paid",
        provider: "stripe",
        receiptId: row.download_receipt_id,
        amountMinor: 500,
        taxMinor: Number(
          row.download_tax_minor
        ),
        totalMinor: Number(
          row.download_total_minor
        ),
        taxMode: row.download_tax_mode,
        currency: "USD",
        settledAt: iso(
          row.download_payment_settled_at
        )
      }
    }
  ];
}

function publicVersion(row) {
  const html =
    row.html_bytes == null
      ? null
      : Buffer.from(row.html_bytes).toString("utf8");
  return {
    id: row.id,
    versionId: row.id,
    state:
      row.state === "accepted_release"
        ? "accepted"
        : row.state ?? "created",
    contentDigest: row.content_digest,
    artifactDigest: row.artifact_digest,
    previewDigest: row.artifact_digest,
    rawFacts: row.raw_facts ?? {},
    artifact:
      html === null
        ? null
        : {
            digest: row.artifact_digest,
            html
          },
    reviewAttested: Boolean(row.attested),
    compilerSchema: row.compiler_schema,
    compilerRevision: row.compiler_revision,
    createdAt: iso(row.created_at),
    readyAt: iso(row.ready_at),
    acceptedAt: iso(row.accepted_at)
  };
}

function publicExport(row) {
  return {
    exportId: row.id,
    projectId: row.project_id,
    status:
      row.state === "building"
        ? "working"
        : row.state,
    createdAt: iso(row.requested_at),
    updatedAt: iso(row.completed_at ?? row.requested_at),
    ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
    ...(row.state === "ready"
      ? {
          filename: `sitesourcery-${row.project_id}-${row.id}.zip`
        }
      : {})
  };
}

function publicCommerceQuote(row) {
  return {
    quoteId: row.id,
    projectId: row.project_id,
    catalogVersion: row.catalog_version,
    termsVersion: row.terms_version,
    offerId: row.offer_key,
    product: row.product_snapshot,
    tenure: row.tenure_snapshot,
    eligibleAddressModes: row.eligible_address_modes,
    addressBinding: {
      id: row.address_id,
      mode: row.address_mode,
      revision: Number(row.address_revision)
    },
    currency: row.currency,
    lineItems: row.line_items,
    totals: row.totals,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    disclosureDigest: row.disclosure_digest,
    status:
      row.state === "checkout_created"
        ? "checkout_created"
        : row.state,
    ...(row.checkout_intent_id
      ? {
          checkout: {
            checkoutId: row.checkout_intent_id,
            url: row.checkout_url,
            expiresAt: iso(row.checkout_expires_at)
          }
        }
      : {})
  };
}

function publicDomainRegistration(row) {
  return {
    id: row.id,
    domainId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    hostname: row.domain_name,
    state: row.state,
    expiresAt: iso(row.expires_at),
    autoRenew: row.auto_renew === true,
    renewalMode: row.auto_renew
      ? "provider_managed"
      : "manual_review",
    dnsRevision: Number(row.dns_revision ?? 0),
    createdAt: iso(row.registered_at)
  };
}

function held(capability) {
  throw new HostedError(
    `${capability.toUpperCase()}_HELD`,
    `${capability.replaceAll("_", " ")} is not enabled yet.`,
    { status: 503 }
  );
}

function providerIdentifier(value, prefix, field) {
  const selected = String(value ?? "");
  invariant(
    selected.startsWith(`${prefix}_`) &&
      /^[A-Za-z0-9_]{4,255}$/u.test(selected),
    "PAYMENT_PROVIDER_RESPONSE_INVALID",
    `${field} is invalid.`,
    { status: 502 }
  );
  return selected;
}

function providerUrl(value, hostname, field) {
  let selected;
  try {
    selected = new URL(String(value ?? ""));
  } catch {
    invariant(
      false,
      "PAYMENT_PROVIDER_RESPONSE_INVALID",
      `${field} is invalid.`,
      { status: 502 }
    );
  }
  invariant(
    selected.protocol === "https:" &&
      selected.hostname === hostname &&
      !selected.username &&
      !selected.password &&
      !selected.hash,
    "PAYMENT_PROVIDER_RESPONSE_INVALID",
    `${field} is outside the approved payment-provider host.`,
    { status: 502 }
  );
  return selected.toString();
}

function checkoutProviderResult(value, issuedAt) {
  const checkoutId = providerIdentifier(
    value?.checkoutId,
    "cs",
    "Checkout Session ID"
  );
  const url = providerUrl(
    value?.url,
    CHECKOUT_HOST,
    "Checkout URL"
  );
  invariant(
    Number.isFinite(Date.parse(value?.expiresAt)) &&
      Date.parse(value.expiresAt) > Date.parse(issuedAt),
    "PAYMENT_PROVIDER_RESPONSE_INVALID",
    "Checkout expiry is invalid.",
    { status: 502 }
  );
  return {
    checkoutId,
    url,
    expiresAt: new Date(value.expiresAt).toISOString()
  };
}

function billingPortalProviderResult(value) {
  return {
    portalSessionId: providerIdentifier(
      value?.portalSessionId,
      "bps",
      "Billing Portal Session ID"
    ),
    url: providerUrl(
      value?.url,
      BILLING_PORTAL_HOST,
      "Billing Portal URL"
    )
  };
}

function stripeTimestamp(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "STRIPE_WEBHOOK_EVENT_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return new Date(value * 1000).toISOString();
}

function translatePostgres(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "23505") {
    return new HostedError(
      "CONFLICT",
      "That value is already in use.",
      { status: 409 }
    );
  }
  if (error?.code === "40001" || error?.code === "40P01") {
    return new HostedError(
      "WRITE_CONFLICT",
      "The project changed at the same time. Try again.",
      { status: 409 }
    );
  }
  return error;
}

export function createCanonicalPostgresService({
  authority,
  identity,
  compiler,
  catalogPort,
  publicationPort,
  exportStore,
  recoveryMailPort,
  paymentProvider: suppliedPaymentProvider = null,
  contactVault = null,
  domainRuntime = null,
  clock = { now: () => new Date().toISOString() },
  randomUUID = systemRandomUUID,
  tokenFactory = randomToken,
  exportWorkerId: suppliedExportWorkerId = null,
  exportLeaseMs = DEFAULT_EXPORT_LEASE_MS,
  licensedBaseDomain = DEFAULT_PLATFORM_BASE_DOMAIN,
  projectLegalAuthority = null,
  projectLegalAuthorityDiagnostic = null,
  resourceLimits = DEFAULT_INGRESS_POLICY.writes
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );
  const configuredResourceLimits = {
    perPrincipal: {
      ...DEFAULT_INGRESS_POLICY.writes.perPrincipal,
      ...resourceLimits?.perPrincipal
    },
    compile: {
      ...DEFAULT_INGRESS_POLICY.writes.compile,
      ...resourceLimits?.compile
    }
  };
  for (const selected of Object.values(configuredResourceLimits)) {
    invariant(
      Number.isInteger(selected.attempts) && selected.attempts >= 1 &&
        selected.attempts <= 10_000 && Number.isInteger(selected.windowMs) &&
        selected.windowMs >= 1_000 && selected.windowMs <= 24 * 60 * 60 * 1000,
      "RUNTIME_CONFIGURATION_ERROR",
      "Hosted write quotas are invalid.",
      { status: 500 }
    );
  }
  invariant(
    identity &&
      typeof identity.authenticate === "function" &&
      typeof identity.register === "function" &&
      typeof identity.completeRegistration ===
        "function" &&
      typeof identity.registrationReadiness ===
        "function" &&
      typeof identity.signIn === "function" &&
      typeof identity.signOut === "function" &&
      typeof identity.issueRecoveryForDelivery === "function" &&
      typeof identity.completeRecovery === "function" &&
      typeof identity.requireRecentReauthentication ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "First-party identity is required.",
    { status: 500 }
  );
  invariant(
    compiler &&
      typeof compiler.compile === "function" &&
      typeof compiler.revision === "string",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical Spark compiler is required.",
    { status: 500 }
  );
  invariant(
    catalogPort && typeof catalogPort.current === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Approved offer catalog port is required.",
    { status: 500 }
  );
  invariant(
    publicationPort &&
      typeof publicationPort.request === "function" &&
      typeof publicationPort.rollback === "function" &&
      typeof publicationPort.unpublish === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Private publication port is required.",
    { status: 500 }
  );
  invariant(
    exportStore &&
      typeof exportStore.key === "function" &&
      typeof exportStore.put === "function" &&
      typeof exportStore.get === "function" &&
      typeof exportStore.delete === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Private export object store is required.",
    { status: 500 }
  );
  invariant(
    Number.isSafeInteger(exportLeaseMs) &&
      exportLeaseMs > 0 &&
      exportLeaseMs <= MAXIMUM_EXPORT_LEASE_MS,
    "RUNTIME_CONFIGURATION_ERROR",
    "Export worker lease duration is invalid.",
    { status: 500 }
  );
  const defaultExportWorkerId = exportWorkerIdentity(
    suppliedExportWorkerId ??
      `export-worker:${randomUUID()}`
  );
  invariant(
    recoveryMailPort &&
      typeof recoveryMailPort.readiness === "function" &&
      typeof recoveryMailPort.deliver === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Recovery mail delivery port is required.",
    { status: 500 }
  );
  const paymentProvider = validateHostedPaymentProvider(
    suppliedPaymentProvider
  );
  const legalAuthority = projectLegalAuthority
    ? Object.freeze(projectLegalAuthority)
    : null;
  async function projectLegalReadiness() {
    if (
      !legalAuthority ||
      typeof authority.readiness !== "function" ||
      typeof authority.projectLegalAuthorityMatches !== "function"
    ) {
      return false;
    }
    const status = await authority.readiness();
    return status.ready === true &&
      status.projectCreationLegal?.ready === true &&
      await authority.projectLegalAuthorityMatches(legalAuthority);
  }
  async function projectLegalArtifactsReadable() {
    if (typeof authority.readiness !== "function") return false;
    try {
      const status = await authority.readiness();
      return status.ready === true &&
        status.projectCreationLegal?.v2Artifact === true;
    } catch {
      return false;
    }
  }
  normalizeHostname(`probe.${licensedBaseDomain}`);
  const domains =
    domainRuntime ?? createHeldDomainRuntime();
  for (const method of [
    "searchDomains",
    "createDomainQuote",
    "saveRegistrantContact",
    "acceptDomainConsent",
    "createDomainOrder",
    "getDomainOrder",
    "listDomainOrders",
    "getDomainPaymentRedirect",
    "resumeDomainAuthorization",
    "refreshDomainPrice",
    "requestDomainRegistration",
    "listDnsRecords",
    "upsertDnsRecord",
    "deleteDnsRecord",
    "setDomainAutoRenew",
    "requestDomainRenewalQuote",
    "requestDomainTransferOut",
    "readiness"
  ]) {
    invariant(
      typeof domains[method] === "function",
      "RUNTIME_CONFIGURATION_ERROR",
      `Domain runtime is missing ${method}.`,
      { status: 500 }
    );
  }

  async function approvedCatalog() {
    return validateOfferCatalog(await catalogPort.current());
  }

  async function audit(
    client,
    {
      organizationId,
      projectId = null,
      actorId,
      action,
      targetType,
      targetId,
      requestId = null,
      metadata = {}
    }
  ) {
    await client.query(
      `select ss.write_audit_event(
         $1, $2, 'user', $3, $4, $5, $6, $7, $8::jsonb
       )`,
      [
        organizationId,
        projectId,
        actorId,
        action,
        targetType,
        targetId,
        requestId,
        JSON.stringify(metadata)
      ]
    );
  }

  async function membership(
    client,
    actor,
    organizationId,
    allowedRoles = null
  ) {
    requiredActor(actor);
    const result = await client.query(
      `select membership.role, organization.state
         from ss.organization_memberships membership
         join ss.organizations organization
           on organization.id = membership.organization_id
        where membership.organization_id = $1
          and membership.user_id = $2
          and membership.state = 'active'`,
      [organizationId, actor.userId]
    );
    const row = result.rows[0];
    invariant(
      row && row.state === "active",
      "NOT_FOUND",
      "The requested item was not found.",
      { status: 404 }
    );
    invariant(
      !allowedRoles || allowedRoles.has(row.role),
      "FORBIDDEN",
      "This account cannot make that change.",
      { status: 403 }
    );
    return row.role;
  }

  async function projectScope(actor, projectId) {
    requiredActor(actor);
    const id = uuid(projectId, "Project ID");
    return authority.service(
      { userId: actor.userId, readOnly: true },
      async (client) => {
        const result = await client.query(
          `select project.organization_id
             from ss.projects project
             join ss.organization_memberships membership
               on membership.organization_id = project.organization_id
              and membership.user_id = $2
              and membership.state = 'active'
            where project.id = $1`,
          [id, actor.userId]
        );
        invariant(
          result.rowCount === 1,
          "NOT_FOUND",
          "The requested item was not found.",
          { status: 404 }
        );
        return {
          projectId: id,
          organizationId: result.rows[0].organization_id
        };
      }
    );
  }

  async function idempotent(
    client,
    {
      actor,
      organizationId,
      projectId = null,
      routeKey,
      key,
      purpose,
      work
    }
  ) {
    const selectedKey = commandId(key);
    const requestDigest = digest({
      organizationId,
      projectId,
      routeKey,
      purpose
    });
    const existing = await client.query(
      `select request_digest, state, response_body
         from ss.idempotency_keys
        where principal_id = $1
          and route_key = $2
          and idempotency_key = $3
        for update`,
      [actor.userId, routeKey, selectedKey]
    );
    if (existing.rows[0]) {
      invariant(
        existing.rows[0].request_digest === requestDigest,
        "IDEMPOTENCY_CONFLICT",
        "That idempotency key was already used for another action.",
        { status: 409 }
      );
      invariant(
        existing.rows[0].state === "completed",
        "COMMAND_IN_PROGRESS",
        "That action has not reached a safe final state.",
        { status: 409 }
      );
      return existing.rows[0].response_body;
    }
    const commandRowId = randomUUID();
    await client.query(
      `insert into ss.idempotency_keys (
         id, organization_id, principal_id, route_key, idempotency_key,
         request_digest, state, created_at, expires_at
       ) values (
         $1, $2, $3, $4, $5, $6, 'running', $7,
         $7::timestamptz + interval '24 hours'
       )`,
      [
        commandRowId,
        organizationId,
        actor.userId,
        routeKey,
        selectedKey,
        requestDigest,
        now(clock)
      ]
    );
    await assertWriteQuota(client, {
      actor,
      organizationId,
      routeKey
    });
    const result = await work(commandRowId);
    await client.query(
      `update ss.idempotency_keys
          set state = 'completed',
              response_status = 200,
              response_body = $2::jsonb
        where id = $1`,
      [commandRowId, JSON.stringify(result)]
    );
    return result;
  }

  async function assertWriteQuota(
    client,
    { actor, organizationId, routeKey }
  ) {
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`sitesourcery.write-quota:${organizationId}:${actor.userId}`]
    );
    const writes = await client.query(
      `select count(*)::integer as count
         from ss.idempotency_keys
        where organization_id = $1
          and principal_id = $2
          and created_at >= $3::timestamptz - ($4::bigint * interval '1 millisecond')`,
      [
        organizationId,
        actor.userId,
        now(clock),
        configuredResourceLimits.perPrincipal.windowMs
      ]
    );
    invariant(
      Number(writes.rows[0]?.count) <= configuredResourceLimits.perPrincipal.attempts,
      "PROJECT_WRITE_RATE_LIMITED",
      "Too many project changes were requested. Retry shortly.",
      { status: 429 }
    );
    if (routeKey !== "project.version.create") return;
    const compiles = await client.query(
      `select count(*)::integer as count
         from ss.idempotency_keys
        where organization_id = $1
          and principal_id = $2
          and route_key = 'project.version.create'
          and created_at >= $3::timestamptz - ($4::bigint * interval '1 millisecond')`,
      [
        organizationId,
        actor.userId,
        now(clock),
        configuredResourceLimits.compile.windowMs
      ]
    );
    invariant(
      Number(compiles.rows[0]?.count) <= configuredResourceLimits.compile.attempts,
      "COMPILE_RATE_LIMITED",
      "Too many versions were compiled. Retry shortly.",
      { status: 429 }
    );
  }

  async function projectWrite(
    actor,
    projectId,
    {
      routeKey,
      key,
      purpose,
      allowedRoles = WRITE_ROLES,
      work
    }
  ) {
    const scope = await projectScope(actor, projectId);
    try {
      return await authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await membership(
            client,
            actor,
            scope.organizationId,
            allowedRoles
          );
          return idempotent(client, {
            actor,
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            routeKey,
            key,
            purpose,
            work: (requestId) =>
              work(client, {
                ...scope,
                requestId
              })
          });
        }
      );
    } catch (error) {
      throw translatePostgres(error);
    }
  }

  async function assertAlakazamSiteMutable(client, scope) {
    const selected = await client.query(
      `select
         project.id,
         exists (
           select 1
             from ss.alakazam_fulfillment_projection projection
            where projection.organization_id = project.organization_id
              and projection.project_id = project.id
         ) as has_fulfillment,
         exists (
           select 1
             from ss.alakazam_subscriptions subscription
            where subscription.organization_id = project.organization_id
              and subscription.project_id = project.id
              and subscription.status <> 'ended'
         ) as has_subscription,
         exists (
           select 1
             from ss.alakazam_checkout_dispatches dispatch
            where dispatch.organization_id = project.organization_id
              and dispatch.project_id = project.id
              and dispatch.state not in ('failed', 'expired')
         ) as has_checkout,
         exists (
           select 1
             from ss.alakazam_customer_provisions provision
             join ss.alakazam_change_quotes quote
               on quote.organization_id = provision.organization_id
              and quote.id = provision.quote_id
            where provision.organization_id = project.organization_id
              and provision.project_id = project.id
              and provision.state in (
                'reserved', 'confirmed',
                'reconciliation_required'
              )
              and quote.state = 'quoted'
              and quote.expires_at > $3
         ) as has_customer_setup
       from ss.projects project
      where project.organization_id = $1
        and project.id = $2
        and project.lifecycle = 'active'
      for update of project`,
      [
        scope.organizationId,
        scope.projectId,
        now(clock)
      ]
    );
    const state = selected.rows[0];
    invariant(
      selected.rowCount === 1 &&
        state.has_fulfillment === false &&
        state.has_subscription === false &&
        state.has_checkout === false &&
        state.has_customer_setup === false,
      "ALAKAZAM_SITE_CHANGE_UNAVAILABLE",
      "This accepted website setup is already bound to Alakazam. Refresh the account before changing it.",
      { status: 409 }
    );
  }

  async function projectRows(client, actor, projectId) {
    const result = await client.query(
      `select
         project.*,
         membership.role as membership_role,
         safety.state as safety_state,
         access.visibility,
         address.id as address_id,
         address.kind as address_kind,
         address.label as address_label,
         address.serving_hostname,
         address.state as address_state,
         address.revision as address_revision,
         verification.id as verification_id,
         verification.method as verification_method,
         verification.state as verification_state,
         verification.requested_at as verification_requested_at,
         draft.raw_facts,
         draft.revision as draft_revision,
         draft.updated_at as draft_updated_at,
         serving.state as serving_state,
         serving.current_release_id,
         serving.previous_release_id,
         subscription.id as subscription_id,
         subscription.status as subscription_status,
         subscription.revision as subscription_revision,
         subscription.current_period_ends_at,
         subscription.cancelled_at,
         subscription.retention_ends_at as subscription_retention_ends_at,
         plan.plan_key as subscription_offer_key,
         policy.tenure_id as subscription_tenure_id,
         ownership.id as ownership_entitlement_id,
         ownership.state as ownership_entitlement_state,
         ownership.completed_at as ownership_completed_at,
         ownership_quote.offer_key as ownership_offer_key,
         ownership_quote.tenure_id as ownership_tenure_id,
         download_entitlement.id as download_entitlement_id,
         download_entitlement.activated_at
           as download_entitlement_activated_at,
         download_entitlement.accepted_disclosure_digest
           as download_accepted_disclosure_digest,
         download_receipt.id as download_receipt_id,
         download_receipt.tax_minor
           as download_tax_minor,
         download_receipt.total_minor
           as download_total_minor,
         download_receipt.tax_mode
           as download_tax_mode,
         download_receipt.settled_at
           as download_payment_settled_at
       from ss.projects project
       join ss.organization_memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = $2
        and membership.state = 'active'
       left join ss.project_safety_projection safety
         on safety.project_id = project.id
       left join ss.project_access_projection access
         on access.project_id = project.id
       left join ss.project_address_projection address_projection
         on address_projection.project_id = project.id
       left join ss.project_addresses address
         on address.organization_id = project.organization_id
        and address.id = address_projection.current_address_id
       left join lateral (
         select request.*
         from ss.domain_verification_requests request
         where request.address_id = address.id
         order by request.requested_at desc, request.id desc
         limit 1
       ) verification on true
       left join ss.project_drafts draft
         on draft.project_id = project.id
       left join ss.project_serving_projection serving
         on serving.project_id = project.id
       left join ss.stripe_subscriptions subscription
         on subscription.project_id = project.id
       left join ss.catalog_prices price
         on price.id = subscription.catalog_price_id
       left join ss.catalog_plans plan
         on plan.id = price.plan_id
       left join ss.catalog_offer_policies policy
         on policy.plan_id = plan.id
        and policy.catalog_version = plan.catalog_version
       left join ss.site_ownership_entitlements ownership
         on ownership.organization_id =
              project.organization_id
        and ownership.project_id = project.id
        and ownership.state = 'completed'
       left join ss.checkout_quote_bindings
         ownership_binding
         on ownership_binding.organization_id =
              ownership.organization_id
        and ownership_binding.checkout_intent_id =
              ownership.checkout_intent_id
       left join ss.commerce_quotes ownership_quote
         on ownership_quote.organization_id =
              ownership_binding.organization_id
        and ownership_quote.id =
              ownership_binding.quote_id
       left join ss.commerce_v2_project_entitlements
         download_entitlement
         on download_entitlement.organization_id =
              project.organization_id
        and download_entitlement.project_id = project.id
        and download_entitlement.kind = 'spark_download'
        and download_entitlement.scope = 'editor_project'
        and download_entitlement.state = 'active'
       left join ss.commerce_v2_download_payment_receipts
         download_receipt
         on download_receipt.organization_id =
              download_entitlement.organization_id
        and download_receipt.id =
              download_entitlement.source_receipt_id
      where project.id = $1`,
      [projectId, actor.userId]
    );
    invariant(
      result.rowCount === 1,
      "NOT_FOUND",
      "The requested item was not found.",
      { status: 404 }
    );
    return result.rows[0];
  }

  async function versionRows(client, projectId) {
    const result = await client.query(
      `select
         version.id,
         version.version_number,
         version.compiler_schema,
         version.compiler_revision,
         version.created_at,
         version.raw_facts,
         fact.content_digest,
         artifact.artifact_digest,
         artifact.html_bytes,
         state.state,
         exists (
           select 1 from ss.version_attestations attestation
           where attestation.version_id = version.id
         ) as attested,
         (
           select min(event.occurred_at)
           from ss.version_state_events event
           where event.version_id = version.id and event.state = 'ready'
         ) as ready_at,
         (
           select min(event.occurred_at)
           from ss.version_state_events event
           where event.version_id = version.id
             and event.state = 'accepted_release'
         ) as accepted_at
       from ss.site_versions version
       join ss.fact_sets fact on fact.id = version.fact_set_id
       join ss.artifacts artifact on artifact.id = version.artifact_id
       left join ss.version_state_projection state
         on state.version_id = version.id
      where version.project_id = $1
      order by version.version_number`,
      [projectId]
    );
    return result.rows;
  }

  async function loadProject(client, actor, projectId) {
    const row = await projectRows(client, actor, projectId);
    const versions = await versionRows(client, projectId);
    const accepted = [...versions]
      .reverse()
      .find((version) => version.state === "accepted_release");
    const legal = await loadProjectLegal(
      client,
      projectId,
      await projectLegalArtifactsReadable()
    );
    return {
      id: row.id,
      projectId: row.id,
      organizationId: row.organization_id,
      name: row.name,
      lifecycle: row.lifecycle,
      revision: Number(row.revision),
      visibility: row.visibility ?? "public",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      draft: {
        revision: Number(row.draft_revision ?? 0),
        rawFacts: row.raw_facts ?? {},
        updatedAt: iso(row.draft_updated_at ?? row.updated_at)
      },
      versions: versions.map(publicVersion),
      acceptedVersionId: accepted?.id ?? null,
      entitlements: publicDownloadEntitlements(
        row,
        accepted?.id ?? null
      ),
      address: publicAddress(row),
      subscription: publicSubscription(row),
      serving: {
        state: row.serving_state ?? "unpublished",
        currentVersionId: accepted?.id ?? null,
        currentReleaseId: row.current_release_id,
        previousReleaseId: row.previous_release_id,
        updatedAt: iso(row.updated_at)
      },
      legal
    };
  }

  async function loadProjectLegal(client, projectId, includeArtifacts) {
    const result = await client.query(
      `select acceptance.document_id, document.kind, document.version,
              document.content_digest,
              acceptance.accepted_at,
              required.acceptance_id is not null as is_current
         from ss.term_acceptances acceptance
         join ss.legal_documents document
           on document.id = acceptance.document_id
         left join ss.project_required_terms required
           on required.project_id = acceptance.project_id
          and required.kind = document.kind
          and required.acceptance_id = acceptance.id
        where acceptance.project_id = $1
        order by required.acceptance_id is not null desc,
                 acceptance.accepted_at, document.kind, document.id`,
      [projectId]
    );
    const evidence = new Map();
    if (includeArtifacts) {
      const artifacts = await client.query(
        `select document_id, artifact_uri
           from ss.legal_document_artifacts
          where document_id = any($1::uuid[])`,
        [result.rows.map((row) => row.document_id)]
      );
      for (const artifact of artifacts.rows) {
        evidence.set(artifact.document_id, artifact.artifact_uri);
      }
    }
    const current = [];
    const history = [];
    const seen = new Set();
    for (const row of result.rows) {
      const item = {
        kind: row.kind,
        version: row.version,
        contentDigest: row.content_digest,
        evidenceUri: evidence.get(row.document_id) ?? null,
        acceptedAt: iso(row.accepted_at)
      };
      if (row.is_current === true) {
        current.push(item);
        seen.add(row.kind);
      } else {
        history.push(item);
      }
    }
    return { current, history };
  }

  async function insertAddress(
    client,
    { actor, organizationId, projectId, input }
  ) {
    const address = addressInput(input, licensedBaseDomain);
    const id = randomUUID();
    await client.query(
      `update ss.project_addresses
          set state = 'detached',
              detached_at = $3,
              serving_hostname = null
        where organization_id = $1
          and project_id = $2
          and state not in ('detached', 'released')`,
      [organizationId, projectId, now(clock)]
    );
    await client.query(
      `insert into ss.project_addresses (
         id, organization_id, project_id, kind, ownership, label,
         retained_domain, serving_hostname, state, allocated_at, configured_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         case when $9 = 'configured' then $10::timestamptz else null end
       )`,
      [
        id,
        organizationId,
        projectId,
        address.kind,
        address.ownership,
        address.label,
        address.retainedDomain,
        address.hostname,
        address.state,
        now(clock)
      ]
    );
    await client.query(
      `insert into ss.project_address_projection (
         organization_id, project_id, current_address_id, updated_at
       ) values ($1, $2, $3, $4)
       on conflict (project_id) do update
         set current_address_id = excluded.current_address_id,
             updated_at = excluded.updated_at`,
      [organizationId, projectId, id, now(clock)]
    );
    await client.query(
      `update ss.commerce_quotes
          set state = 'void',
              voided_at = $3,
              void_reason = 'address_changed'
        where organization_id = $1
          and project_id = $2
          and state in ('quoted', 'checkout_dispatching')`,
      [organizationId, projectId, now(clock)]
    );
    await client.query(
      `update ss.projects
          set revision = revision + 1
        where organization_id = $1 and id = $2`,
      [organizationId, projectId]
    );
    return id;
  }

  async function loadCommerceQuote(
    client,
    actor,
    projectId,
    quoteId,
    catalog
  ) {
    const result = await client.query(
      `select
         quote.*,
         binding.checkout_intent_id,
         checkout.expires_at as checkout_expires_at,
         checkout.provider_checkout_url as checkout_url
       from ss.commerce_quotes quote
       join ss.organization_memberships membership
         on membership.organization_id = quote.organization_id
        and membership.user_id = $3
        and membership.state = 'active'
       left join ss.checkout_quote_bindings binding
         on binding.quote_id = quote.id
       left join ss.checkout_intents checkout
         on checkout.id = binding.checkout_intent_id
      where quote.project_id = $1
        and quote.id = $2`,
      [projectId, quoteId, actor.userId]
    );
    invariant(
      result.rowCount === 1,
      "NOT_FOUND",
      "The requested item was not found.",
      { status: 404 }
    );
    const row = result.rows[0];
    const selected = resolveOffer(catalog, row.offer_key);
    row.product_snapshot = {
      productId: selected.product.productId,
      name: selected.product.name,
      description: selected.product.description,
      implementationContract:
        selected.product.implementationContract
    };
    row.tenure_snapshot = {
      tenureId: selected.tenure.tenureId,
      name: selected.tenure.name,
      billingShape: selected.tenure.billingShape,
      terms: selected.tenure.terms
    };
    if (
      row.state === "quoted" &&
      Date.parse(row.expires_at) <= Date.parse(now(clock))
    ) {
      row.state = "expired";
    }
    return row;
  }

  async function exactOfferPolicy(client, catalog, selected, issuedAt) {
    const result = await client.query(
      `select
         policy.*,
         line.id as price_line_id,
         line.component,
         line.stripe_price_ref,
         price.id as catalog_price_id,
         price.currency,
         price.unit_amount_minor,
         price.cadence
       from ss.catalog_offer_policies policy
       join ss.catalog_offer_price_lines line
         on line.offer_policy_id = policy.id
       join ss.catalog_prices price
         on price.id = line.catalog_price_id
        and price.approved_at <= $3
        and price.active_from <= $3
        and (price.active_until is null or price.active_until > $3)
      where policy.offer_key = $1
        and policy.catalog_version = $2
        and policy.active_from <= $3
        and (policy.active_until is null or policy.active_until > $3)
      order by line.component, line.id`,
      [selected.offer.offerId, catalog.catalogVersion, issuedAt]
    );
    invariant(
      result.rowCount > 0,
      "OFFER_CONFIGURATION_MISMATCH",
      "The approved offer is not installed in the production pricing authority.",
      { status: 503 }
    );
    const policy = result.rows[0];
    invariant(
      policy.product_id === selected.offer.productId &&
        policy.tenure_id === selected.offer.tenureId &&
        policy.terms_version === catalog.termsVersion &&
        JSON.stringify(policy.eligible_address_modes) ===
          JSON.stringify(selected.offer.eligibleAddressModes),
      "OFFER_CONFIGURATION_MISMATCH",
      "The approved catalog and production pricing authority do not match.",
      { status: 503 }
    );
    const expected = [];
    if (selected.offer.amounts.oneTime) {
      expected.push({
        component: "one_time",
        cadence: "one_time",
        amountMinor: selected.offer.amounts.oneTime.amountMinor,
        currency: selected.offer.amounts.oneTime.currency,
        stripePriceRef: selected.offer.stripePriceRefs.oneTime
      });
    }
    if (selected.offer.amounts.recurring) {
      expected.push({
        component: "recurring",
        cadence: selected.offer.amounts.recurring.interval,
        amountMinor:
          selected.offer.amounts.recurring.amountMinor,
        currency: selected.offer.amounts.recurring.currency,
        stripePriceRef: selected.offer.stripePriceRefs.recurring
      });
    }
    invariant(
      expected.length === result.rowCount &&
        expected.every((line) =>
          result.rows.some(
            (row) =>
              row.component === line.component &&
              row.cadence === line.cadence &&
              Number(row.unit_amount_minor) === line.amountMinor &&
              row.currency === line.currency &&
              row.stripe_price_ref === line.stripePriceRef
          )
        ),
      "OFFER_CONFIGURATION_MISMATCH",
      "The approved offer price lines do not match the production pricing authority.",
      { status: 503 }
    );
    return {
      policy,
      lines: result.rows
    };
  }

  function paymentDigest(value, field) {
    const selected = requiredText(value, field, 64);
    invariant(
      /^[a-f0-9]{64}$/u.test(selected),
      "INVALID_INPUT",
      `${field} is invalid.`,
      { status: 400 }
    );
    return selected;
  }

  function checkoutResponse(row) {
    const checkout = {
      checkoutId: row.id,
      providerCheckoutId: row.stripe_checkout_session_id,
      state: row.state,
      url: row.provider_checkout_url,
      expiresAt: iso(row.expires_at)
    };
    return {
      checkout,
      checkoutId: checkout.checkoutId,
      checkoutUrl: checkout.url,
      url: checkout.url,
      expiresAt: checkout.expiresAt
    };
  }

  function billingPortalResponse(row) {
    return {
      portalSessionId: row.stripe_portal_session_id,
      portalUrl: row.provider_portal_url,
      url: row.provider_portal_url
    };
  }

  function providerUnavailable(error, capability, resourceId) {
    const certainty = providerEffectCertainty(error);
    return new HostedError(
      certainty === "ambiguous"
        ? `${capability}_RECONCILIATION_REQUIRED`
        : `${capability}_UNAVAILABLE`,
      certainty === "ambiguous"
        ? "The payment provider may have accepted this action. Site Sourcery will reconcile the same idempotent request before another attempt."
        : "The payment provider did not accept this action.",
      {
        status: 503,
        details: {
          resourceId,
          certainty,
          providerErrorCode: providerErrorCode(error)
        }
      }
    );
  }

  async function checkoutStageRows(
    client,
    actor,
    organizationId,
    projectId,
    checkoutId
  ) {
    const checkoutResult = await client.query(
      `select
         checkout.*,
         binding.quote_id,
         binding.accepted_disclosure_digest,
         quote.offer_key,
         quote.catalog_version,
         quote.disclosure_digest,
         quote.state as quote_state,
         quote.expires_at as quote_expires_at,
         customer.stripe_customer_id
       from ss.checkout_intents checkout
       join ss.checkout_quote_bindings binding
         on binding.organization_id = checkout.organization_id
        and binding.checkout_intent_id = checkout.id
       join ss.commerce_quotes quote
         on quote.organization_id = binding.organization_id
        and quote.id = binding.quote_id
       left join ss.stripe_customers customer
         on customer.organization_id = checkout.organization_id
      where checkout.organization_id = $1
        and checkout.project_id = $2
        and checkout.id = $3
        and checkout.created_by_user_id = $4
      for update of checkout, quote`,
      [organizationId, projectId, checkoutId, actor.userId]
    );
    invariant(
      checkoutResult.rowCount === 1,
      "CHECKOUT_RECONCILIATION_REQUIRED",
      "The staged Checkout Session could not be reconciled.",
      { status: 503 }
    );
    const row = checkoutResult.rows[0];
    const lines = await client.query(
      `select
         quote_line.id,
         quote_line.position,
         quote_line.source_kind,
         quote_line.billing_cadence,
         quote_line.currency,
         quote_line.amount_minor,
         quote_line.stripe_price_ref
       from ss.checkout_intent_price_lines checkout_line
       join ss.commerce_quote_price_lines quote_line
         on quote_line.organization_id =
              checkout_line.organization_id
        and quote_line.id =
              checkout_line.quote_price_line_id
      where checkout_line.organization_id = $1
        and checkout_line.project_id = $2
        and checkout_line.checkout_intent_id = $3
      order by quote_line.position`,
      [organizationId, projectId, checkoutId]
    );
    invariant(
      lines.rowCount > 0,
      "CHECKOUT_RECONCILIATION_REQUIRED",
      "The staged Checkout Session has no authoritative price lines.",
      { status: 503 }
    );
    invariant(
      lines.rows.every(
        (line) => line.source_kind === "abracadabra_product"
      ),
      "DOMAIN_CHECKOUT_HELD",
      "Domain payment uses the separate authorize, register, and capture workflow.",
      { status: 503 }
    );
    const amounts = {};
    const refs = {};
    for (const line of lines.rows) {
      const money = {
        amountMinor: Number(line.amount_minor),
        currency: line.currency
      };
      if (line.billing_cadence === "one_time") {
        invariant(
          !amounts.oneTime,
          "CHECKOUT_AUTHORITY_INVALID",
          "Checkout has more than one one-time website price.",
          { status: 503 }
        );
        amounts.oneTime = money;
        refs.oneTime = line.stripe_price_ref;
      } else {
        invariant(
          !amounts.recurring,
          "CHECKOUT_AUTHORITY_INVALID",
          "Checkout has more than one recurring website price.",
          { status: 503 }
        );
        amounts.recurring = {
          ...money,
          interval: line.billing_cadence
        };
        refs.recurring = line.stripe_price_ref;
      }
    }
    const purpose = {
      tenantId: organizationId,
      customerId: actor.userId,
      projectId,
      quoteId: row.quote_id,
      quoteVersion: 1,
      catalogVersion: row.catalog_version,
      offerId: row.offer_key,
      disclosureDigest: row.disclosure_digest,
      lines: [
        {
          lineItemId: `website:${row.offer_key}`,
          receiptGroupId: `website:${row.offer_key}`,
          amounts,
          authority: {
            type: "stripe_price_refs",
            refs
          }
        }
      ]
    };
    const purposeDigest = digest(purpose);
    invariant(
      row.purpose_digest === purposeDigest,
      "CHECKOUT_RECONCILIATION_REQUIRED",
      "The staged Checkout purpose no longer matches its immutable quote.",
      { status: 503 }
    );
    return {
      row,
      purpose,
      purposeDigest,
      providerRequest: {
        idempotencyKey: row.provider_idempotency_key,
        purposeDigest,
        purpose,
        ...(row.stripe_customer_id
          ? {
              stripeCustomerId: row.stripe_customer_id
            }
          : {})
      }
    };
  }

  async function stageCheckout(
    actor,
    projectId,
    input
  ) {
    const scope = await projectScope(actor, projectId);
    const quoteId = uuid(input.quoteId, "Quote ID");
    const acceptedDisclosureDigest = paymentDigest(
      input.acceptedDisclosureDigest,
      "Accepted quote digest"
    );
    const key = commandId(input.commandId);
    const routeKey = "commerce.checkout";
    const requestDigest = digest({
      routeKey,
      purpose: {
        projectId: scope.projectId,
        quoteId,
        acceptedDisclosureDigest
      }
    });
    return authority.service(
      {
        userId: actor.userId,
        organizationId: scope.organizationId
      },
      async (client) => {
        await membership(
          client,
          actor,
          scope.organizationId,
          BILLING_ROLES
        );
        const existing = await client.query(
          `select *
             from ss.idempotency_keys
            where principal_id = $1
              and route_key = $2
              and idempotency_key = $3
            for update`,
          [actor.userId, routeKey, key]
        );
        if (existing.rows[0]) {
          const command = existing.rows[0];
          invariant(
            command.request_digest === requestDigest,
            "IDEMPOTENCY_CONFLICT",
            "That idempotency key was already used for another action.",
            { status: 409 }
          );
          if (command.state === "completed") {
            return {
              completed: true,
              response: command.response_body
            };
          }
          invariant(
            command.state === "running" &&
              command.resource_type ===
                "checkout_intent" &&
              command.resource_id,
            "CHECKOUT_REQUIRES_NEW_COMMAND",
            "That Checkout attempt reached a final failure. Request a fresh quote and use a new idempotency key.",
            { status: 409 }
          );
          const staged = await checkoutStageRows(
            client,
            actor,
            scope.organizationId,
            scope.projectId,
            command.resource_id
          );
          if (
            staged.row.state === "open" ||
            staged.row.state === "completed"
          ) {
            const response = checkoutResponse(staged.row);
            await client.query(
              `update ss.idempotency_keys
                  set state = 'completed',
                      response_status = 201,
                      response_body = $2::jsonb
                where id = $1`,
              [command.id, JSON.stringify(response)]
            );
            return { completed: true, response };
          }
          invariant(
            staged.row.state === "provider_pending",
            "CHECKOUT_REQUIRES_NEW_COMMAND",
            "That Checkout attempt is not recoverable with this command.",
            { status: 409 }
          );
          return {
            completed: false,
            commandRowId: command.id,
            scope,
            ...staged
          };
        }

        const quoted = await client.query(
          `select
             quote.*,
             policy.price_id as primary_catalog_price_id
           from ss.commerce_quotes quote
           join ss.catalog_offer_policies policy
             on policy.id = quote.offer_policy_id
          where quote.organization_id = $1
            and quote.project_id = $2
            and quote.id = $3
          for update of quote`,
          [scope.organizationId, scope.projectId, quoteId]
        );
        const quote = quoted.rows[0];
        invariant(
          quote,
          "NOT_FOUND",
          "The requested item was not found.",
          { status: 404 }
        );
        const acceptedAt = now(clock);
        invariant(
          quote.state === "quoted" &&
            Date.parse(quote.expires_at) >
              Date.parse(acceptedAt),
          "QUOTE_NOT_CHECKOUTABLE",
          "That quote is unavailable or expired. Request a new quote.",
          { status: 409 }
        );
        invariant(
          quote.disclosure_digest ===
            acceptedDisclosureDigest,
          "QUOTE_ACCEPTANCE_MISMATCH",
          "The accepted quote does not match the server disclosure.",
          { status: 409 }
        );
        const address = await client.query(
          `select address.id
             from ss.project_address_projection projection
             join ss.project_addresses address
               on address.organization_id = projection.organization_id
              and address.id = projection.current_address_id
            where projection.organization_id = $1
              and projection.project_id = $2
              and address.id = $3
              and address.revision = $4
              and (
                case when address.kind = 'licensed'
                  then 'licensed'
                  else 'customer_owned'
                end
              ) = $5`,
          [
            scope.organizationId,
            scope.projectId,
            quote.address_id,
            Number(quote.address_revision),
            quote.address_mode
          ]
        );
        invariant(
          address.rowCount === 1,
          "QUOTE_STALE",
          "The project address changed. Request a new quote.",
          { status: 409 }
        );
        if (quote.subscription_id) {
          const subscription = await client.query(
            `select id
               from ss.stripe_subscriptions
              where organization_id = $1
                and project_id = $2
                and id = $3
                and revision = $4`,
            [
              scope.organizationId,
              scope.projectId,
              quote.subscription_id,
              Number(quote.subscription_revision)
            ]
          );
          invariant(
            subscription.rowCount === 1,
            "QUOTE_STALE",
            "The project billing state changed. Request a new quote.",
            { status: 409 }
          );
        }
        const priceLines = await client.query(
          `select *
             from ss.commerce_quote_price_lines
            where organization_id = $1
              and project_id = $2
              and quote_id = $3
            order by position`,
          [scope.organizationId, scope.projectId, quoteId]
        );
        invariant(
          priceLines.rowCount > 0,
          "CHECKOUT_AUTHORITY_INVALID",
          "That quote has no authoritative prices.",
          { status: 503 }
        );
        invariant(
          priceLines.rows.every(
            (line) =>
              line.source_kind ===
              "abracadabra_product"
          ),
          "DOMAIN_CHECKOUT_HELD",
          "Domain payment uses the separate authorize, register, and capture workflow.",
          { status: 503 }
        );

        const checkoutId = randomUUID();
        const providerIdempotencyKey =
          `hosted:checkout:${scope.organizationId}:${key}`;
        const amounts = {};
        const refs = {};
        for (const line of priceLines.rows) {
          const money = {
            amountMinor: Number(line.amount_minor),
            currency: line.currency
          };
          if (line.billing_cadence === "one_time") {
            invariant(
              !amounts.oneTime,
              "CHECKOUT_AUTHORITY_INVALID",
              "Checkout has more than one one-time website price.",
              { status: 503 }
            );
            amounts.oneTime = money;
            refs.oneTime = line.stripe_price_ref;
          } else {
            invariant(
              !amounts.recurring,
              "CHECKOUT_AUTHORITY_INVALID",
              "Checkout has more than one recurring website price.",
              { status: 503 }
            );
            amounts.recurring = {
              ...money,
              interval: line.billing_cadence
            };
            refs.recurring = line.stripe_price_ref;
          }
        }
        const purpose = {
          tenantId: scope.organizationId,
          customerId: actor.userId,
          projectId: scope.projectId,
          quoteId,
          quoteVersion: 1,
          catalogVersion: quote.catalog_version,
          offerId: quote.offer_key,
          disclosureDigest:
            quote.disclosure_digest,
          lines: [
            {
              lineItemId: `website:${quote.offer_key}`,
              receiptGroupId:
                `website:${quote.offer_key}`,
              amounts,
              authority: {
                type: "stripe_price_refs",
                refs
              }
            }
          ]
        };
        const purposeDigest = digest(purpose);
        const amountMinor = priceLines.rows.reduce(
          (total, line) =>
            total + Number(line.amount_minor),
          0
        );
        const commandRowId = randomUUID();
        await client.query(
          `insert into ss.idempotency_keys (
             id, organization_id, principal_id, route_key,
             idempotency_key, request_digest, state,
             resource_type, resource_id, created_at,
             expires_at
           ) values (
             $1, $2, $3, $4, $5, $6, 'running',
             'checkout_intent', $7, $8,
             $8::timestamptz + interval '24 hours'
           )`,
          [
            commandRowId,
            scope.organizationId,
            actor.userId,
            routeKey,
            key,
            requestDigest,
            checkoutId,
            acceptedAt
          ]
        );
        await client.query(
          `insert into ss.checkout_intents (
             id, organization_id, project_id,
             catalog_price_id, currency, amount_minor,
             state, created_by_user_id, purpose_digest,
             provider_idempotency_key,
             provider_effect_certainty, created_at
           ) values (
             $1, $2, $3, $4, $5, $6,
             'provider_pending', $7, $8, $9, null, $10
           )`,
          [
            checkoutId,
            scope.organizationId,
            scope.projectId,
            quote.primary_catalog_price_id,
            quote.currency,
            amountMinor,
            actor.userId,
            purposeDigest,
            providerIdempotencyKey,
            acceptedAt
          ]
        );
        await client.query(
          `insert into ss.checkout_quote_bindings (
             organization_id, project_id,
             checkout_intent_id, quote_id,
             accepted_disclosure_digest,
             accepted_by_user_id, accepted_at
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            scope.organizationId,
            scope.projectId,
            checkoutId,
            quoteId,
            acceptedDisclosureDigest,
            actor.userId,
            acceptedAt
          ]
        );
        for (const line of priceLines.rows) {
          await client.query(
            `insert into ss.checkout_intent_price_lines (
               organization_id, project_id,
               checkout_intent_id, quote_price_line_id
             ) values ($1, $2, $3, $4)`,
            [
              scope.organizationId,
              scope.projectId,
              checkoutId,
              line.id
            ]
          );
        }
        await client.query(
          `update ss.commerce_quotes
              set state = 'checkout_dispatching'
            where organization_id = $1
              and project_id = $2
              and id = $3
              and state = 'quoted'`,
          [scope.organizationId, scope.projectId, quoteId]
        );
        await audit(client, {
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          actorId: actor.userId,
          action: "commerce.checkout.dispatching",
          targetType: "checkout_intent",
          targetId: checkoutId,
          requestId: commandRowId,
          metadata: {
            quoteId,
            purposeDigest,
            providerEffect: false
          }
        });
        const staged = await checkoutStageRows(
          client,
          actor,
          scope.organizationId,
          scope.projectId,
          checkoutId
        );
        return {
          completed: false,
          commandRowId,
          scope,
          ...staged
        };
      }
    );
  }

  async function recordCheckoutFailure(staged, error) {
    const certainty = providerEffectCertainty(error);
    const errorCode = providerErrorCode(error);
    await authority.service(
      {
        userId: staged.row.created_by_user_id,
        organizationId: staged.scope.organizationId
      },
      async (client) => {
        await client.query(
          `update ss.checkout_intents
              set state = case
                    when $4 = 'not_submitted'
                      then 'failed'
                    else state
                  end,
                  provider_effect_certainty = $4,
                  provider_error_code = $5
            where organization_id = $1
              and project_id = $2
              and id = $3
              and state = 'provider_pending'`,
          [
            staged.scope.organizationId,
            staged.scope.projectId,
            staged.row.id,
            certainty,
            errorCode
          ]
        );
        if (certainty === "not_submitted") {
          await client.query(
            `update ss.commerce_quotes
                set state = 'void',
                    voided_at = $4,
                    void_reason =
                      'checkout_provider_not_submitted'
              where organization_id = $1
                and project_id = $2
                and id = $3
                and state = 'checkout_dispatching'`,
            [
              staged.scope.organizationId,
              staged.scope.projectId,
              staged.row.quote_id,
              now(clock)
            ]
          );
          await client.query(
            `update ss.idempotency_keys
                set state = 'failed',
                    response_status = 503,
                    response_body = $2::jsonb
              where id = $1
                and state = 'running'`,
            [
              staged.commandRowId,
              JSON.stringify({
                error: {
                  code: "CHECKOUT_UNAVAILABLE",
                  certainty,
                  providerErrorCode: errorCode
                }
              })
            ]
          );
        }
      }
    );
  }

  async function finalizeCheckout(
    actor,
    staged,
    result
  ) {
    const selected = checkoutProviderResult(
      result,
      now(clock)
    );
    return authority.service(
      {
        userId: actor.userId,
        organizationId: staged.scope.organizationId
      },
      async (client) => {
        const current = await client.query(
          `select *
             from ss.checkout_intents
            where organization_id = $1
              and project_id = $2
              and id = $3
            for update`,
          [
            staged.scope.organizationId,
            staged.scope.projectId,
            staged.row.id
          ]
        );
        const row = current.rows[0];
        invariant(
          row &&
            row.purpose_digest ===
              staged.purposeDigest &&
            row.provider_idempotency_key ===
              staged.providerRequest.idempotencyKey,
          "CHECKOUT_RECONCILIATION_REQUIRED",
          "The Checkout Session no longer matches its staged purpose.",
          { status: 503 }
        );
        if (
          row.state === "open" ||
          row.state === "completed"
        ) {
          invariant(
            row.stripe_checkout_session_id ===
                selected.checkoutId &&
              row.provider_checkout_url === selected.url &&
              iso(row.expires_at) ===
                selected.expiresAt,
            "CHECKOUT_RECONCILIATION_REQUIRED",
            "The payment provider returned conflicting Checkout facts.",
            { status: 503 }
          );
        } else {
          invariant(
            row.state === "provider_pending",
            "CHECKOUT_RECONCILIATION_REQUIRED",
            "The Checkout Session cannot be finalized from its current state.",
            { status: 503 }
          );
          await client.query(
            `update ss.checkout_intents
                set stripe_checkout_session_id = $4,
                    provider_checkout_url = $5,
                    expires_at = $6,
                    state = 'open',
                    provider_effect_certainty = 'confirmed',
                    provider_error_code = null
              where organization_id = $1
                and project_id = $2
                and id = $3`,
            [
              staged.scope.organizationId,
              staged.scope.projectId,
              staged.row.id,
              selected.checkoutId,
              selected.url,
              selected.expiresAt
            ]
          );
          await client.query(
            `update ss.commerce_quotes
                set state = 'checkout_created'
              where organization_id = $1
                and project_id = $2
                and id = $3
                and state = 'checkout_dispatching'`,
            [
              staged.scope.organizationId,
              staged.scope.projectId,
              staged.row.quote_id
            ]
          );
          await audit(client, {
            organizationId:
              staged.scope.organizationId,
            projectId: staged.scope.projectId,
            actorId: actor.userId,
            action: "commerce.checkout.created",
            targetType: "checkout_intent",
            targetId: staged.row.id,
            requestId: staged.commandRowId,
            metadata: {
              quoteId: staged.row.quote_id,
              providerCheckoutId:
                selected.checkoutId,
              purposeDigest: staged.purposeDigest
            }
          });
        }
        const finalized = await client.query(
          `select *
             from ss.checkout_intents
            where organization_id = $1
              and project_id = $2
              and id = $3`,
          [
            staged.scope.organizationId,
            staged.scope.projectId,
            staged.row.id
          ]
        );
        const response = checkoutResponse(
          finalized.rows[0]
        );
        await client.query(
          `update ss.idempotency_keys
              set state = 'completed',
                  response_status = 201,
                  response_body = $2::jsonb
            where id = $1
              and state = 'running'`,
          [
            staged.commandRowId,
            JSON.stringify(response)
          ]
        );
        return response;
      }
    );
  }

  async function stageBillingPortal(
    actor,
    projectId,
    input
  ) {
    const scope = await projectScope(actor, projectId);
    const key = commandId(input.commandId);
    const routeKey = "billing.portal";
    const requestDigest = digest({
      routeKey,
      purpose: { projectId: scope.projectId }
    });
    return authority.service(
      {
        userId: actor.userId,
        organizationId: scope.organizationId
      },
      async (client) => {
        await membership(
          client,
          actor,
          scope.organizationId,
          BILLING_ROLES
        );
        const existing = await client.query(
          `select *
             from ss.idempotency_keys
            where principal_id = $1
              and route_key = $2
              and idempotency_key = $3
            for update`,
          [actor.userId, routeKey, key]
        );
        if (existing.rows[0]) {
          const command = existing.rows[0];
          invariant(
            command.request_digest === requestDigest,
            "IDEMPOTENCY_CONFLICT",
            "That idempotency key was already used for another action.",
            { status: 409 }
          );
          if (command.state === "completed") {
            return {
              completed: true,
              response: command.response_body
            };
          }
          invariant(
            command.state === "running" &&
              command.resource_type ===
                "billing_portal_session" &&
              command.resource_id,
            "BILLING_PORTAL_REQUIRES_NEW_COMMAND",
            "That billing portal attempt reached a final failure. Use a new idempotency key.",
            { status: 409 }
          );
          const resumed = await client.query(
            `select
               portal.*,
               customer.stripe_customer_id
             from ss.billing_portal_sessions portal
             join ss.stripe_customers customer
               on customer.organization_id =
                    portal.organization_id
              and customer.id =
                    portal.stripe_customer_row_id
            where portal.organization_id = $1
              and portal.project_id = $2
              and portal.id = $3
              and portal.created_by_user_id = $4
            for update of portal`,
            [
              scope.organizationId,
              scope.projectId,
              command.resource_id,
              actor.userId
            ]
          );
          const row = resumed.rows[0];
          invariant(
            row,
            "BILLING_PORTAL_RECONCILIATION_REQUIRED",
            "The staged billing portal session could not be reconciled.",
            { status: 503 }
          );
          if (row.state === "open") {
            const response =
              billingPortalResponse(row);
            await client.query(
              `update ss.idempotency_keys
                  set state = 'completed',
                      response_status = 201,
                      response_body = $2::jsonb
                where id = $1`,
              [command.id, JSON.stringify(response)]
            );
            return { completed: true, response };
          }
          invariant(
            row.state === "provider_pending",
            "BILLING_PORTAL_REQUIRES_NEW_COMMAND",
            "That billing portal attempt is not recoverable with this command.",
            { status: 409 }
          );
          return {
            completed: false,
            commandRowId: command.id,
            scope,
            row,
            providerRequest: {
              stripeCustomerId:
                row.stripe_customer_id,
              idempotencyKey:
                row.provider_idempotency_key
            }
          };
        }
        const customer = await client.query(
          `select customer.*
             from ss.stripe_subscriptions subscription
             join ss.stripe_customers customer
               on customer.organization_id =
                    subscription.organization_id
              and customer.id =
                    subscription.stripe_customer_row_id
            where subscription.organization_id = $1
              and subscription.project_id = $2
              and subscription.status <> 'deleted'
            for share of subscription, customer`,
          [scope.organizationId, scope.projectId]
        );
        invariant(
          customer.rowCount === 1,
          "BILLING_ACCOUNT_UNAVAILABLE",
          "This project does not have a payment-provider billing account.",
          { status: 409 }
        );
        const portalId = randomUUID();
        const providerIdempotencyKey =
          `hosted:billing:${scope.organizationId}:${key}`;
        const purposeDigest = digest({
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          stripeCustomerRowId: customer.rows[0].id
        });
        const commandRowId = randomUUID();
        const createdAt = now(clock);
        await client.query(
          `insert into ss.idempotency_keys (
             id, organization_id, principal_id, route_key,
             idempotency_key, request_digest, state,
             resource_type, resource_id, created_at,
             expires_at
           ) values (
             $1, $2, $3, $4, $5, $6, 'running',
             'billing_portal_session', $7, $8,
             $8::timestamptz + interval '24 hours'
           )`,
          [
            commandRowId,
            scope.organizationId,
            actor.userId,
            routeKey,
            key,
            requestDigest,
            portalId,
            createdAt
          ]
        );
        await client.query(
          `insert into ss.billing_portal_sessions (
             id, organization_id, project_id,
             stripe_customer_row_id, created_by_user_id,
             provider_idempotency_key, purpose_digest,
             state, created_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7,
             'provider_pending', $8
           )`,
          [
            portalId,
            scope.organizationId,
            scope.projectId,
            customer.rows[0].id,
            actor.userId,
            providerIdempotencyKey,
            purposeDigest,
            createdAt
          ]
        );
        await audit(client, {
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          actorId: actor.userId,
          action: "billing.portal.dispatching",
          targetType: "billing_portal_session",
          targetId: portalId,
          requestId: commandRowId,
          metadata: {
            purposeDigest,
            providerEffect: false
          }
        });
        return {
          completed: false,
          commandRowId,
          scope,
          row: {
            id: portalId,
            created_by_user_id: actor.userId,
            purpose_digest: purposeDigest
          },
          providerRequest: {
            stripeCustomerId:
              customer.rows[0].stripe_customer_id,
            idempotencyKey: providerIdempotencyKey
          }
        };
      }
    );
  }

  async function recordBillingPortalFailure(
    staged,
    error
  ) {
    const certainty = providerEffectCertainty(error);
    const errorCode = providerErrorCode(error);
    await authority.service(
      {
        userId: staged.row.created_by_user_id,
        organizationId: staged.scope.organizationId
      },
      async (client) => {
        await client.query(
          `update ss.billing_portal_sessions
              set state = case
                    when $4 = 'not_submitted'
                      then 'failed'
                    else state
                  end,
                  provider_effect_certainty = $4,
                  provider_error_code = $5
            where organization_id = $1
              and project_id = $2
              and id = $3
              and state = 'provider_pending'`,
          [
            staged.scope.organizationId,
            staged.scope.projectId,
            staged.row.id,
            certainty,
            errorCode
          ]
        );
        if (certainty === "not_submitted") {
          await client.query(
            `update ss.idempotency_keys
                set state = 'failed',
                    response_status = 503,
                    response_body = $2::jsonb
              where id = $1
                and state = 'running'`,
            [
              staged.commandRowId,
              JSON.stringify({
                error: {
                  code:
                    "BILLING_PORTAL_UNAVAILABLE",
                  certainty,
                  providerErrorCode: errorCode
                }
              })
            ]
          );
        }
      }
    );
  }

  async function finalizeBillingPortal(
    actor,
    staged,
    result
  ) {
    const selected =
      billingPortalProviderResult(result);
    return authority.service(
      {
        userId: actor.userId,
        organizationId: staged.scope.organizationId
      },
      async (client) => {
        const current = await client.query(
          `select *
             from ss.billing_portal_sessions
            where organization_id = $1
              and project_id = $2
              and id = $3
            for update`,
          [
            staged.scope.organizationId,
            staged.scope.projectId,
            staged.row.id
          ]
        );
        const row = current.rows[0];
        invariant(
          row &&
            row.purpose_digest ===
              staged.row.purpose_digest &&
            row.provider_idempotency_key ===
              staged.providerRequest.idempotencyKey,
          "BILLING_PORTAL_RECONCILIATION_REQUIRED",
          "The billing portal session no longer matches its staged purpose.",
          { status: 503 }
        );
        if (row.state === "open") {
          invariant(
            row.stripe_portal_session_id ===
                selected.portalSessionId &&
              row.provider_portal_url ===
                selected.url,
            "BILLING_PORTAL_RECONCILIATION_REQUIRED",
            "The payment provider returned conflicting billing portal facts.",
            { status: 503 }
          );
        } else {
          invariant(
            row.state === "provider_pending",
            "BILLING_PORTAL_RECONCILIATION_REQUIRED",
            "The billing portal session cannot be finalized from its current state.",
            { status: 503 }
          );
          await client.query(
            `update ss.billing_portal_sessions
                set state = 'open',
                    stripe_portal_session_id = $4,
                    provider_portal_url = $5,
                    provider_effect_certainty =
                      'confirmed',
                    provider_error_code = null
              where organization_id = $1
                and project_id = $2
                and id = $3`,
            [
              staged.scope.organizationId,
              staged.scope.projectId,
              staged.row.id,
              selected.portalSessionId,
              selected.url
            ]
          );
          await audit(client, {
            organizationId:
              staged.scope.organizationId,
            projectId: staged.scope.projectId,
            actorId: actor.userId,
            action: "billing.portal.created",
            targetType:
              "billing_portal_session",
            targetId: staged.row.id,
            requestId: staged.commandRowId,
            metadata: {
              providerPortalSessionId:
                selected.portalSessionId
            }
          });
        }
        const finalized = await client.query(
          `select *
             from ss.billing_portal_sessions
            where organization_id = $1
              and project_id = $2
              and id = $3`,
          [
            staged.scope.organizationId,
            staged.scope.projectId,
            staged.row.id
          ]
        );
        const response = billingPortalResponse(
          finalized.rows[0]
        );
        await client.query(
          `update ss.idempotency_keys
              set state = 'completed',
                  response_status = 201,
                  response_body = $2::jsonb
            where id = $1
              and state = 'running'`,
          [
            staged.commandRowId,
            JSON.stringify(response)
          ]
        );
        return response;
      }
    );
  }

  async function claimCancellationDispatch(workerId) {
    return authority.service({}, async (client) => {
      const selected = await client.query(
        `select
           outbox.*,
           acceptance.project_id,
           acceptance.accepted_disclosure_digest,
           preview.effective_at,
           preview.retention_ends_at,
           subscription.stripe_subscription_id
         from ss.transactional_outbox outbox
         join ss.subscription_cancellation_acceptances
           acceptance
           on acceptance.organization_id =
                outbox.organization_id
          and acceptance.subscription_id =
                outbox.aggregate_id
          and acceptance.preview_id =
                (outbox.payload ->> 'previewId')::uuid
         join ss.subscription_cancellation_previews preview
           on preview.organization_id =
                acceptance.organization_id
          and preview.id = acceptance.preview_id
         join ss.stripe_subscriptions subscription
           on subscription.organization_id =
                acceptance.organization_id
          and subscription.id =
                acceptance.subscription_id
        where outbox.event_type =
                'subscription.cancellation_requested'
          and outbox.published_at is null
          and outbox.available_at <= $1
          and (
            outbox.locked_at is null
            or outbox.locked_at <
              $1::timestamptz - interval '5 minutes'
          )
        order by outbox.available_at, outbox.id
        for update of outbox skip locked
        limit 1`,
        [now(clock)]
      );
      if (selected.rowCount === 0) return null;
      const row = selected.rows[0];
      await client.query(
        `update ss.transactional_outbox
            set locked_at = $2,
                locked_by = $3,
                attempt_count = attempt_count + 1
          where id = $1`,
        [row.id, now(clock), workerId]
      );
      return {
        ...row,
        locked_by: workerId
      };
    });
  }

  async function releaseCancellationDispatch(
    dispatch,
    error
  ) {
    const certainty = providerEffectCertainty(error);
    const code = providerErrorCode(error);
    await authority.service({}, (client) =>
      client.query(
        `update ss.transactional_outbox
            set locked_at = null,
                locked_by = null,
                last_error = $3,
                available_at =
                  case
                    when $4 = 'ambiguous'
                      then 'infinity'::timestamptz
                    else $5::timestamptz + interval '5 minutes'
                  end
          where id = $1
            and locked_by = $2
            and published_at is null`,
        [
          dispatch.id,
          dispatch.locked_by,
          `${certainty}:${code}`,
          certainty,
          now(clock)
        ]
      )
    );
    return { certainty, code };
  }

  async function finishCancellationDispatch(
    dispatch,
    providerResult
  ) {
    const subscriptionId = providerIdentifier(
      providerResult?.subscriptionId,
      "sub",
      "Stripe Subscription ID"
    );
    invariant(
      subscriptionId ===
          dispatch.stripe_subscription_id &&
        providerResult.cancelAtPeriodEnd === true &&
        Number.isFinite(
          Date.parse(providerResult.effectiveAt)
        ) &&
        iso(providerResult.effectiveAt) ===
          iso(dispatch.effective_at),
      "CANCELLATION_PROVIDER_RESPONSE_INVALID",
      "The payment provider did not schedule the exact accepted cancellation.",
      { status: 502 }
    );
    const occurredAt = now(clock);
    return authority.service({}, async (client) => {
      const current = await client.query(
        `select *
           from ss.transactional_outbox
          where id = $1
          for update`,
        [dispatch.id]
      );
      const row = current.rows[0];
      if (row?.published_at) {
        return {
          status: "scheduled",
          effectiveAt: iso(dispatch.effective_at)
        };
      }
      invariant(
        row && row.locked_by === dispatch.locked_by,
        "CANCELLATION_RECONCILIATION_REQUIRED",
        "The cancellation dispatch lease changed before it could be committed.",
        { status: 503 }
      );
      const facts = {
        schema:
          "sitesourcery.subscription-cancellation/v1",
        subscriptionId,
        previewId:
          dispatch.payload.previewId,
        cancellationDigest:
          dispatch.accepted_disclosure_digest,
        cancelAtPeriodEnd: true,
        effectiveAt: iso(dispatch.effective_at),
        retentionEndsAt:
          iso(dispatch.retention_ends_at)
      };
      await client.query(
        `insert into ss.provider_receipts (
           id, organization_id, project_id, provider_code,
           receipt_kind, external_object_ref,
           facts, facts_digest, occurred_at
         ) values (
           $1, $2, $3, 'stripe',
           'subscription_cancellation_scheduled',
           $4, $5::jsonb, $6, $7
         )
         on conflict (
           provider_code, receipt_kind,
           external_object_ref
         ) do nothing`,
        [
          randomUUID(),
          dispatch.organization_id,
          dispatch.project_id,
          `${subscriptionId}:${dispatch.accepted_disclosure_digest}`,
          JSON.stringify(facts),
          digest(facts),
          occurredAt
        ]
      );
      await client.query(
        `update ss.stripe_subscriptions
            set cancelled_at = $4,
                retention_ends_at = $5
          where organization_id = $1
            and project_id = $2
            and id = $3`,
        [
          dispatch.organization_id,
          dispatch.project_id,
          dispatch.aggregate_id,
          iso(dispatch.effective_at),
          iso(dispatch.retention_ends_at)
        ]
      );
      await client.query(
        `update ss.transactional_outbox
            set published_at = $3,
                locked_at = null,
                locked_by = null,
                last_error = null
          where id = $1
            and locked_by = $2`,
        [dispatch.id, dispatch.locked_by, occurredAt]
      );
      await client.query(
        `select ss.write_audit_event(
           $1, $2, 'provider', 'stripe', $3,
           'stripe_subscription', $4, null, $5::jsonb
         )`,
        [
          dispatch.organization_id,
          dispatch.project_id,
          "subscription.cancellation_scheduled",
          dispatch.aggregate_id,
          JSON.stringify({
            previewId:
              dispatch.payload.previewId,
            effectiveAt:
              iso(dispatch.effective_at),
            cancellationDigest:
              dispatch.accepted_disclosure_digest
          })
        ]
      );
      return {
        status: "scheduled",
        effectiveAt: iso(dispatch.effective_at)
      };
    });
  }

  async function cancellationStatus(
    actor,
    projectId,
    previewId
  ) {
    const scope = await projectScope(actor, projectId);
    return authority.service(
      {
        userId: actor.userId,
        organizationId: scope.organizationId,
        readOnly: true
      },
      async (client) => {
        await membership(
          client,
          actor,
          scope.organizationId,
          BILLING_ROLES
        );
        const result = await client.query(
          `select
             outbox.published_at,
             outbox.last_error,
             preview.effective_at,
             preview.retention_ends_at
           from ss.subscription_cancellation_acceptances
             acceptance
           join ss.subscription_cancellation_previews preview
             on preview.organization_id =
                  acceptance.organization_id
            and preview.id = acceptance.preview_id
           join ss.transactional_outbox outbox
             on outbox.organization_id =
                  acceptance.organization_id
            and outbox.aggregate_id =
                  acceptance.subscription_id
            and outbox.event_type =
                  'subscription.cancellation_requested'
            and outbox.payload ->> 'previewId' =
                  acceptance.preview_id::text
          where acceptance.organization_id = $1
            and acceptance.project_id = $2
            and acceptance.preview_id = $3`,
          [
            scope.organizationId,
            scope.projectId,
            previewId
          ]
        );
        const row = result.rows[0];
        invariant(
          row,
          "CANCELLATION_PREVIEW_NOT_FOUND",
          "The accepted cancellation could not be found.",
          { status: 404 }
        );
        let providerStatus = "held_for_dispatch";
        if (row.published_at) {
          providerStatus = "scheduled";
        } else if (
          String(row.last_error ?? "").startsWith(
            "ambiguous:"
          )
        ) {
          providerStatus =
            "reconciliation_required";
        } else if (row.last_error) {
          providerStatus = "retry_queued";
        }
        return {
          providerStatus,
          effectiveAt: iso(row.effective_at),
          retentionEndsAt:
            iso(row.retention_ends_at)
        };
      }
    );
  }

  function stripeObjectId(value, prefix, field) {
    return providerIdentifier(value, prefix, field);
  }

  function stripeEventTime(event) {
    return stripeTimestamp(
      event.created,
      "Stripe event timestamp"
    );
  }

  function stripeCurrency(value) {
    const selected = String(value ?? "").toUpperCase();
    invariant(
      /^[A-Z]{3}$/u.test(selected),
      "STRIPE_WEBHOOK_EVENT_INVALID",
      "Stripe currency is invalid.",
      { status: 400 }
    );
    return selected;
  }

  function invoiceSubscriptionId(object) {
    const value =
      typeof object?.subscription === "string"
        ? object.subscription
        : object?.parent?.subscription_details
              ?.subscription;
    return stripeObjectId(
      value,
      "sub",
      "Stripe Subscription ID"
    );
  }

  async function writeStripeReceipt(
    client,
    {
      event,
      eventRowId,
      organizationId,
      projectId,
      objectId,
      receiptKind,
      facts,
      amountMinor = null,
      currency = null
    }
  ) {
    const providerReceiptId = randomUUID();
    const occurredAt = stripeEventTime(event);
    const externalObjectRef = `${objectId}:${event.id}`;
    await client.query(
      `insert into ss.provider_receipts (
         id, organization_id, project_id, provider_code,
         receipt_kind, external_object_ref,
         source_event_ref, facts, facts_digest,
         occurred_at
       ) values (
         $1, $2, $3, 'stripe', $4, $5, $6,
         $7::jsonb, $8, $9
       )`,
      [
        providerReceiptId,
        organizationId,
        projectId,
        receiptKind,
        externalObjectRef,
        event.id,
        JSON.stringify(facts),
        digest(facts),
        occurredAt
      ]
    );
    let stripeReceiptId = null;
    const stripeKinds = new Set([
      "checkout_completed",
      "subscription_created",
      "subscription_updated",
      "invoice_paid",
      "invoice_failed",
      "subscription_cancelled",
      "refund"
    ]);
    if (stripeKinds.has(receiptKind)) {
      stripeReceiptId = randomUUID();
      await client.query(
        `insert into ss.stripe_receipts (
           id, organization_id, project_id,
           provider_receipt_id, stripe_event_row_id,
           stripe_object_id, receipt_kind, currency,
           amount_minor, occurred_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         )`,
        [
          stripeReceiptId,
          organizationId,
          projectId,
          providerReceiptId,
          eventRowId,
          objectId,
          receiptKind,
          currency,
          amountMinor,
          occurredAt
        ]
      );
    }
    return {
      providerReceiptId,
      stripeReceiptId,
      occurredAt
    };
  }

  async function exactStripeCustomer(
    client,
    organizationId,
    stripeCustomerId,
    providerReceiptId = null
  ) {
    const selected = stripeObjectId(
      stripeCustomerId,
      "cus",
      "Stripe Customer ID"
    );
    const existing = await client.query(
      `select *
         from ss.stripe_customers
        where organization_id = $1
        for update`,
      [organizationId]
    );
    if (existing.rows[0]) {
      invariant(
        existing.rows[0].stripe_customer_id ===
          selected,
        "STRIPE_TENANT_BINDING_INVALID",
        "The Stripe Customer does not match this organization.",
        { status: 409 }
      );
      return existing.rows[0];
    }
    const id = randomUUID();
    const inserted = await client.query(
      `insert into ss.stripe_customers (
         id, organization_id, stripe_customer_id,
         created_from_receipt_id
       ) values ($1, $2, $3, $4)
       returning *`,
      [
        id,
        organizationId,
        selected,
        providerReceiptId
      ]
    );
    return inserted.rows[0];
  }

  function validateCheckoutMetadata(
    object,
    checkout
  ) {
    const metadata = object.metadata;
    invariant(
      metadata &&
        metadata.schema ===
          "sitesourcery_checkout_v1" &&
        metadata.tenant_id ===
          checkout.organization_id &&
        metadata.customer_id ===
          checkout.created_by_user_id &&
        metadata.project_id === checkout.project_id &&
        metadata.quote_id === checkout.quote_id &&
        metadata.catalog_version ===
          checkout.catalog_version &&
        metadata.offer_id === checkout.offer_key &&
        metadata.disclosure_digest ===
          checkout.disclosure_digest &&
        metadata.purpose_digest ===
          checkout.purpose_digest &&
        object.client_reference_id ===
          checkout.quote_id,
      "STRIPE_TENANT_BINDING_INVALID",
      "The signed Checkout event does not match its exact server purpose.",
      { status: 409 }
    );
  }

  async function applyCheckoutCompleted(
    client,
    eventRowId,
    event
  ) {
    const object = event.data.object;
    const checkoutSessionId = stripeObjectId(
      object.id,
      "cs",
      "Stripe Checkout Session ID"
    );
    const result = await client.query(
      `select
         checkout.*,
         binding.quote_id,
         quote.offer_key,
         quote.catalog_version,
         quote.tenure_id,
         quote.disclosure_digest,
         project.billing_policy_id
       from ss.checkout_intents checkout
       join ss.checkout_quote_bindings binding
         on binding.organization_id =
              checkout.organization_id
        and binding.checkout_intent_id = checkout.id
       join ss.commerce_quotes quote
         on quote.organization_id = binding.organization_id
        and quote.id = binding.quote_id
       join ss.projects project
         on project.organization_id =
              checkout.organization_id
        and project.id = checkout.project_id
      where checkout.stripe_checkout_session_id = $1
      for update of checkout`,
      [checkoutSessionId]
    );
    invariant(
      result.rowCount === 1,
      "STRIPE_CHECKOUT_NOT_FOUND",
      "The signed Checkout event does not match a staged Checkout Session.",
      { status: 409 }
    );
    const checkout = result.rows[0];
    validateCheckoutMetadata(object, checkout);
    invariant(
      object.payment_status === "paid" &&
        Number.isSafeInteger(object.amount_total) &&
        object.amount_total ===
          Number(checkout.amount_minor) &&
        stripeCurrency(object.currency) ===
          checkout.currency,
      "STRIPE_CHECKOUT_PAYMENT_INVALID",
      "Checkout completion does not contain exact paid amount evidence.",
      { status: 409 }
    );
    const lines = await client.query(
      `select quote_line.*
         from ss.checkout_intent_price_lines checkout_line
         join ss.commerce_quote_price_lines quote_line
           on quote_line.organization_id =
                checkout_line.organization_id
          and quote_line.id =
                checkout_line.quote_price_line_id
        where checkout_line.organization_id = $1
          and checkout_line.project_id = $2
          and checkout_line.checkout_intent_id = $3
        order by quote_line.position`,
      [
        checkout.organization_id,
        checkout.project_id,
        checkout.id
      ]
    );
    invariant(
      lines.rowCount > 0 &&
        lines.rows.every(
          (line) =>
            line.source_kind ===
            "abracadabra_product"
        ),
      "STRIPE_CHECKOUT_PAYMENT_INVALID",
      "Checkout settlement contains unsupported price lines.",
      { status: 409 }
    );
    const receipt = await writeStripeReceipt(client, {
      event,
      eventRowId,
      organizationId: checkout.organization_id,
      projectId: checkout.project_id,
      objectId: checkoutSessionId,
      receiptKind: "checkout_completed",
      amountMinor: Number(object.amount_total),
      currency: checkout.currency,
      facts: {
        schema:
          "sitesourcery.stripe-checkout-receipt/v1",
        checkoutIntentId: checkout.id,
        checkoutSessionId,
        quoteId: checkout.quote_id,
        purposeDigest: checkout.purpose_digest,
        paymentStatus: object.payment_status,
        amountMinor: Number(object.amount_total),
        currency: checkout.currency,
        stripeCustomerId: object.customer,
        stripeSubscriptionId:
          object.subscription ?? null,
        stripePaymentIntentId:
          object.payment_intent ?? null,
        stripeInvoiceId: object.invoice ?? null
      }
    });
    const customer = await exactStripeCustomer(
      client,
      checkout.organization_id,
      object.customer,
      receipt.providerReceiptId
    );
    const recurring = lines.rows.filter(
      (line) =>
        line.billing_cadence === "month" ||
        line.billing_cadence === "year"
    );
    invariant(
      recurring.length <= 1,
      "STRIPE_CHECKOUT_PAYMENT_INVALID",
      "Checkout has an unsupported recurring price shape.",
      { status: 409 }
    );
    if (recurring.length === 1) {
      const subscriptionId = stripeObjectId(
        object.subscription,
        "sub",
        "Stripe Subscription ID"
      );
      const existing = await client.query(
        `select *
           from ss.stripe_subscriptions
          where project_id = $1
          for update`,
        [checkout.project_id]
      );
      if (existing.rows[0]) {
        invariant(
          existing.rows[0].organization_id ===
              checkout.organization_id &&
            existing.rows[0]
                .stripe_subscription_id ===
              subscriptionId,
          "STRIPE_TENANT_BINDING_INVALID",
          "The Stripe Subscription conflicts with this project.",
          { status: 409 }
        );
      } else {
        await client.query(
          `insert into ss.stripe_subscriptions (
             id, organization_id, project_id,
             stripe_customer_row_id,
             stripe_subscription_id, stripe_price_id,
             catalog_price_id, billing_policy_id, status,
             currency, amount_minor
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8,
             'pending', $9, $10
           )`,
          [
            randomUUID(),
            checkout.organization_id,
            checkout.project_id,
            customer.id,
            subscriptionId,
            recurring[0].stripe_price_ref,
            recurring[0]
              .catalog_offer_price_line_id
              ? (
                  await client.query(
                    `select catalog_price_id
                       from ss.catalog_offer_price_lines
                      where id = $1`,
                    [
                      recurring[0]
                        .catalog_offer_price_line_id
                    ]
                  )
                ).rows[0].catalog_price_id
              : checkout.catalog_price_id,
            checkout.billing_policy_id,
            recurring[0].currency,
            Number(recurring[0].amount_minor)
          ]
        );
      }
    }
    const oneTime = lines.rows.filter(
      (line) => line.billing_cadence === "one_time"
    );
    if (oneTime.length > 0) {
      invariant(
        oneTime.length === 1 &&
          (
            checkout.tenure_id === "own" ||
            checkout.tenure_id ===
              "owned_managed"
          ),
        "STRIPE_CHECKOUT_PAYMENT_INVALID",
        "Checkout has an unsupported ownership price shape.",
        { status: 409 }
      );
      const paymentIntentId = object.payment_intent
        ? stripeObjectId(
            object.payment_intent,
            "pi",
            "Stripe PaymentIntent ID"
          )
        : null;
      const invoiceId = object.invoice
        ? stripeObjectId(
            object.invoice,
            "in",
            "Stripe Invoice ID"
          )
        : null;
      invariant(
        paymentIntentId || invoiceId,
        "STRIPE_CHECKOUT_PAYMENT_INVALID",
        "A paid ownership Checkout requires PaymentIntent or Invoice evidence.",
        { status: 409 }
      );
      const price = await client.query(
        `select catalog_price_id
           from ss.catalog_offer_price_lines
          where id = $1`,
        [
          oneTime[0]
            .catalog_offer_price_line_id
        ]
      );
      const entitlementId = randomUUID();
      await client.query(
        `insert into ss.site_ownership_entitlements (
           id, organization_id, project_id,
           checkout_intent_id, catalog_price_id,
           provider_receipt_id,
           stripe_payment_intent_id, stripe_invoice_id,
           currency, amount_minor, state, completed_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, 'completed', $11
         )
         on conflict (checkout_intent_id) do nothing`,
        [
          entitlementId,
          checkout.organization_id,
          checkout.project_id,
          checkout.id,
          price.rows[0].catalog_price_id,
          receipt.providerReceiptId,
          paymentIntentId,
          invoiceId,
          oneTime[0].currency,
          Number(oneTime[0].amount_minor),
          receipt.occurredAt
        ]
      );
      const entitlement = await client.query(
        `select id
           from ss.site_ownership_entitlements
          where checkout_intent_id = $1`,
        [checkout.id]
      );
      await client.query(
        `insert into ss.site_ownership_entitlement_events (
           id, organization_id, project_id,
           entitlement_id, provider_receipt_id,
           state, occurred_at
         ) values (
           $1, $2, $3, $4, $5, 'completed', $6
         )
         on conflict (
           entitlement_id, provider_receipt_id, state
         ) do nothing`,
        [
          randomUUID(),
          checkout.organization_id,
          checkout.project_id,
          entitlement.rows[0].id,
          receipt.providerReceiptId,
          receipt.occurredAt
        ]
      );
    }
    await client.query(
      `update ss.checkout_intents
          set state = 'completed'
        where id = $1
          and state in ('open', 'completed')`,
      [checkout.id]
    );
    await client.query(
      `select ss.write_audit_event(
         $1, $2, 'provider', 'stripe', $3,
         'checkout_intent', $4, null, $5::jsonb
       )`,
      [
        checkout.organization_id,
        checkout.project_id,
        "commerce.checkout.paid",
        checkout.id,
        JSON.stringify({
          checkoutSessionId,
          quoteId: checkout.quote_id,
          purposeDigest: checkout.purpose_digest
        })
      ]
    );
    return {
      status: "processed",
      organizationId: checkout.organization_id,
      projectId: checkout.project_id
    };
  }

  function subscriptionState(eventType, object) {
    if (
      eventType === "customer.subscription.deleted" ||
      object.status === "canceled" ||
      object.status === "incomplete_expired"
    ) {
      return "cancelled";
    }
    if (object.status === "active") return "active";
    if (object.status === "past_due") return "grace";
    if (
      object.status === "unpaid" ||
      object.status === "paused"
    ) {
      return "suspended";
    }
    if (object.status === "incomplete") return "pending";
    invariant(
      object.status !== "trialing",
      "STRIPE_SUBSCRIPTION_INVALID",
      "The approved offer has no free trial.",
      { status: 409 }
    );
    invariant(
      false,
      "STRIPE_SUBSCRIPTION_INVALID",
      "Stripe Subscription status is unsupported.",
      { status: 409 }
    );
  }

  async function resolveStripeSubscription(
    client,
    object
  ) {
    const subscriptionId = stripeObjectId(
      object.id,
      "sub",
      "Stripe Subscription ID"
    );
    const existing = await client.query(
      `select
         subscription.*,
         customer.stripe_customer_id,
         extract(
           epoch from policy.grace_period
         )::bigint as grace_seconds,
         extract(
           epoch from policy.retention_period
         )::bigint as retention_seconds
       from ss.stripe_subscriptions subscription
       join ss.stripe_customers customer
         on customer.organization_id =
              subscription.organization_id
        and customer.id =
              subscription.stripe_customer_row_id
       join ss.billing_policies policy
         on policy.id =
              subscription.billing_policy_id
      where subscription.stripe_subscription_id = $1
      for update of subscription, customer`,
      [subscriptionId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const metadata = object.metadata;
    invariant(
      metadata &&
        metadata.schema ===
          "sitesourcery_checkout_v1" &&
        UUID.test(String(metadata.tenant_id ?? "")) &&
        UUID.test(String(metadata.project_id ?? "")) &&
        /^[a-f0-9]{64}$/u.test(
          String(metadata.purpose_digest ?? "")
        ),
      "STRIPE_TENANT_BINDING_INVALID",
      "The Stripe Subscription is missing its exact Checkout binding.",
      { status: 409 }
    );
    const staged = await client.query(
      `select
         checkout.organization_id,
         checkout.project_id,
         checkout.purpose_digest,
         checkout.created_by_user_id,
         quote.offer_key,
         line.stripe_price_ref,
         line.currency,
         line.amount_minor,
         offer_line.catalog_price_id,
         project.billing_policy_id,
         extract(
           epoch from policy.grace_period
         )::bigint as grace_seconds,
         extract(
           epoch from policy.retention_period
         )::bigint as retention_seconds
       from ss.checkout_intents checkout
       join ss.checkout_quote_bindings binding
         on binding.organization_id =
              checkout.organization_id
        and binding.checkout_intent_id = checkout.id
       join ss.commerce_quotes quote
         on quote.organization_id =
              binding.organization_id
        and quote.id = binding.quote_id
       join ss.checkout_intent_price_lines checkout_line
         on checkout_line.organization_id =
              checkout.organization_id
        and checkout_line.checkout_intent_id =
              checkout.id
       join ss.commerce_quote_price_lines line
         on line.organization_id =
              checkout_line.organization_id
        and line.id =
              checkout_line.quote_price_line_id
        and line.billing_cadence in ('month', 'year')
       join ss.catalog_offer_price_lines offer_line
         on offer_line.id =
              line.catalog_offer_price_line_id
       join ss.projects project
         on project.organization_id =
              checkout.organization_id
        and project.id = checkout.project_id
       join ss.billing_policies policy
         on policy.id = project.billing_policy_id
      where checkout.organization_id = $1
        and checkout.project_id = $2
        and checkout.purpose_digest = $3
        and checkout.state in ('open', 'completed')
      for update of checkout`,
      [
        metadata.tenant_id,
        metadata.project_id,
        metadata.purpose_digest
      ]
    );
    invariant(
      staged.rowCount === 1 &&
        metadata.customer_id ===
          staged.rows[0].created_by_user_id,
      "STRIPE_TENANT_BINDING_INVALID",
      "The Stripe Subscription does not match one exact staged Checkout.",
      { status: 409 }
    );
    const row = staged.rows[0];
    const customer = await exactStripeCustomer(
      client,
      row.organization_id,
      object.customer
    );
    const id = randomUUID();
    const inserted = await client.query(
      `insert into ss.stripe_subscriptions (
         id, organization_id, project_id,
         stripe_customer_row_id, stripe_subscription_id,
         stripe_price_id, catalog_price_id,
         billing_policy_id, status, currency,
         amount_minor
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         'pending', $9, $10
       )
       returning *`,
      [
        id,
        row.organization_id,
        row.project_id,
        customer.id,
        subscriptionId,
        row.stripe_price_ref,
        row.catalog_price_id,
        row.billing_policy_id,
        row.currency,
        Number(row.amount_minor)
      ]
    );
    return {
      ...inserted.rows[0],
      stripe_customer_id: customer.stripe_customer_id,
      grace_seconds: row.grace_seconds,
      retention_seconds: row.retention_seconds
    };
  }

  async function applySubscriptionEvent(
    client,
    eventRowId,
    event
  ) {
    const object = event.data.object;
    const row = await resolveStripeSubscription(
      client,
      object
    );
    invariant(
      object.customer === row.stripe_customer_id,
      "STRIPE_TENANT_BINDING_INVALID",
      "The Stripe Subscription Customer does not match its organization.",
      { status: 409 }
    );
    const items = object.items?.data;
    invariant(
      Array.isArray(items) && items.length === 1,
      "STRIPE_SUBSCRIPTION_INVALID",
      "The Stripe Subscription must contain one exact recurring price.",
      { status: 409 }
    );
    const itemPrice = items[0]?.price;
    invariant(
      itemPrice?.id === row.stripe_price_id &&
        Number(itemPrice.unit_amount) ===
          Number(row.amount_minor) &&
        stripeCurrency(itemPrice.currency) ===
          row.currency,
      "STRIPE_SUBSCRIPTION_INVALID",
      "The Stripe Subscription price does not match the approved server price.",
      { status: 409 }
    );
    const state = subscriptionState(
      event.type,
      object
    );
    const occurredAt = stripeEventTime(event);
    const periodSeconds =
      object.current_period_end ??
      items[0].current_period_end;
    const currentPeriodEndsAt =
      Number.isSafeInteger(periodSeconds) &&
      periodSeconds > 0
        ? new Date(periodSeconds * 1000).toISOString()
        : null;
    invariant(
      state === "cancelled" ||
        state === "suspended" ||
        state === "pending" ||
        currentPeriodEndsAt,
      "STRIPE_SUBSCRIPTION_INVALID",
      "The Stripe Subscription period end is missing.",
      { status: 409 }
    );
    const receiptKind =
      event.type === "customer.subscription.created"
        ? "subscription_created"
        : state === "cancelled"
          ? "subscription_cancelled"
          : "subscription_updated";
    const receipt = await writeStripeReceipt(client, {
      event,
      eventRowId,
      organizationId: row.organization_id,
      projectId: row.project_id,
      objectId: object.id,
      receiptKind,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      facts: {
        schema:
          "sitesourcery.stripe-subscription-receipt/v1",
        subscriptionId: object.id,
        customerId: object.customer,
        stripeStatus: object.status,
        localState: state,
        priceId: row.stripe_price_id,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        currentPeriodEndsAt
      }
    });
    const graceEndsAt =
      state === "grace"
        ? new Date(
            Date.parse(occurredAt) +
              Number(row.grace_seconds) * 1000
          ).toISOString()
        : null;
    const retentionEndsAt =
      state === "cancelled" ||
      state === "suspended"
        ? new Date(
            Date.parse(occurredAt) +
              Number(row.retention_seconds) * 1000
          ).toISOString()
        : null;
    await client.query(
      `update ss.stripe_subscriptions
          set status = $4,
              current_period_ends_at =
                coalesce($5, current_period_ends_at),
              first_failed_at = case
                when $4 = 'grace'
                  then coalesce(first_failed_at, $6)
                when $4 = 'active' then null
                else first_failed_at
              end,
              grace_ends_at = case
                when $4 = 'grace' then $7
                when $4 = 'active' then null
                else grace_ends_at
              end,
              suspended_at = case
                when $4 = 'suspended'
                  then coalesce(suspended_at, $6)
                when $4 = 'active' then null
                else suspended_at
              end,
              cancelled_at = case
                when $4 = 'cancelled'
                  then coalesce(cancelled_at, $6)
                else cancelled_at
              end,
              retention_ends_at = case
                when $4 in ('cancelled', 'suspended')
                  then coalesce(retention_ends_at, $8)
                when $4 = 'active' then null
                else retention_ends_at
              end
        where organization_id = $1
          and project_id = $2
          and id = $3`,
      [
        row.organization_id,
        row.project_id,
        row.id,
        state,
        currentPeriodEndsAt,
        occurredAt,
        graceEndsAt,
        retentionEndsAt
      ]
    );
    await client.query(
      `insert into ss.subscription_state_events (
         id, organization_id, project_id,
         subscription_id, state, stripe_receipt_id,
         occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        row.organization_id,
        row.project_id,
        row.id,
        state,
        receipt.stripeReceiptId,
        occurredAt
      ]
    );
    return {
      status: "processed",
      organizationId: row.organization_id,
      projectId: row.project_id
    };
  }

  async function applyInvoiceEvent(
    client,
    eventRowId,
    event
  ) {
    const object = event.data.object;
    const subscriptionId =
      invoiceSubscriptionId(object);
    const result = await client.query(
      `select
         subscription.*,
         customer.stripe_customer_id,
         extract(
           epoch from policy.grace_period
         )::bigint as grace_seconds
       from ss.stripe_subscriptions subscription
       join ss.stripe_customers customer
         on customer.organization_id =
              subscription.organization_id
        and customer.id =
              subscription.stripe_customer_row_id
       join ss.billing_policies policy
         on policy.id =
              subscription.billing_policy_id
      where subscription.stripe_subscription_id = $1
      for update of subscription`,
      [subscriptionId]
    );
    invariant(
      result.rowCount === 1,
      "STRIPE_SUBSCRIPTION_NOT_FOUND",
      "The Stripe Invoice does not match a known subscription.",
      { status: 409 }
    );
    const row = result.rows[0];
    invariant(
      object.customer === row.stripe_customer_id,
      "STRIPE_TENANT_BINDING_INVALID",
      "The Stripe Invoice Customer does not match its organization.",
      { status: 409 }
    );
    const paid = event.type === "invoice.paid";
    const amountMinor = paid
      ? object.amount_paid
      : object.amount_due;
    invariant(
      Number.isSafeInteger(amountMinor) &&
        amountMinor >= 0 &&
        stripeCurrency(object.currency) ===
          row.currency,
      "STRIPE_INVOICE_INVALID",
      "The Stripe Invoice amount is invalid.",
      { status: 409 }
    );
    const occurredAt = stripeEventTime(event);
    const receipt = await writeStripeReceipt(client, {
      event,
      eventRowId,
      organizationId: row.organization_id,
      projectId: row.project_id,
      objectId: stripeObjectId(
        object.id,
        "in",
        "Stripe Invoice ID"
      ),
      receiptKind: paid
        ? "invoice_paid"
        : "invoice_failed",
      amountMinor,
      currency: row.currency,
      facts: {
        schema:
          "sitesourcery.stripe-invoice-receipt/v1",
        invoiceId: object.id,
        subscriptionId,
        customerId: object.customer,
        paid,
        amountMinor,
        currency: row.currency
      }
    });
    const state = paid ? "active" : "grace";
    const graceEndsAt = paid
      ? null
      : new Date(
          Date.parse(occurredAt) +
            Number(row.grace_seconds) * 1000
        ).toISOString();
    const periods = Array.isArray(object.lines?.data)
      ? object.lines.data
          .map((line) => line?.period?.end)
          .filter(
            (value) =>
              Number.isSafeInteger(value) && value > 0
          )
      : [];
    const periodEnd =
      periods.length > 0
        ? new Date(Math.max(...periods) * 1000)
            .toISOString()
        : null;
    await client.query(
      `update ss.stripe_subscriptions
          set status = $4,
              current_period_ends_at =
                coalesce($5, current_period_ends_at),
              first_failed_at = case
                when $4 = 'grace'
                  then coalesce(first_failed_at, $6)
                else null
              end,
              grace_ends_at = $7,
              suspended_at = case
                when $4 = 'active' then null
                else suspended_at
              end,
              retention_ends_at = case
                when $4 = 'active' then null
                else retention_ends_at
              end
        where organization_id = $1
          and project_id = $2
          and id = $3
          and status not in ('cancelled', 'deleted')`,
      [
        row.organization_id,
        row.project_id,
        row.id,
        state,
        periodEnd,
        occurredAt,
        graceEndsAt
      ]
    );
    const updated = await client.query(
      `select status
         from ss.stripe_subscriptions
        where id = $1`,
      [row.id]
    );
    invariant(
      updated.rows[0].status === state,
      "STRIPE_INVOICE_STATE_INVALID",
      "The Stripe Invoice cannot reactivate a cancelled subscription.",
      { status: 409 }
    );
    await client.query(
      `insert into ss.subscription_state_events (
         id, organization_id, project_id,
         subscription_id, state, stripe_receipt_id,
         occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        row.organization_id,
        row.project_id,
        row.id,
        state,
        receipt.stripeReceiptId,
        occurredAt
      ]
    );
    return {
      status: "processed",
      organizationId: row.organization_id,
      projectId: row.project_id
    };
  }

  async function applyOwnershipReversal(
    client,
    eventRowId,
    event
  ) {
    const object = event.data.object;
    const dispute =
      event.type === "charge.dispute.created";
    const paymentIntentId = stripeObjectId(
      object.payment_intent,
      "pi",
      "Stripe PaymentIntent ID"
    );
    const result = await client.query(
      `select *
         from ss.site_ownership_entitlements
        where stripe_payment_intent_id = $1
        for update`,
      [paymentIntentId]
    );
    if (result.rowCount === 0) {
      return { status: "ignored" };
    }
    const entitlement = result.rows[0];
    const amountMinor = dispute
      ? Number(entitlement.amount_minor)
      : event.type === "charge.refunded"
        ? object.amount_refunded
        : object.amount;
    invariant(
      Number.isSafeInteger(amountMinor) &&
        amountMinor > 0 &&
        stripeCurrency(object.currency) ===
          entitlement.currency,
      "STRIPE_OWNERSHIP_REVERSAL_INVALID",
      "The ownership reversal does not match the paid entitlement.",
      { status: 409 }
    );
    const receiptKind = dispute
      ? "ownership_disputed"
      : "refund";
    const objectId = dispute
      ? stripeObjectId(
          object.id,
          "dp",
          "Stripe Dispute ID"
        )
      : event.type === "charge.refunded"
        ? stripeObjectId(
            object.id,
            "ch",
            "Stripe Charge ID"
          )
        : stripeObjectId(
            object.id,
            "re",
            "Stripe Refund ID"
          );
    const receipt = await writeStripeReceipt(client, {
      event,
      eventRowId,
      organizationId: entitlement.organization_id,
      projectId: entitlement.project_id,
      objectId,
      receiptKind,
      amountMinor,
      currency: entitlement.currency,
      facts: {
        schema:
          "sitesourcery.ownership-reversal/v1",
        entitlementId: entitlement.id,
        paymentIntentId,
        kind: dispute ? "dispute" : "refund",
        amountMinor,
        currency: entitlement.currency
      }
    });
    const state = dispute ? "disputed" : "refunded";
    await client.query(
      `update ss.site_ownership_entitlements
          set state = $4,
              refunded_amount_minor = case
                when $4 = 'refunded'
                  then greatest(
                    refunded_amount_minor,
                    least(amount_minor, $5)
                  )
                else refunded_amount_minor
              end,
              refunded_at = case
                when $4 = 'refunded' then $6
                else refunded_at
              end,
              revoked_at = case
                when $4 = 'disputed' then $6
                else revoked_at
              end
        where organization_id = $1
          and project_id = $2
          and id = $3`,
      [
        entitlement.organization_id,
        entitlement.project_id,
        entitlement.id,
        state,
        amountMinor,
        receipt.occurredAt
      ]
    );
    await client.query(
      `insert into ss.site_ownership_entitlement_events (
         id, organization_id, project_id,
         entitlement_id, provider_receipt_id,
         state, occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        entitlement.organization_id,
        entitlement.project_id,
        entitlement.id,
        receipt.providerReceiptId,
        state,
        receipt.occurredAt
      ]
    );
    return {
      status: "processed",
      organizationId: entitlement.organization_id,
      projectId: entitlement.project_id
    };
  }

  async function applyStripeEvent(
    client,
    eventRowId,
    event
  ) {
    if (event.type === "checkout.session.completed") {
      return applyCheckoutCompleted(
        client,
        eventRowId,
        event
      );
    }
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      return applySubscriptionEvent(
        client,
        eventRowId,
        event
      );
    }
    if (
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_failed"
    ) {
      return applyInvoiceEvent(
        client,
        eventRowId,
        event
      );
    }
    if (
      event.type === "charge.refunded" ||
      event.type === "refund.created" ||
      event.type === "charge.dispute.created"
    ) {
      return applyOwnershipReversal(
        client,
        eventRowId,
        event
      );
    }
    return { status: "ignored" };
  }

  async function persistStripeEvent(event) {
    const payloadDigest = digest(event);
    return authority.service({}, async (client) => {
      const existing = await client.query(
        `select event.*, processing.state
           from ss.stripe_events event
           join ss.stripe_event_processing processing
             on processing.stripe_event_row_id = event.id
          where event.stripe_event_id = $1`,
        [event.id]
      );
      if (existing.rows[0]) {
        invariant(
          existing.rows[0].payload_digest ===
              payloadDigest &&
            existing.rows[0].event_type ===
              event.type &&
            existing.rows[0].livemode ===
              event.livemode,
          "STRIPE_EVENT_ID_CONFLICT",
          "A Stripe event ID was reused with different signed content.",
          { status: 409 }
        );
        return {
          eventRowId: existing.rows[0].id,
          state: existing.rows[0].state,
          duplicate: true
        };
      }
      const eventRowId = randomUUID();
      await client.query(
        `insert into ss.stripe_events (
           id, stripe_event_id, event_type, livemode,
           api_version, payload_digest, payload,
           signature_verified_at, received_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8
         )`,
        [
          eventRowId,
          event.id,
          event.type,
          event.livemode,
          event.api_version ?? null,
          payloadDigest,
          JSON.stringify(event),
          now(clock)
        ]
      );
      await client.query(
        `insert into ss.stripe_event_processing (
           stripe_event_row_id, state
         ) values ($1, 'received')`,
        [eventRowId]
      );
      return {
        eventRowId,
        state: "received",
        duplicate: false
      };
    });
  }

  async function processStripeEvent(
    persisted,
    event
  ) {
    try {
      return await authority.service(
        {},
        async (client) => {
          const processing = await client.query(
            `select *
               from ss.stripe_event_processing
              where stripe_event_row_id = $1
              for update`,
            [persisted.eventRowId]
          );
          const state = processing.rows[0]?.state;
          invariant(
            state,
            "STRIPE_EVENT_STORAGE_INVALID",
            "Stripe event processing state is missing.",
            { status: 500 }
          );
          if (
            state === "processed" ||
            state === "ignored"
          ) {
            return {
              received: true,
              duplicate: true,
              eventId: event.id,
              status: state
            };
          }
          await client.query(
            `update ss.stripe_event_processing
                set state = 'processing',
                    attempt_count = attempt_count + 1,
                    locked_at = $2,
                    locked_by = 'hosted-webhook',
                    failure_code = null
              where stripe_event_row_id = $1`,
            [persisted.eventRowId, now(clock)]
          );
          const applied = await applyStripeEvent(
            client,
            persisted.eventRowId,
            event
          );
          await client.query(
            `update ss.stripe_event_processing
                set state = $2,
                    processed_at = $3,
                    locked_at = null,
                    locked_by = null,
                    failure_code = null
              where stripe_event_row_id = $1`,
            [
              persisted.eventRowId,
              applied.status === "ignored"
                ? "ignored"
                : "processed",
              now(clock)
            ]
          );
          return {
            received: true,
            duplicate: persisted.duplicate,
            eventId: event.id,
            status:
              applied.status === "ignored"
                ? "ignored"
                : "processed"
          };
        }
      );
    } catch (error) {
      await authority.service({}, (client) =>
        client.query(
          `update ss.stripe_event_processing
              set state = 'failed',
                  locked_at = null,
                  locked_by = null,
                  failure_code = $2
            where stripe_event_row_id = $1`,
          [
            persisted.eventRowId,
            providerErrorCode(error)
          ]
        )
      );
      throw translatePostgres(error);
    }
  }

  async function ingestVerifiedStripeEvent(event) {
    invariant(
      event &&
        typeof event === "object" &&
        stripeObjectId(
          event.id,
          "evt",
          "Stripe event ID"
        ) &&
        typeof event.type === "string" &&
        event.type.length > 0 &&
        event.type.length <= 200 &&
        typeof event.livemode === "boolean" &&
        Number.isSafeInteger(event.created) &&
        event.data?.object &&
        typeof event.data.object === "object",
      "STRIPE_WEBHOOK_EVENT_INVALID",
      "The verified Stripe event is invalid.",
      { status: 400 }
    );
    const persisted = await persistStripeEvent(event);
    return processStripeEvent(persisted, event);
  }

  async function stagePublication(
    client,
    actor,
    scope,
    versionId,
    operation
  ) {
    const version = await client.query(
      `select
         version.id,
         version.compiler_schema,
         version.compiler_revision,
         artifact.artifact_digest,
         artifact.html_bytes
       from ss.site_versions version
       join ss.artifacts artifact
         on artifact.organization_id = version.organization_id
        and artifact.id = version.artifact_id
       join ss.version_state_projection state
         on state.version_id = version.id
        and state.state = 'accepted_release'
      where version.organization_id = $1
        and version.project_id = $2
        and version.id = $3`,
      [scope.organizationId, scope.projectId, versionId]
    );
    invariant(
      version.rowCount === 1,
      "ACCEPTED_VERSION_REQUIRED",
      "Choose the exact accepted version before requesting publication.",
      { status: 409 }
    );
    const versionRow = version.rows[0];
    const screeningId = randomUUID();
    await client.query(
      `insert into ss.release_screenings (
         id, organization_id, project_id, version_id, stage,
         method, passed, artifact_digest, findings,
         checker_revision, checked_at
       ) values (
         $1, $2, $3, $4, 'pre_publication',
         'canonical_artifact', true, $5, '[]'::jsonb, $6, $7
       )`,
      [
        screeningId,
        scope.organizationId,
        scope.projectId,
        versionId,
        versionRow.artifact_digest,
        versionRow.compiler_revision,
        now(clock)
      ]
    );
    const requested = await client.query(
      "select ss.request_release($1, $2, $3) as id",
      [scope.projectId, versionId, screeningId]
    );
    const releaseRequestId = requested.rows[0].id;
    const request = await client.query(
      `select address_id, requested_at
         from ss.release_requests
        where organization_id = $1
          and project_id = $2
          and id = $3`,
      [
        scope.organizationId,
        scope.projectId,
        releaseRequestId
      ]
    );
    invariant(
      request.rowCount === 1,
      "PUBLICATION_PROOF_INVALID",
      "The exact publication request could not be staged.",
      { status: 409 }
    );
    return {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      releaseRequestId,
      versionId,
      addressId: request.rows[0].address_id,
      requestedBy: actor.userId,
      requestedAt: iso(request.rows[0].requested_at),
      operation
    };
  }

  async function loadPublicationProof(staged) {
    return authority.service(
      {
        userId: staged.requestedBy,
        organizationId: staged.organizationId,
        readOnly: true
      },
      async (client) => {
        const proof = await client.query(
          `select
         project.id as project_id,
         project.organization_id,
         project.lifecycle,
         safety.state as safety_state,
         request.id as request_id,
         request.version_id,
         request.address_id,
         request.prepublication_screening_id,
         state.state as version_state,
         version.compiler_schema,
         version.compiler_revision,
         artifact.artifact_digest,
         artifact.html_bytes,
         screening.id as screening_id,
         screening.stage as screening_stage,
         screening.passed as screening_passed,
         screening.artifact_digest as screening_artifact_digest,
         subscription.status as subscription_status,
         subscription.grace_ends_at,
         ownership.id as ownership_entitlement_id,
         ownership.state as ownership_state,
         ownership.completed_at as ownership_completed_at,
         address.kind as address_kind,
         address.state as address_state,
         address.serving_hostname
       from ss.release_requests request
       join ss.projects project
         on project.organization_id = request.organization_id
        and project.id = request.project_id
       join ss.project_safety_projection safety
         on safety.project_id = project.id
       join ss.site_versions version
         on version.organization_id = request.organization_id
        and version.id = request.version_id
       join ss.version_state_projection state
         on state.version_id = version.id
       join ss.artifacts artifact
         on artifact.organization_id = version.organization_id
        and artifact.id = version.artifact_id
       join ss.release_screenings screening
         on screening.organization_id = request.organization_id
        and screening.id = request.prepublication_screening_id
       left join ss.stripe_subscriptions subscription
         on subscription.organization_id = request.organization_id
        and subscription.project_id = request.project_id
       left join ss.site_ownership_entitlements ownership
         on ownership.organization_id = request.organization_id
        and ownership.project_id = request.project_id
        and ownership.state = 'completed'
       join ss.project_addresses address
         on address.organization_id = request.organization_id
        and address.id = request.address_id
        where request.organization_id = $1
          and request.project_id = $2
          and request.id = $3
          and request.version_id = $4
          and request.address_id = $5
          and (
            subscription.status in ('active', 'grace')
            or ownership.id is not null
          )`,
          [
            staged.organizationId,
            staged.projectId,
            staged.releaseRequestId,
            staged.versionId,
            staged.addressId
          ]
        );
        invariant(
          proof.rowCount === 1,
          "PUBLICATION_PROOF_INVALID",
          "The exact publication proof could not be assembled.",
          { status: 409 }
        );
        const row = proof.rows[0];
        return {
          row,
          input: {
            organizationId: row.organization_id,
            projectId: row.project_id,
            releaseId: staged.versionId,
            project: {
              id: row.project_id,
              organizationId: row.organization_id,
              lifecycle: row.lifecycle,
              safetyState: row.safety_state
            },
            releaseRequest: {
              id: row.request_id,
              organizationId: row.organization_id,
              projectId: row.project_id,
              versionId: row.version_id,
              addressId: row.address_id,
              prepublicationScreeningId:
                row.prepublication_screening_id
            },
            version: {
              id: row.version_id,
              state: row.version_state,
              artifactDigest: row.artifact_digest,
              compilerSchema: row.compiler_schema,
              compilerRevision: row.compiler_revision
            },
            screening: {
              id: row.screening_id,
              versionId: row.version_id,
              stage: row.screening_stage,
              passed: row.screening_passed,
              artifactDigest: row.screening_artifact_digest
            },
            entitlement:
              row.subscription_status === "active" ||
              row.subscription_status === "grace"
                ? {
                    kind: "subscription",
                    organizationId:
                      row.organization_id,
                    projectId: row.project_id,
                    status:
                      row.subscription_status,
                    graceEndsAt:
                      iso(row.grace_ends_at)
                  }
                : {
                    kind: "ownership",
                    id:
                      row.ownership_entitlement_id,
                    organizationId:
                      row.organization_id,
                    projectId: row.project_id,
                    status: row.ownership_state,
                    completedAt:
                      iso(row.ownership_completed_at)
                  },
            address: {
              id: row.address_id,
              organizationId: row.organization_id,
              projectId: row.project_id,
              kind: row.address_kind,
              state: row.address_state,
              verified: row.address_state === "configured",
              hostname: row.serving_hostname
            },
            artifact: {
              htmlBytes: row.html_bytes,
              sha256: row.artifact_digest,
              compilerSchema: row.compiler_schema,
              compilerRevision: row.compiler_revision
            }
          }
        };
      }
    );
  }

  async function finalizePublication(
    actor,
    staged,
    proof,
    providerResult
  ) {
    return authority.service(
      {
        userId: actor.userId,
        organizationId: staged.organizationId
      },
      async (client) => {
        const locked = await client.query(
          `select id
             from ss.release_requests
            where organization_id = $1
              and project_id = $2
              and id = $3
            for update`,
          [
            staged.organizationId,
            staged.projectId,
            staged.releaseRequestId
          ]
        );
        invariant(
          locked.rowCount === 1,
          "PUBLICATION_PROOF_INVALID",
          "The staged publication request no longer exists.",
          { status: 409 }
        );
        const receiptId = randomUUID();
        const facts = {
          projectId: staged.projectId,
          versionId: staged.versionId,
          artifactDigest: proof.row.artifact_digest,
          hostname: proof.row.serving_hostname
        };
        const factsDigest = digest(facts);
        await client.query(
          `insert into ss.provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts, facts_digest, occurred_at
       ) values (
         $1, $2, $3, 'sitesourcery-selfhost', 'deployment_verified',
         $4, $5::jsonb, $6, $7
       )
       on conflict (
         provider_code, receipt_kind, external_object_ref
       ) do nothing`,
          [
            receiptId,
            staged.organizationId,
            staged.projectId,
            providerResult.providerRequestId,
            JSON.stringify(facts),
            factsDigest,
            now(clock)
          ]
        );
        const receipt = await client.query(
          `select id, facts_digest
         from ss.provider_receipts
        where provider_code = 'sitesourcery-selfhost'
          and receipt_kind = 'deployment_verified'
          and external_object_ref = $1`,
          [providerResult.providerRequestId]
        );
        invariant(
          receipt.rowCount === 1 &&
            receipt.rows[0].facts_digest === factsDigest,
          "PUBLICATION_RECEIPT_CONFLICT",
          "The publication receipt does not match this exact release.",
          { status: 409 }
        );
        const existing = await client.query(
          `select id
             from ss.releases
            where organization_id = $1
              and project_id = $2
              and release_request_id = $3`,
          [
            staged.organizationId,
            staged.projectId,
            staged.releaseRequestId
          ]
        );
        let releaseId = existing.rows[0]?.id;
        if (!releaseId) {
          const completed = await client.query(
            "select ss.complete_release($1, $2) as id",
            [
              staged.releaseRequestId,
              receipt.rows[0].id
            ]
          );
          releaseId = completed.rows[0].id;
          await client.query(
            "update ss.projects set revision = revision + 1 where id = $1",
            [staged.projectId]
          );
        }
        return {
          releaseRequest: {
            id: staged.releaseRequestId,
            versionId: staged.versionId,
            addressId: staged.addressId,
            state: "released",
            providerRequestId:
              providerResult.providerRequestId,
            requestedBy: staged.requestedBy,
            requestedAt: staged.requestedAt
          },
          releaseId,
          publication: providerResult,
          project: await loadProject(
            client,
            actor,
            staged.projectId
          )
        };
      }
    );
  }

  async function dispatchPublication(actor, staged) {
    const proof = await loadPublicationProof(staged);
    const providerResult =
      staged.operation === "rollback"
        ? await publicationPort.rollback(proof.input)
        : await publicationPort.request(proof.input);
    const expectedProviderRequestId =
      `selfhost:${staged.operation}:${staged.releaseRequestId}`;
    invariant(
      providerResult?.status === "released" &&
        providerResult.published === true &&
        providerResult.releaseId === staged.versionId &&
        providerResult.providerRequestId ===
          expectedProviderRequestId,
      "PUBLICATION_HELD",
      "Publication is safely held and no website was made live.",
      {
        status: 503,
        details: {
          operation: staged.operation,
          staged: providerResult?.staged === true
        }
      }
    );
    try {
      return await finalizePublication(
        actor,
        staged,
        proof,
        providerResult
      );
    } catch (error) {
      try {
        const compensation =
          await publicationPort.unpublish({
            projectId: staged.projectId,
            hostname: proof.row.serving_hostname
          });
        invariant(
          compensation?.status === "unpublished" &&
            compensation.published === false,
          "PUBLICATION_RECONCILIATION_REQUIRED",
          "Publication could not be made safely non-serving after a database failure.",
          { status: 503 }
        );
      } catch {
        throw new HostedError(
          "PUBLICATION_RECONCILIATION_REQUIRED",
          "Publication finalization failed and the serving state needs operator reconciliation.",
          {
            status: 503,
            details: {
              projectId: staged.projectId,
              releaseRequestId: staged.releaseRequestId
            }
          }
        );
      }
      throw translatePostgres(error);
    }
  }

  function exportFailureFacts({
    phase,
    certainty,
    causeCode = null,
    objectKey = null,
    recovery = "manual_retry_required"
  }) {
    return {
      phase,
      certainty,
      ...(causeCode ? { causeCode } : {}),
      ...(objectKey ? { objectKey } : {}),
      recovery
    };
  }

  function exportFenceLost() {
    return new HostedError(
      "EXPORT_FENCE_LOST",
      "That export attempt was recovered by another worker.",
      { status: 409 }
    );
  }

  async function failExportClaim(
    stage,
    {
      failureCode,
      failureFacts
    }
  ) {
    const failed = await authority.service(
      {},
      (client) =>
        client.query(
          `update ss.export_requests
              set state = 'failed',
                  worker_id = null,
                  lease_started_at = null,
                  lease_expires_at = null,
                  completed_at = null,
                  expires_at = null,
                  failure_code = $5,
                  failure_facts = $6::jsonb,
                  failed_at = $7
            where id = $1
              and state = 'building'
              and worker_id = $2
              and attempt_number = $3
              and fence_token = $4
          returning *`,
          [
            stage.exportId,
            stage.workerId,
            stage.attempt,
            stage.fence,
            failureCode,
            JSON.stringify(failureFacts),
            now(clock)
          ]
        )
    );
    if (failed.rowCount !== 1) throw exportFenceLost();
    return failed.rows[0];
  }

  async function releaseExportClaim(stage) {
    const released = await authority.service(
      {},
      (client) =>
        client.query(
          `update ss.export_requests
              set state = 'queued',
                  worker_id = null,
                  lease_started_at = null,
                  lease_expires_at = null,
                  manifest_digest = null,
                  object_key = null,
                  byte_count = null,
                  object_attempt_number = null,
                  object_fence_token = null,
                  completed_at = null,
                  expires_at = null,
                  failure_code = null,
                  failure_facts = null,
                  failed_at = null
            where id = $1
              and state = 'building'
              and worker_id = $2
              and attempt_number = $3
              and fence_token = $4
          returning *`,
          [
            stage.exportId,
            stage.workerId,
            stage.attempt,
            stage.fence
          ]
        )
    );
    if (released.rowCount !== 1) throw exportFenceLost();
    return released.rows[0];
  }

  async function claimExport({
    exportId = null,
    workerId
  }) {
    const selectedWorkerId =
      exportWorkerIdentity(workerId);
    const claimStartedAt = now(clock);
    const leaseExpiresAt = addMs(
      claimStartedAt,
      exportLeaseMs
    );
    return authority.service(
      {},
      async (client) => {
        const values = [claimStartedAt];
        const exactPredicate = exportId
          ? `and export.id = $${values.push(exportId)}`
          : "";
        const selected = await client.query(
          `select
             export.*,
             project.name,
             project.lifecycle,
             project.created_at as project_created_at,
             project.updated_at as project_updated_at,
             organization.name as organization_name,
             subscription.retention_ends_at
           from ss.export_requests export
           join ss.projects project
             on project.organization_id = export.organization_id
            and project.id = export.project_id
           join ss.organizations organization
             on organization.id = export.organization_id
           left join ss.stripe_subscriptions subscription
             on subscription.organization_id = export.organization_id
            and subscription.project_id = export.project_id
          where (
              export.state = 'queued'
              or (
                export.state = 'building'
                and export.lease_expires_at <= $1
              )
            )
            ${exactPredicate}
          order by export.requested_at, export.id
          limit 1
          for update of export skip locked`,
          values
        );
        const selectedRow = selected.rows[0];
        if (!selectedRow && exportId) {
          const existing = await client.query(
            `select state
               from ss.export_requests
              where id = $1`,
            [exportId]
          );
          invariant(
            existing.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          invariant(
            existing.rows[0].state !== "failed",
            "EXPORT_RETRY_REQUIRED",
            "That failed export requires an explicit retry.",
            { status: 409 }
          );
          invariant(
            false,
            "EXPORT_CLAIM_UNAVAILABLE",
            "That export is not available for this worker.",
            { status: 409 }
          );
        }
        if (!selectedRow) return null;

        const recoveryObject =
          selectedRow.manifest_digest &&
          selectedRow.object_key &&
          selectedRow.byte_count !== null &&
          selectedRow.object_attempt_number !== null &&
          selectedRow.object_fence_token !== null
            ? {
                key: selectedRow.object_key,
                sha256: selectedRow.manifest_digest,
                byteLength: Number(selectedRow.byte_count),
                attempt: Number(
                  selectedRow.object_attempt_number
                ),
                fence: Number(
                  selectedRow.object_fence_token
                )
              }
            : null;
        const claimed = await client.query(
          `update ss.export_requests
              set state = 'building',
                  fence_token = fence_token + 1,
                  worker_id = $2,
                  lease_started_at = $3,
                  lease_expires_at = $4,
                  completed_at = null,
                  expires_at = null,
                  failure_code = null,
                  failure_facts = null,
                  failed_at = null
            where id = $1
          returning *`,
          [
            selectedRow.id,
            selectedWorkerId,
            claimStartedAt,
            leaseExpiresAt
          ]
        );
        const row = {
          ...selectedRow,
          ...claimed.rows[0]
        };
        const stage = {
          exportId: row.id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          workerId: selectedWorkerId,
          attempt: Number(row.attempt_number),
          fence: Number(row.fence_token),
          generatedAt: claimStartedAt,
          retentionEndsAt: row.retention_ends_at
            ? iso(row.retention_ends_at)
            : null,
          recoveryObject
        };

        if (
          stage.retentionEndsAt &&
          Date.parse(stage.retentionEndsAt) <=
            Date.parse(claimStartedAt)
        ) {
          const failureCode =
            "EXPORT_RETENTION_EXPIRED";
          const retained = await client.query(
            `update ss.export_requests
                set state = 'failed',
                    worker_id = null,
                    lease_started_at = null,
                    lease_expires_at = null,
                    completed_at = null,
                    expires_at = null,
                    failure_code = $5,
                    failure_facts = $6::jsonb,
                    failed_at = $7
              where id = $1
                and state = 'building'
                and worker_id = $2
                and attempt_number = $3
                and fence_token = $4`,
            [
              stage.exportId,
              stage.workerId,
              stage.attempt,
              stage.fence,
              failureCode,
              JSON.stringify(
                exportFailureFacts({
                  phase: "retention",
                  certainty: recoveryObject
                    ? "ambiguous"
                    : "not_written",
                  objectKey:
                    recoveryObject?.key ?? null
                })
              ),
              claimStartedAt
            ]
          );
          invariant(
            retained.rowCount === 1,
            "EXPORT_FENCE_LOST",
            "That export attempt was recovered by another worker.",
            { status: 409 }
          );
          return {
            ...stage,
            failureCode
          };
        }

        const [draft, versions, addresses, tickets] =
          await Promise.all([
            client.query(
              `select raw_facts, revision, updated_at
                 from ss.project_drafts
                where project_id = $1`,
              [row.project_id]
            ),
            client.query(
              `select
                 version.id, version.version_number,
                 version.raw_facts, version.compiler_schema,
                 version.compiler_revision, version.created_at,
                 state.state, artifact.artifact_digest,
                 artifact.html_bytes
               from ss.site_versions version
               join ss.artifacts artifact
                 on artifact.id = version.artifact_id
               left join ss.version_state_projection state
                 on state.version_id = version.id
              where version.project_id = $1
              order by version.version_number`,
              [row.project_id]
            ),
            client.query(
              `select
                 id, kind, ownership, retained_domain,
                 serving_hostname, state, allocated_at
               from ss.project_addresses
              where project_id = $1
              order by allocated_at, id`,
              [row.project_id]
            ),
            client.query(
              `select
                 ticket.id, ticket.subject, ticket.state,
                 ticket.created_at,
                 coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'authorKind', message.author_kind,
                       'body', message.body,
                       'createdAt', message.created_at
                     )
                     order by message.created_at, message.id
                   ) filter (where message.id is not null),
                   '[]'::jsonb
                 ) as messages
               from ss.support_tickets ticket
               left join ss.support_messages message
                 on message.ticket_id = ticket.id
              where ticket.project_id = $1
              group by ticket.id
              order by ticket.created_at, ticket.id`,
              [row.project_id]
            )
          ]);
        return {
          ...stage,
          manifest: {
            schema: "sitesourcery.project-export/v1",
            generatedAt: claimStartedAt,
            organization: {
              id: row.organization_id,
              name: row.organization_name
            },
            project: {
              id: row.project_id,
              name: row.name,
              lifecycle: row.lifecycle,
              createdAt: iso(row.project_created_at),
              updatedAt: iso(row.project_updated_at),
              supportTickets: tickets.rows.map(
                (ticket) => ({
                  id: ticket.id,
                  subject: ticket.subject,
                  state: ticket.state,
                  createdAt: iso(ticket.created_at),
                  messages: ticket.messages
                })
              )
            },
            site: {
              draft: draft.rows[0]
                ? {
                    revision: Number(
                      draft.rows[0].revision
                    ),
                    rawFacts: draft.rows[0].raw_facts,
                    updatedAt: iso(
                      draft.rows[0].updated_at
                    )
                  }
                : null,
              versions: versions.rows.map(
                (version) => ({
                  id: version.id,
                  versionNumber: Number(
                    version.version_number
                  ),
                  state: version.state,
                  rawFacts: version.raw_facts,
                  compilerSchema:
                    version.compiler_schema,
                  compilerRevision:
                    version.compiler_revision,
                  artifactDigest:
                    version.artifact_digest,
                  createdAt: iso(version.created_at)
                })
              )
            },
            domains: addresses.rows.map(
              (address) => ({
                id: address.id,
                kind: address.kind,
                ownership: address.ownership,
                retainedDomain:
                  address.retained_domain,
                servingHostname:
                  address.serving_hostname,
                state: address.state,
                allocatedAt: iso(address.allocated_at)
              })
            )
          },
          versions: versions.rows
        };
      }
    );
  }

  async function claimExportWithRetry(input) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await claimExport(input);
      } catch (error) {
        const retryable =
          error?.code === "40001" ||
          error?.code === "40P01" ||
          (
            error instanceof HostedError &&
            error.code === "WRITE_CONFLICT"
          );
        if (!retryable) throw error;
        lastError = error;
      }
    }
    throw translatePostgres(lastError);
  }

  function buildExportObject(stage) {
    const json = (value) =>
      Buffer.from(
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8"
      );
    const entries = [
      {
        name: "manifest.json",
        bytes: json(stage.manifest)
      },
      {
        name: "site/project.json",
        bytes: json(stage.manifest.project)
      },
      {
        name: "site/content.json",
        bytes: json(stage.manifest.site)
      },
      {
        name: "domains/manifest.json",
        bytes: json(stage.manifest.domains)
      },
      ...stage.versions.map((version) => ({
        name:
          `site/releases/${version.version_number}-${version.id}.html`,
        bytes: version.html_bytes
      }))
    ];
    const bytes = createStoredZip(entries, {
      createdAt: stage.generatedAt
    });
    return {
      key: exportStore.key({
        organizationId: stage.organizationId,
        projectId: stage.projectId,
        exportId: stage.exportId,
        attempt: stage.attempt,
        fence: stage.fence
      }),
      bytes,
      sha256: digest(bytes),
      byteLength: bytes.byteLength,
      attempt: stage.attempt,
      fence: stage.fence
    };
  }

  async function prepareExportObject(stage, object) {
    const prepared = await authority.service(
      {},
      (client) =>
        client.query(
          `update ss.export_requests
              set manifest_digest = $5,
                  object_key = $6,
                  byte_count = $7,
                  object_attempt_number = $3,
                  object_fence_token = $4
            where id = $1
              and state = 'building'
              and worker_id = $2
              and attempt_number = $3
              and fence_token = $4
          returning id`,
          [
            stage.exportId,
            stage.workerId,
            stage.attempt,
            stage.fence,
            object.sha256,
            object.key,
            object.byteLength
          ]
        )
    );
    if (prepared.rowCount !== 1) throw exportFenceLost();
  }

  async function readExactExportObject(object) {
    return exportStore.get({
      key: object.key,
      expectedSha256: object.sha256,
      expectedByteLength: object.byteLength
    });
  }

  function exactExportObject(value, expected) {
    invariant(
      value?.key === expected.key &&
        value?.sha256 === expected.sha256 &&
        Number(value?.byteLength) ===
          expected.byteLength,
      "EXPORT_OBJECT_RESPONSE_INVALID",
      "The export object store returned different object facts.",
      { status: 503 }
    );
    return {
      key: expected.key,
      sha256: expected.sha256,
      byteLength: expected.byteLength,
      attempt: expected.attempt,
      fence: expected.fence
    };
  }

  async function failObjectClaim(
    stage,
    {
      failureCode,
      phase,
      certainty,
      cause,
      objectKey
    }
  ) {
    await failExportClaim(stage, {
      failureCode,
      failureFacts: exportFailureFacts({
        phase,
        certainty,
        causeCode: safeExportCauseCode(cause),
        objectKey
      })
    });
    throw new HostedError(
      failureCode,
      "The export object could not be confirmed safely. Use Retry after reviewing the failure.",
      { status: 503 }
    );
  }

  async function reconcileExistingExportObject(
    stage,
    object
  ) {
    try {
      return exactExportObject(
        await readExactExportObject(object),
        object
      );
    } catch (error) {
      if (exportObjectNotFound(error)) return null;
      await failObjectClaim(stage, {
        failureCode:
          "EXPORT_OBJECT_RECONCILIATION_REQUIRED",
        phase: "reconcile",
        certainty: "ambiguous",
        cause: error,
        objectKey: object.key
      });
    }
  }

  async function writeAndReconcileExportObject(
    stage,
    prepared
  ) {
    try {
      return exactExportObject(
        await exportStore.put({
          organizationId: stage.organizationId,
          projectId: stage.projectId,
          exportId: stage.exportId,
          attempt: prepared.attempt,
          fence: prepared.fence,
          bytes: prepared.bytes,
          expectedSha256: prepared.sha256
        }),
        prepared
      );
    } catch (writeError) {
      try {
        return exactExportObject(
          await readExactExportObject(prepared),
          prepared
        );
      } catch (readError) {
        if (exportObjectNotFound(readError)) {
          await failObjectClaim(stage, {
            failureCode:
              "EXPORT_OBJECT_WRITE_NOT_CONFIRMED",
            phase: "put",
            certainty: "not_written",
            cause: writeError,
            objectKey: prepared.key
          });
        }
        await failObjectClaim(stage, {
          failureCode:
            writeError?.code ===
                "OBJECT_KEY_CONFLICT" ||
              readError?.code ===
                "OBJECT_INTEGRITY_MISMATCH"
              ? "EXPORT_OBJECT_KEY_CONFLICT"
              : "EXPORT_OBJECT_RECONCILIATION_REQUIRED",
          phase: "put_reconcile",
          certainty: "ambiguous",
          cause: readError,
          objectKey: prepared.key
        });
      }
    }
  }

  async function finalizeExportClaimOnce(stage, object) {
    if (
      stage.retentionEndsAt &&
      Date.parse(stage.retentionEndsAt) <=
        Date.parse(now(clock))
    ) {
      await failExportClaim(stage, {
        failureCode: "EXPORT_RETENTION_EXPIRED",
        failureFacts: exportFailureFacts({
          phase: "finalize",
          certainty: "confirmed_not_finalized",
          objectKey: object.key
        })
      });
      throw new HostedError(
        "EXPORT_RETENTION_EXPIRED",
        "The project export retention period has ended.",
        { status: 410 }
      );
    }
    return authority.service(
      {},
      async (client) => {
        const completedAt = now(clock);
        const expiresAt =
          stage.retentionEndsAt ??
          addDays(completedAt, EXPORT_TTL_DAYS);
        const updated = await client.query(
          `update ss.export_requests
              set state = 'ready',
                  manifest_digest = $5,
                  object_key = $6,
                  byte_count = $7,
                  completed_at = $8,
                  expires_at = $9,
                  worker_id = null,
                  lease_started_at = null,
                  lease_expires_at = null,
                  failure_code = null,
                  failure_facts = null,
                  failed_at = null
            where id = $1
              and state = 'building'
              and worker_id = $2
              and attempt_number = $3
              and fence_token = $4
              and manifest_digest = $5
              and object_key = $6
              and byte_count = $7
              and object_attempt_number = $10
              and object_fence_token = $11
          returning *`,
          [
            stage.exportId,
            stage.workerId,
            stage.attempt,
            stage.fence,
            object.sha256,
            object.key,
            object.byteLength,
            completedAt,
            expiresAt,
            object.attempt,
            object.fence
          ]
        );
        if (updated.rowCount !== 1) {
          throw exportFenceLost();
        }
        await audit(client, {
          organizationId: stage.organizationId,
          projectId: stage.projectId,
          actorId: "system:export-worker",
          action: "export.ready",
          targetType: "export_request",
          targetId: stage.exportId,
          metadata: {
            attempt: stage.attempt,
            fence: stage.fence,
            byteLength: object.byteLength,
            sha256: object.sha256
          }
        });
        return { export: publicExport(updated.rows[0]) };
      }
    );
  }

  async function finalizeExportClaim(stage, object) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await finalizeExportClaimOnce(
          stage,
          object
        );
      } catch (error) {
        const retryable =
          error?.code === "40001" ||
          error?.code === "40P01" ||
          (
            error instanceof HostedError &&
            error.code === "WRITE_CONFLICT"
          );
        if (!retryable) throw error;
        lastError = error;
      }
    }
    throw translatePostgres(lastError);
  }

  async function processClaimedExport(
    stage,
    { signal = null } = {}
  ) {
    if (stage.failureCode) {
      throw new HostedError(
        stage.failureCode,
        "The project export retention period has ended.",
        { status: 410 }
      );
    }
    if (signal?.aborted) {
      const released = await releaseExportClaim(stage);
      return {
        aborted: true,
        export: publicExport(released)
      };
    }

    let object = null;
    try {
      object = stage.recoveryObject
        ? await reconcileExistingExportObject(
            stage,
            stage.recoveryObject
          )
        : null;
      if (!object) {
        const prepared = buildExportObject(stage);
        await prepareExportObject(stage, prepared);
        if (signal?.aborted) {
          const released = await releaseExportClaim(stage);
          return {
            aborted: true,
            export: publicExport(released)
          };
        }
        object = await writeAndReconcileExportObject(
          stage,
          prepared
        );
      }
      return finalizeExportClaim(stage, object);
    } catch (error) {
      if (
        error instanceof HostedError &&
        [
          "EXPORT_FENCE_LOST",
          "EXPORT_OBJECT_KEY_CONFLICT",
          "EXPORT_OBJECT_RECONCILIATION_REQUIRED",
          "EXPORT_OBJECT_WRITE_NOT_CONFIRMED",
          "EXPORT_RETENTION_EXPIRED",
          "WRITE_CONFLICT"
        ].includes(error.code)
      ) {
        throw error;
      }
      const failureCode = object
        ? "EXPORT_FINALIZE_FAILED"
        : "EXPORT_BUILD_FAILED";
      await failExportClaim(stage, {
        failureCode,
        failureFacts: exportFailureFacts({
          phase: object ? "finalize" : "build",
          certainty: object
            ? "confirmed_not_finalized"
            : "not_written",
          causeCode: safeExportCauseCode(error),
          objectKey: object?.key ?? null
        })
      });
      throw new HostedError(
        failureCode,
        object
          ? "The confirmed export object could not be finalized. Use Retry to start a new attempt."
          : "The export could not be built safely. Use Retry to start a new attempt.",
        { status: 503 }
      );
    }
  }

  const service = {
    authenticate(token) {
      return identity.authenticate(token);
    },

    register(input, requestContext) {
      return identity.register(input, requestContext);
    },

    completeRegistration(input) {
      return identity.completeRegistration(input);
    },

    signIn(input) {
      return identity.signIn(input);
    },

    signOut(actor) {
      return identity.signOut(requiredActor(actor));
    },

    async requestRecovery(input, requestContext) {
      const selectedCommandId = commandId(input.commandId);
      const recipient = normalizeEmail(input.email);
      const requestDigest = digest({
        schema: "sitesourcery.recovery-request/v1",
        commandId: selectedCommandId,
        recipient
      });
      const prior = await authority.service(
        { readOnly: true },
        async (client) =>
          (
            await client.query(
              `select request_digest, state, delivery_mode
                 from ss.hosted_recovery_delivery_requests
                where command_id = $1
                limit 1`,
              [selectedCommandId]
            )
          ).rows[0] ?? null
      );
      if (prior) {
        return priorRecoveryDelivery(
          prior,
          requestDigest
        );
      }
      const recoveryReadiness =
        await recoveryMailPort.readiness();
      if (recoveryReadiness.ready !== true) {
        return recoveryDeliveryResponse("held");
      }
      invariant(
        ["production", "dev-sink"].includes(
          recoveryReadiness.mode
        ) &&
          typeof recoveryReadiness.provider === "string" &&
          recoveryReadiness.provider.length > 0 &&
          recoveryReadiness.provider.length <= 120,
        "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
        "Recovery mail readiness is invalid.",
        { status: 500 }
      );
      const issued =
        await identity.issueRecoveryForDelivery(
          recipient,
          { commandId: selectedCommandId },
          requestContext
        );
      invariant(
        issued.recipient === recipient,
        "RECOVERY_DELIVERY_INVALID",
        "Recovery identity returned an invalid recipient.",
        { status: 500 }
      );
      const requestedAt =
        issued.delivery?.createdAt ?? now(clock);
      const expiresAt =
        issued.delivery?.expiresAt ??
        addMs(requestedAt, RECOVERY_DELIVERY_TTL_MS);
      const recoveryToken =
        issued.delivery?.token ??
        digest({
          schema: "sitesourcery.recovery-decoy/v1",
          recipient,
          commandId: selectedCommandId
        });
      const deliveryIdempotencyKey =
        `recovery_${digest({
          recipient,
          commandId: selectedCommandId
        })}`;
      const reservation = await authority.service({}, async (client) => {
        await client.query(
          `select pg_advisory_xact_lock(
             hashtextextended($1, 0)
           )`,
          [
            `sitesourcery.recovery.command:${selectedCommandId}`
          ]
        );
        const concurrent = await client.query(
          `select request_digest, state, delivery_mode
             from ss.hosted_recovery_delivery_requests
            where command_id = $1
            limit 1
            for update`,
          [selectedCommandId]
        );
        if (concurrent.rows[0]) {
          return {
            replayed: true,
            row: concurrent.rows[0]
          };
        }
        const id = randomUUID();
        const inserted = await client.query(
          `insert into ss.hosted_recovery_delivery_requests (
             id, command_id, request_digest,
             delivery_idempotency_key, delivery_mode,
             delivery_provider, state, requested_at,
             expires_at, recovery_token_id
           ) values (
             $1, $2, $3,
             $4, $5,
             $6, $7, $8,
             $9, $10
           )`,
          [
            id,
            selectedCommandId,
            requestDigest,
            deliveryIdempotencyKey,
            recoveryReadiness.mode,
            recoveryReadiness.provider,
            issued.delivery
              ? "pending_delivery"
              : "recipient_unresolved",
            requestedAt,
            expiresAt,
            issued.delivery?.tokenId ?? null
          ]
        );
        invariant(
          inserted.rowCount === 1,
          "RECOVERY_DELIVERY_RESERVATION_FAILED",
          "Recovery delivery could not be reserved.",
          { status: 500 }
        );
        return { replayed: false, id };
      });
      if (reservation.replayed) {
        return priorRecoveryDelivery(
          reservation.row,
          requestDigest
        );
      }
      if (!issued.delivery) {
        return recoveryDeliveryResponse(
          recoveryReadiness.mode
        );
      }

      async function markDeliveryUnknown() {
        try {
          await authority.service({}, async (client) => {
            await client.query(
              `update ss.hosted_recovery_delivery_requests
                  set state = 'delivery_unknown',
                      failure_code =
                        'RECOVERY_DELIVERY_EFFECT_UNKNOWN',
                      updated_at = clock_timestamp()
                where id = $1
                  and state = 'pending_delivery'`,
              [reservation.id]
            );
          });
        } catch {
          // The original delivery failure remains authoritative. A row left
          // pending is also terminal for automatic replay.
        }
      }

      try {
        const receipt = await recoveryMailPort.deliver({
          idempotencyKey: deliveryIdempotencyKey,
          recipient,
          token: recoveryToken,
          customerUserId: issued.delivery.userId,
          requestedAt,
          expiresAt
        });
        const productionAcceptance =
          receipt?.state === "provider_accepted" &&
          receipt.mode === "production" &&
          receipt.providerEffects === true &&
          /^[0-9a-f-]{36}$/u.test(
            String(receipt.messageId ?? "")
          );
        const developmentDelivery =
          receipt?.state === "delivered" &&
          receipt.mode === "dev-sink" &&
          receipt.provider === "development-sink";
        invariant(
          (productionAcceptance || developmentDelivery) &&
            receipt.mode === recoveryReadiness.mode &&
            receipt.provider ===
              recoveryReadiness.provider &&
            receipt.idempotencyKey ===
              deliveryIdempotencyKey &&
            receipt.expiresAt === expiresAt &&
            /^[a-f0-9]{64}$/u.test(receipt.receiptId) &&
            /^[a-f0-9]{64}$/u.test(receipt.payloadDigest),
          "RECOVERY_DELIVERY_RECEIPT_INVALID",
          "Recovery transport returned an invalid delivery receipt.",
          { status: 502 }
        );
        const receiptFacts = {
          schema:
            "sitesourcery.recovery-delivery-evidence/v1",
          receiptId: receipt.receiptId,
          mode: receipt.mode,
          provider: receipt.provider,
          state: receipt.state,
          messageId: receipt.messageId ?? null,
          providerMessageId: receipt.providerMessageId,
          idempotencyKey: receipt.idempotencyKey,
          payloadDigest: receipt.payloadDigest,
          acceptedAt: receipt.acceptedAt,
          expiresAt: receipt.expiresAt
        };
        const receiptFactsDigest = digest(receiptFacts);
        await authority.service({}, async (client) => {
          const locked = await client.query(
            `select
               request_digest, delivery_idempotency_key,
               delivery_mode, delivery_provider, state,
               requested_at, expires_at
             from ss.hosted_recovery_delivery_requests
            where id = $1
            for update`,
            [reservation.id]
          );
          const row = locked.rows[0];
          invariant(
            locked.rowCount === 1 &&
              row.request_digest === requestDigest &&
              row.delivery_idempotency_key ===
                deliveryIdempotencyKey &&
              row.delivery_mode === receipt.mode &&
              row.delivery_provider === receipt.provider &&
              row.state === "pending_delivery" &&
              iso(row.requested_at) === requestedAt &&
              iso(row.expires_at) === expiresAt,
            "RECOVERY_DELIVERY_RECONCILIATION_REQUIRED",
            "Recovery state changed while email was being delivered.",
            { status: 409 }
          );
          await client.query(
            `insert into ss.provider_receipts (
               id, provider_code, receipt_kind,
               external_object_ref, facts, facts_digest,
               occurred_at
             ) values (
               $1, $2, 'recovery_delivery_accepted',
               $3, $4::jsonb, $5,
               $6
             )
             on conflict (
               provider_code, receipt_kind,
               external_object_ref
             ) do nothing`,
            [
              randomUUID(),
              `mail:${receipt.provider}`,
              receipt.receiptId,
              JSON.stringify(receiptFacts),
              receiptFactsDigest,
              receipt.acceptedAt
            ]
          );
          const recorded = await client.query(
            `select id, facts_digest
               from ss.provider_receipts
              where provider_code = $1
                and receipt_kind =
                      'recovery_delivery_accepted'
                and external_object_ref = $2`,
            [
              `mail:${receipt.provider}`,
              receipt.receiptId
            ]
          );
          invariant(
            recorded.rowCount === 1 &&
              recorded.rows[0].facts_digest ===
                receiptFactsDigest,
            "RECOVERY_DELIVERY_RECEIPT_CONFLICT",
            "Recovery delivery evidence does not match.",
            { status: 409 }
          );
          const finalized = await client.query(
            `update ss.hosted_recovery_delivery_requests
                set state = $2,
                    provider_receipt_id = $3,
                    mail_delivery_id = $4,
                    provider_accepted_at = $5,
                    delivery_lineage_version = $6,
                    delivered_at = $7,
                    updated_at = clock_timestamp()
              where id = $1
                and state = 'pending_delivery'`,
            [
              reservation.id,
              receipt.state,
              recorded.rows[0].id,
              productionAcceptance ? receipt.messageId : null,
              productionAcceptance ? receipt.acceptedAt : null,
              productionAcceptance
                ? "provider_accepted_v1"
                : "development_sink_v1",
              developmentDelivery ? receipt.acceptedAt : null
            ]
          );
          invariant(
            finalized.rowCount === 1,
            "RECOVERY_DELIVERY_RECONCILIATION_REQUIRED",
            "Recovery delivery could not be finalized.",
            { status: 409 }
          );
        });
        return recoveryDeliveryResponse(
          recoveryReadiness.mode
        );
      } catch (error) {
        await markDeliveryUnknown();
        throw error;
      }
    },

    completeRecovery(input) {
      return identity.completeRecovery(input.token, input.password);
    },

    async me(actor) {
      if (!actor) return { user: null };
      const organizations = await service.listOrganizations(actor);
      return {
        user: actor.user,
        organizations: organizations.organizations
      };
    },

    async listOrganizations(actor) {
      requiredActor(actor);
      return authority.service(
        { userId: actor.userId, readOnly: true },
        async (client) => {
          const result = await client.query(
            `select
               organization.id,
               organization.name,
               organization.state,
               organization.created_at,
               membership.role
             from ss.organization_memberships membership
             join ss.organizations organization
               on organization.id = membership.organization_id
            where membership.user_id = $1
              and membership.state = 'active'
            order by organization.created_at, organization.id`,
            [actor.userId]
          );
          return {
            organizations: result.rows.map((row) => ({
              id: row.id,
              name: row.name,
              role: row.role,
              state: row.state,
              createdAt: iso(row.created_at)
            }))
          };
        }
      );
    },

    async listProjects(actor, organizationId) {
      const orgId = uuid(organizationId, "Organization ID");
      requiredActor(actor);
      return authority.service(
        {
          userId: actor.userId,
          organizationId: orgId,
          readOnly: true
        },
        async (client) => {
          await membership(client, actor, orgId);
          const result = await client.query(
            `select id
               from ss.projects
              where organization_id = $1
                and lifecycle <> 'deleted'
              order by updated_at desc, id`,
            [orgId]
          );
          const projects = [];
          for (const row of result.rows) {
            projects.push(await loadProject(client, actor, row.id));
          }
          return { projects };
        }
      );
    },

    async getProject(actor, projectId) {
      const scope = await projectScope(actor, projectId);
      return authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => ({
          project: await loadProject(client, actor, scope.projectId)
        })
      );
    },

    async getProjectLegalAuthority() {
      invariant(
        legalAuthority && await projectLegalReadiness(),
        "LEGAL_CONFIGURATION_REQUIRED",
        "The reviewed Privacy V3 authority is not configured.",
        { status: 503 }
      );
      return publicProjectLegalAuthority(legalAuthority);
    },

    async projectCreationLegalReadiness() {
      return projectLegalReadiness();
    },

    async createProject(actor, organizationId, input) {
      requiredActor(actor);
      const orgId = uuid(organizationId, "Organization ID");
      invariant(
        legalAuthority && await projectLegalReadiness(),
        "LEGAL_CONFIGURATION_REQUIRED",
        "Project creation is held while reviewed legal authority is installed.",
        { status: 503 }
      );
      invariant(
        input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input).every((key) =>
            new Set([
              "accessPassword",
              "address",
              "commandId",
              "legalAcceptance",
              "name",
              "userAgentDigest",
              "visibility"
            ]).has(key)
          ),
        "LEGAL_ACCEPTANCE_INVALID",
        "Project creation contains an unsupported field.",
        { status: 400 }
      );
      const name = requiredText(input.name, "Project name", 120, 2);
      const legalAcceptance = validateProjectLegalAcceptance(
        input.legalAcceptance,
        legalAuthority
      );
      const visibility = input.visibility ?? "public";
      invariant(
        visibility === "public" || visibility === "private",
        "INVALID_INPUT",
        "Visibility is invalid.",
        { status: 400 }
      );
      const accessPassword =
        visibility === "private"
          ? validatePassword(input.accessPassword)
          : null;
      const passwordPhc = accessPassword
        ? await hashPassword(accessPassword)
        : null;
      const normalizedAddress = input.address
        ? { ...input.address, kind: input.address.kind }
        : null;
      try {
        return await authority.service(
          { userId: actor.userId, organizationId: orgId },
          async (client) => {
            await membership(client, actor, orgId, WRITE_ROLES);
            return idempotent(client, {
              actor,
              organizationId: orgId,
              routeKey: "project.create",
              key: input.commandId,
              purpose: {
                organizationId: orgId,
                name,
                visibility,
                address: normalizedAddress,
                legalAcceptance
              },
              work: async (requestId) => {
                const documents = await client.query(
                  `select document.id, document.kind, document.version,
                          document.content_digest, document.content_uri,
                          document.effective_at, artifact.artifact_uri,
                          artifact.artifact_sha256, artifact.byte_count,
                          artifact.media_type
                     from ss.legal_documents document
                     left join ss.legal_document_artifacts artifact
                       on artifact.document_id = document.id
                    join (values
                      ($1::text, $2::text),
                      ($3::text, $4::text),
                      ($5::text, $6::text)
                    ) expected(kind, version)
                      on expected.kind = document.kind
                     and expected.version = document.version
                    where document.retired_at is null
                    order by array_position(
                      array[$1::text, $3::text, $5::text], document.kind
                    )
                    for update of document`,
                  [
                    legalAcceptance.documents[0].kind,
                    legalAcceptance.documents[0].version,
                    legalAcceptance.documents[1].kind,
                    legalAcceptance.documents[1].version,
                    legalAcceptance.documents[2].kind,
                    legalAcceptance.documents[2].version
                  ]
                );
                invariant(
                  documents.rowCount === legalAcceptance.documents.length &&
                    documents.rows.every((document, index) => {
                      const expected = legalAcceptance.documents[index];
                      const expectedArtifact =
                        legalAuthority.artifactBindings[index];
                      const artifactValid = expectedArtifact.artifactUri === null
                        ? document.artifact_uri === null &&
                          document.artifact_sha256 === null &&
                          document.byte_count === null &&
                          document.media_type === null
                        : document.artifact_uri === expectedArtifact.artifactUri &&
                            constantTimeDigestEqual(
                              document.artifact_sha256,
                              expectedArtifact.artifactSha256
                            ) &&
                            Number(document.byte_count) ===
                              expectedArtifact.byteCount &&
                            document.media_type === expectedArtifact.mediaType;
                      return document.kind === expected.kind &&
                        document.version === expected.version &&
                        constantTimeDigestEqual(
                          document.content_digest,
                          expected.contentDigest
                        ) &&
                        document.content_uri === expected.contentUri &&
                        new Date(document.effective_at).toISOString() === expected.effectiveAt &&
                        artifactValid;
                    }),
                  "LEGAL_AUTHORITY_CHANGED",
                  "The reviewed legal authority changed. Refresh and try again.",
                  { status: 409 }
                );
                const policy = await client.query(
                  `select id
                     from ss.billing_policies
                    where effective_at <= $1
                      and (retired_at is null or retired_at > $1)
                    order by effective_at desc, id desc
                    limit 1`,
                  [now(clock)]
                );
                invariant(
                  policy.rowCount === 1,
                  "BILLING_POLICY_REQUIRED",
                  "The billing lifecycle policy is not installed.",
                  { status: 503 }
                );
                const projectId = randomUUID();
                await client.query(
                  `insert into ss.projects (
                     id, organization_id, created_by_user_id,
                     billing_policy_id, name, lifecycle, revision,
                     created_at, updated_at
                   ) values ($1, $2, $3, $4, $5, 'active', 1, $6, $6)`,
                  [
                    projectId,
                    orgId,
                    actor.userId,
                    policy.rows[0].id,
                    name,
                    now(clock)
                  ]
                );
                const receiptId = randomUUID();
                const acceptedAt = now(clock);
                await client.query(
                  `insert into ss.project_legal_acceptance_receipts (
                     id, organization_id, project_id, user_id, request_id,
                     schema_version, acceptance_statement, authority_digest,
                     user_agent_digest, accepted_at
                   ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                  [
                    receiptId,
                    orgId,
                    projectId,
                    actor.userId,
                    requestId,
                    legalAcceptance.schema,
                    legalAcceptance.acceptanceStatement,
                    legalAcceptance.authorityDigest,
                    input.userAgentDigest ?? null,
                    acceptedAt
                  ]
                );
                for (const document of documents.rows) {
                  const acceptanceId = randomUUID();
                  await client.query(
                    `insert into ss.term_acceptances (
                       id, organization_id, project_id, user_id, document_id,
                       accepted_at, request_id, legal_receipt_id
                     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                      acceptanceId,
                      orgId,
                      projectId,
                      actor.userId,
                      document.id,
                      acceptedAt,
                      requestId,
                      receiptId
                    ]
                  );
                  await client.query(
                    `insert into ss.project_required_terms (
                       organization_id, project_id, kind, acceptance_id
                     ) values ($1, $2, $3, $4)`,
                    [orgId, projectId, document.kind, acceptanceId]
                  );
                }
                await client.query(
                  `insert into ss.project_safety_projection (
                     organization_id, project_id, state, updated_at
                   ) values ($1, $2, 'clear', $3)`,
                  [orgId, projectId, now(clock)]
                );
                let credentialId = null;
                if (passwordPhc) {
                  credentialId = randomUUID();
                  await client.query(
                    `insert into ss.project_access_credentials (
                       id, organization_id, project_id, password_phc,
                       credential_fingerprint, created_at
                     ) values ($1, $2, $3, $4, $5, $6)`,
                    [
                      credentialId,
                      orgId,
                      projectId,
                      passwordPhc,
                      digest(passwordPhc),
                      now(clock)
                    ]
                  );
                }
                await client.query(
                  `insert into ss.project_access_projection (
                     organization_id, project_id, visibility,
                     current_credential_id, updated_at
                   ) values ($1, $2, $3, $4, $5)`,
                  [
                    orgId,
                    projectId,
                    visibility,
                    credentialId,
                    now(clock)
                  ]
                );
                await client.query(
                  `insert into ss.project_drafts (
                     organization_id, project_id, raw_facts, revision,
                     updated_by_user_id, updated_at
                   ) values ($1, $2, '{}'::jsonb, 1, $3, $4)`,
                  [orgId, projectId, actor.userId, now(clock)]
                );
                await client.query(
                  `insert into ss.project_address_projection (
                     organization_id, project_id, current_address_id, updated_at
                   ) values ($1, $2, null, $3)`,
                  [orgId, projectId, now(clock)]
                );
                await client.query(
                  `insert into ss.project_serving_projection (
                     organization_id, project_id, state, resume_state, updated_at
                   ) values ($1, $2, 'unpublished', 'unpublished', $3)`,
                  [orgId, projectId, now(clock)]
                );
                if (normalizedAddress) {
                  await insertAddress(client, {
                    actor,
                    organizationId: orgId,
                    projectId,
                    input: normalizedAddress
                  });
                }
                await audit(client, {
                  organizationId: orgId,
                  projectId,
                  actorId: actor.userId,
                  action: "project.created",
                  targetType: "project",
                  targetId: projectId,
                  requestId
                });
                return {
                  project: await loadProject(client, actor, projectId)
                };
              }
            });
          }
        );
      } catch (error) {
        throw translatePostgres(error);
      }
    },

    async saveDraft(actor, projectId, input) {
      const rawFacts = safeRawFacts(input.rawFacts);
      const revision = Number(input.expectedRevision);
      invariant(
        Number.isSafeInteger(revision) && revision > 0,
        "PRECONDITION_REQUIRED",
        "The exact draft revision is required.",
        { status: 428 }
      );
      return projectWrite(actor, projectId, {
        routeKey: "project.draft.save",
        key: input.commandId,
        purpose: { rawFacts, revision },
        work: async (client, scope) => {
          const updated = await client.query(
            `update ss.project_drafts
                set raw_facts = $4::jsonb,
                    revision = revision + 1,
                    updated_by_user_id = $3,
                    updated_at = $5
              where organization_id = $1
                and project_id = $2
                and revision = $6
            returning revision, raw_facts, updated_at`,
            [
              scope.organizationId,
              scope.projectId,
              actor.userId,
              JSON.stringify(rawFacts),
              now(clock),
              revision
            ]
          );
          invariant(
            updated.rowCount === 1,
            "REVISION_CONFLICT",
            "This project changed in another tab. Reload it before saving.",
            { status: 409 }
          );
          await client.query(
            `update ss.projects
                set revision = revision + 1
              where id = $1`,
            [scope.projectId]
          );
          const draft = updated.rows[0];
          return {
            project: await loadProject(client, actor, scope.projectId),
            draft: {
              revision: Number(draft.revision),
              rawFacts: draft.raw_facts,
              updatedAt: iso(draft.updated_at)
            },
            revision: Number(draft.revision)
          };
        }
      });
    },

    async createVersion(actor, projectId, input) {
      const rawFacts = safeRawFacts(input.rawFacts);
      invariant(
        input.reviewAttested === true,
        "REVIEW_ATTESTATION_REQUIRED",
        "Review the exact generated page before saving this version.",
        { status: 400 }
      );
      const previewDigest = requiredText(
        input.previewDigest,
        "Preview digest",
        64
      );
      invariant(
        /^[a-f0-9]{64}$/u.test(previewDigest),
        "PREVIEW_ARTIFACT_MISMATCH",
        "The reviewed page does not match the exact server-generated artifact.",
        { status: 409 }
      );
      return projectWrite(actor, projectId, {
        routeKey: "project.version.create",
        key: input.commandId,
        purpose: {
          rawFacts,
          previewDigest,
          reviewAttested: true,
          compilerRevision: compiler.revision
        },
        work: async (client, scope) => {
          const compiled = compiler.compile(rawFacts);
          invariant(
            previewDigest === compiled.artifactDigest,
            "PREVIEW_ARTIFACT_MISMATCH",
            "The reviewed page does not match the exact server-generated artifact.",
            { status: 409 }
          );
          await client.query(
            "select id from ss.projects where id = $1 for update",
            [scope.projectId]
          );
          let factSet = await client.query(
            `select id
               from ss.fact_sets
              where organization_id = $1
                and project_id = $2
                and normalized_digest = $3`,
            [
              scope.organizationId,
              scope.projectId,
              compiled.normalizedDigest
            ]
          );
          let factSetId = factSet.rows[0]?.id ?? null;
          if (!factSetId) {
            factSetId = randomUUID();
            const facts = compiled.contentFacts;
            const normalized = compiled.normalizedFacts;
            await client.query(
              `insert into ss.fact_sets (
                 id, organization_id, project_id, schema_version, theme,
                 business_name, summary, about, offerings_count, location,
                 hours, phone_display, phone_href, email_display, email_href,
                 website_display, website_href, primary_action,
                 content_digest, normalized_digest, created_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21
               )`,
              [
                factSetId,
                scope.organizationId,
                scope.projectId,
                compiled.schema,
                normalized.theme,
                facts.businessName,
                facts.summary,
                facts.about,
                compiled.offerings.length,
                facts.location,
                facts.hours,
                facts.phone?.display ?? null,
                facts.phone?.href ?? null,
                facts.email?.display ?? null,
                facts.email?.href ?? null,
                facts.website?.display ?? null,
                facts.website?.href ?? null,
                facts.primaryAction,
                compiled.contentDigest,
                compiled.normalizedDigest,
                now(clock)
              ]
            );
            for (const [index, offering] of compiled.offerings.entries()) {
              await client.query(
                `insert into ss.fact_offerings (
                   organization_id, fact_set_id, position, offering
                 ) values ($1, $2, $3, $4)`,
                [
                  scope.organizationId,
                  factSetId,
                  index + 1,
                  offering
                ]
              );
            }
          }

          let artifact = await client.query(
            `select id, artifact_digest
               from ss.artifacts
              where organization_id = $1
                and project_id = $2
                and artifact_digest = $3`,
            [
              scope.organizationId,
              scope.projectId,
              compiled.artifactDigest
            ]
          );
          let artifactId = artifact.rows[0]?.id ?? null;
          if (!artifactId) {
            artifactId = randomUUID();
            artifact = await client.query(
              `insert into ss.artifacts (
                 id, organization_id, project_id, html_bytes, created_at
               ) values ($1, $2, $3, $4, $5)
               returning id, artifact_digest`,
              [
                artifactId,
                scope.organizationId,
                scope.projectId,
                compiled.htmlBytes,
                now(clock)
              ]
            );
          }
          invariant(
            artifact.rows[0]?.artifact_digest ===
              compiled.artifactDigest,
            "COMPILER_OUTPUT_INVALID",
            "The persisted artifact failed exact digest verification.",
            { status: 500 }
          );

          let versionResult = await client.query(
            `select version.id
               from ss.site_versions version
              where version.project_id = $1
                and version.fact_set_id = $2
                and version.artifact_id = $3`,
            [scope.projectId, factSetId, artifactId]
          );
          let versionId = versionResult.rows[0]?.id ?? null;
          if (!versionId) {
            const sequence = await client.query(
              `select coalesce(max(version_number), 0) + 1 as next
                 from ss.site_versions
                where project_id = $1`,
              [scope.projectId]
            );
            versionId = randomUUID();
            await client.query(
              `insert into ss.site_versions (
                 id, organization_id, project_id, version_number,
                 fact_set_id, artifact_id, raw_facts, compiler_schema,
                 compiler_revision, created_by_user_id, created_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11
               )`,
              [
                versionId,
                scope.organizationId,
                scope.projectId,
                Number(sequence.rows[0].next),
                factSetId,
                artifactId,
                JSON.stringify(rawFacts),
                compiled.schema,
                compiled.compilerRevision,
                actor.userId,
                now(clock)
              ]
            );
            const screeningId = randomUUID();
            await client.query(
              `insert into ss.release_screenings (
                 id, organization_id, project_id, version_id, stage,
                 method, passed, artifact_digest, findings,
                 checker_revision, checked_at
               ) values (
                 $1, $2, $3, $4, 'pre_acceptance',
                 'canonical_compile', true, $5, '[]'::jsonb, $6, $7
               )`,
              [
                screeningId,
                scope.organizationId,
                scope.projectId,
                versionId,
                compiled.artifactDigest,
                compiled.compilerRevision,
                now(clock)
              ]
            );
            await client.query(
              "select ss.transition_version($1, 'draft', null, null)",
              [versionId]
            );
            await client.query(
              "update ss.projects set revision = revision + 1 where id = $1",
              [scope.projectId]
            );
          }
          const versions = await versionRows(client, scope.projectId);
          const version = versions.find((row) => row.id === versionId);
          return {
            version: publicVersion(version),
            project: await loadProject(client, actor, scope.projectId)
          };
        }
      });
    },

    async markVersionReady(actor, projectId, versionId, input) {
      const selectedVersionId = uuid(versionId, "Version ID");
      return projectWrite(actor, projectId, {
        routeKey: "project.version.ready",
        key: input.commandId,
        purpose: { versionId: selectedVersionId },
        work: async (client, scope) => {
          const state = await client.query(
            `select projection.state
               from ss.site_versions version
               left join ss.version_state_projection projection
                 on projection.version_id = version.id
              where version.organization_id = $1
                and version.project_id = $2
                and version.id = $3
              for update of version`,
            [
              scope.organizationId,
              scope.projectId,
              selectedVersionId
            ]
          );
          invariant(
            state.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          invariant(
            ["draft", "ready", "accepted_release"].includes(
              state.rows[0].state
            ),
            "VERSION_STATE_CONFLICT",
            "That version cannot be marked ready.",
            { status: 409 }
          );
          if (state.rows[0].state === "draft") {
            await client.query(
              "select ss.transition_version($1, 'ready', null, null)",
              [selectedVersionId]
            );
            await client.query(
              "update ss.projects set revision = revision + 1 where id = $1",
              [scope.projectId]
            );
          }
          const versions = await versionRows(client, scope.projectId);
          return {
            version: publicVersion(
              versions.find((row) => row.id === selectedVersionId)
            ),
            project: await loadProject(client, actor, scope.projectId)
          };
        }
      });
    },

    async acceptVersion(actor, projectId, versionId, input) {
      const selectedVersionId = uuid(versionId, "Version ID");
      return projectWrite(actor, projectId, {
        routeKey: "project.version.accept",
        key: input.commandId,
        purpose: { versionId: selectedVersionId },
        work: async (client, scope) => {
          await assertAlakazamSiteMutable(client, scope);
          const selected = await client.query(
            `select
               projection.state,
               screening.id as screening_id
             from ss.site_versions version
             join ss.version_state_projection projection
               on projection.version_id = version.id
             left join lateral (
               select candidate.id
                 from ss.release_screenings candidate
                where candidate.organization_id = version.organization_id
                  and candidate.project_id = version.project_id
                  and candidate.version_id = version.id
                  and candidate.stage = 'pre_acceptance'
                  and candidate.passed
                order by candidate.checked_at desc, candidate.id desc
                limit 1
             ) screening on true
            where version.organization_id = $1
              and version.project_id = $2
              and version.id = $3
            for update of version`,
            [
              scope.organizationId,
              scope.projectId,
              selectedVersionId
            ]
          );
          invariant(
            selected.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          invariant(
            ["ready", "accepted_release"].includes(
              selected.rows[0].state
            ),
            "VERSION_NOT_READY",
            "That version is not ready for acceptance.",
            { status: 409 }
          );
          if (selected.rows[0].state === "ready") {
            invariant(
              selected.rows[0].screening_id,
              "VERSION_SCREENING_REQUIRED",
              "The exact generated page has not passed acceptance screening.",
              { status: 409 }
            );
            const attestationId = randomUUID();
            await client.query(
              `insert into ss.version_attestations (
                 id, organization_id, project_id, version_id, user_id,
                 statement_version, attested_at, request_id
               ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                attestationId,
                scope.organizationId,
                scope.projectId,
                selectedVersionId,
                actor.userId,
                "abracadabra.exact-preview/v1",
                now(clock),
                scope.requestId
              ]
            );
            await client.query(
              "select ss.transition_version($1, 'accepted_release', $2, $3)",
              [
                selectedVersionId,
                selected.rows[0].screening_id,
                attestationId
              ]
            );
            await client.query(
              "update ss.projects set revision = revision + 1 where id = $1",
              [scope.projectId]
            );
          }
          const versions = await versionRows(client, scope.projectId);
          return {
            version: publicVersion(
              versions.find((row) => row.id === selectedVersionId)
            ),
            project: await loadProject(client, actor, scope.projectId)
          };
        }
      });
    },

    async selectAddress(actor, projectId, input) {
      const normalized = addressInput(input, licensedBaseDomain);
      return projectWrite(actor, projectId, {
        routeKey: "project.address.select",
        key: input.commandId,
        purpose: { address: normalized },
        work: async (client, scope) => {
          await assertAlakazamSiteMutable(client, scope);
          const addressId = await insertAddress(client, {
            actor,
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            input
          });
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "project.address.selected",
            targetType: "project_address",
            targetId: addressId,
            requestId: scope.requestId,
            metadata: {
              kind: normalized.kind,
              hostname: normalized.hostname
            }
          });
          const project = await loadProject(
            client,
            actor,
            scope.projectId
          );
          return {
            address: project.address,
            project
          };
        }
      });
    },

    async requestAddressVerification(
      actor,
      projectId,
      addressId,
      input
    ) {
      const selectedAddressId = uuid(addressId, "Address ID");
      const method = requiredText(
        input.method,
        "Verification method",
        40
      );
      invariant(
        method === "registrar_receipt" ||
          method === "dns_challenge",
        "INVALID_INPUT",
        "Verification method is invalid.",
        { status: 400 }
      );
      const reference = requiredText(
        input.reference,
        "Proof reference",
        1000
      );
      invariant(
        contactVault && typeof contactVault.seal === "function",
        "CONTACT_VAULT_HELD",
        "Domain proof intake is held until the private contact vault is configured.",
        { status: 503 }
      );
      return projectWrite(actor, projectId, {
        routeKey: "project.address.verification.request",
        key: input.commandId,
        purpose: {
          addressId: selectedAddressId,
          method,
          referenceDigest: digest(reference)
        },
        work: async (client, scope) => {
          const address = await client.query(
            `select id, kind, state
               from ss.project_addresses
              where organization_id = $1
                and project_id = $2
                and id = $3
                and id = (
                  select current_address_id
                    from ss.project_address_projection
                   where project_id = $2
                )
              for update`,
            [
              scope.organizationId,
              scope.projectId,
              selectedAddressId
            ]
          );
          invariant(
            address.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          invariant(
            address.rows[0].kind !== "licensed",
            "ADDRESS_ALREADY_VERIFIED",
            "That address does not need customer ownership verification.",
            { status: 409 }
          );
          const sealed = await contactVault.seal({
            tenantId: scope.organizationId,
            customerId: actor.userId,
            purpose: "domain_verification_reference",
            payload: { reference }
          });
          invariant(
            typeof sealed?.vaultRef === "string" &&
              sealed.vaultRef.length > 0,
            "CONTACT_VAULT_ERROR",
            "The domain proof could not be sealed.",
            { status: 503 }
          );
          await client.query(
            `update ss.domain_verification_requests
                set state = 'superseded',
                    superseded_at = $4
              where organization_id = $1
                and project_id = $2
                and address_id = $3
                and state = 'pending_review'`,
            [
              scope.organizationId,
              scope.projectId,
              selectedAddressId,
              now(clock)
            ]
          );
          const requestId = randomUUID();
          await client.query(
            `insert into ss.domain_verification_requests (
               id, organization_id, project_id, address_id, method,
               proof_reference_ciphertext, proof_reference_digest, state,
               requested_by_user_id, requested_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, 'pending_review', $8, $9
             )`,
            [
              requestId,
              scope.organizationId,
              scope.projectId,
              selectedAddressId,
              method,
              Buffer.from(sealed.vaultRef, "utf8"),
              digest(reference),
              actor.userId,
              now(clock)
            ]
          );
          await client.query(
            `update ss.project_addresses
                set state = 'pending_review'
              where id = $1`,
            [selectedAddressId]
          );
          await client.query(
            "update ss.projects set revision = revision + 1 where id = $1",
            [scope.projectId]
          );
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "project.address.verification_requested",
            targetType: "domain_verification_request",
            targetId: requestId,
            requestId: scope.requestId,
            metadata: { method }
          });
          const project = await loadProject(
            client,
            actor,
            scope.projectId
          );
          return {
            verificationRequest:
              project.address.verificationRequest,
            address: project.address,
            project
          };
        }
      });
    },

    async getOfferCatalog() {
      return {
        catalog: toBrowserSafeCatalog(await approvedCatalog())
      };
    },

    async createCommerceQuote(actor, projectId, input) {
      const catalog = await approvedCatalog();
      const selected = resolveOffer(catalog, input.offerId);
      const domainQuoteId = input.domainQuoteId
        ? uuid(input.domainQuoteId, "Domain quote ID")
        : null;
      const issuedAt = now(clock);
      const expiresAt = addMs(issuedAt, 30 * 60 * 1000);
      return projectWrite(actor, projectId, {
        routeKey: "commerce.quote.create",
        key: input.commandId,
        purpose: {
          offerId: selected.offer.offerId,
          catalogVersion: catalog.catalogVersion,
          domainQuoteId
        },
        work: async (client, scope) => {
          const project = await client.query(
            `select
               project.lifecycle,
               address.id as address_id,
               address.kind as address_kind,
               address.revision as address_revision,
               subscription.id as subscription_id,
               subscription.revision as subscription_revision
             from ss.projects project
             left join ss.project_address_projection projection
               on projection.project_id = project.id
             left join ss.project_addresses address
               on address.organization_id = project.organization_id
              and address.id = projection.current_address_id
             left join ss.stripe_subscriptions subscription
               on subscription.organization_id = project.organization_id
              and subscription.project_id = project.id
            where project.organization_id = $1
              and project.id = $2
            for update of project`,
            [scope.organizationId, scope.projectId]
          );
          const projectRow = project.rows[0];
          invariant(
            projectRow?.lifecycle === "active",
            "PROJECT_NOT_WRITABLE",
            "This project is no longer open for changes.",
            { status: 409 }
          );
          invariant(
            projectRow.address_id,
            "ADDRESS_REQUIRED",
            "Choose a website address first.",
            { status: 409 }
          );
          const mode =
            projectRow.address_kind === "licensed"
              ? "licensed"
              : "customer_owned";
          invariant(
            selected.offer.eligibleAddressModes.includes(mode),
            "OFFER_ADDRESS_INELIGIBLE",
            selected.offer.tenureId === "own"
              ? "Own requires a customer-owned domain."
              : "That plan cannot use the project’s current address.",
            { status: 409 }
          );
          const authorityOffer = await exactOfferPolicy(
            client,
            catalog,
            selected,
            issuedAt
          );
          let domainQuote = null;
          if (domainQuoteId) {
            const domain = await client.query(
              `select *
                 from ss.domain_quotes
                where organization_id = $1
                  and project_id = $2
                  and id = $3
                  and status = 'open'
                  and expires_at > $4`,
              [
                scope.organizationId,
                scope.projectId,
                domainQuoteId,
                issuedAt
              ]
            );
            invariant(
              domain.rowCount === 1,
              "DOMAIN_QUOTE_UNAVAILABLE",
              "That domain quote is unavailable or expired.",
              { status: 404 }
            );
            domainQuote = domain.rows[0];
          }

          const websiteLine = {
            lineItemId: `website:${selected.offer.offerId}`,
            receiptGroupId: `website:${selected.offer.offerId}`,
            kind: "abracadabra_product",
            label: `${selected.product.name} — ${selected.tenure.name}`,
            product: {
              productId: selected.product.productId,
              name: selected.product.name,
              description: selected.product.description,
              implementationContract:
                selected.product.implementationContract
            },
            tenure: {
              tenureId: selected.tenure.tenureId,
              name: selected.tenure.name,
              billingShape: selected.tenure.billingShape,
              terms: selected.tenure.terms
            },
            ...(selected.offer.amounts.oneTime
              ? {
                  oneTime: selected.offer.amounts.oneTime
                }
              : {}),
            ...(selected.offer.amounts.recurring
              ? {
                  recurring: selected.offer.amounts.recurring
                }
              : {}),
            terms: selected.tenure.terms
          };
          const lineItems = [websiteLine];
          if (domainQuote) {
            lineItems.push({
              lineItemId: `domain:${domainQuote.id}`,
              receiptGroupId: `domain:${domainQuote.id}`,
              kind:
                domainQuote.quote_kind === "renewal"
                  ? "domain_renewal"
                  : "domain_registration",
              label: `${domainQuote.domain_name} ${
                domainQuote.quote_kind === "renewal"
                  ? "renewal"
                  : "registration"
              }`,
              domain: domainQuote.domain_name,
              oneTime: {
                amountMinor: Number(
                  domainQuote.customer_price_minor
                ),
                currency: domainQuote.currency
              },
              renewalAmountMinor: Number(
                domainQuote.renewal_price_minor
              ),
              renewalDisclosure:
                domainQuote.renewal_disclosure
            });
          }
          const oneTimeAmount =
            (selected.offer.amounts.oneTime?.amountMinor ?? 0) +
            Number(domainQuote?.customer_price_minor ?? 0);
          const recurring = selected.offer.amounts.recurring
            ? [
                {
                  amountMinor:
                    selected.offer.amounts.recurring.amountMinor,
                  currency:
                    selected.offer.amounts.recurring.currency,
                  interval:
                    selected.offer.amounts.recurring.interval
                }
              ]
            : [];
          const totals = {
            oneTime: {
              amountMinor: oneTimeAmount,
              currency: catalog.currency
            },
            recurring
          };
          const quoteId = randomUUID();
          const disclosure = {
            quoteId,
            projectId: scope.projectId,
            catalogVersion: catalog.catalogVersion,
            termsVersion: catalog.termsVersion,
            offerId: selected.offer.offerId,
            product: websiteLine.product,
            tenure: websiteLine.tenure,
            eligibleAddressModes:
              selected.offer.eligibleAddressModes,
            addressBinding: {
              id: projectRow.address_id,
              mode,
              revision: Number(projectRow.address_revision)
            },
            lineItems,
            totals,
            issuedAt,
            expiresAt
          };
          const disclosureDigest = digest(disclosure);
          await client.query(
            `insert into ss.commerce_quotes (
               id, organization_id, project_id, offer_policy_id,
               offer_key, catalog_version, terms_version, product_id,
               tenure_id, eligible_address_modes, address_id,
               address_mode, address_revision, subscription_id,
               subscription_revision, currency, line_items, totals,
               disclosure_digest, state, issued_at, expires_at,
               created_by_user_id
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10::text[], $11, $12, $13, $14,
               $15, $16, $17::jsonb, $18::jsonb,
               $19, 'quoted', $20, $21, $22
             )`,
            [
              quoteId,
              scope.organizationId,
              scope.projectId,
              authorityOffer.policy.id,
              selected.offer.offerId,
              catalog.catalogVersion,
              catalog.termsVersion,
              selected.offer.productId,
              selected.offer.tenureId,
              selected.offer.eligibleAddressModes,
              projectRow.address_id,
              mode,
              Number(projectRow.address_revision),
              projectRow.subscription_id,
              projectRow.subscription_revision
                ? Number(projectRow.subscription_revision)
                : null,
              catalog.currency,
              JSON.stringify(lineItems),
              JSON.stringify(totals),
              disclosureDigest,
              issuedAt,
              expiresAt,
              actor.userId
            ]
          );
          let position = 1;
          for (const line of authorityOffer.lines) {
            await client.query(
              `insert into ss.commerce_quote_price_lines (
                 id, organization_id, project_id, quote_id, position,
                 source_kind, billing_cadence,
                 catalog_offer_price_line_id, currency, amount_minor,
                 stripe_price_ref
               ) values (
                 $1, $2, $3, $4, $5, 'abracadabra_product', $6,
                 $7, $8, $9, $10
               )`,
              [
                randomUUID(),
                scope.organizationId,
                scope.projectId,
                quoteId,
                position,
                line.cadence,
                line.price_line_id,
                line.currency,
                Number(line.unit_amount_minor),
                line.stripe_price_ref
              ]
            );
            position += 1;
          }
          if (domainQuote) {
            await client.query(
              `insert into ss.commerce_quote_price_lines (
                 id, organization_id, project_id, quote_id, position,
                 source_kind, billing_cadence, domain_quote_id,
                 currency, amount_minor
               ) values (
                 $1, $2, $3, $4, $5, 'domain', 'one_time', $6, $7, $8
               )`,
              [
                randomUUID(),
                scope.organizationId,
                scope.projectId,
                quoteId,
                position,
                domainQuote.id,
                domainQuote.currency,
                Number(domainQuote.customer_price_minor)
              ]
            );
          }
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "commerce.quote.created",
            targetType: "commerce_quote",
            targetId: quoteId,
            requestId: scope.requestId,
            metadata: {
              offerId: selected.offer.offerId,
              disclosureDigest
            }
          });
          const row = await loadCommerceQuote(
            client,
            actor,
            scope.projectId,
            quoteId,
            catalog
          );
          return { quote: publicCommerceQuote(row) };
        }
      });
    },

    async getCommerceQuote(actor, projectId, quoteId) {
      const scope = await projectScope(actor, projectId);
      const selectedQuoteId = uuid(quoteId, "Quote ID");
      const catalog = await approvedCatalog();
      return authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => ({
          quote: publicCommerceQuote(
            await loadCommerceQuote(
              client,
              actor,
              scope.projectId,
              selectedQuoteId,
              catalog
            )
          )
        })
      );
    },

    async createCheckout(actor, projectId, input) {
      requiredActor(actor);
      const readiness =
        await paymentProvider.readiness();
      invariant(
        readiness?.ready === true,
        "CHECKOUT_UNAVAILABLE",
        "Secure Checkout is held until the exact payment-provider configuration is ready.",
        {
          status: 503,
          details: {
            provider: readiness?.provider ?? "stripe",
            mode: readiness?.mode ?? "held",
            code:
              readiness?.code ??
              "PAYMENT_PROVIDER_NOT_READY",
            providerEffect: false
          }
        }
      );
      const staged = await stageCheckout(
        actor,
        projectId,
        input
      );
      if (staged.completed) return staged.response;
      let result;
      try {
        result = await paymentProvider.createCheckout(
          staged.providerRequest
        );
      } catch (error) {
        await recordCheckoutFailure(staged, error);
        throw providerUnavailable(
          error,
          "CHECKOUT",
          staged.row.id
        );
      }
      try {
        return await finalizeCheckout(
          actor,
          staged,
          result
        );
      } catch (error) {
        const ambiguous = {
          code:
            error?.code ??
            "CHECKOUT_LOCAL_COMMIT_UNKNOWN",
          certainty: "ambiguous"
        };
        await recordCheckoutFailure(
          staged,
          ambiguous
        );
        throw providerUnavailable(
          ambiguous,
          "CHECKOUT",
          staged.row.id
        );
      }
    },

    async createBillingPortal(actor, projectId, input) {
      requiredActor(actor);
      const readiness =
        await paymentProvider.readiness();
      invariant(
        readiness?.ready === true,
        "BILLING_PORTAL_UNAVAILABLE",
        "Billing management is held until the exact payment-provider configuration is ready.",
        {
          status: 503,
          details: {
            provider: readiness?.provider ?? "stripe",
            mode: readiness?.mode ?? "held",
            code:
              readiness?.code ??
              "PAYMENT_PROVIDER_NOT_READY",
            providerEffect: false
          }
        }
      );
      const staged = await stageBillingPortal(
        actor,
        projectId,
        input
      );
      if (staged.completed) return staged.response;
      let result;
      try {
        result =
          await paymentProvider.createBillingPortal(
            staged.providerRequest
          );
      } catch (error) {
        await recordBillingPortalFailure(
          staged,
          error
        );
        throw providerUnavailable(
          error,
          "BILLING_PORTAL",
          staged.row.id
        );
      }
      try {
        return await finalizeBillingPortal(
          actor,
          staged,
          result
        );
      } catch (error) {
        const ambiguous = {
          code:
            error?.code ??
            "BILLING_PORTAL_LOCAL_COMMIT_UNKNOWN",
          certainty: "ambiguous"
        };
        await recordBillingPortalFailure(
          staged,
          ambiguous
        );
        throw providerUnavailable(
          ambiguous,
          "BILLING_PORTAL",
          staged.row.id
        );
      }
    },

    async ingestStripeWebhook({
      rawBody,
      signature
    } = {}) {
      invariant(
        Buffer.isBuffer(rawBody),
        "STRIPE_WEBHOOK_BODY_REQUIRED",
        "Stripe webhook verification requires the exact raw request bytes.",
        { status: 400 }
      );
      let event;
      try {
        event = await paymentProvider.verifyWebhook({
          rawBody,
          signature
        });
      } catch (error) {
        if (error instanceof HostedError) throw error;
        const code = String(error?.code ?? "");
        const invalid =
          code.includes("webhook") ||
          code.includes("signature");
        throw new HostedError(
          invalid
            ? "STRIPE_WEBHOOK_SIGNATURE_INVALID"
            : "STRIPE_WEBHOOK_UNAVAILABLE",
          invalid
            ? "Stripe webhook signature verification failed."
            : "Stripe webhook verification is unavailable.",
          {
            status: invalid ? 400 : 503,
            details: {
              providerErrorCode:
                providerErrorCode(error),
              providerEffect: false
            }
          }
        );
      }
      return ingestVerifiedStripeEvent(event);
    },

    ingestVerifiedStripeEvent,

    async processPaymentOutbox({
      limit = 10,
      workerId =
        `hosted-payment-${process.pid}`
    } = {}) {
      invariant(
        Number.isSafeInteger(limit) &&
          limit >= 1 &&
          limit <= 100 &&
          typeof workerId === "string" &&
          /^[A-Za-z0-9._:-]{8,200}$/u.test(workerId),
        "INVALID_INPUT",
        "Payment outbox worker options are invalid.",
        { status: 400 }
      );
      const readiness =
        await paymentProvider.readiness();
      if (readiness?.ready !== true) {
        return {
          processed: 0,
          failed: 0,
          held: true,
          provider: readiness?.provider ?? "stripe",
          mode: readiness?.mode ?? "held"
        };
      }
      let processed = 0;
      let failed = 0;
      let ambiguous = 0;
      for (let index = 0; index < limit; index += 1) {
        const dispatch =
          await claimCancellationDispatch(workerId);
        if (!dispatch) break;
        let providerResult;
        try {
          providerResult =
            await paymentProvider.scheduleCancellation({
              stripeSubscriptionId:
                dispatch.stripe_subscription_id,
              idempotencyKey:
                `hosted:cancellation:${dispatch.dedupe_key}`,
              cancellationDigest:
                dispatch.accepted_disclosure_digest
            });
          await finishCancellationDispatch(
            dispatch,
            providerResult
          );
          processed += 1;
        } catch (error) {
          const released =
            await releaseCancellationDispatch(
              dispatch,
              error
            );
          failed += 1;
          if (released.certainty === "ambiguous") {
            ambiguous += 1;
          }
        }
      }
      return {
        processed,
        failed,
        ambiguous,
        held: false,
        provider: readiness.provider ?? "stripe",
        mode: readiness.mode ?? null
      };
    },

    async getSubscription(actor, projectId) {
      const { project } = await service.getProject(
        actor,
        projectId
      );
      return { subscription: project.subscription };
    },

    async getCancellationPreview(actor, projectId) {
      const scope = await projectScope(actor, projectId);
      return authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await membership(
            client,
            actor,
            scope.organizationId,
            BILLING_ROLES
          );
          const subscription = await client.query(
            `select
               subscription.id,
               subscription.revision,
               subscription.status,
               subscription.current_period_ends_at,
               plan.plan_key
             from ss.stripe_subscriptions subscription
             join ss.catalog_prices price
               on price.id = subscription.catalog_price_id
             join ss.catalog_plans plan
               on plan.id = price.plan_id
            where subscription.organization_id = $1
              and subscription.project_id = $2
              and subscription.status in ('active', 'grace')
            for update of subscription`,
            [scope.organizationId, scope.projectId]
          );
          const row = subscription.rows[0];
          invariant(
            row &&
              row.current_period_ends_at &&
              Date.parse(row.current_period_ends_at) >
                Date.parse(now(clock)),
            "SUBSCRIPTION_NOT_CANCELLABLE",
            "This project does not have an active paid plan.",
            { status: 409 }
          );
          const issuedAt = now(clock);
          const effectiveAt = iso(row.current_period_ends_at);
          const retentionEndsAt = addDays(
            effectiveAt,
            RETENTION_DAYS
          );
          const previewId = randomUUID();
          const expiresAt = addMs(
            issuedAt,
            CANCELLATION_PREVIEW_TTL_MS
          );
          const disclosure = {
            previewId,
            projectId: scope.projectId,
            effectiveAt,
            retentionEndsAt,
            issuedAt,
            expiresAt,
            subscriptionBinding: {
              id: row.id,
              revision: Number(row.revision),
              status: row.status,
              offerId: row.plan_key,
              currentPeriodEndsAt: effectiveAt
            }
          };
          const disclosureDigest = digest(disclosure);
          await client.query(
            `insert into ss.subscription_cancellation_previews (
               id, organization_id, project_id, subscription_id,
               subscription_revision, subscription_status, offer_key,
               current_period_ends_at, effective_at, retention_ends_at,
               disclosure_digest, issued_by_user_id, issued_at, expires_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7,
               $8, $8, $9, $10, $11, $12, $13
             )`,
            [
              previewId,
              scope.organizationId,
              scope.projectId,
              row.id,
              Number(row.revision),
              row.status,
              row.plan_key,
              effectiveAt,
              retentionEndsAt,
              disclosureDigest,
              actor.userId,
              issuedAt,
              expiresAt
            ]
          );
          return {
            preview: {
              previewId,
              projectId: scope.projectId,
              effectiveAt,
              retentionEndsAt,
              disclosureDigest
            }
          };
        }
      );
    },

    async cancelSubscription(actor, projectId, input) {
      const previewId = uuid(
        input.previewId,
        "Cancellation preview ID"
      );
      const acceptedDisclosureDigest = requiredText(
        input.acceptedDisclosureDigest,
        "Accepted cancellation digest",
        64
      );
      invariant(
        /^[a-f0-9]{64}$/u.test(acceptedDisclosureDigest),
        "INVALID_INPUT",
        "Accepted cancellation digest is invalid.",
        { status: 400 }
      );
      const accepted = await projectWrite(actor, projectId, {
        routeKey: "subscription.cancel",
        key: input.commandId,
        purpose: { previewId, acceptedDisclosureDigest },
        allowedRoles: BILLING_ROLES,
        work: async (client, scope) => {
          const preview = await client.query(
            `select *
               from ss.subscription_cancellation_previews
              where organization_id = $1
                and project_id = $2
                and id = $3`,
            [
              scope.organizationId,
              scope.projectId,
              previewId
            ]
          );
          const row = preview.rows[0];
          invariant(
            row,
            "CANCELLATION_PREVIEW_NOT_FOUND",
            "Request a new cancellation preview.",
            { status: 404 }
          );
          invariant(
            row.disclosure_digest ===
                acceptedDisclosureDigest &&
              Date.parse(row.expires_at) >
                Date.parse(now(clock)),
            "CANCELLATION_PREVIEW_EXPIRED",
            "That cancellation preview is stale. Request a new one.",
            { status: 409 }
          );
          await client.query(
            `insert into ss.subscription_cancellation_acceptances (
               preview_id, organization_id, project_id, subscription_id,
               accepted_disclosure_digest, accepted_by_user_id,
               request_id, accepted_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              previewId,
              scope.organizationId,
              scope.projectId,
              row.subscription_id,
              acceptedDisclosureDigest,
              actor.userId,
              scope.requestId,
              now(clock)
            ]
          );
          await client.query(
            `insert into ss.transactional_outbox (
               organization_id, aggregate_type, aggregate_id,
               event_type, payload, dedupe_key, available_at
             ) values (
               $1, 'stripe_subscription', $2,
               'subscription.cancellation_requested', $3::jsonb, $4, $5
             )`,
            [
              scope.organizationId,
              row.subscription_id,
              JSON.stringify({
                projectId: scope.projectId,
                subscriptionId: row.subscription_id,
                previewId,
                effectiveAt: iso(row.effective_at),
                retentionEndsAt: iso(row.retention_ends_at)
              }),
              `subscription.cancel:${previewId}`,
              now(clock)
            ]
          );
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "subscription.cancellation_accepted",
            targetType: "stripe_subscription",
            targetId: row.subscription_id,
            requestId: scope.requestId,
            metadata: {
              previewId,
              effectiveAt: iso(row.effective_at)
            }
          });
          const project = await loadProject(
            client,
            actor,
            scope.projectId
          );
          return {
            cancellation: {
              previewId,
              acceptedAt: now(clock),
              effectiveAt: iso(row.effective_at),
              retentionEndsAt: iso(row.retention_ends_at),
              providerStatus: "held_for_dispatch"
            },
            subscription: project.subscription
          };
        }
      });
      await service.processPaymentOutbox({
        limit: 1,
        workerId: `request-cancel-${previewId}`
      });
      const status = await cancellationStatus(
        actor,
        projectId,
        previewId
      );
      return {
        ...accepted,
        cancellation: {
          ...accepted.cancellation,
          ...status
        },
        subscription: (
          await service.getSubscription(
            actor,
            projectId
          )
        ).subscription
      };
    },

    async requestRelease(actor, projectId, input) {
      const versionId = uuid(input.versionId, "Version ID");
      const staged = await projectWrite(actor, projectId, {
        routeKey: "release.request",
        key: input.commandId,
        purpose: { versionId },
        work: (client, scope) =>
          stagePublication(
            client,
            actor,
            scope,
            versionId,
            "publish"
          )
      });
      return dispatchPublication(actor, staged);
    },

    async rollbackRelease(
      actor,
      projectId,
      versionId,
      input
    ) {
      const targetVersionId = uuid(versionId, "Version ID");
      const staged = await projectWrite(actor, projectId, {
        routeKey: "release.rollback",
        key: input.commandId,
        purpose: { versionId: targetVersionId },
        work: (client, scope) =>
          stagePublication(
            client,
            actor,
            scope,
            targetVersionId,
            "rollback"
          )
      });
      return dispatchPublication(actor, staged);
    },

    async unpublish(actor, projectId, input) {
      return projectWrite(actor, projectId, {
        routeKey: "release.unpublish",
        key: input.commandId,
        purpose: { projectId },
        work: async (client, scope) => {
          const current = await client.query(
            `select
               serving.current_release_id,
               address.serving_hostname
             from ss.project_serving_projection serving
             left join ss.project_address_projection projection
               on projection.project_id = serving.project_id
             left join ss.project_addresses address
               on address.organization_id = serving.organization_id
              and address.id = projection.current_address_id
            where serving.organization_id = $1
              and serving.project_id = $2
            for update of serving`,
            [scope.organizationId, scope.projectId]
          );
          const row = current.rows[0];
          invariant(
            row?.serving_hostname,
            "PUBLICATION_NOT_FOUND",
            "This project does not have a serving address.",
            { status: 404 }
          );
          await publicationPort.unpublish({
            projectId: scope.projectId,
            hostname: row.serving_hostname
          });
          await client.query(
            `update ss.project_serving_projection
                set state = 'unpublished',
                    current_release_id = null,
                    previous_release_id = null,
                    resume_state = 'unpublished',
                    updated_at = $3
              where organization_id = $1
                and project_id = $2`,
            [
              scope.organizationId,
              scope.projectId,
              now(clock)
            ]
          );
          await client.query(
            `insert into ss.serving_events (
               organization_id, project_id, release_id, event_kind
             ) values ($1, $2, $3, 'unpublished')`,
            [
              scope.organizationId,
              scope.projectId,
              row.current_release_id
            ]
          );
          await client.query(
            "update ss.projects set revision = revision + 1 where id = $1",
            [scope.projectId]
          );
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "release.unpublished",
            targetType: "project",
            targetId: scope.projectId,
            requestId: scope.requestId
          });
          return {
            project: await loadProject(
              client,
              actor,
              scope.projectId
            )
          };
        }
      });
    },

    async setVisibility(actor, projectId, input) {
      const visibility = requiredText(
        input.visibility,
        "Visibility",
        20
      );
      invariant(
        visibility === "public" || visibility === "private",
        "INVALID_INPUT",
        "Visibility is invalid.",
        { status: 400 }
      );
      const accessPassword =
        visibility === "private"
          ? validatePassword(input.accessPassword)
          : null;
      const passwordPhc = accessPassword
        ? await hashPassword(accessPassword)
        : null;
      return projectWrite(actor, projectId, {
        routeKey: "project.visibility.set",
        key: input.commandId,
        purpose: {
          visibility,
          accessPasswordDigest: accessPassword
            ? digest(accessPassword)
            : null
        },
        work: async (client, scope) => {
          await client.query(
            `update ss.project_access_credentials
                set revoked_at = coalesce(revoked_at, $3)
              where organization_id = $1
                and project_id = $2
                and revoked_at is null`,
            [
              scope.organizationId,
              scope.projectId,
              now(clock)
            ]
          );
          let credentialId = null;
          if (passwordPhc) {
            credentialId = randomUUID();
            await client.query(
              `insert into ss.project_access_credentials (
                 id, organization_id, project_id, password_phc,
                 credential_fingerprint, created_at
               ) values ($1, $2, $3, $4, $5, $6)`,
              [
                credentialId,
                scope.organizationId,
                scope.projectId,
                passwordPhc,
                digest(passwordPhc),
                now(clock)
              ]
            );
          }
          await client.query(
            `update ss.project_access_projection
                set visibility = $3,
                    current_credential_id = $4,
                    updated_at = $5
              where organization_id = $1
                and project_id = $2`,
            [
              scope.organizationId,
              scope.projectId,
              visibility,
              credentialId,
              now(clock)
            ]
          );
          await client.query(
            `update ss.viewer_sessions
                set revoked_at = coalesce(revoked_at, $3)
              where organization_id = $1
                and project_id = $2
                and revoked_at is null`,
            [
              scope.organizationId,
              scope.projectId,
              now(clock)
            ]
          );
          await client.query(
            "update ss.projects set revision = revision + 1 where id = $1",
            [scope.projectId]
          );
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "project.visibility_changed",
            targetType: "project",
            targetId: scope.projectId,
            requestId: scope.requestId,
            metadata: { visibility }
          });
          return {
            project: await loadProject(
              client,
              actor,
              scope.projectId
            )
          };
        }
      });
    },

    async createSupportTicket(actor, projectId, input) {
      const subject = requiredText(
        input.subject,
        "Subject",
        120,
        3
      );
      const message = requiredText(
        input.message,
        "Message",
        4000
      );
      return projectWrite(actor, projectId, {
        routeKey: "support.ticket.create",
        key: input.commandId,
        purpose: { subject, message },
        allowedRoles: null,
        work: async (client, scope) => {
          const ticketId = randomUUID();
          await client.query(
            `insert into ss.support_tickets (
               id, organization_id, project_id, opened_by_user_id,
               subject, state, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, 'open', $6, $6
             )`,
            [
              ticketId,
              scope.organizationId,
              scope.projectId,
              actor.userId,
              subject,
              now(clock)
            ]
          );
          const messageId = randomUUID();
          await client.query(
            `insert into ss.support_messages (
               id, organization_id, project_id, ticket_id,
               author_kind, author_user_id, body, created_at
             ) values (
               $1, $2, $3, $4, 'customer', $5, $6, $7
             )`,
            [
              messageId,
              scope.organizationId,
              scope.projectId,
              ticketId,
              actor.userId,
              message,
              now(clock)
            ]
          );
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "support.ticket.opened",
            targetType: "support_ticket",
            targetId: ticketId,
            requestId: scope.requestId
          });
          return {
            supportTicket: {
              id: ticketId,
              projectId: scope.projectId,
              subject,
              message,
              state: "open",
              createdBy: actor.userId,
              createdAt: now(clock)
            }
          };
        }
      });
    },

    async requestExport(actor, projectId, input) {
      return projectWrite(actor, projectId, {
        routeKey: "export.request",
        key: input.commandId,
        purpose: { projectId },
        allowedRoles: null,
        work: async (client, scope) => {
          const retention = await client.query(
            `select retention_ends_at
               from ss.stripe_subscriptions
              where organization_id = $1 and project_id = $2`,
            [scope.organizationId, scope.projectId]
          );
          invariant(
            !retention.rows[0]?.retention_ends_at ||
              Date.parse(retention.rows[0].retention_ends_at) >
                Date.parse(now(clock)),
            "EXPORT_RETENTION_EXPIRED",
            "The project export retention period has ended.",
            { status: 410 }
          );
          const exportId = randomUUID();
          await client.query(
            `insert into ss.export_requests (
               id, organization_id, project_id, requested_by_user_id,
               state, requested_at
             ) values ($1, $2, $3, $4, 'queued', $5)`,
            [
              exportId,
              scope.organizationId,
              scope.projectId,
              actor.userId,
              now(clock)
            ]
          );
          await audit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: actor.userId,
            action: "export.queued",
            targetType: "export_request",
            targetId: exportId,
            requestId: scope.requestId
          });
          const row = await client.query(
            "select * from ss.export_requests where id = $1",
            [exportId]
          );
          return { export: publicExport(row.rows[0]) };
        }
      });
    },

    async processExport(
      exportId,
      {
        workerId = defaultExportWorkerId,
        signal = null
      } = {}
    ) {
      const selectedExportId = uuid(
        exportId,
        "Export ID"
      );
      if (signal?.aborted) {
        return {
          aborted: true,
          export: {
            exportId: selectedExportId,
            status: "queued"
          }
        };
      }
      const stage = await claimExportWithRetry({
        exportId: selectedExportId,
        workerId
      });
      return processClaimedExport(stage, { signal });
    },

    async processQueuedExports({
      workerId = defaultExportWorkerId,
      signal = null,
      limit = 25
    } = {}) {
      const selectedWorkerId =
        exportWorkerIdentity(workerId);
      const selectedLimit = exportBatchLimit(limit);
      const results = [];
      while (
        results.length < selectedLimit &&
        !signal?.aborted
      ) {
        const stage = await claimExportWithRetry({
          workerId: selectedWorkerId
        });
        if (!stage) break;
        try {
          const result = await processClaimedExport(
            stage,
            { signal }
          );
          results.push(result);
          if (result.aborted) break;
        } catch (error) {
          results.push({
            export: {
              exportId: stage.exportId,
              status: "failed"
            },
            errorCode:
              error instanceof HostedError
                ? error.code
                : "EXPORT_GENERATION_FAILED"
          });
        }
      }
      return results;
    },

    async getExport(actor, projectId, exportId) {
      const scope = await projectScope(actor, projectId);
      const selectedExportId = uuid(exportId, "Export ID");
      const rawToken = tokenFactory(32);
      const tokenDigest = digest(rawToken);
      let expiredObjectKey = null;
      const result = await authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await membership(client, actor, scope.organizationId);
          const found = await client.query(
            `select *
               from ss.export_requests
              where organization_id = $1
                and project_id = $2
                and id = $3
              for update`,
            [
              scope.organizationId,
              scope.projectId,
              selectedExportId
            ]
          );
          const row = found.rows[0];
          invariant(
            row,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          if (
            row.state === "ready" &&
            Date.parse(row.expires_at) <= Date.parse(now(clock))
          ) {
            expiredObjectKey = row.object_key;
            await client.query(
              `update ss.export_requests
                  set state = 'expired'
                where id = $1`,
              [selectedExportId]
            );
            row.state = "expired";
          }
          const presented = publicExport(row);
          if (row.state === "ready") {
            const authorizationId = randomUUID();
            const issuedAt = now(clock);
            const expiresAt = addMs(
              issuedAt,
              DOWNLOAD_TTL_MS
            );
            await client.query(
              `insert into ss.export_download_authorizations (
                 id, organization_id, project_id, export_request_id,
                 issued_to_user_id, token_digest, issued_at, expires_at
               ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                authorizationId,
                scope.organizationId,
                scope.projectId,
                selectedExportId,
                actor.userId,
                tokenDigest,
                issuedAt,
                expiresAt
              ]
            );
            presented.download = {
              token: rawToken,
              expiresAt
            };
          }
          return { export: presented };
        }
      );
      if (expiredObjectKey) {
        await exportStore
          .delete({ key: expiredObjectKey })
          .catch(() => {});
      }
      return result;
    },

    async retryExport(actor, projectId, exportId, input) {
      const selectedExportId = uuid(exportId, "Export ID");
      return projectWrite(actor, projectId, {
        routeKey: "export.retry",
        key: input.commandId,
        purpose: { exportId: selectedExportId },
        allowedRoles: null,
        work: async (client, scope) => {
          const found = await client.query(
            `select *
               from ss.export_requests
              where organization_id = $1
                and project_id = $2
                and id = $3
              for update`,
            [
              scope.organizationId,
              scope.projectId,
              selectedExportId
            ]
          );
          const row = found.rows[0];
          invariant(
            row,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          invariant(
            row.state === "failed" || row.state === "expired",
            "EXPORT_STATE_CONFLICT",
            "Only failed or expired exports can be regenerated.",
            { status: 409 }
          );
          const updated = await client.query(
            `update ss.export_requests
                set state = 'queued',
                    attempt_number =
                      attempt_number + 1,
                    worker_id = null,
                    lease_started_at = null,
                    lease_expires_at = null,
                    manifest_digest = null,
                    object_key = null,
                    byte_count = null,
                    object_attempt_number = null,
                    object_fence_token = null,
                    completed_at = null,
                    expires_at = null,
                    failure_code = null,
                    failure_facts = null,
                    failed_at = null
              where id = $1
            returning *`,
            [selectedExportId]
          );
          return { export: publicExport(updated.rows[0]) };
        }
      });
    },

    async downloadExport(
      actor,
      projectId,
      exportId,
      rawToken
    ) {
      const scope = await projectScope(actor, projectId);
      const selectedExportId = uuid(exportId, "Export ID");
      const tokenDigest = digest(
        requiredText(rawToken, "Download token", 512)
      );
      return authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await membership(client, actor, scope.organizationId);
          const result = await client.query(
            `select
               export.*,
               grant_row.id as authorization_id
             from ss.export_requests export
             join ss.export_download_authorizations grant_row
               on grant_row.organization_id = export.organization_id
              and grant_row.project_id = export.project_id
              and grant_row.export_request_id = export.id
            where export.organization_id = $1
              and export.project_id = $2
              and export.id = $3
              and export.state = 'ready'
              and export.expires_at > $4
              and grant_row.issued_to_user_id = $5
              and grant_row.token_digest = $6
              and grant_row.consumed_at is null
              and grant_row.expires_at > $4
            for update of grant_row`,
            [
              scope.organizationId,
              scope.projectId,
              selectedExportId,
              now(clock),
              actor.userId,
              tokenDigest
            ]
          );
          const row = result.rows[0];
          invariant(
            row,
            "DOWNLOAD_AUTHORIZATION_INVALID",
            "That download link is invalid or expired.",
            { status: 403 }
          );
          const object = await exportStore.get({
            key: row.object_key,
            expectedSha256: row.manifest_digest,
            expectedByteLength: Number(row.byte_count)
          });
          await client.query(
            `update ss.export_download_authorizations
                set consumed_at = $2
              where id = $1`,
            [row.authorization_id, now(clock)]
          );
          return {
            bytes: object.bytes,
            contentType: "application/zip",
            filename: `sitesourcery-${scope.projectId}-${selectedExportId}.zip`,
            sha256: object.sha256
          };
        }
      );
    },

    async deleteProject(actor, projectId, input) {
      requiredActor(actor);
      invariant(
        typeof identity.requireRecentReauthentication ===
          "function",
        "RUNTIME_CONFIGURATION_ERROR",
        "Recent reauthentication support is required for deletion.",
        { status: 500 }
      );
      await identity.requireRecentReauthentication(actor);
      const scope = await projectScope(actor, projectId);
      const selectedCommandId = commandId(input.commandId);
      const purpose = {
        projectId: scope.projectId,
        policyVersion: "terminal-purge/v1"
      };
      const projectFacts = await authority.service(
        {
          userId: actor.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => {
          await membership(
            client,
            actor,
            scope.organizationId,
            new Set(["owner"])
          );
          const selected = await client.query(
            `select
               project.lifecycle,
               address.serving_hostname,
               coalesce(
                 jsonb_agg(
                   distinct jsonb_build_object(
                     'key', export.object_key,
                     'sha256', export.manifest_digest,
                     'byteLength', export.byte_count
                   )
                 ) filter (where export.object_key is not null),
                 '[]'::jsonb
               ) as exports
             from ss.projects project
             left join ss.project_address_projection projection
               on projection.project_id = project.id
             left join ss.project_addresses address
               on address.organization_id = project.organization_id
              and address.id = projection.current_address_id
             left join ss.export_requests export
               on export.organization_id = project.organization_id
              and export.project_id = project.id
            where project.organization_id = $1
              and project.id = $2
            group by project.id, address.serving_hostname`,
            [scope.organizationId, scope.projectId]
          );
          invariant(
            selected.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          return selected.rows[0];
        }
      );
      if (projectFacts.lifecycle === "deleted") {
        return {
          deleted: true,
          projectId: scope.projectId,
          state: "completed"
        };
      }
      if (projectFacts.serving_hostname) {
        await publicationPort.unpublish({
          projectId: scope.projectId,
          hostname: projectFacts.serving_hostname
        });
      }
      for (const object of projectFacts.exports) {
        await exportStore.delete({ key: object.key });
      }
      try {
        return await authority.service(
          {
            userId: actor.userId,
            organizationId: scope.organizationId
          },
          async (client) =>
            idempotent(client, {
              actor,
              organizationId: scope.organizationId,
              routeKey: "project.delete",
              key: selectedCommandId,
              purpose,
              work: async (requestId) => {
                await membership(
                  client,
                  actor,
                  scope.organizationId,
                  new Set(["owner"])
                );
                const deletion = await client.query(
                  `select ss.begin_terminal_project_purge(
                     $1, 'terminal-purge/v1', $2
                   ) as id`,
                  [scope.projectId, actor.userId]
                );
                const knownKeys = new Set(
                  projectFacts.exports.map((entry) => entry.key)
                );
                await client.query(
                  `update ss.lifecycle_jobs
                      set state = 'succeeded',
                          completed_at = $2,
                          locked_at = null,
                          locked_by = null
                    where project_id = $1
                      and job_type = 'delete_blob'
                      and payload ->> 'objectKey' = any($3::text[])`,
                  [
                    scope.projectId,
                    now(clock),
                    [...knownKeys]
                  ]
                );
                const pending = await client.query(
                  `select count(*)::integer as count
                     from ss.lifecycle_jobs
                    where project_id = $1
                      and job_type = 'delete_blob'
                      and state <> 'succeeded'`,
                  [scope.projectId]
                );
                let state = "purging";
                if (Number(pending.rows[0].count) === 0) {
                  await client.query(
                    "select ss.finalize_terminal_project_purge($1)",
                    [scope.projectId]
                  );
                  state = "completed";
                }
                await audit(client, {
                  organizationId: scope.organizationId,
                  projectId: scope.projectId,
                  actorId: actor.userId,
                  action: "project.deletion_requested",
                  targetType: "deletion_request",
                  targetId: deletion.rows[0].id,
                  requestId,
                  metadata: { state }
                });
                return {
                  deleted: state === "completed",
                  projectId: scope.projectId,
                  deletionRequestId: deletion.rows[0].id,
                  state,
                  retainedCustomerDomains: true
                };
              }
            })
        );
      } catch (error) {
        throw translatePostgres(error);
      }
    },

    async searchDomains(actor, query) {
      return domains.searchDomains(actor, query);
    },

    async createDomainQuote(actor, input) {
      return domains.createDomainQuote(actor, input);
    },

    async saveRegistrantContact(actor, organizationId, input) {
      return domains.saveRegistrantContact(
        actor,
        organizationId,
        input
      );
    },

    async acceptDomainConsent(actor, quoteId, input) {
      return domains.acceptDomainConsent(
        actor,
        quoteId,
        input
      );
    },

    async createDomainOrder(actor, projectId, input) {
      return domains.createDomainOrder(
        actor,
        projectId,
        input
      );
    },

    async getDomainOrder(
      actor,
      orderId,
      projectId = null
    ) {
      return domains.getDomainOrder(
        actor,
        orderId,
        projectId
      );
    },

    async listDomainOrders(actor, projectId) {
      return domains.listDomainOrders(actor, projectId);
    },

    async getDomainPaymentRedirect(
      actor,
      orderId,
      projectId
    ) {
      return domains.getDomainPaymentRedirect(
        actor,
        orderId,
        projectId
      );
    },

    async resumeDomainAuthorization(input) {
      return domains.resumeDomainAuthorization(input);
    },

    async refreshDomainPrice(actor, orderId, input) {
      return domains.refreshDomainPrice(
        actor,
        orderId,
        input
      );
    },

    async requestDomainRegistration(actor, orderId, input) {
      return domains.requestDomainRegistration(
        actor,
        orderId,
        input
      );
    },

    async listDomains(
      actor,
      organizationId,
      projectId = null
    ) {
      requiredActor(actor);
      const orgId = uuid(organizationId, "Organization ID");
      const selectedProjectId =
        projectId === null
          ? null
          : uuid(projectId, "Project ID");
      return authority.service(
        {
          userId: actor.userId,
          organizationId: orgId,
          readOnly: true
        },
        async (client) => {
          await membership(client, actor, orgId);
          const result = await client.query(
            `select
               registration.*,
               (
                 select count(*)::integer
                   from ss.domain_dns_change_sets change_set
                  where change_set.registration_id = registration.id
               ) as dns_revision
            from ss.domain_registrations registration
            where registration.organization_id = $1
              and (
                $2::uuid is null
                or registration.project_id = $2
              )
            order by registration.registered_at,
                     registration.id`,
            [orgId, selectedProjectId]
          );
          return {
            domains: result.rows.map(publicDomainRegistration)
          };
        }
      );
    },

    async getDomain(
      actor,
      domainId,
      projectId = null
    ) {
      requiredActor(actor);
      const id = uuid(domainId, "Domain ID");
      const selectedProjectId =
        projectId === null
          ? null
          : uuid(projectId, "Project ID");
      const scope = await authority.service(
        { userId: actor.userId, readOnly: true },
        async (client) => {
          const result = await client.query(
            `select
               registration.organization_id,
               registration.project_id
               from ss.domain_registrations registration
               join ss.organization_memberships membership
                 on membership.organization_id =
                      registration.organization_id
                and membership.user_id = $2
                and membership.state = 'active'
              where registration.id = $1`,
            [id, actor.userId]
          );
          invariant(
            result.rowCount === 1 &&
              (
                selectedProjectId === null ||
                result.rows[0].project_id ===
                  selectedProjectId
              ),
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          return result.rows[0].organization_id;
        }
      );
      return authority.service(
        {
          userId: actor.userId,
          organizationId: scope,
          readOnly: true
        },
        async (client) => {
          const result = await client.query(
            `select
               registration.*,
               (
                 select count(*)::integer
                   from ss.domain_dns_change_sets change_set
                  where change_set.registration_id = registration.id
               ) as dns_revision
             from ss.domain_registrations registration
            where registration.organization_id = $1
              and registration.id = $2`,
            [scope, id]
          );
          invariant(
            result.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          return { domain: publicDomainRegistration(result.rows[0]) };
        }
      );
    },

    async listDnsRecords(
      actor,
      domainId,
      projectId = null
    ) {
      return domains.listDnsRecords(
        actor,
        domainId,
        projectId
      );
    },

    async upsertDnsRecord(
      actor,
      domainId,
      recordId,
      input
    ) {
      return domains.upsertDnsRecord(
        actor,
        domainId,
        recordId,
        input
      );
    },

    async deleteDnsRecord(
      actor,
      domainId,
      recordId,
      input
    ) {
      return domains.deleteDnsRecord(
        actor,
        domainId,
        recordId,
        input
      );
    },

    async setDomainAutoRenew(actor, domainId, input) {
      return domains.setDomainAutoRenew(
        actor,
        domainId,
        input
      );
    },

    async requestDomainRenewalQuote(actor, domainId, input) {
      return domains.requestDomainRenewalQuote(
        actor,
        domainId,
        input
      );
    },

    async requestDomainTransferOut(actor, domainId, input) {
      return domains.requestDomainTransferOut(
        actor,
        domainId,
        input
      );
    },

    async readiness() {
      const persistence = await authority.readiness();
      let catalog;
      try {
        const current = await approvedCatalog();
        await authority.service(
          { readOnly: true },
          async (client) => {
            for (const offer of current.offers) {
              await exactOfferPolicy(
                client,
                current,
                resolveOffer(current, offer.offerId),
                now(clock)
              );
            }
          }
        );
        catalog = {
          ready: true,
          catalogVersion: current.catalogVersion,
          sellableProducts: [
            ...new Set(
              current.offers.map((offer) => offer.productId)
            )
          ]
        };
      } catch (error) {
        const code =
          error instanceof HostedError
            ? error.code
            : error?.code ?? "CATALOG_UNAVAILABLE";
        catalog = {
          ready: false,
          mode:
            code === "catalog_unavailable"
              ? "held"
              : "unavailable",
          code
        };
      }
      const publication =
        typeof publicationPort.readiness === "function"
          ? await publicationPort.readiness()
          : {
              ready: true,
              kind: publicationPort.kind,
              held: null
            };
      const recovery = await recoveryMailPort.readiness();
      const registration =
        await identity.registrationReadiness();
      let payments;
      try {
        payments = await paymentProvider.readiness();
      } catch (error) {
        payments = {
          ready: false,
          provider: "stripe",
          mode: "held",
          code:
            error?.code ??
            "PAYMENT_PROVIDER_NOT_READY"
        };
      }
      let domainProviders;
      try {
        domainProviders = await domains.readiness();
      } catch (error) {
        domainProviders = {
          ready: false,
          provider: "spaceship",
          mode: "held",
          registrar: "held",
          dns: "held",
          code:
            error?.code ??
            "DOMAIN_PROVIDER_NOT_READY"
        };
      }
      let projectCreationLegal = {
        ready: false,
        diagnostic: projectLegalAuthorityDiagnostic ?? {
          state: "held",
          code: "LEGAL_CONFIGURATION_REQUIRED",
          reason: "Privacy V3 constants are not sealed."
        }
      };
      if (legalAuthority) {
        try {
          projectCreationLegal = {
            ready: await projectLegalReadiness(),
            diagnostic: null
          };
        } catch (error) {
          projectCreationLegal = {
            ready: false,
            diagnostic: {
              state: "held",
              code: error?.code ?? "LEGAL_CONFIGURATION_REQUIRED",
              reason: "Privacy V3 authority could not be verified."
            }
          };
        }
      }
      return {
        ready:
          persistence.ready &&
          (
            catalog.ready === true ||
            catalog.mode === "held"
          ) &&
          publication.ready !== false &&
          (
            recovery.mode !== "production" ||
            (
              recovery.ready === true &&
              recovery.verified === true
            )
          ) &&
          (
            registration.mode !== "production" ||
            (
              registration.ready === true &&
              registration.verified === true
            )
          ),
        service: "sitesourcery-hosted-runtime",
        runtime: process.version,
        persistence,
        projectCreationLegal,
        compiler: {
          ready: true,
          schema: compiler.schema,
          revision: compiler.revision
        },
        catalog,
        publication,
        registration,
        recovery,
        exports: {
          ready: true,
          kind: exportStore.kind
        },
        payments,
        providers: {
          checkout:
            payments.ready === true
              ? payments.mode ?? "ready"
              : "held",
          registrar:
            domainProviders.ready === true
              ? domainProviders.registrar ?? "ready"
              : "held",
          dns:
            domainProviders.ready === true
              ? domainProviders.dns ?? "ready"
              : "held",
          domains: domainProviders,
          registrationEmail:
            registration.mode === "production" &&
            registration.ready === true &&
            registration.verified === true
              ? "ready"
              : registration.mode,
          email:
            recovery.mode === "production" &&
            recovery.ready === true &&
            recovery.verified === true
              ? "ready"
              : recovery.mode
        }
      };
    }
  };

  return Object.freeze(service);
}
