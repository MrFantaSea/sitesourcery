import { createHash } from "node:crypto";

import {
  CHECKOUT_COMMAND_SCHEMA,
  CHECKOUT_DISPATCH_SCHEMA,
  CHECKOUT_PURPOSE_SCHEMA,
  DOWNLOAD_PRICE_MINOR,
  ENTITLEMENT_SCHEMA,
  PAYMENT_RECEIPT_SCHEMA,
  PURCHASE_ACCEPTANCE_SCHEMA,
  PURCHASE_ACCEPTANCE_STATEMENT
} from "../commerce-v2/constants.mjs";
import {
  CommerceV2Error,
  clone,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const REVERSAL_OBJECT_ID =
  /^(?:ch|dp|du)_[A-Za-z0-9_]+$/u;
const CHARGE_ID = /^ch_[A-Za-z0-9_]+$/u;
const FRAUD_WARNING_ID = /^issfr_[A-Za-z0-9_]+$/u;
const SAFE_CODE = /^[A-Za-z0-9._:-]{1,200}$/u;
const REVERSAL_EVENT_TYPES = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated"
]);
const ENTITLEMENT_SEVERITY = Object.freeze({
  active: 0,
  suspended: 1,
  revoked: 2
});
const DATABASE_CONSTRAINT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "42501",
  "55000"
]);
const PROJECT_ROLES = Object.freeze([
  "owner",
  "admin",
  "editor"
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

function exactClock(clock) {
  const value =
    typeof clock === "function"
      ? clock()
      : clock?.now?.();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Download payment repository rejected inconsistent evidence",
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

function exactPreparation(value) {
  const purpose = value?.purpose;
  invariant(
    value?.schema === CHECKOUT_COMMAND_SCHEMA &&
      value.state === "held" &&
      value.dispatchAuthorized === false &&
      value.provider === null &&
      value.offerId === "spark_download" &&
      value.entitlementKind === "spark_download" &&
      purpose?.schema === CHECKOUT_PURPOSE_SCHEMA &&
      purpose.projectId === value.projectId &&
      purpose.versionId === value.versionId &&
      purpose.quoteId === value.quoteId &&
      purpose.offerId === "spark_download" &&
      purpose.entitlementKind === "spark_download" &&
      purpose.purchaseTermsAccepted === true &&
      ["automatic", "disabled_by_owner"].includes(
        purpose.taxMode
      ) &&
      purpose.price?.amountMinor === DOWNLOAD_PRICE_MINOR &&
      purpose.price?.currency === "USD" &&
      purpose.price?.billing === "one_time" &&
      purpose.price?.interval === null,
    "repository_conflict",
    "the Download preparation is invalid",
    { status: 500 }
  );
  invariant(
    value.acceptance?.schema ===
      PURCHASE_ACCEPTANCE_SCHEMA &&
      value.acceptance.statement ===
        PURCHASE_ACCEPTANCE_STATEMENT &&
      value.acceptance.acceptedAt ===
        value.preparedAt &&
      value.acceptance.acceptedDisclosureDigest ===
        purpose.acceptedDisclosureDigest,
    "repository_conflict",
    "the Download purchase acceptance is invalid",
    { status: 500 }
  );
  return Object.freeze({
    tenantId: exactUuid(
      purpose.tenantId,
      "preparation.purpose.tenantId"
    ),
    customerId: exactUuid(
      purpose.customerId,
      "preparation.purpose.customerId"
    ),
    projectId: exactUuid(
      value.projectId,
      "preparation.projectId"
    ),
    versionId: exactUuid(
      value.versionId,
      "preparation.versionId"
    ),
    quoteId: exactUuid(
      value.quoteId,
      "preparation.quoteId"
    ),
    commandId: requiredText(
      value.commandId,
      "preparation.commandId"
    ),
    purposeDigest: requiredDigest(
      value.purposeDigest,
      "preparation.purposeDigest"
    ),
    acceptedDisclosureDigest: requiredDigest(
      purpose.acceptedDisclosureDigest,
      "preparation.purpose.acceptedDisclosureDigest"
    ),
    quoteSnapshotDigest: requiredDigest(
      purpose.quoteSnapshotDigest,
      "preparation.purpose.quoteSnapshotDigest"
    ),
    acceptanceClientAddress: requiredText(
      value.acceptance.clientAddress,
      "preparation.acceptance.clientAddress",
      80
    ),
    purpose: clone(purpose)
  });
}

function exactDispatchResult(preparation, value) {
  invariant(
    value?.schema === CHECKOUT_DISPATCH_SCHEMA &&
      value.commandId === preparation.commandId &&
      value.quoteId === preparation.quoteId &&
      value.projectId === preparation.projectId &&
      value.versionId === preparation.versionId &&
      value.offerId === "spark_download" &&
      value.entitlementKind === "spark_download" &&
      value.state === "ready" &&
      value.dispatchAuthorized === true &&
      value.provider === "stripe" &&
      value.purposeDigest === preparation.purposeDigest &&
      value.checkout?.url === value.checkoutUrl,
    "repository_conflict",
    "the Download dispatch result is invalid",
    { status: 500 }
  );
  const checkoutSessionId = requiredText(
    value.checkout?.id,
    "dispatch.checkout.id"
  );
  invariant(
    CHECKOUT_ID.test(checkoutSessionId),
    "repository_conflict",
    "the Stripe Checkout Session ID is invalid",
    { status: 500 }
  );
  return Object.freeze({
    checkoutSessionId,
    checkoutUrl: requiredText(
      value.checkoutUrl,
      "dispatch.checkoutUrl",
      4096
    ),
    providerExpiresAt: requiredIso(
      value.checkout.expiresAt,
      "dispatch.checkout.expiresAt"
    ),
    dispatchedAt: requiredIso(
      value.dispatchedAt,
      "dispatch.dispatchedAt"
    ),
    snapshot: JSON.stringify(value)
  });
}

function expiryReconciliation(row) {
  const preparation = clone(row?.preparation);
  const exact = exactPreparation(preparation);
  const selected = exactDispatchResult(
    exact,
    row?.result
  );
  invariant(
    row.state === "ready" &&
      row.organization_id === exact.tenantId &&
      row.preparation_command_id ===
        exact.commandId &&
      row.project_id === exact.projectId &&
      row.version_id === exact.versionId &&
      row.quote_id === exact.quoteId &&
      row.customer_user_id === exact.customerId &&
      row.purpose_digest === exact.purposeDigest &&
      row.checkout_session_id ===
        selected.checkoutSessionId,
    "repository_conflict",
    "the expired Download Checkout evidence is invalid",
    { status: 500 }
  );
  return Object.freeze({
    preparation,
    result: clone(row.result),
    checkoutSessionId: selected.checkoutSessionId
  });
}

function publicEntitlement(row, customerId) {
  if (!row) return null;
  return Object.freeze({
    schema: ENTITLEMENT_SCHEMA,
    entitlementId: row.entitlement_id,
    tenantId: row.organization_id,
    customerId,
    projectId: row.project_id,
    kind: "spark_download",
    scope: "editor_project",
    state: "active",
    activatedAt: new Date(
      row.activated_at
    ).toISOString(),
    expiresAt: null,
    acceptedDisclosureDigest:
      row.accepted_disclosure_digest,
    payment: {
      status: "paid",
      provider: "stripe",
      receiptId: row.receipt_id,
      amountMinor: Number(row.amount_minor),
      taxMinor: Number(row.tax_minor),
      totalMinor: Number(row.total_minor),
      taxMode: row.tax_mode,
      currency: "USD",
      settledAt: new Date(
        row.settled_at
      ).toISOString()
    }
  });
}

function entitlementQuery() {
  return `select
            entitlement.id as entitlement_id,
            entitlement.organization_id,
            entitlement.project_id,
            entitlement.accepted_disclosure_digest,
            entitlement.activated_at,
            receipt.id as receipt_id,
            receipt.amount_minor,
            receipt.tax_minor,
            receipt.total_minor,
            receipt.tax_mode,
            receipt.settled_at
          from ss.commerce_v2_project_entitlements entitlement
          join ss.commerce_v2_download_payment_receipts receipt
            on receipt.organization_id =
               entitlement.organization_id
           and receipt.id = entitlement.source_receipt_id
         where entitlement.organization_id = $1
           and entitlement.project_id = $2
           and entitlement.kind = 'spark_download'
           and entitlement.scope = 'editor_project'
           and entitlement.state = 'active'`;
}

async function holdDownloadCheckoutGate(
  client,
  {
    signalType,
    signalId,
    evidenceDigest,
    reason,
    changedAt
  }
) {
  const gate = await client.query(
    `select state, revision
       from ss.commerce_v2_download_checkout_gate
      where singleton = true
      for update`
  );
  invariant(
    gate.rowCount === 1,
    "repository_conflict",
    "the Download Checkout circuit breaker is unavailable",
    { status: 500 }
  );
  if (gate.rows[0].state === "held") {
    return false;
  }
  await client.query(
    `insert into ss.commerce_v2_download_gate_transitions (
       prior_state, resulting_state, reason,
       signal_type, signal_id, evidence_digest,
       changed_by_user_id, changed_at
     ) values (
       'open', 'held', $1, $2, $3, $4,
       null, $5
     )`,
    [
      reason,
      signalType,
      signalId,
      evidenceDigest,
      changedAt
    ]
  );
  const updated = await client.query(
    `update ss.commerce_v2_download_checkout_gate
        set state = 'held',
            reason = $1,
            signal_type = $2,
            signal_id = $3,
            evidence_digest = $4,
            state_changed_at = $5,
            revision = revision + 1
      where singleton = true
        and state = 'open'
      returning revision`,
    [
      reason,
      signalType,
      signalId,
      evidenceDigest,
      changedAt
    ]
  );
  invariant(
    updated.rowCount === 1,
    "repository_conflict",
    "the Download Checkout circuit breaker did not hold",
    { status: 500 }
  );
  return true;
}

async function storeDownloadDisputeDossier(
  client,
  {
    receiptId,
    tenantId,
    projectId,
    entitlementId,
    triggerEventId,
    triggerType,
    providerCreatedAt,
    payloadDigest
  }
) {
  const evidence = await client.query(
    `select receipt.facts as receipt_facts,
            prep.preparation,
            quote.snapshot as quote_snapshot,
            entitlement.state as entitlement_state,
            entitlement.state_reason,
            entitlement.activated_at,
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'accessEventId', access.id,
                  'artifactDigest', access.artifact_digest,
                  'byteCount', access.byte_count,
                  'clientAddress', access.client_address,
                  'requestId', access.request_id,
                  'responseIssuedAt', access.response_issued_at,
                  'state', access.state,
                  'userAgentDigest', access.user_agent_digest,
                  'versionId', access.version_id
                ) order by access.response_issued_at, access.id
              )
              from ss.commerce_v2_download_access_events access
              where access.organization_id = receipt.organization_id
                and access.receipt_id = receipt.id
            ), '[]'::jsonb) as access_events
       from ss.commerce_v2_download_payment_receipts receipt
       join ss.commerce_v2_project_entitlements entitlement
         on entitlement.organization_id = receipt.organization_id
        and entitlement.id = $4
        and entitlement.source_receipt_id = receipt.id
       join ss.commerce_v2_download_dispatches dispatch
         on dispatch.organization_id = receipt.organization_id
        and dispatch.preparation_command_id =
            receipt.preparation_command_id
       join ss.commerce_v2_checkout_preparations prep
         on prep.organization_id = dispatch.organization_id
        and prep.command_id = dispatch.preparation_command_id
       join ss.commerce_v2_download_quotes quote
         on quote.organization_id = receipt.organization_id
        and quote.id = receipt.quote_id
      where receipt.id = $1
        and receipt.organization_id = $2
        and receipt.project_id = $3`,
    [receiptId, tenantId, projectId, entitlementId]
  );
  invariant(
    evidence.rowCount === 1,
    "repository_conflict",
    "the private Download dispute dossier evidence is incomplete",
    { status: 500 }
  );
  const row = evidence.rows[0];
  const dossier = {
    schema:
      "sitesourcery.download-private-dispute-dossier/v1",
    createdAt: providerCreatedAt,
    trigger: {
      eventId: triggerEventId,
      eventType: triggerType,
      payloadDigest
    },
    scope: {
      tenantId,
      projectId,
      receiptId,
      entitlementId
    },
    quote: clone(row.quote_snapshot),
    purchaseAcceptance: clone(row.preparation),
    payment: clone(row.receipt_facts),
    entitlement: {
      state: row.entitlement_state,
      stateReason: row.state_reason,
      activatedAt: new Date(
        row.activated_at
      ).toISOString()
    },
    accessEvents: clone(row.access_events)
  };
  const dossierDigest = digest(dossier);
  await client.query(
    `insert into ss.commerce_v2_download_dispute_dossiers (
       organization_id, project_id, receipt_id,
       entitlement_id, trigger_event_id, trigger_type,
       dossier, dossier_digest, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9
     )
     on conflict (trigger_type, trigger_event_id)
     do nothing`,
    [
      tenantId,
      projectId,
      receiptId,
      entitlementId,
      triggerEventId,
      triggerType,
      JSON.stringify(dossier),
      dossierDigest,
      providerCreatedAt
    ]
  );
  return dossierDigest;
}

export function createPostgresDownloadPaymentRepository({
  authority,
  clock = () => new Date()
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async findStripeCustomer(input) {
      if (
        !UUID.test(String(input?.tenantId ?? "")) ||
        !UUID.test(String(input?.customerId ?? ""))
      ) {
        return null;
      }
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `select customer.stripe_customer_id
                 from ss.stripe_customers customer
                 join ss.organizations organization
                   on organization.id =
                      customer.organization_id
                  and organization.state = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      customer.organization_id
                  and membership.user_id = $2
                  and membership.state = 'active'
                  and membership.role = any($3::text[])
                where customer.organization_id = $1`,
              [
                input.tenantId,
                input.customerId,
                PROJECT_ROLES
              ]
            );
            if (result.rowCount !== 1) return null;
            const selected =
              result.rows[0].stripe_customer_id;
            invariant(
              STRIPE_CUSTOMER_ID.test(selected),
              "repository_conflict",
              "the organization's Stripe Customer binding is invalid",
              { status: 500 }
            );
            return selected;
          }
        )
      );
    },

    async findVerifiedCheckoutIdentity(input) {
      if (
        !UUID.test(String(input?.tenantId ?? "")) ||
        !UUID.test(String(input?.customerId ?? ""))
      ) {
        return null;
      }
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `select principal.id as user_id,
                      lower(principal.email) as email,
                      principal.created_at as account_created_at,
                      registration.activated_at,
                      registration.possession_evidence_digest
                 from auth.users principal
                 join ss.organization_memberships membership
                   on membership.user_id = principal.id
                  and membership.organization_id = $1
                  and membership.state = 'active'
                  and membership.role = any($3::text[])
                 join ss.organizations organization
                   on organization.id = membership.organization_id
                  and organization.state = 'active'
                 join ss.hosted_registration_requests registration
                   on registration.activated_user_id = principal.id
                  and registration.activated_organization_id = $1
                  and registration.state = 'activated'
                  and registration.activated_at is not null
                  and registration.possession_proven_at =
                      registration.activated_at
                  and registration.possession_evidence_digest is not null
                where principal.id = $2
                  and principal.disabled_at is null`,
              [
                input.tenantId,
                input.customerId,
                PROJECT_ROLES
              ]
            );
            if (result.rowCount !== 1) return null;
            const row = result.rows[0];
            const email = row.email;
            return Object.freeze({
              verified: true,
              userId: row.user_id,
              email,
              emailDigest: createHash("sha256")
                .update(email, "utf8")
                .digest("hex"),
              accountCreatedAt: new Date(
                row.account_created_at
              ).toISOString(),
              activatedAt: new Date(
                row.activated_at
              ).toISOString(),
              possessionEvidenceDigest:
                row.possession_evidence_digest
            });
          }
        )
      );
    },

    async findProjectEntitlement(input) {
      if (
        !UUID.test(String(input?.tenantId ?? "")) ||
        !UUID.test(String(input?.customerId ?? "")) ||
        !UUID.test(String(input?.projectId ?? ""))
      ) {
        return null;
      }
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `${entitlementQuery()}
                 and exists (
                   select 1
                   from ss.projects project
                   join ss.organizations organization
                     on organization.id =
                        project.organization_id
                    and organization.state = 'active'
                   join ss.organization_memberships membership
                     on membership.organization_id =
                        project.organization_id
                    and membership.user_id = $3
                    and membership.state = 'active'
                    and membership.role = any($4::text[])
                  where project.organization_id = $1
                    and project.id = $2
                    and project.lifecycle = 'active'
                 )`,
              [
                input.tenantId,
                input.projectId,
                input.customerId,
                PROJECT_ROLES
              ]
            );
            return result.rowCount === 1
              ? publicEntitlement(
                  result.rows[0],
                  input.customerId
                )
              : null;
          }
        )
      );
    },

    async findPaymentReceiptByIntent({
      paymentIntentId
    } = {}) {
      if (
        !PAYMENT_INTENT_ID.test(
          String(paymentIntentId ?? "")
        )
      ) {
        return null;
      }
      return translated(() =>
        database.service(
          { readOnly: true },
          async (client) => {
            const result = await client.query(
              `select receipt.id as receipt_id,
                      receipt.organization_id,
                      receipt.project_id,
                      receipt.customer_user_id,
                      receipt.payment_intent_id,
                      receipt.amount_minor,
                      receipt.tax_minor,
                      receipt.total_minor,
                      receipt.currency,
                      entitlement.id as entitlement_id,
                      entitlement.state as entitlement_state
                 from ss.commerce_v2_download_payment_receipts receipt
                 join ss.commerce_v2_project_entitlements entitlement
                   on entitlement.organization_id =
                      receipt.organization_id
                  and entitlement.source_receipt_id =
                      receipt.id
                where receipt.payment_intent_id = $1`,
              [paymentIntentId]
            );
            if (result.rowCount !== 1) return null;
            const row = result.rows[0];
            return Object.freeze({
              receiptId: row.receipt_id,
              tenantId: row.organization_id,
              customerId: row.customer_user_id,
              projectId: row.project_id,
              entitlementId: row.entitlement_id,
              entitlementState:
                row.entitlement_state,
              paymentIntentId:
                row.payment_intent_id,
              amountMinor: Number(
                row.amount_minor
              ),
              taxMinor: Number(row.tax_minor),
              totalMinor: Number(row.total_minor),
              currency: row.currency
            });
          }
        )
      );
    },

    async claimDispatch(input) {
      const preparation = exactPreparation(input);
      const now = exactClock(clock);
      const leaseExpiresAt = new Date(
        Date.parse(now) + 120_000
      ).toISOString();
      return translated(() =>
        database.service(
          {
            userId: preparation.customerId,
            organizationId: preparation.tenantId
          },
          async (client) => {
            const same = await client.query(
              `select dispatch.*, prep.preparation
                 from ss.commerce_v2_download_dispatches dispatch
                 join ss.commerce_v2_checkout_preparations prep
                   on prep.organization_id =
                      dispatch.organization_id
                  and prep.command_id =
                      dispatch.preparation_command_id
                where dispatch.organization_id = $1
                  and dispatch.preparation_command_id = $2
                for update of dispatch`,
              [
                preparation.tenantId,
                preparation.commandId
              ]
            );
            if (same.rowCount === 1) {
              const row = same.rows[0];
              invariant(
                row.quote_id === preparation.quoteId &&
                  row.customer_user_id ===
                    preparation.customerId &&
                  row.project_id ===
                    preparation.projectId &&
                  row.version_id ===
                    preparation.versionId &&
                  row.purpose_digest ===
                    preparation.purposeDigest &&
                  row.accepted_disclosure_digest ===
                    preparation.acceptedDisclosureDigest &&
                  row.quote_snapshot_digest ===
                    preparation.quoteSnapshotDigest,
                "repository_conflict",
                "the Download dispatch identity changed",
                { status: 500 }
              );
              if (row.state === "ready") {
                if (
                  Date.parse(row.provider_expires_at) >
                  Date.parse(now)
                ) {
                  return {
                    status: "replay",
                    result: clone(row.result)
                  };
                }
                return {
                  status: "reconcile_expiry",
                  reconciliation:
                    expiryReconciliation(row)
                };
              }
              if (row.state === "dispatching") {
                if (
                  Date.parse(row.lease_expires_at) <=
                  Date.parse(now)
                ) {
                  await client.query(
                    `update ss.commerce_v2_download_dispatches
                        set state = 'effect_unknown',
                            provider_error_code =
                              'dispatch_interrupted',
                            updated_at = greatest(
                              clock_timestamp(),
                              updated_at + interval '1 microsecond'
                            )
                      where organization_id = $1
                        and preparation_command_id = $2
                        and state = 'dispatching'`,
                    [
                      preparation.tenantId,
                      preparation.commandId
                    ]
                  );
                  return { status: "effect_unknown" };
                }
                return { status: "pending" };
              }
              if (row.state === "effect_unknown") {
                return { status: "effect_unknown" };
              }
              if (row.state === "settled") {
                return { status: "entitled" };
              }
              return { status: "expired" };
            }

            const open = await client.query(
              `select dispatch.*, prep.preparation
                 from ss.commerce_v2_download_dispatches dispatch
                 join ss.commerce_v2_checkout_preparations prep
                   on prep.organization_id =
                      dispatch.organization_id
                  and prep.command_id =
                      dispatch.preparation_command_id
                where dispatch.organization_id = $1
                  and dispatch.project_id = $2
                  and dispatch.state in (
                    'dispatching', 'ready',
                    'effect_unknown', 'settled'
                  )
                for update of dispatch`,
              [
                preparation.tenantId,
                preparation.projectId
              ]
            );
            if (open.rowCount === 1) {
              const row = open.rows[0];
              if (
                row.state === "ready" &&
                Date.parse(row.provider_expires_at) <=
                  Date.parse(now)
              ) {
                return {
                  status: "reconcile_expiry",
                  reconciliation:
                    expiryReconciliation(row)
                };
              } else if (row.state === "settled") {
                return { status: "entitled" };
              } else if (row.state === "effect_unknown") {
                return { status: "effect_unknown" };
              } else if (
                row.state === "dispatching" &&
                Date.parse(row.lease_expires_at) <=
                  Date.parse(now)
              ) {
                await client.query(
                  `update ss.commerce_v2_download_dispatches
                      set state = 'effect_unknown',
                          provider_error_code =
                            'dispatch_interrupted',
                          updated_at = greatest(
                            clock_timestamp(),
                            updated_at + interval '1 microsecond'
                          )
                    where organization_id = $1
                      and preparation_command_id = $2
                      and state = 'dispatching'`,
                  [
                    preparation.tenantId,
                    row.preparation_command_id
                  ]
                );
                return { status: "effect_unknown" };
              } else {
                return { status: "pending" };
              }
            }

            const priorAttempt = await client.query(
              `select outcome
                 from ss.commerce_v2_download_checkout_attempts
                where organization_id = $1
                  and preparation_command_id = $2`,
              [
                preparation.tenantId,
                preparation.commandId
              ]
            );
            if (priorAttempt.rowCount === 1) {
              return {
                status: priorAttempt.rows[0].outcome
              };
            }

            const gate = await client.query(
              `select state, revision
                 from ss.commerce_v2_download_checkout_gate
                where singleton = true
                for update`
            );
            invariant(
              gate.rowCount === 1,
              "repository_conflict",
              "the Download Checkout circuit breaker is unavailable",
              { status: 500 }
            );
            if (gate.rows[0].state === "held") {
              await client.query(
                `insert into ss.commerce_v2_download_checkout_attempts (
                   organization_id, preparation_command_id,
                   quote_id, customer_user_id, project_id,
                   client_address, accepted_disclosure_digest,
                   purpose_digest, outcome, gate_revision,
                   attempted_at
                 ) values (
                   $1, $2, $3, $4, $5, $6, $7, $8,
                   'risk_held', $9, $10
                 )`,
                [
                  preparation.tenantId,
                  preparation.commandId,
                  preparation.quoteId,
                  preparation.customerId,
                  preparation.projectId,
                  preparation.acceptanceClientAddress,
                  preparation.acceptedDisclosureDigest,
                  preparation.purposeDigest,
                  Number(gate.rows[0].revision),
                  now
                ]
              );
              return { status: "risk_held" };
            }

            const velocity = await client.query(
              `select
                 count(*) filter (
                   where customer_user_id = $1
                     and attempted_at > $3::timestamptz - interval '1 hour'
                 ) as account_attempts,
                 count(*) filter (
                   where client_address = $2
                     and attempted_at > $3::timestamptz - interval '1 hour'
                 ) as address_attempts,
                 count(*) filter (
                   where attempted_at > $3::timestamptz - interval '5 minutes'
                 ) as global_attempts
                from ss.commerce_v2_download_checkout_attempts
               where attempted_at > $3::timestamptz - interval '1 hour'`,
              [
                preparation.customerId,
                preparation.acceptanceClientAddress,
                now
              ]
            );
            const counts = velocity.rows[0];
            if (
              Number(counts.account_attempts) >= 6 ||
              Number(counts.address_attempts) >= 12 ||
              Number(counts.global_attempts) >= 120
            ) {
              await client.query(
                `insert into ss.commerce_v2_download_checkout_attempts (
                   organization_id, preparation_command_id,
                   quote_id, customer_user_id, project_id,
                   client_address, accepted_disclosure_digest,
                   purpose_digest, outcome, gate_revision,
                   attempted_at
                 ) values (
                   $1, $2, $3, $4, $5, $6, $7, $8,
                   'rate_limited', $9, $10
                 )`,
                [
                  preparation.tenantId,
                  preparation.commandId,
                  preparation.quoteId,
                  preparation.customerId,
                  preparation.projectId,
                  preparation.acceptanceClientAddress,
                  preparation.acceptedDisclosureDigest,
                  preparation.purposeDigest,
                  Number(gate.rows[0].revision),
                  now
                ]
              );
              return { status: "rate_limited" };
            }

            await client.query(
              `insert into ss.commerce_v2_download_checkout_attempts (
                 organization_id,
                 preparation_command_id,
                 quote_id,
                 customer_user_id,
                 project_id,
                 client_address,
                 accepted_disclosure_digest,
                 purpose_digest,
                 outcome,
                 gate_revision,
                 attempted_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8,
                 'claimed', $9, $10
               )`,
              [
                preparation.tenantId,
                preparation.commandId,
                preparation.quoteId,
                preparation.customerId,
                preparation.projectId,
                preparation.acceptanceClientAddress,
                preparation.acceptedDisclosureDigest,
                preparation.purposeDigest,
                Number(gate.rows[0].revision),
                now
              ]
            );

            const inserted = await client.query(
              `insert into ss.commerce_v2_download_dispatches (
                 organization_id,
                 preparation_command_id,
                 quote_id, customer_user_id,
                 project_id, version_id,
                 provider, state, purpose_digest,
                 accepted_disclosure_digest,
                 quote_snapshot_digest,
                 lease_expires_at, created_at, updated_at
               ) values (
                 $1, $2, $3, $4, $5, $6,
                 'stripe', 'dispatching', $7, $8, $9,
                 $10, $11, $11
               )
               returning preparation_command_id`,
              [
                preparation.tenantId,
                preparation.commandId,
                preparation.quoteId,
                preparation.customerId,
                preparation.projectId,
                preparation.versionId,
                preparation.purposeDigest,
                preparation.acceptedDisclosureDigest,
                preparation.quoteSnapshotDigest,
                leaseExpiresAt,
                now
              ]
            );
            invariant(
              inserted.rowCount === 1,
              "repository_conflict",
              "the Download dispatch was not reserved",
              { status: 500 }
            );
            return { status: "claimed" };
          }
        )
      );
    },

    async expireDispatch(input) {
      const preparation = exactPreparation(
        input?.preparation
      );
      const checkoutSessionId = requiredText(
        input?.checkoutSessionId,
        "checkoutSessionId"
      );
      invariant(
        CHECKOUT_ID.test(checkoutSessionId) &&
          input?.result?.checkout?.id ===
            checkoutSessionId,
        "repository_conflict",
        "the expired Download Checkout identity is invalid",
        { status: 500 }
      );
      const now = exactClock(clock);
      return translated(() =>
        database.service(
          {
            userId: preparation.customerId,
            organizationId: preparation.tenantId
          },
          async (client) => {
            const expired = await client.query(
              `update ss.commerce_v2_download_dispatches
                  set state = 'expired',
                      updated_at = greatest(
                        clock_timestamp(),
                        updated_at + interval '1 microsecond'
                      )
                where organization_id = $1
                  and preparation_command_id = $2
                  and project_id = $3
                  and version_id = $4
                  and quote_id = $5
                  and customer_user_id = $6
                  and purpose_digest = $7
                  and checkout_session_id = $8
                  and provider_expires_at <= $9
                  and state = 'ready'
                returning preparation_command_id`,
              [
                preparation.tenantId,
                preparation.commandId,
                preparation.projectId,
                preparation.versionId,
                preparation.quoteId,
                preparation.customerId,
                preparation.purposeDigest,
                checkoutSessionId,
                now
              ]
            );
            invariant(
              expired.rowCount === 1,
              "repository_conflict",
              "the provider-confirmed expired Download Checkout was not closed durably",
              { status: 500 }
            );
          }
        )
      );
    },

    async completeDispatch(input, result) {
      const preparation = exactPreparation(input);
      const selected = exactDispatchResult(
        preparation,
        result
      );
      return translated(() =>
        database.service(
          {
            userId: preparation.customerId,
            organizationId: preparation.tenantId
          },
          async (client) => {
            const completed = await client.query(
              `update ss.commerce_v2_download_dispatches
                  set state = 'ready',
                      checkout_session_id = $3,
                      checkout_url = $4,
                      provider_expires_at = $5,
                      dispatched_at = $6,
                      result = $7::jsonb,
                      updated_at = greatest(
                        clock_timestamp(),
                        updated_at + interval '1 microsecond'
                      )
                where organization_id = $1
                  and preparation_command_id = $2
                  and state = 'dispatching'
                  and quote_id = $8
                  and project_id = $9
                  and version_id = $10
                  and customer_user_id = $11
                  and purpose_digest = $12
                returning preparation_command_id`,
              [
                preparation.tenantId,
                preparation.commandId,
                selected.checkoutSessionId,
                selected.checkoutUrl,
                selected.providerExpiresAt,
                selected.dispatchedAt,
                selected.snapshot,
                preparation.quoteId,
                preparation.projectId,
                preparation.versionId,
                preparation.customerId,
                preparation.purposeDigest
              ]
            );
            invariant(
              completed.rowCount === 1,
              "repository_conflict",
              "the Download dispatch did not complete durably",
              { status: 500 }
            );
          }
        )
      );
    },

    async markDispatchUnknown(input, code) {
      const preparation = exactPreparation(input);
      invariant(
        SAFE_CODE.test(code),
        "repository_conflict",
        "the Download provider error code is invalid",
        { status: 500 }
      );
      return translated(() =>
        database.service(
          {
            userId: preparation.customerId,
            organizationId: preparation.tenantId
          },
          async (client) => {
            const updated = await client.query(
              `update ss.commerce_v2_download_dispatches
                  set state = 'effect_unknown',
                      provider_error_code = $3,
                      updated_at = greatest(
                        clock_timestamp(),
                        updated_at + interval '1 microsecond'
                      )
                where organization_id = $1
                  and preparation_command_id = $2
                  and state = 'dispatching'
                returning preparation_command_id`,
              [
                preparation.tenantId,
                preparation.commandId,
                code
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the ambiguous Download effect was not held",
              { status: 500 }
            );
          }
        )
      );
    },

    async abandonDispatch(input) {
      const preparation = exactPreparation(input);
      return translated(() =>
        database.service(
          {
            userId: preparation.customerId,
            organizationId: preparation.tenantId
          },
          (client) =>
            client.query(
              `delete from ss.commerce_v2_download_dispatches
                where organization_id = $1
                  and preparation_command_id = $2
                  and state = 'dispatching'`,
              [
                preparation.tenantId,
                preparation.commandId
              ]
            )
        )
      );
    },

    async findDispatchByCheckout({
      checkoutSessionId
    } = {}) {
      if (!CHECKOUT_ID.test(String(checkoutSessionId ?? ""))) {
        return null;
      }
      return translated(() =>
        database.service(
          { readOnly: true },
          async (client) => {
            const result = await client.query(
              `select dispatch.*, prep.preparation
                 from ss.commerce_v2_download_dispatches dispatch
                 join ss.commerce_v2_checkout_preparations prep
                   on prep.organization_id =
                      dispatch.organization_id
                  and prep.command_id =
                      dispatch.preparation_command_id
                where dispatch.checkout_session_id = $1`,
              [checkoutSessionId]
            );
            if (result.rowCount !== 1) return null;
            const row = result.rows[0];
            return Object.freeze({
              commandId: row.preparation_command_id,
              tenantId: row.organization_id,
              customerId: row.customer_user_id,
              projectId: row.project_id,
              versionId: row.version_id,
              quoteId: row.quote_id,
              provider: row.provider,
              state: row.state,
              checkoutSessionId:
                row.checkout_session_id,
              purposeDigest: row.purpose_digest,
              purpose: clone(row.preparation.purpose)
            });
          }
        )
      );
    },

    async claimStripeEvent(input) {
      const event = Object.freeze({
        eventId: requiredText(
          input?.eventId,
          "event.eventId"
        ),
        eventType: requiredText(
          input?.eventType,
          "event.eventType"
        ),
        livemode: input?.livemode,
        providerCreatedAt: requiredIso(
          input?.providerCreatedAt,
          "event.providerCreatedAt"
        ),
        payloadDigest: requiredDigest(
          input?.payloadDigest,
          "event.payloadDigest"
        ),
        checkoutSessionId: requiredText(
          input?.checkoutSessionId,
          "event.checkoutSessionId"
        ),
        tenantId: exactUuid(
          input?.tenantId,
          "event.tenantId"
        ),
        projectId: exactUuid(
          input?.projectId,
          "event.projectId"
        )
      });
      invariant(
        EVENT_ID.test(event.eventId) &&
          event.eventType ===
            "checkout.session.completed" &&
          typeof event.livemode === "boolean" &&
          CHECKOUT_ID.test(event.checkoutSessionId),
        "stripe_event_invalid",
        "the Download Stripe event is invalid"
      );
      return translated(() =>
        database.service({}, async (client) => {
          const dispatch = await client.query(
            `select preparation_command_id
               from ss.commerce_v2_download_dispatches
              where organization_id = $1
                and project_id = $2
                and checkout_session_id = $3
                and state in ('ready', 'settled')`,
            [
              event.tenantId,
              event.projectId,
              event.checkoutSessionId
            ]
          );
          invariant(
            dispatch.rowCount === 1,
            "stripe_event_binding_invalid",
            "the Stripe event has no durable Download dispatch",
            { status: 400 }
          );
          const inserted = await client.query(
            `insert into ss.commerce_v2_download_stripe_events (
               id, organization_id, project_id,
               preparation_command_id,
               checkout_session_id, event_type,
               livemode, payload_digest,
               provider_created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9
             )
             on conflict (id) do nothing
             returning id`,
            [
              event.eventId,
              event.tenantId,
              event.projectId,
              dispatch.rows[0].preparation_command_id,
              event.checkoutSessionId,
              event.eventType,
              event.livemode,
              event.payloadDigest,
              event.providerCreatedAt
            ]
          );
          if (inserted.rowCount === 1) {
            return { status: "claimed" };
          }
          const existing = await client.query(
            `select *
               from ss.commerce_v2_download_stripe_events
              where id = $1
              for update`,
            [event.eventId]
          );
          const row = existing.rows[0];
          invariant(
            existing.rowCount === 1 &&
              row.organization_id === event.tenantId &&
              row.project_id === event.projectId &&
              row.checkout_session_id ===
                event.checkoutSessionId &&
              row.event_type === event.eventType &&
              row.livemode === event.livemode &&
              row.payload_digest === event.payloadDigest &&
              new Date(
                row.provider_created_at
              ).toISOString() === event.providerCreatedAt,
            "stripe_event_conflict",
            "the Stripe event ID was already used for different evidence",
            { status: 409 }
          );
          return row.state === "processed"
            ? {
                status: "replay",
                result: clone(row.result)
              }
            : { status: "pending" };
        })
      );
    },

    async settleStripeEvent(input) {
      const dispatch = input?.dispatch;
      const event = input?.event;
      const payment = input?.payment;
      const receiptId = exactUuid(
        input?.receiptId,
        "receiptId"
      );
      const entitlementId = exactUuid(
        input?.entitlementId,
        "entitlementId"
      );
      const settledAt = requiredIso(
        input?.settledAt,
        "settledAt"
      );
      invariant(
        dispatch &&
          CHECKOUT_ID.test(dispatch.checkoutSessionId) &&
          event &&
          EVENT_ID.test(event.eventId) &&
          payment?.checkoutSessionId ===
            dispatch.checkoutSessionId &&
          PAYMENT_INTENT_ID.test(
            payment.paymentIntentId
          ) &&
          STRIPE_CUSTOMER_ID.test(payment.customerId) &&
          payment.paymentStatus === "paid" &&
          payment.amountMinor === DOWNLOAD_PRICE_MINOR &&
          Number.isSafeInteger(payment.taxMinor) &&
          payment.taxMinor >= 0 &&
          Number.isSafeInteger(payment.totalMinor) &&
          payment.totalMinor ===
            DOWNLOAD_PRICE_MINOR + payment.taxMinor &&
          [
            "automatic",
            "disabled_by_owner"
          ].includes(payment.taxMode) &&
          (
            payment.taxMode === "automatic" ||
            payment.taxMinor === 0
          ) &&
          payment.currency === "USD" &&
          payment.purposeDigest ===
            dispatch.purposeDigest,
        "stripe_payment_invalid",
        "the Download payment facts are invalid",
        { status: 500 }
      );
      const tenantId = exactUuid(
        dispatch.purpose.tenantId,
        "dispatch.purpose.tenantId"
      );
      const customerId = exactUuid(
        dispatch.purpose.customerId,
        "dispatch.purpose.customerId"
      );
      const projectId = exactUuid(
        dispatch.purpose.projectId,
        "dispatch.purpose.projectId"
      );
      const versionId = exactUuid(
        dispatch.purpose.versionId,
        "dispatch.purpose.versionId"
      );
      const quoteId = exactUuid(
        dispatch.purpose.quoteId,
        "dispatch.purpose.quoteId"
      );
      const acceptedDisclosureDigest =
        requiredDigest(
          dispatch.purpose.acceptedDisclosureDigest,
          "dispatch.purpose.acceptedDisclosureDigest"
        );
      const facts = {
        schema: PAYMENT_RECEIPT_SCHEMA,
        receiptId,
        provider: "stripe",
        eventId: event.eventId,
        checkoutSessionId:
          dispatch.checkoutSessionId,
        paymentIntentId: payment.paymentIntentId,
        stripeCustomerId: payment.customerId,
        projectId,
        versionId,
        quoteId,
        purposeDigest: dispatch.purposeDigest,
        acceptedDisclosureDigest,
        payment: {
          status: "paid",
          provider: "stripe",
          receiptId,
          amountMinor: DOWNLOAD_PRICE_MINOR,
          taxMinor: payment.taxMinor,
          totalMinor: payment.totalMinor,
          taxMode: payment.taxMode,
          currency: "USD",
          settledAt
        },
        providerEvidence: clone(payment)
      };
      return translated(() =>
        database.service({}, async (client) => {
          const locked = await client.query(
            `select event.state as event_state,
                    event.result as event_result,
                    event.payload_digest,
                    dispatch.state as dispatch_state,
                    dispatch.checkout_session_id,
                    dispatch.project_id,
                    dispatch.version_id,
                    dispatch.quote_id,
                    dispatch.customer_user_id,
                    dispatch.purpose_digest
               from ss.commerce_v2_download_stripe_events event
               join ss.commerce_v2_download_dispatches dispatch
                 on dispatch.organization_id =
                    event.organization_id
                and dispatch.preparation_command_id =
                    event.preparation_command_id
                and dispatch.checkout_session_id =
                    event.checkout_session_id
              where event.id = $1
                and event.organization_id = $2
                and event.project_id = $3
              for update of event, dispatch`,
            [event.eventId, tenantId, projectId]
          );
          invariant(
            locked.rowCount === 1,
            "stripe_event_binding_invalid",
            "the Download payment event is unavailable",
            { status: 409 }
          );
          const row = locked.rows[0];
          if (row.event_state === "processed") {
            return clone(row.event_result);
          }
          invariant(
            row.event_state === "pending" &&
              row.dispatch_state === "ready" &&
              row.payload_digest === event.payloadDigest &&
              row.checkout_session_id ===
                dispatch.checkoutSessionId &&
              row.project_id === projectId &&
              row.version_id === versionId &&
              row.quote_id === quoteId &&
              row.customer_user_id === customerId &&
              row.purpose_digest ===
                dispatch.purposeDigest,
            "stripe_event_binding_invalid",
            "the Download payment evidence changed before settlement",
            { status: 409 }
          );
          const boundCustomer = await client.query(
            `select stripe_customer_id
               from ss.stripe_customers
              where organization_id = $1
              for update`,
            [tenantId]
          );
          if (boundCustomer.rowCount === 0) {
            await client.query(
              `insert into ss.stripe_customers (
                 organization_id,
                 stripe_customer_id,
                 created_from_receipt_id
               ) values ($1, $2, null)`,
              [
                tenantId,
                payment.customerId
              ]
            );
          } else {
            invariant(
              boundCustomer.rowCount === 1 &&
                boundCustomer.rows[0]
                  .stripe_customer_id ===
                  payment.customerId,
              "stripe_customer_binding_invalid",
              "the Download payment Customer does not match this organization",
              { status: 409 }
            );
          }
          await client.query(
            `insert into ss.commerce_v2_download_payment_receipts (
               id, organization_id, project_id,
               version_id, quote_id, customer_user_id,
               preparation_command_id, stripe_event_id,
               provider, checkout_session_id,
               payment_intent_id, stripe_customer_id,
               payment_status, amount_minor,
               tax_minor, total_minor, tax_mode,
               currency,
               purpose_digest,
               accepted_disclosure_digest,
               settled_at, facts
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               'stripe', $9, $10, $11,
               'paid', 2000, $12, $13, $14,
               'USD', $15, $16, $17,
               $18::jsonb
             )`,
            [
              receiptId,
              tenantId,
              projectId,
              versionId,
              quoteId,
              customerId,
              dispatch.commandId,
              event.eventId,
              dispatch.checkoutSessionId,
              payment.paymentIntentId,
              payment.customerId,
              payment.taxMinor,
              payment.totalMinor,
              payment.taxMode,
              dispatch.purposeDigest,
              acceptedDisclosureDigest,
              settledAt,
              JSON.stringify(facts)
            ]
          );
          await client.query(
            `insert into ss.commerce_v2_project_entitlements (
               id, organization_id, project_id,
               customer_user_id, kind, scope, state,
               source_receipt_id,
               accepted_disclosure_digest,
               activated_at, state_changed_at,
               state_reason, expires_at
             ) values (
               $1, $2, $3, $4,
               'spark_download', 'editor_project',
               'active', $5, $6, $7, $7,
               'payment_settled', null
             )`,
            [
              entitlementId,
              tenantId,
              projectId,
              customerId,
              receiptId,
              acceptedDisclosureDigest,
              settledAt
            ]
          );
          const result = {
            status: "processed",
            projectId,
            entitlementId
          };
          const dispatchUpdate = await client.query(
            `update ss.commerce_v2_download_dispatches
                set state = 'settled',
                    updated_at = greatest(
                      clock_timestamp(),
                      updated_at + interval '1 microsecond'
                    )
              where organization_id = $1
                and preparation_command_id = $2
                and state = 'ready'
              returning preparation_command_id`,
            [tenantId, dispatch.commandId]
          );
          const eventUpdate = await client.query(
            `update ss.commerce_v2_download_stripe_events
                set state = 'processed',
                    result = $2::jsonb,
                    completed_at = clock_timestamp()
              where id = $1
                and state = 'pending'
              returning id`,
            [event.eventId, JSON.stringify(result)]
          );
          invariant(
            dispatchUpdate.rowCount === 1 &&
              eventUpdate.rowCount === 1,
            "repository_conflict",
            "the Download payment did not settle durably",
            { status: 500 }
          );
          return result;
        })
      );
    },

    async applyEarlyFraudWarning(input) {
      const event = Object.freeze({
        eventId: requiredText(
          input?.event?.eventId,
          "event.eventId"
        ),
        eventType: requiredText(
          input?.event?.eventType,
          "event.eventType"
        ),
        livemode: input?.event?.livemode,
        providerCreatedAt: requiredIso(
          input?.event?.providerCreatedAt,
          "event.providerCreatedAt"
        ),
        payloadDigest: requiredDigest(
          input?.event?.payloadDigest,
          "event.payloadDigest"
        )
      });
      const receipt = Object.freeze({
        receiptId: exactUuid(
          input?.receipt?.receiptId,
          "receipt.receiptId"
        ),
        tenantId: exactUuid(
          input?.receipt?.tenantId,
          "receipt.tenantId"
        ),
        customerId: exactUuid(
          input?.receipt?.customerId,
          "receipt.customerId"
        ),
        projectId: exactUuid(
          input?.receipt?.projectId,
          "receipt.projectId"
        ),
        entitlementId: exactUuid(
          input?.receipt?.entitlementId,
          "receipt.entitlementId"
        ),
        paymentIntentId: requiredText(
          input?.receipt?.paymentIntentId,
          "receipt.paymentIntentId"
        )
      });
      const warning = Object.freeze({
        warningId: requiredText(
          input?.warning?.warningId,
          "warning.warningId"
        ),
        chargeId: requiredText(
          input?.warning?.chargeId,
          "warning.chargeId"
        ),
        paymentIntentId: requiredText(
          input?.warning?.paymentIntentId,
          "warning.paymentIntentId"
        ),
        actionable: input?.warning?.actionable,
        fraudType: requiredText(
          input?.warning?.fraudType,
          "warning.fraudType"
        )
      });
      invariant(
        EVENT_ID.test(event.eventId) &&
          [
            "radar.early_fraud_warning.created",
            "radar.early_fraud_warning.updated"
          ].includes(event.eventType) &&
          typeof event.livemode === "boolean" &&
          FRAUD_WARNING_ID.test(warning.warningId) &&
          CHARGE_ID.test(warning.chargeId) &&
          PAYMENT_INTENT_ID.test(
            warning.paymentIntentId
          ) &&
          warning.paymentIntentId ===
            receipt.paymentIntentId &&
          typeof warning.actionable === "boolean" &&
          /^[a-z_]{2,80}$/u.test(warning.fraudType),
        "stripe_fraud_warning_binding_invalid",
        "the Download early fraud warning evidence is invalid",
        { status: 400 }
      );
      return translated(() =>
        database.service({}, async (client) => {
          const locked = await client.query(
            `select receipt.id,
                    entitlement.state,
                    entitlement.state_reason
               from ss.commerce_v2_download_payment_receipts receipt
               join ss.commerce_v2_project_entitlements entitlement
                 on entitlement.organization_id = receipt.organization_id
                and entitlement.id = $4
                and entitlement.source_receipt_id = receipt.id
              where receipt.id = $1
                and receipt.organization_id = $2
                and receipt.project_id = $3
                and receipt.customer_user_id = $5
                and receipt.payment_intent_id = $6
              for update of entitlement`,
            [
              receipt.receiptId,
              receipt.tenantId,
              receipt.projectId,
              receipt.entitlementId,
              receipt.customerId,
              receipt.paymentIntentId
            ]
          );
          invariant(
            locked.rowCount === 1,
            "stripe_fraud_warning_binding_invalid",
            "the early fraud warning receipt changed",
            { status: 409 }
          );
          const priorState = locked.rows[0].state;
          const resultingState =
            warning.actionable && priorState === "active"
              ? "suspended"
              : priorState;
          const reason =
            resultingState === priorState
              ? locked.rows[0].state_reason
              : "early_fraud_warning_review";
          const result = {
            status: "processed",
            actionable: warning.actionable,
            projectId: receipt.projectId,
            entitlementId: receipt.entitlementId,
            entitlementState: resultingState,
            checkoutGate:
              warning.actionable ? "held" : "unchanged"
          };
          const inserted = await client.query(
            `insert into ss.commerce_v2_download_fraud_warning_events (
               id, organization_id, project_id, receipt_id,
               entitlement_id, warning_id, charge_id,
               payment_intent_id, event_type, actionable,
               fraud_type, livemode, payload_digest,
               provider_created_at, result, completed_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14,
               $15::jsonb, clock_timestamp()
             )
             on conflict (id) do nothing
             returning id`,
            [
              event.eventId,
              receipt.tenantId,
              receipt.projectId,
              receipt.receiptId,
              receipt.entitlementId,
              warning.warningId,
              warning.chargeId,
              warning.paymentIntentId,
              event.eventType,
              warning.actionable,
              warning.fraudType,
              event.livemode,
              event.payloadDigest,
              event.providerCreatedAt,
              JSON.stringify(result)
            ]
          );
          if (inserted.rowCount === 0) {
            const replay = await client.query(
              `select result
                 from ss.commerce_v2_download_fraud_warning_events
                where id = $1
                  and organization_id = $2
                  and receipt_id = $3
                  and payload_digest = $4`,
              [
                event.eventId,
                receipt.tenantId,
                receipt.receiptId,
                event.payloadDigest
              ]
            );
            invariant(
              replay.rowCount === 1,
              "stripe_event_conflict",
              "the early fraud warning event ID conflicts with different evidence",
              { status: 409 }
            );
            return clone(replay.rows[0].result);
          }
          if (resultingState !== priorState) {
            const updated = await client.query(
              `update ss.commerce_v2_project_entitlements
                  set state = 'suspended',
                      state_changed_at = greatest(
                        state_changed_at + interval '1 microsecond',
                        $3::timestamptz
                      ),
                      state_reason = $4
                where organization_id = $1
                  and id = $2
                  and state = $5
                returning id`,
              [
                receipt.tenantId,
                receipt.entitlementId,
                event.providerCreatedAt,
                reason,
                priorState
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the early fraud warning suspension did not settle durably",
              { status: 500 }
            );
          }
          if (warning.actionable) {
            await holdDownloadCheckoutGate(client, {
              signalType: event.eventType,
              signalId: event.eventId,
              evidenceDigest: event.payloadDigest,
              reason:
                "stripe_actionable_early_fraud_warning",
              changedAt: event.providerCreatedAt
            });
            await storeDownloadDisputeDossier(client, {
              receiptId: receipt.receiptId,
              tenantId: receipt.tenantId,
              projectId: receipt.projectId,
              entitlementId: receipt.entitlementId,
              triggerEventId: event.eventId,
              triggerType: event.eventType,
              providerCreatedAt:
                event.providerCreatedAt,
              payloadDigest: event.payloadDigest
            });
          }
          return result;
        })
      );
    },

    async applyPaymentReversal(input) {
      const event = Object.freeze({
        eventId: requiredText(
          input?.event?.eventId,
          "event.eventId"
        ),
        eventType: requiredText(
          input?.event?.eventType,
          "event.eventType"
        ),
        livemode: input?.event?.livemode,
        providerCreatedAt: requiredIso(
          input?.event?.providerCreatedAt,
          "event.providerCreatedAt"
        ),
        payloadDigest: requiredDigest(
          input?.event?.payloadDigest,
          "event.payloadDigest"
        )
      });
      const receipt = Object.freeze({
        receiptId: exactUuid(
          input?.receipt?.receiptId,
          "receipt.receiptId"
        ),
        tenantId: exactUuid(
          input?.receipt?.tenantId,
          "receipt.tenantId"
        ),
        customerId: exactUuid(
          input?.receipt?.customerId,
          "receipt.customerId"
        ),
        projectId: exactUuid(
          input?.receipt?.projectId,
          "receipt.projectId"
        ),
        entitlementId: exactUuid(
          input?.receipt?.entitlementId,
          "receipt.entitlementId"
        ),
        paymentIntentId: requiredText(
          input?.receipt?.paymentIntentId,
          "receipt.paymentIntentId"
        ),
        totalMinor: input?.receipt?.totalMinor,
        currency: input?.receipt?.currency
      });
      const decision = Object.freeze({
        paymentIntentId: requiredText(
          input?.decision?.paymentIntentId,
          "decision.paymentIntentId"
        ),
        providerObjectId: requiredText(
          input?.decision?.providerObjectId,
          "decision.providerObjectId"
        ),
        amountMinor: input?.decision?.amountMinor,
        providerStatus: requiredText(
          input?.decision?.providerStatus,
          "decision.providerStatus"
        ),
        targetState: requiredText(
          input?.decision?.targetState,
          "decision.targetState"
        ),
        reason: requiredText(
          input?.decision?.reason,
          "decision.reason"
        )
      });
      invariant(
        EVENT_ID.test(event.eventId) &&
          REVERSAL_EVENT_TYPES.has(event.eventType) &&
          typeof event.livemode === "boolean" &&
          PAYMENT_INTENT_ID.test(
            receipt.paymentIntentId
          ) &&
          decision.paymentIntentId ===
            receipt.paymentIntentId &&
          REVERSAL_OBJECT_ID.test(
            decision.providerObjectId
          ) &&
          Number.isSafeInteger(receipt.totalMinor) &&
          receipt.totalMinor >= DOWNLOAD_PRICE_MINOR &&
          receipt.currency === "USD" &&
          Number.isSafeInteger(decision.amountMinor) &&
          decision.amountMinor > 0 &&
          decision.amountMinor <= 99_999_999 &&
          ["suspended", "revoked"].includes(
            decision.targetState
          ) &&
          SAFE_CODE.test(decision.providerStatus) &&
          SAFE_CODE.test(decision.reason),
        "stripe_reversal_binding_invalid",
        "the Download reversal evidence is invalid",
        { status: 400 }
      );
      return translated(() =>
        database.service({}, async (client) => {
          const locked = await client.query(
            `select receipt.id as receipt_id,
                    receipt.organization_id,
                    receipt.project_id,
                    receipt.customer_user_id,
                    receipt.payment_intent_id,
                    receipt.total_minor,
                    receipt.currency,
                    entitlement.id as entitlement_id,
                    entitlement.state as entitlement_state,
                    entitlement.state_changed_at,
                    entitlement.state_reason
               from ss.commerce_v2_download_payment_receipts receipt
               join ss.commerce_v2_project_entitlements entitlement
                 on entitlement.organization_id =
                    receipt.organization_id
                and entitlement.source_receipt_id =
                    receipt.id
              where receipt.id = $1
                and receipt.organization_id = $2
                and receipt.project_id = $3
                and receipt.payment_intent_id = $4
              for update of entitlement`,
            [
              receipt.receiptId,
              receipt.tenantId,
              receipt.projectId,
              receipt.paymentIntentId
            ]
          );
          invariant(
            locked.rowCount === 1 &&
              locked.rows[0].customer_user_id ===
                receipt.customerId &&
              locked.rows[0].entitlement_id ===
                receipt.entitlementId &&
              Number(locked.rows[0].total_minor) ===
                receipt.totalMinor &&
              locked.rows[0].currency ===
                receipt.currency,
            "stripe_reversal_binding_invalid",
            "the Download reversal receipt changed",
            { status: 409 }
          );
          const row = locked.rows[0];
          const priorState = row.entitlement_state;
          invariant(
            Object.hasOwn(
              ENTITLEMENT_SEVERITY,
              priorState
            ),
            "repository_conflict",
            "the Download entitlement state is invalid",
            { status: 500 }
          );
          const resultingState =
            ENTITLEMENT_SEVERITY[
              decision.targetState
            ] > ENTITLEMENT_SEVERITY[priorState]
              ? decision.targetState
              : priorState;
          const resultingReason =
            resultingState === priorState
              ? row.state_reason
              : decision.reason;
          const result = {
            status: "processed",
            projectId: receipt.projectId,
            entitlementId: receipt.entitlementId,
            entitlementState: resultingState,
            reason: resultingReason
          };
          const inserted = await client.query(
            `insert into ss.commerce_v2_download_reversal_events (
               id, organization_id, project_id,
               receipt_id, entitlement_id,
               payment_intent_id, event_type,
               provider_object_id, livemode,
               payload_digest, provider_created_at,
               amount_minor, provider_status,
               target_state, reason, prior_state,
               prior_reason, resulting_state, result,
               completed_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19::jsonb,
               clock_timestamp()
             )
             on conflict (id) do nothing
             returning id`,
            [
              event.eventId,
              receipt.tenantId,
              receipt.projectId,
              receipt.receiptId,
              receipt.entitlementId,
              receipt.paymentIntentId,
              event.eventType,
              decision.providerObjectId,
              event.livemode,
              event.payloadDigest,
              event.providerCreatedAt,
              decision.amountMinor,
              decision.providerStatus,
              decision.targetState,
              decision.reason,
              priorState,
              row.state_reason,
              resultingState,
              JSON.stringify(result)
            ]
          );
          if (inserted.rowCount === 0) {
            const existing = await client.query(
              `select *
                 from ss.commerce_v2_download_reversal_events
                where id = $1`,
              [event.eventId]
            );
            const recorded = existing.rows[0];
            invariant(
              existing.rowCount === 1 &&
                recorded.organization_id ===
                  receipt.tenantId &&
                recorded.project_id ===
                  receipt.projectId &&
                recorded.receipt_id ===
                  receipt.receiptId &&
                recorded.entitlement_id ===
                  receipt.entitlementId &&
                recorded.payment_intent_id ===
                  receipt.paymentIntentId &&
                recorded.event_type ===
                  event.eventType &&
                recorded.provider_object_id ===
                  decision.providerObjectId &&
                recorded.livemode === event.livemode &&
                recorded.payload_digest ===
                  event.payloadDigest &&
                new Date(
                  recorded.provider_created_at
                ).toISOString() ===
                  event.providerCreatedAt,
              "stripe_event_conflict",
              "the Stripe reversal event ID was already used for different evidence",
              { status: 409 }
            );
            return clone(recorded.result);
          }
          if (resultingState !== priorState) {
            const updated = await client.query(
              `update ss.commerce_v2_project_entitlements
                  set state = $3,
                      state_changed_at = greatest(
                        state_changed_at +
                          interval '1 microsecond',
                        $4::timestamptz
                      ),
                      state_reason = $5
                where organization_id = $1
                  and id = $2
                  and state = $6
                returning id`,
              [
                receipt.tenantId,
                receipt.entitlementId,
                resultingState,
                event.providerCreatedAt,
                resultingReason,
                priorState
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the Download entitlement reversal did not settle durably",
              { status: 500 }
            );
          }
          if (event.eventType === "charge.dispute.created") {
            await holdDownloadCheckoutGate(client, {
              signalType: event.eventType,
              signalId: event.eventId,
              evidenceDigest: event.payloadDigest,
              reason: "stripe_download_dispute_created",
              changedAt: event.providerCreatedAt
            });
          }
          if (event.eventType.startsWith("charge.dispute.")) {
            await storeDownloadDisputeDossier(client, {
              receiptId: receipt.receiptId,
              tenantId: receipt.tenantId,
              projectId: receipt.projectId,
              entitlementId: receipt.entitlementId,
              triggerEventId: event.eventId,
              triggerType: event.eventType,
              providerCreatedAt:
                event.providerCreatedAt,
              payloadDigest: event.payloadDigest
            });
          }
          return result;
        })
      );
    },

    async recordDownloadAccess(input) {
      const evidence = Object.freeze({
        tenantId: exactUuid(input?.tenantId, "tenantId"),
        customerId: exactUuid(
          input?.customerId,
          "customerId"
        ),
        projectId: exactUuid(
          input?.projectId,
          "projectId"
        ),
        versionId: exactUuid(
          input?.versionId,
          "versionId"
        ),
        entitlementId: exactUuid(
          input?.entitlementId,
          "entitlementId"
        ),
        receiptId: exactUuid(
          input?.receiptId,
          "receiptId"
        ),
        artifactDigest: requiredDigest(
          input?.artifactDigest,
          "artifactDigest"
        ),
        byteCount: input?.byteCount,
        requestId: requiredText(
          input?.requestId,
          "requestId"
        ),
        clientAddress: requiredText(
          input?.clientAddress,
          "clientAddress",
          80
        ),
        userAgentDigest: requiredDigest(
          input?.userAgentDigest,
          "userAgentDigest"
        ),
        state: input?.state,
        responseIssuedAt: requiredIso(
          input?.responseIssuedAt,
          "responseIssuedAt"
        )
      });
      invariant(
        Number.isSafeInteger(evidence.byteCount) &&
          evidence.byteCount > 0 &&
          evidence.state === "response_issued",
        "repository_conflict",
        "the Download access evidence is invalid",
        { status: 500 }
      );
      return translated(() =>
        database.service(
          {
            userId: evidence.customerId,
            organizationId: evidence.tenantId
          },
          async (client) => {
            const inserted = await client.query(
              `insert into ss.commerce_v2_download_access_events (
                 organization_id, project_id, version_id,
                 customer_user_id, entitlement_id, receipt_id,
                 artifact_digest, byte_count, request_id,
                 client_address, user_agent_digest, state,
                 response_issued_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12, $13
               )
               on conflict (request_id) do nothing
               returning id`,
              [
                evidence.tenantId,
                evidence.projectId,
                evidence.versionId,
                evidence.customerId,
                evidence.entitlementId,
                evidence.receiptId,
                evidence.artifactDigest,
                evidence.byteCount,
                evidence.requestId,
                evidence.clientAddress,
                evidence.userAgentDigest,
                evidence.state,
                evidence.responseIssuedAt
              ]
            );
            if (inserted.rowCount === 0) {
              const replay = await client.query(
                `select *
                   from ss.commerce_v2_download_access_events
                  where request_id = $1`,
                [evidence.requestId]
              );
              const row = replay.rows[0];
              invariant(
                replay.rowCount === 1 &&
                  row.organization_id === evidence.tenantId &&
                  row.project_id === evidence.projectId &&
                  row.version_id === evidence.versionId &&
                  row.customer_user_id === evidence.customerId &&
                  row.entitlement_id === evidence.entitlementId &&
                  row.receipt_id === evidence.receiptId &&
                  row.artifact_digest === evidence.artifactDigest &&
                  Number(row.byte_count) === evidence.byteCount &&
                  row.client_address === evidence.clientAddress &&
                  row.user_agent_digest === evidence.userAgentDigest &&
                  row.state === evidence.state &&
                  new Date(row.response_issued_at).toISOString() ===
                    evidence.responseIssuedAt,
                "repository_conflict",
                "the Download access request ID conflicts with different evidence",
                { status: 409 }
              );
              return Object.freeze({
                recorded: true,
                replay: true,
                accessEventId: row.id
              });
            }
            return Object.freeze({
              recorded: true,
              replay: false,
              accessEventId: inserted.rows[0].id
            });
          }
        )
      );
    },

    async resolveDownloadArtifact(input) {
      if (
        !UUID.test(String(input?.tenantId ?? "")) ||
        !UUID.test(String(input?.customerId ?? "")) ||
        !UUID.test(String(input?.projectId ?? "")) ||
        !UUID.test(String(input?.versionId ?? ""))
      ) {
        return null;
      }
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `select
                 entitlement.id as entitlement_id,
                 entitlement.organization_id,
                 entitlement.project_id,
                 entitlement.accepted_disclosure_digest,
                 entitlement.activated_at,
                 receipt.id as receipt_id,
                 receipt.tax_minor,
                 receipt.total_minor,
                 receipt.tax_mode,
                 receipt.settled_at,
                 version.project_id as version_project_id,
                 artifact.artifact_digest,
                 artifact.html_bytes
               from ss.commerce_v2_project_entitlements entitlement
               join ss.commerce_v2_download_payment_receipts receipt
                 on receipt.organization_id =
                    entitlement.organization_id
                and receipt.id = entitlement.source_receipt_id
               join ss.projects project
                 on project.organization_id =
                    entitlement.organization_id
                and project.id = entitlement.project_id
                and project.lifecycle = 'active'
               join ss.organizations organization
                 on organization.id = project.organization_id
                and organization.state = 'active'
               join ss.organization_memberships membership
                 on membership.organization_id =
                    project.organization_id
                and membership.user_id = $3
                and membership.state = 'active'
                and membership.role = any($5::text[])
               join ss.site_versions version
                 on version.organization_id =
                    project.organization_id
                and version.project_id = project.id
                and version.id = $4
               join ss.version_state_projection state
                 on state.organization_id =
                    version.organization_id
                and state.project_id = version.project_id
                and state.version_id = version.id
                and state.state = 'accepted_release'
               join ss.artifacts artifact
                 on artifact.organization_id =
                    version.organization_id
                and artifact.project_id = version.project_id
                and artifact.id = version.artifact_id
              where entitlement.organization_id = $1
                and entitlement.project_id = $2
                and entitlement.kind = 'spark_download'
                and entitlement.scope = 'editor_project'
                and entitlement.state = 'active'`,
              [
                input.tenantId,
                input.projectId,
                input.customerId,
                input.versionId,
                PROJECT_ROLES
              ]
            );
            if (result.rowCount !== 1) return null;
            const row = result.rows[0];
            return Object.freeze({
              entitlement: publicEntitlement(
                row,
                input.customerId
              ),
              versionProjectId:
                row.version_project_id,
              htmlBytes: Buffer.from(row.html_bytes),
              artifactDigest: row.artifact_digest
            });
          }
        )
      );
    }
  });
}
