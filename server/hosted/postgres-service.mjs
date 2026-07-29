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
  normalizeHostname,
  optionalText,
  randomToken,
  requiredText,
  safeRawFacts,
  validatePassword
} from "./security.mjs";
import { createStoredZip } from "./zip.mjs";
import { createHeldDomainRuntime } from "./domain-postgres-runtime.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WRITE_ROLES = new Set(["owner", "admin", "editor"]);
const BILLING_ROLES = new Set(["owner", "admin", "billing"]);
const PRODUCT_TERM_KINDS = Object.freeze(["product", "privacy", "website"]);
const EXPORT_TTL_DAYS = 90;
const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const RECOVERY_DELIVERY_TTL_MS = 30 * 60 * 1000;

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

function publicVersion(row) {
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
  contactVault = null,
  domainRuntime = null,
  clock = { now: () => new Date().toISOString() },
  randomUUID = systemRandomUUID,
  tokenFactory = randomToken,
  licensedBaseDomain = "sites.sitesourcery.me"
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );
  invariant(
    identity &&
      typeof identity.authenticate === "function" &&
      typeof identity.register === "function" &&
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
      typeof exportStore.put === "function" &&
      typeof exportStore.get === "function" &&
      typeof exportStore.delete === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Private export object store is required.",
    { status: 500 }
  );
  invariant(
    recoveryMailPort &&
      typeof recoveryMailPort.readiness === "function" &&
      typeof recoveryMailPort.deliver === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Recovery mail delivery port is required.",
    { status: 500 }
  );
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
      routeKey,
      key,
      purpose,
      work
    }
  ) {
    const selectedKey = commandId(key);
    const requestDigest = digest({ routeKey, purpose });
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
         policy.tenure_id as subscription_tenure_id
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
         fact.content_digest,
         artifact.artifact_digest,
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
      address: publicAddress(row),
      subscription: publicSubscription(row),
      serving: {
        state: row.serving_state ?? "unpublished",
        currentReleaseId: row.current_release_id,
        previousReleaseId: row.previous_release_id,
        updatedAt: iso(row.updated_at)
      }
    };
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
         checkout.expires_at as checkout_expires_at
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
    row.checkout_url = null;
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
       join ss.stripe_subscriptions subscription
         on subscription.organization_id = request.organization_id
        and subscription.project_id = request.project_id
       join ss.project_addresses address
         on address.organization_id = request.organization_id
        and address.id = request.address_id
        where request.organization_id = $1
          and request.project_id = $2
          and request.id = $3
          and request.version_id = $4
          and request.address_id = $5`,
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
            subscription: {
              organizationId: row.organization_id,
              projectId: row.project_id,
              status: row.subscription_status,
              graceEndsAt: iso(row.grace_ends_at)
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

  const service = {
    authenticate(token) {
      return identity.authenticate(token);
    },

    register(input) {
      return identity.register(input);
    },

    signIn(input) {
      return identity.signIn(input);
    },

    signOut(actor) {
      return identity.signOut(requiredActor(actor));
    },

    async requestRecovery(input) {
      const recoveryReadiness =
        await recoveryMailPort.readiness();
      if (recoveryReadiness.ready !== true) {
        return {
          accepted: true,
          delivery: "manual_operator",
          emailSent: false
        };
      }
      const selectedCommandId = commandId(input.commandId);
      const issued =
        await identity.issueRecoveryForDelivery(input.email, {
          commandId: selectedCommandId
        });
      const requestedAt =
        issued.delivery?.createdAt ?? now(clock);
      const expiresAt =
        issued.delivery?.expiresAt ??
        addMs(requestedAt, RECOVERY_DELIVERY_TTL_MS);
      const recipient = issued.recipient;
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
      const receipt = await recoveryMailPort.deliver({
        idempotencyKey: deliveryIdempotencyKey,
        recipient,
        token: recoveryToken,
        requestedAt,
        expiresAt
      });
      invariant(
        receipt?.state === "delivered" &&
          receipt.mode === recoveryReadiness.mode &&
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
        schema: "sitesourcery.recovery-delivery-evidence/v1",
        receiptId: receipt.receiptId,
        mode: receipt.mode,
        provider: receipt.provider,
        providerMessageId: receipt.providerMessageId,
        idempotencyKey: receipt.idempotencyKey,
        payloadDigest: receipt.payloadDigest,
        acceptedAt: receipt.acceptedAt,
        expiresAt: receipt.expiresAt
      };
      await authority.service({}, async (client) => {
        await client.query(
          `insert into ss.provider_receipts (
             id, provider_code, receipt_kind,
             external_object_ref, facts, facts_digest, occurred_at
           ) values (
             $1, $2, 'recovery_delivery_accepted',
             $3, $4::jsonb, $5, $6
           )
           on conflict (
             provider_code, receipt_kind, external_object_ref
           ) do nothing`,
          [
            randomUUID(),
            `mail:${receipt.provider}`,
            receipt.receiptId,
            JSON.stringify(receiptFacts),
            digest(receiptFacts),
            receipt.acceptedAt
          ]
        );
        const recorded = await client.query(
          `select facts_digest
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
          recorded.rows[0]?.facts_digest ===
            digest(receiptFacts),
          "RECOVERY_DELIVERY_RECEIPT_CONFLICT",
          "Recovery delivery evidence does not match.",
          { status: 409 }
        );
      });
      return recoveryReadiness.mode === "production"
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

    async createProject(actor, organizationId, input) {
      requiredActor(actor);
      const orgId = uuid(organizationId, "Organization ID");
      const name = requiredText(input.name, "Project name", 120, 2);
      invariant(
        input.acceptedTerms === true,
        "TERMS_REQUIRED",
        "Accept the current product, privacy, and website terms to continue.",
        { status: 400 }
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
                address: normalizedAddress
              },
              work: async (requestId) => {
                const documents = await client.query(
                  `select distinct on (kind) id, kind
                     from ss.legal_documents
                    where kind = any($1::text[])
                      and effective_at <= $2
                      and (retired_at is null or retired_at > $2)
                    order by kind, effective_at desc, id desc`,
                  [PRODUCT_TERM_KINDS, now(clock)]
                );
                invariant(
                  documents.rowCount === PRODUCT_TERM_KINDS.length,
                  "LEGAL_CONFIGURATION_REQUIRED",
                  "Current product, privacy, and website terms must be installed before project creation.",
                  { status: 503 }
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
                for (const document of documents.rows) {
                  const acceptanceId = randomUUID();
                  await client.query(
                    `insert into ss.term_acceptances (
                       id, organization_id, project_id, user_id, document_id,
                       accepted_at, request_id
                     ) values ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                      acceptanceId,
                      orgId,
                      projectId,
                      actor.userId,
                      document.id,
                      now(clock),
                      requestId
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
      const compiled = compiler.compile(rawFacts);
      const previewDigest = requiredText(
        input.previewDigest,
        "Preview digest",
        64
      );
      invariant(
        /^[a-f0-9]{64}$/u.test(previewDigest) &&
          previewDigest === compiled.artifactDigest,
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

    async createCheckout() {
      held("checkout");
    },

    async createBillingPortal() {
      held("billing_portal");
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
      return projectWrite(actor, projectId, {
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
               event_type, payload, dedupe_key
             ) values (
               $1, 'stripe_subscription', $2,
               'subscription.cancellation_requested', $3::jsonb, $4
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
              `subscription.cancel:${previewId}`
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

    async processExport(exportId) {
      const selectedExportId = uuid(exportId, "Export ID");
      const stage = await authority.service(
        {},
        async (client) => {
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
            where export.id = $1
            for update of export`,
            [selectedExportId]
          );
          const row = selected.rows[0];
          invariant(
            row,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          invariant(
            row.state === "queued" || row.state === "failed",
            "EXPORT_STATE_CONFLICT",
            "That export is not queued for processing.",
            { status: 409 }
          );
          invariant(
            !row.retention_ends_at ||
              Date.parse(row.retention_ends_at) >
                Date.parse(now(clock)),
            "EXPORT_RETENTION_EXPIRED",
            "The project export retention period has ended.",
            { status: 410 }
          );
          await client.query(
            `update ss.export_requests
                set state = 'building',
                    manifest_digest = null,
                    object_key = null,
                    byte_count = null,
                    completed_at = null,
                    expires_at = null
              where id = $1`,
            [selectedExportId]
          );
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
          const generatedAt = now(clock);
          const manifest = {
            schema: "sitesourcery.project-export/v1",
            generatedAt,
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
              supportTickets: tickets.rows.map((ticket) => ({
                id: ticket.id,
                subject: ticket.subject,
                state: ticket.state,
                createdAt: iso(ticket.created_at),
                messages: ticket.messages
              }))
            },
            site: {
              draft: draft.rows[0]
                ? {
                    revision: Number(draft.rows[0].revision),
                    rawFacts: draft.rows[0].raw_facts,
                    updatedAt: iso(draft.rows[0].updated_at)
                  }
                : null,
              versions: versions.rows.map((version) => ({
                id: version.id,
                versionNumber: Number(version.version_number),
                state: version.state,
                rawFacts: version.raw_facts,
                compilerSchema: version.compiler_schema,
                compilerRevision: version.compiler_revision,
                artifactDigest: version.artifact_digest,
                createdAt: iso(version.created_at)
              }))
            },
            domains: addresses.rows.map((address) => ({
              id: address.id,
              kind: address.kind,
              ownership: address.ownership,
              retainedDomain: address.retained_domain,
              servingHostname: address.serving_hostname,
              state: address.state,
              allocatedAt: iso(address.allocated_at)
            }))
          };
          return {
            exportId: row.id,
            organizationId: row.organization_id,
            projectId: row.project_id,
            generatedAt,
            retentionEndsAt: row.retention_ends_at
              ? iso(row.retention_ends_at)
              : null,
            manifest,
            versions: versions.rows
          };
        }
      );

      let object;
      try {
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
            name: `site/releases/${version.version_number}-${version.id}.html`,
            bytes: version.html_bytes
          }))
        ];
        const bytes = createStoredZip(entries, {
          createdAt: stage.generatedAt
        });
        object = await exportStore.put({
          organizationId: stage.organizationId,
          projectId: stage.projectId,
          exportId: stage.exportId,
          bytes,
          expectedSha256: digest(bytes)
        });
      } catch (error) {
        await authority.service({}, (client) =>
          client.query(
            `update ss.export_requests
                set state = 'failed'
              where id = $1 and state = 'building'`,
            [stage.exportId]
          )
        );
        throw error;
      }

      return authority.service({}, async (client) => {
        const expiresAt =
          stage.retentionEndsAt ??
          addDays(now(clock), EXPORT_TTL_DAYS);
        const updated = await client.query(
          `update ss.export_requests
              set state = 'ready',
                  manifest_digest = $2,
                  object_key = $3,
                  byte_count = $4,
                  completed_at = $5,
                  expires_at = $6
            where id = $1
              and state = 'building'
          returning *`,
          [
            stage.exportId,
            object.sha256,
            object.key,
            object.byteLength,
            now(clock),
            expiresAt
          ]
        );
        invariant(
          updated.rowCount === 1,
          "EXPORT_STATE_CONFLICT",
          "Export state changed during generation.",
          { status: 409 }
        );
        await audit(client, {
          organizationId: stage.organizationId,
          projectId: stage.projectId,
          actorId: "system:export-worker",
          action: "export.ready",
          targetType: "export_request",
          targetId: stage.exportId,
          metadata: {
            byteLength: object.byteLength,
            sha256: object.sha256
          }
        });
        return { export: publicExport(updated.rows[0]) };
      });
    },

    async processQueuedExports() {
      const queued = await authority.service(
        { readOnly: true },
        async (client) =>
          (
            await client.query(
              `select id
                 from ss.export_requests
                where state = 'queued'
                order by requested_at, id`
            )
          ).rows.map((row) => row.id)
      );
      const results = [];
      for (const exportId of queued) {
        try {
          results.push(await service.processExport(exportId));
        } catch (error) {
          results.push({
            export: { exportId, status: "failed" },
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
          if (row.object_key) {
            await exportStore.delete({ key: row.object_key });
          }
          const updated = await client.query(
            `update ss.export_requests
                set state = 'queued',
                    manifest_digest = null,
                    object_key = null,
                    byte_count = null,
                    completed_at = null,
                    expires_at = null
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

    async getDomainOrder(actor, orderId) {
      return domains.getDomainOrder(actor, orderId);
    },

    async listDomainOrders(actor, projectId) {
      return domains.listDomainOrders(actor, projectId);
    },

    async getDomainPaymentRedirect(actor, orderId) {
      return domains.getDomainPaymentRedirect(
        actor,
        orderId
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

    async listDomains(actor, organizationId) {
      requiredActor(actor);
      const orgId = uuid(organizationId, "Organization ID");
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
            order by registration.registered_at,
                     registration.id`,
            [orgId]
          );
          return {
            domains: result.rows.map(publicDomainRegistration)
          };
        }
      );
    },

    async getDomain(actor, domainId) {
      requiredActor(actor);
      const id = uuid(domainId, "Domain ID");
      const scope = await authority.service(
        { userId: actor.userId, readOnly: true },
        async (client) => {
          const result = await client.query(
            `select registration.organization_id
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
            result.rowCount === 1,
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

    async listDnsRecords(actor, domainId) {
      return domains.listDnsRecords(actor, domainId);
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
        catalog = {
          ready: false,
          code:
            error instanceof HostedError
              ? error.code
              : error?.code ?? "CATALOG_UNAVAILABLE"
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
      const domainProviders = await domains.readiness();
      return {
        ready:
          persistence.ready &&
          catalog.ready &&
          publication.ready !== false &&
          (
            recovery.mode !== "production" ||
            (
              recovery.ready === true &&
              recovery.verified === true
            )
          ),
        service: "sitesourcery-hosted-runtime",
        runtime: process.version,
        persistence,
        compiler: {
          ready: true,
          schema: compiler.schema,
          revision: compiler.revision
        },
        catalog,
        publication,
        recovery,
        exports: {
          ready: true,
          kind: exportStore.kind
        },
        providers: {
          checkout: "held",
          registrar:
            domainProviders.ready
              ? "ready"
              : domainProviders.mode,
          dns: domainProviders.dns ?? "held",
          domains: domainProviders,
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
