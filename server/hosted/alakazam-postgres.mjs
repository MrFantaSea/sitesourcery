import {
  ALAKAZAM_CATALOG_VERSION,
  ALAKAZAM_TERMS_VERSION,
  quoteAlakazamChange,
  resolveAlakazamTier
} from "../commerce-v2/alakazam.mjs";
import {
  CommerceV2Error,
  clone,
  digest,
  invariant,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ROLES = Object.freeze([
  "owner",
  "admin",
  "editor"
]);
const TAX_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);
const DATABASE_CONSTRAINT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "42501",
  "55000"
]);

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactKeys(value, expected) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    "the Alakazam quote repository input is invalid"
  );
  return value;
}

function exactQuoteInput(value) {
  exactKeys(value, [
    "customerId",
    "expiresAt",
    "issuedAt",
    "projectId",
    "quoteId",
    "targetTierId",
    "taxMode",
    "tenantId"
  ]);
  const taxMode = requiredText(
    value.taxMode,
    "taxMode",
    40
  );
  invariant(
    TAX_MODES.has(taxMode),
    "invalid_input",
    "taxMode is invalid"
  );
  const issuedAt = requiredIso(
    value.issuedAt,
    "issuedAt"
  );
  const expiresAt = requiredIso(
    value.expiresAt,
    "expiresAt"
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(issuedAt) &&
      Date.parse(expiresAt) - Date.parse(issuedAt) <=
        30 * 60 * 1000,
    "invalid_input",
    "the Alakazam quote window is invalid"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(
      value.projectId,
      "projectId"
    ),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    targetTierId: requiredText(
      value.targetTierId,
      "targetTierId",
      100
    ),
    taxMode,
    issuedAt,
    expiresAt
  });
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam repository rejected inconsistent quote evidence",
      { status: 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function validateAuthority(authority) {
  invariant(
    authority &&
      typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

function exactDatabaseIso(value, field) {
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    field
  );
}

function exactDatabaseInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function jsonObject(value, field) {
  let selected = value;
  if (typeof selected === "string") {
    try {
      selected = JSON.parse(selected);
    } catch {
      invariant(
        false,
        "repository_conflict",
        `${field} is invalid`,
        { status: 500 }
      );
    }
  }
  invariant(
    selected &&
      typeof selected === "object" &&
      !Array.isArray(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return clone(selected);
}

function projectStoredQuote(row, input) {
  invariant(
    row &&
      row.id === input.quoteId &&
      row.organization_id === input.tenantId &&
      row.project_id === input.projectId &&
      row.customer_user_id === input.customerId &&
      row.created_by_user_id === input.customerId &&
      row.catalog_version === ALAKAZAM_CATALOG_VERSION &&
      row.terms_version === ALAKAZAM_TERMS_VERSION &&
      row.target_tier_id === input.targetTierId &&
      row.tax_state === input.taxMode &&
      row.provider_effects_authorized === true &&
      row.state !== "held" &&
      row.currency === "USD" &&
      row.provider_proration_enabled === false &&
      row.premium_configuration_policy ===
        "preserved_when_inactive",
    "idempotency_conflict",
    "the Alakazam quote ID was already used for another purpose",
    { status: 409 }
  );
  const currentSubscription = row.current_subscription_id
    ? {
        subscriptionId: row.current_subscription_id,
        tierId: row.current_tier_id,
        status: "active",
        revision: exactDatabaseInteger(
          row.current_subscription_revision,
          "quote.currentSubscriptionRevision"
        ),
        currentPeriodEndsAt: exactDatabaseIso(
          row.current_period_ends_at,
          "quote.currentPeriodEndsAt"
        ),
        cancelAtPeriodEnd: false,
        pendingChange: null
      }
    : null;
  const expectedCurrentAmountMinor = currentSubscription
    ? resolveAlakazamTier(currentSubscription.tierId)
        .price.amountMinor
    : null;
  const downloadCredit = row.download_entitlement_id
    ? {
        entitlementId: row.download_entitlement_id,
        state: "active",
        available: true,
        amountMinor: exactDatabaseInteger(
          row.applied_value_minor,
          "quote.appliedValueMinor"
        )
      }
    : null;
  const expected = quoteAlakazamChange({
    quoteId: row.id,
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    targetTierId: row.target_tier_id,
    currentSubscription,
    downloadCredit,
    issuedAt: exactDatabaseIso(
      row.issued_at,
      "quote.issuedAt"
    ),
    expiresAt: exactDatabaseIso(
      row.expires_at,
      "quote.expiresAt"
    ),
    providerEffectsAuthorized: true,
    taxMode: row.tax_state
  });
  const expectedEffectiveRule =
    expected.changeKind === "downgrade"
      ? "current_period_end"
      : "after_payment_and_provider_confirmation";
  const storedDisclosure = jsonObject(
    row.disclosure,
    "quote.disclosure"
  );
  invariant(
    row.change_kind === expected.changeKind &&
      row.current_subscription_id ===
        (expected.currentSubscriptionBinding
          ?.subscriptionId ?? null) &&
      Number(row.current_subscription_revision) ===
        (expected.currentSubscriptionBinding
          ?.revision ?? 0) &&
      row.current_tier_id ===
        (expected.currentSubscriptionBinding?.tierId ??
          null) &&
      (
        row.current_amount_minor === null ||
        row.current_amount_minor === undefined
          ? expected.currentSubscriptionBinding === null
          : exactDatabaseInteger(
              row.current_amount_minor,
              "quote.currentAmountMinor"
            ) === expectedCurrentAmountMinor
      ) &&
      exactDatabaseInteger(
        row.target_amount_minor,
        "quote.targetAmountMinor"
      ) === expected.targetTier.price.amountMinor &&
      row.applied_value_kind ===
        expected.appliedValue.kind &&
      exactDatabaseInteger(
        row.applied_value_minor,
        "quote.appliedValueMinor"
      ) === expected.appliedValue.amountMinor &&
      exactDatabaseInteger(
        row.due_now_subtotal_minor,
        "quote.dueNowSubtotalMinor"
      ) === expected.dueNow.subtotalMinor &&
      exactDatabaseInteger(
        row.next_renewal_amount_minor,
        "quote.nextRenewalAmountMinor"
      ) === expected.nextRenewal.amountMinor &&
      row.effective_rule === expectedEffectiveRule &&
      (
        expected.changeKind === "downgrade"
          ? exactDatabaseIso(
              row.effective_at,
              "quote.effectiveAt"
            ) === expected.effectiveAt
          : row.effective_at === null ||
            row.effective_at === undefined
      ) &&
      row.no_mid_period_refund ===
        expected.noMidPeriodRefundOrProration &&
      digest(storedDisclosure) ===
        expected.disclosureDigest &&
      row.disclosure_digest ===
        expected.disclosureDigest &&
      row.quote_digest === expected.quoteDigest,
    "repository_conflict",
    "the stored Alakazam quote failed its immutable digest projection",
    { status: 500 }
  );
  return expected;
}

function currentSubscription(row, pendingChange) {
  if (!row) return null;
  invariant(
    row.customer_user_id,
    "repository_conflict",
    "the current Alakazam subscription identity is invalid",
    { status: 500 }
  );
  const tierId = requiredText(
    row.tier_id,
    "currentSubscription.tierId",
    100
  );
  const status = requiredText(
    row.status,
    "currentSubscription.status",
    50
  );
  invariant(
    status === "active",
    "alakazam_change_unavailable",
    "resolve the current subscription payment state before changing tiers",
    { status: 409 }
  );
  invariant(
    exactDatabaseInteger(
      row.amount_minor,
      "currentSubscription.amountMinor"
    ) === resolveAlakazamTier(tierId).price.amountMinor,
    "repository_conflict",
    "the current Alakazam tier amount is invalid",
    { status: 500 }
  );
  return Object.freeze({
    subscriptionId: exactUuid(
      row.id,
      "currentSubscription.subscriptionId"
    ),
    tierId,
    status,
    revision: exactDatabaseInteger(
      row.revision,
      "currentSubscription.revision"
    ),
    currentPeriodEndsAt: exactDatabaseIso(
      row.current_period_ends_at,
      "currentSubscription.currentPeriodEndsAt"
    ),
    cancelAtPeriodEnd:
      row.cancel_at_period_end === true,
    pendingChange
  });
}

export function createPostgresAlakazamRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async createQuote(value) {
      const input = exactQuoteInput(value);
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId
          },
          async (client) => {
            const project = await client.query(
              `select project.id
                 from ss.projects project
                 join ss.organizations organization
                   on organization.id =
                      project.organization_id
                  and organization.state = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      project.organization_id
                  and membership.user_id = $2
                  and membership.state = 'active'
                  and membership.role = any($4::text[])
                where project.organization_id = $1
                  and project.id = $3
                  and project.lifecycle = 'active'
                for update of project`,
              [
                input.tenantId,
                input.customerId,
                input.projectId,
                PROJECT_ROLES
              ]
            );
            invariant(
              project.rowCount === 1,
              "project_unavailable",
              "the editor project is unavailable",
              { status: 404 }
            );

            const existing = await client.query(
              `select *
                 from ss.alakazam_change_quotes
                where organization_id = $1
                  and id = $2`,
              [input.tenantId, input.quoteId]
            );
            if (existing.rowCount === 1) {
              return projectStoredQuote(
                existing.rows[0],
                input
              );
            }
            invariant(
              existing.rowCount === 0,
              "repository_conflict",
              "the Alakazam quote repository returned duplicate identity",
              { status: 500 }
            );

            const subscriptions = await client.query(
              `select *
                 from ss.alakazam_subscriptions
                where organization_id = $1
                  and project_id = $2
                  and status <> 'ended'
                for update`,
              [input.tenantId, input.projectId]
            );
            invariant(
              subscriptions.rowCount <= 1,
              "repository_conflict",
              "the project has conflicting Alakazam subscriptions",
              { status: 500 }
            );
            const subscriptionRow =
              subscriptions.rows[0] ?? null;
            invariant(
              !subscriptionRow ||
                subscriptionRow.customer_user_id ===
                  input.customerId,
              "alakazam_change_unavailable",
              "the current Alakazam billing owner is unavailable",
              { status: 409 }
            );

            let pendingChange = null;
            if (subscriptionRow) {
              const schedules = await client.query(
                `select id, target_tier_id,
                        effective_at, state
                   from ss.alakazam_downgrade_schedules
                  where organization_id = $1
                    and subscription_id = $2
                    and state in (
                      'dispatching', 'scheduled',
                      'reconciliation_required'
                    )
                  for update`,
                [input.tenantId, subscriptionRow.id]
              );
              invariant(
                schedules.rowCount <= 1,
                "repository_conflict",
                "the subscription has conflicting tier changes",
                { status: 500 }
              );
              if (schedules.rowCount === 1) {
                pendingChange = {
                  scheduleId: schedules.rows[0].id,
                  targetTierId:
                    schedules.rows[0].target_tier_id,
                  effectiveAt: exactDatabaseIso(
                    schedules.rows[0].effective_at,
                    "pendingChange.effectiveAt"
                  ),
                  state: schedules.rows[0].state
                };
              }
            }

            let downloadCredit = null;
            if (!subscriptionRow) {
              const entitlements = await client.query(
                `select entitlement.id
                   from ss.commerce_v2_project_entitlements entitlement
                  where entitlement.organization_id = $1
                    and entitlement.project_id = $2
                    and entitlement.customer_user_id = $3
                    and entitlement.kind = 'spark_download'
                    and entitlement.scope = 'editor_project'
                    and entitlement.state = 'active'
                    and not exists (
                      select 1
                        from ss.alakazam_credit_applications application
                       where application.download_entitlement_id =
                             entitlement.id
                    )
                  order by entitlement.activated_at, entitlement.id
                  limit 2
                  for update of entitlement`,
                [
                  input.tenantId,
                  input.projectId,
                  input.customerId
                ]
              );
              invariant(
                entitlements.rowCount <= 1,
                "repository_conflict",
                "the project has conflicting Download credit authority",
                { status: 500 }
              );
              if (entitlements.rowCount === 1) {
                downloadCredit = {
                  entitlementId:
                    entitlements.rows[0].id,
                  state: "active",
                  available: true,
                  amountMinor: 500
                };
              }
            }

            const quote = quoteAlakazamChange({
              quoteId: input.quoteId,
              tenantId: input.tenantId,
              customerId: input.customerId,
              projectId: input.projectId,
              targetTierId: input.targetTierId,
              currentSubscription: currentSubscription(
                subscriptionRow,
                pendingChange
              ),
              downloadCredit,
              issuedAt: input.issuedAt,
              expiresAt: input.expiresAt,
              providerEffectsAuthorized: true,
              taxMode: input.taxMode
            });
            const current =
              quote.currentSubscriptionBinding;
            const currentAmountMinor = current
              ? resolveAlakazamTier(current.tierId)
                  .price.amountMinor
              : null;
            const effectiveRule =
              quote.changeKind === "downgrade"
                ? "current_period_end"
                : "after_payment_and_provider_confirmation";
            const inserted = await client.query(
              `insert into ss.alakazam_change_quotes (
                 id, organization_id, project_id,
                 customer_user_id, catalog_version,
                 terms_version, change_kind,
                 current_subscription_id,
                 current_subscription_revision,
                 current_tier_id, current_amount_minor,
                 current_period_ends_at, target_tier_id,
                 target_amount_minor, applied_value_kind,
                 applied_value_minor, download_entitlement_id,
                 due_now_subtotal_minor,
                 next_renewal_amount_minor, currency,
                 effective_rule, effective_at,
                 no_mid_period_refund,
                 provider_proration_enabled,
                 premium_configuration_policy, tax_state,
                 disclosure, disclosure_digest, quote_digest,
                 state, provider_effects_authorized,
                 issued_at, expires_at, created_by_user_id
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $14, 'USD',
                 $19, $20, $21, false,
                 'preserved_when_inactive', $22,
                 $23::jsonb, $24, $25,
                 'quoted', true, $26, $27, $4
               )
               returning *`,
              [
                quote.quoteId,
                quote.tenantId,
                quote.projectId,
                quote.customerId,
                quote.catalogVersion,
                quote.termsVersion,
                quote.changeKind,
                current?.subscriptionId ?? null,
                current?.revision ?? null,
                current?.tierId ?? null,
                currentAmountMinor,
                current?.currentPeriodEndsAt ?? null,
                quote.targetTier.tierId,
                quote.targetTier.price.amountMinor,
                quote.appliedValue.kind,
                quote.appliedValue.amountMinor,
                quote.appliedValue.kind ===
                "download_purchase"
                  ? quote.appliedValue.sourceId
                  : null,
                quote.dueNow.subtotalMinor,
                effectiveRule,
                quote.changeKind === "downgrade"
                  ? quote.effectiveAt
                  : null,
                quote.noMidPeriodRefundOrProration,
                quote.dueNow.taxState,
                JSON.stringify(quote.disclosure),
                quote.disclosureDigest,
                quote.quoteDigest,
                quote.issuedAt,
                quote.expiresAt
              ]
            );
            invariant(
              inserted.rowCount === 1,
              "repository_conflict",
              "the Alakazam quote was not committed durably",
              { status: 500 }
            );
            return projectStoredQuote(
              inserted.rows[0],
              input
            );
          }
        )
      );
    }
  });
}
