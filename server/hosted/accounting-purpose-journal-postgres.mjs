import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function authority(value) {
  invariant(
    value && typeof value.service === "function",
    "ACCOUNTING_PURPOSE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for the accounting journal.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "ACCOUNTING_PURPOSE_UNAVAILABLE",
      "The accounting purpose journal is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "ACCOUNTING_PURPOSE_RETRY_REQUIRED",
      "The journal changed; refresh and retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "ACCOUNTING_PURPOSE_REPOSITORY_CONFLICT",
      "The journal rejected inconsistent source evidence.",
      { status: 409 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translatedError(error);
  }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function actor(input) {
  return {
    actorKind: "operator",
    userId: input.actorId,
    organizationId: input.operatorOrganizationId,
    isolation: "serializable",
    readOnly: true
  };
}

async function requireCapability(client, actorId) {
  const result = await client.query(
    `select ss.service_operator_has_capability(
       $1, 'service_management_manage', clock_timestamp()
     ) as allowed`,
    [actorId]
  );
  invariant(
    result.rows[0]?.allowed === true,
    "ACCOUNTING_PURPOSE_UNAVAILABLE",
    "The accounting purpose journal is unavailable.",
    { status: 404 }
  );
}

function entry(row) {
  return deepFreeze({
    schema: "sitesourcery.accounting-purpose-journal-entry/v1",
    idempotencyDigest: row.idempotency_digest,
    source: {
      relation: row.source_relation,
      receiptId: row.source_receipt_id
    },
    organizationId: row.organization_id,
    projectId: row.project_id,
    purpose: row.purpose,
    money: {
      currency: row.currency,
      chargedAmountMinor: String(row.charged_amount_minor),
      tax: {
        state: row.tax_evidence_state,
        minor: row.tax_minor === null ? null : String(row.tax_minor),
        mode: row.tax_mode
      },
      fee: {
        state: row.fee_evidence_state,
        minor: row.fee_minor === null ? null : String(row.fee_minor)
      },
      payoutAging: {
        state: row.payout_aging_state,
        availableAt: row.payout_available_at === null
          ? null
          : iso(row.payout_available_at)
      }
    },
    evidenceDigests: structuredClone(row.evidence_digests),
    occurredAt: iso(row.occurred_at),
    projectedAt: iso(row.projected_at),
    entryDigest: row.entry_digest
  });
}

const SELECT_COLUMNS = `
  idempotency_digest, source_relation, source_receipt_id,
  organization_id, project_id, purpose, charged_amount_minor,
  tax_minor, tax_mode, tax_evidence_state, fee_minor,
  fee_evidence_state, payout_available_at, payout_aging_state,
  currency, evidence_digests, occurred_at, projected_at, entry_digest`;

export function createPostgresAccountingPurposeJournalRepository({
  authority: input
} = {}) {
  const database = authority(input);
  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_accounting_purpose_journal_contract_v1()'
              ) is not null
                and ss.hosted_accounting_purpose_journal_contract_v1() =
                  'canonical-accounting-purpose-journal-v1-projection-only-held'
                as contract_ready,
              c.relrowsecurity and c.relforcerowsecurity as rls_ready,
              not has_table_privilege(
                'service_role', 'ss.accounting_purpose_journal',
                'INSERT,UPDATE,DELETE'
              ) as direct_mutation_denied
            from pg_class c
            where c.oid = 'ss.accounting_purpose_journal'::regclass
          `)
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.rls_ready === true && row.direct_mutation_denied === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "accounting-purpose-journal-postgres",
          code: ready ? null : "ACCOUNTING_PURPOSE_NOT_MIGRATED",
          sourceAuthoritative: false,
          authoritativeAccounting: false,
          commercialEffects: false,
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "accounting-purpose-journal-postgres",
          code: "ACCOUNTING_PURPOSE_DATABASE_UNAVAILABLE",
          sourceAuthoritative: false,
          authoritativeAccounting: false,
          commercialEffects: false,
          providerEffects: false
        });
      }
    },

    synchronize() {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const result = await client.query(
            "select * from ss.project_accounting_purpose_journal_v1()"
          );
          const row = result.rows[0];
          return deepFreeze({
            schema: "sitesourcery.accounting-purpose-journal-sync/v1",
            sourceCount: Number(row.source_count),
            insertedCount: Number(row.inserted_count),
            journalCount: Number(row.journal_count),
            sourceAuthoritative: false,
            providerEffects: false
          });
        }
      ));
    },

    list(input) {
      return translated(() => database.service(
        actor(input),
        async (client) => {
          await requireCapability(client, input.actorId);
          const values = input.cursor === null
            ? [input.limit + 1]
            : [
                input.cursor.occurredAt,
                input.cursor.idempotencyDigest,
                input.limit + 1
              ];
          const selected = await client.query(
            `select ${SELECT_COLUMNS}
               from ss.accounting_purpose_journal
              ${input.cursor === null ? "" : `where (occurred_at, idempotency_digest) >
                ($1::timestamptz, $2::ss.sha256_hex)`}
              order by occurred_at, idempotency_digest
              limit $${values.length}`,
            values
          );
          const hasMore = selected.rows.length > input.limit;
          const rows = selected.rows.slice(0, input.limit);
          const last = rows.at(-1);
          return deepFreeze({
            schema: "sitesourcery.accounting-purpose-journal/v1",
            sourceAuthoritative: false,
            authoritativeAccounting: false,
            providerEffects: false,
            entries: rows.map(entry),
            nextCursor: hasMore ? {
              occurredAt: iso(last.occurred_at),
              idempotencyDigest: last.idempotency_digest
            } : null
          });
        }
      ));
    },

    exportRows(input) {
      return translated(() => database.service(
        actor(input),
        async (client) => {
          await requireCapability(client, input.actorId);
          const selected = await client.query(
            `select ${SELECT_COLUMNS}
               from ss.accounting_purpose_journal
              where projected_at <= $1::timestamptz
              order by occurred_at, idempotency_digest
              limit 1001`,
            [input.asOf]
          );
          invariant(
            selected.rows.length <= 1000,
            "ACCOUNTING_PURPOSE_EXPORT_TOO_LARGE",
            "The bounded accounting export exceeds 1000 rows.",
            { status: 409 }
          );
          return deepFreeze(selected.rows.map(entry));
        }
      ));
    }
  });
}
