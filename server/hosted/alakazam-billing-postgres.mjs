import {
  CommerceV2Error,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";
import {
  exactAlakazamBillingScope
} from "./alakazam-billing-invoice.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ROLES = Object.freeze([
  "owner",
  "admin",
  "editor"
]);
const DATABASE_CONSTRAINT_CODES = new Set([
  "23502",
  "23503",
  "23505",
  "23514",
  "23P01"
]);

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam repository rejected inconsistent evidence",
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
    authority && typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactDatabaseIso(value, field) {
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    field
  );
}

function nullableDatabaseIso(value, field) {
  return value === null || value === undefined
    ? null
    : exactDatabaseIso(value, field);
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

function exactInvoiceInput(value) {
  const scope = exactAlakazamBillingScope(
    {
      actorId: value?.actorId,
      customerId: value?.customerId,
      projectId: value?.projectId,
      tenantId: value?.tenantId
    },
    "the Alakazam invoice input"
  );
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(
          [
            "actorId",
            "customerId",
            "projectId",
            "receiptId",
            "tenantId"
          ].sort()
        ),
    "invalid_input",
    "the Alakazam invoice input is invalid"
  );
  return Object.freeze({
    ...scope,
    receiptId: exactUuid(value.receiptId, "receiptId")
  });
}

/**
 * The same project guard the Alakazam account read uses: an active
 * organization, an active membership in a project role, an active project,
 * and no other customer holding this project's billing.
 */
async function requireBillingProject(client, input) {
  const project = await client.query(
    `select
       project.id,
       not exists (
         select 1
           from ss.alakazam_subscriptions subscription
          where subscription.organization_id = $1
            and subscription.project_id = $2
            and subscription.status <> 'ended'
            and subscription.customer_user_id <> $3
       ) as billing_owner_available
     from ss.projects project
     join ss.organizations organization
       on organization.id = project.organization_id
      and organization.state = 'active'
     join ss.organization_memberships membership
       on membership.organization_id =
          project.organization_id
      and membership.user_id = $3
      and membership.state = 'active'
      and membership.role = any($4::text[])
    where project.organization_id = $1
      and project.id = $2
      and project.lifecycle = 'active'`,
    [
      input.tenantId,
      input.projectId,
      input.customerId,
      PROJECT_ROLES
    ]
  );
  invariant(
    project.rowCount === 1 &&
      project.rows[0].billing_owner_available === true,
    "project_unavailable",
    "the customer billing project is unavailable",
    { status: 404 }
  );
}

export function createPostgresAlakazamBillingRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    /**
     * A-03. Reads one settled Alakazam receipt, bound to the signed-in
     * customer's own organization, project, and customer identity. A receipt
     * belonging to any other customer or project simply does not match, so
     * the caller receives the same "unavailable" answer as a missing one.
     */
    async readCustomerInvoice(value) {
      const input = exactInvoiceInput(value);
      return translated(() =>
        database.service(
          {
            userId: input.actorId,
            organizationId: input.tenantId,
            readOnly: true
          },
          async (client) => {
            await requireBillingProject(client, input);

            const receipts = await client.query(
              `select
                 receipt.id,
                 receipt.receipt_kind,
                 receipt.list_subtotal_minor,
                 receipt.provider_discount_minor,
                 receipt.net_subtotal_minor,
                 receipt.tax_minor,
                 receipt.total_minor,
                 receipt.tax_mode,
                 receipt.currency,
                 receipt.settled_at,
                 receipt.provider_facts_digest,
                 receipt.stripe_invoice_id is not null
                   as provider_invoice_recorded,
                 quote.target_tier_id
               from ss.alakazam_payment_receipts receipt
               left join ss.alakazam_change_quotes quote
                 on quote.organization_id =
                    receipt.organization_id
                and quote.id = receipt.quote_id
              where receipt.organization_id = $1
                and receipt.project_id = $2
                and receipt.customer_user_id = $3
                and receipt.id = $4`,
              [
                input.tenantId,
                input.projectId,
                input.customerId,
                input.receiptId
              ]
            );
            invariant(
              receipts.rowCount <= 1,
              "repository_conflict",
              "the customer Alakazam receipt is ambiguous",
              { status: 500 }
            );
            if (receipts.rowCount === 0) return null;
            const row = receipts.rows[0];
            return Object.freeze({
              projectId: input.projectId,
              receiptId: exactUuid(
                row.id,
                "invoice.receiptId"
              ),
              kind: requiredText(
                row.receipt_kind,
                "invoice.kind",
                50
              ),
              tierId:
                row.target_tier_id === null
                  ? null
                  : requiredText(
                      row.target_tier_id,
                      "invoice.tierId",
                      100
                    ),
              subtotalMinor: exactDatabaseInteger(
                row.list_subtotal_minor,
                "invoice.subtotalMinor"
              ),
              discountMinor: exactDatabaseInteger(
                row.provider_discount_minor,
                "invoice.discountMinor"
              ),
              netSubtotalMinor: exactDatabaseInteger(
                row.net_subtotal_minor,
                "invoice.netSubtotalMinor"
              ),
              taxMinor: exactDatabaseInteger(
                row.tax_minor,
                "invoice.taxMinor"
              ),
              totalMinor: exactDatabaseInteger(
                row.total_minor,
                "invoice.totalMinor"
              ),
              taxMode: requiredText(
                row.tax_mode,
                "invoice.taxMode",
                50
              ),
              currency: requiredText(
                row.currency,
                "invoice.currency",
                3
              ),
              settledAt: exactDatabaseIso(
                row.settled_at,
                "invoice.settledAt"
              ),
              settlementDigest: requiredDigest(
                row.provider_facts_digest,
                "invoice.settlementDigest"
              ),
              providerInvoiceRecorded:
                row.provider_invoice_recorded === true
            });
          }
        )
      );
    },

    /**
     * E-09. Reads the retry, replay, and reconciliation truth for one
     * customer's Alakazam billing in a single read-only transaction, so the
     * counts, the subscription revision, and the observation time are
     * mutually consistent rather than stitched from separate moments.
     */
    async readCustomerBillingStates(value) {
      const input = exactAlakazamBillingScope(
        value,
        "the Alakazam billing states input"
      );
      return translated(() =>
        database.service(
          {
            userId: input.actorId,
            organizationId: input.tenantId,
            readOnly: true
          },
          async (client) => {
            await requireBillingProject(client, input);

            const observed = await client.query(
              "select now() as observed_at"
            );
            const subscriptions = await client.query(
              `select
                 subscription.status,
                 subscription.revision,
                 subscription.first_failed_at,
                 subscription.grace_ends_at,
                 subscription.provider_observed_at,
                 subscription.updated_at
               from ss.alakazam_subscriptions subscription
              where subscription.organization_id = $1
                and subscription.project_id = $2
                and subscription.customer_user_id = $3
              order by
                (subscription.status <> 'ended') desc,
                subscription.created_at desc,
                subscription.id desc
              limit 1`,
              [
                input.tenantId,
                input.projectId,
                input.customerId
              ]
            );
            const events = await client.query(
              `select
                 count(*) as total,
                 count(*) filter (
                   where event.state in (
                     'received', 'processing', 'failed'
                   )
                 ) as outstanding,
                 count(*) filter (
                   where event.state = 'failed'
                 ) as failed,
                 coalesce(
                   max(event.attempt_count), 0
                 ) as maximum_attempt_count,
                 max(event.occurred_at) as last_occurred_at,
                 max(event.processed_at) as last_processed_at
               from ss.alakazam_stripe_events event
              where event.organization_id = $1
                and event.project_id = $2`,
              [input.tenantId, input.projectId]
            );
            const reconciliation = await client.query(
              `select
                 (
                   select min(quote.updated_at)
                     from ss.alakazam_change_quotes quote
                    where quote.organization_id = $1
                      and quote.project_id = $2
                      and quote.customer_user_id = $3
                      and quote.state =
                          'reconciliation_required'
                 ) as change_since,
                 (
                   select min(schedule.updated_at)
                     from ss.alakazam_downgrade_schedules
                          schedule
                    where schedule.organization_id = $1
                      and schedule.project_id = $2
                      and schedule.state =
                          'reconciliation_required'
                 ) as schedule_since`,
              [
                input.tenantId,
                input.projectId,
                input.customerId
              ]
            );

            const subscriptionRow =
              subscriptions.rows[0] ?? null;
            const eventRow = events.rows[0];
            const reconciliationRow =
              reconciliation.rows[0];
            const changeSince = nullableDatabaseIso(
              reconciliationRow.change_since,
              "reconciliation.changeSince"
            );
            const scheduleSince = nullableDatabaseIso(
              reconciliationRow.schedule_since,
              "reconciliation.scheduleSince"
            );
            return Object.freeze({
              projectId: input.projectId,
              observedAt: exactDatabaseIso(
                observed.rows[0].observed_at,
                "billingStates.observedAt"
              ),
              subscription: subscriptionRow === null
                ? null
                : Object.freeze({
                    status: requiredText(
                      subscriptionRow.status,
                      "subscription.status",
                      50
                    ),
                    revision: exactDatabaseInteger(
                      subscriptionRow.revision,
                      "subscription.revision"
                    ),
                    firstFailedAt: nullableDatabaseIso(
                      subscriptionRow.first_failed_at,
                      "subscription.firstFailedAt"
                    ),
                    graceEndsAt: nullableDatabaseIso(
                      subscriptionRow.grace_ends_at,
                      "subscription.graceEndsAt"
                    ),
                    providerObservedAt: exactDatabaseIso(
                      subscriptionRow.provider_observed_at,
                      "subscription.providerObservedAt"
                    ),
                    updatedAt: exactDatabaseIso(
                      subscriptionRow.updated_at,
                      "subscription.updatedAt"
                    )
                  }),
              events: Object.freeze({
                total: exactDatabaseInteger(
                  eventRow.total,
                  "events.total"
                ),
                outstanding: exactDatabaseInteger(
                  eventRow.outstanding,
                  "events.outstanding"
                ),
                failed: exactDatabaseInteger(
                  eventRow.failed,
                  "events.failed"
                ),
                maximumAttemptCount: exactDatabaseInteger(
                  eventRow.maximum_attempt_count,
                  "events.maximumAttemptCount"
                ),
                lastOccurredAt: nullableDatabaseIso(
                  eventRow.last_occurred_at,
                  "events.lastOccurredAt"
                ),
                lastProcessedAt: nullableDatabaseIso(
                  eventRow.last_processed_at,
                  "events.lastProcessedAt"
                )
              }),
              reconciliation: Object.freeze(
                changeSince === null &&
                  scheduleSince === null
                  ? { kind: null, since: null }
                  : scheduleSince === null ||
                      (
                        changeSince !== null &&
                        Date.parse(changeSince) <=
                          Date.parse(scheduleSince)
                      )
                    ? {
                        kind: "tier_change",
                        since: changeSince
                      }
                    : {
                        kind: "downgrade_schedule",
                        since: scheduleSince
                      }
              )
            });
          }
        )
      );
    }
  });
}
