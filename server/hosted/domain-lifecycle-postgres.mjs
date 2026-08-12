import { randomUUID as systemRandomUUID } from "node:crypto";

import {
  digest,
  normalizeDomain,
  requiredString
} from "../domain/canonical.mjs";
import { invariant } from "../domain/errors.mjs";
import { DOMAIN_PROVIDER_LIFECYCLE_SCHEMA } from
  "../domain/provider-lifecycle.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROVIDER_CODE = /^[a-z][a-z0-9_-]{1,63}$/u;

function uuid(value, field) {
  const selected = String(value ?? "");
  invariant(UUID.test(selected), "invalid_lifecycle_scope", `${field} is invalid`, {
    status: 400
  });
  return selected;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "invalid_lifecycle_evidence",
    `${field} is invalid`,
    { status: 409 }
  );
  return value;
}

function instant(value, field) {
  const milliseconds = Date.parse(value ?? "");
  invariant(
    Number.isFinite(milliseconds),
    "invalid_lifecycle_evidence",
    `${field} is invalid`,
    { status: 409 }
  );
  return new Date(milliseconds).toISOString();
}

function selectedScope(value) {
  const scope = Object.freeze({
    organizationId: uuid(value?.organizationId, "organizationId"),
    projectId: uuid(value?.projectId, "projectId"),
    customerId: uuid(value?.customerId, "customerId"),
    actorId: uuid(value?.actorId, "actorId")
  });
  invariant(
    scope.actorId === scope.customerId,
    "invalid_lifecycle_scope",
    "customer lifecycle scope is invalid",
    { status: 400 }
  );
  return scope;
}

function exactState(value, scope, domain) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_LIFECYCLE_SCHEMA &&
      value.scope?.organizationId === scope.organizationId &&
      value.scope?.projectId === scope.projectId &&
      value.scope?.customerId === scope.customerId &&
      value.scope?.actorId === scope.actorId &&
      normalizeDomain(value.pin?.domain) === domain,
    "domain_lifecycle_binding_mismatch",
    "lifecycle state does not match its customer and provider pin",
    { status: 409 }
  );
  const providerCode = requiredString(
    value.pin.providerCode,
    "pin.providerCode",
    64
  );
  invariant(
    PROVIDER_CODE.test(providerCode),
    "invalid_domain_provider_pin",
    "provider pin evidence changed",
    { status: 409 }
  );
  const authoritative = value.authoritative;
  invariant(
    authoritative && typeof authoritative === "object" &&
      authoritative.autoRenew === false,
    "invalid_lifecycle_evidence",
    "authoritative lifecycle readback is required for canonical persistence",
    { status: 409 }
  );
  const renewalStatus = requiredString(
    value.renewal?.status,
    "renewal.status",
    32
  );
  const transferStatus = requiredString(
    value.transfer?.status,
    "transfer.status",
    32
  );
  const reviewReason = value.review?.reason ?? null;
  if (reviewReason !== null) {
    requiredString(reviewReason, "review.reason", 128);
  }
  return {
    document: structuredClone(value),
    schema: value.schema,
    providerCode,
    registrarOfRecord: requiredString(
      value.pin.registrarOfRecord,
      "pin.registrarOfRecord",
      128
    ),
    providerPinFingerprint: sha256(
      value.pin.fingerprint,
      "pin.fingerprint"
    ),
    lifecycleStatus: requiredString(
      authoritative.lifecycleStatus,
      "authoritative.lifecycleStatus",
      32
    ),
    expirationDate: instant(
      authoritative.expirationDate,
      "authoritative.expirationDate"
    ),
    observedAt: instant(
      authoritative.observedAt,
      "authoritative.observedAt"
    ),
    evidenceDigest: sha256(
      authoritative.evidenceDigest,
      "authoritative.evidenceDigest"
    ),
    renewalStatus,
    renewalQuoteDigest: optionalDigest(
      value.renewal?.quote?.quoteFingerprint,
      "renewal.quoteFingerprint"
    ),
    renewalOperationDigest: optionalDigest(
      value.renewal?.attempt?.operationDigest,
      "renewal.operationDigest"
    ),
    renewalOutcomeDigest: optionalDigest(
      value.renewal?.attempt?.outcomeDigest,
      "renewal.outcomeDigest"
    ),
    transferStatus,
    transferOperationDigest: optionalDigest(
      value.transfer?.attempt?.operationDigest,
      "transfer.operationDigest"
    ),
    transferOutcomeDigest: optionalDigest(
      value.transfer?.attempt?.outcomeDigest,
      "transfer.outcomeDigest"
    ),
    reviewReason,
    updatedAt: instant(value.updatedAt, "updatedAt")
  };
}

function optionalDigest(value, field) {
  return value === null || value === undefined ? null : sha256(value, field);
}

function clone(value) {
  return value === null || value === undefined
    ? value
    : structuredClone(value);
}

function repositoryFailure(message) {
  invariant(false, "invalid_lifecycle_repository", message, { status: 500 });
}

export function createPostgresDomainLifecycleRepository({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "invalid_lifecycle_configuration",
    "canonical PostgreSQL lifecycle authority is required",
    { status: 500 }
  );

  async function readiness() {
    try {
      const row = await authority.service(
        { readOnly: true },
        async (client) => (
          await client.query(`
            select
              ss.domain_provider_lifecycle_persistence_contract_v1() =
                'canonical-domain-provider-lifecycle-persistence-v1-held'
                as contract_ready,
              bool_and(table_record.relrowsecurity)
                and bool_and(table_record.relforcerowsecurity)
                as forced_rls
              from pg_class table_record
             where table_record.oid in (
               'ss.domain_provider_lifecycle_states'::regclass,
               'ss.domain_provider_lifecycle_commands'::regclass
             )
          `)
        ).rows[0]
      );
      return Object.freeze({
        ready: row?.contract_ready === true && row?.forced_rls === true,
        mode: "canonical_postgres_held",
        canonicalPersistence: true,
        providerEffects: false,
        paymentEffects: false,
        dnsEffects: false
      });
    } catch {
      return Object.freeze({
        ready: false,
        mode: "canonical_postgres_held",
        canonicalPersistence: false,
        providerEffects: false,
        paymentEffects: false,
        dnsEffects: false
      });
    }
  }

  async function transact({
    scope,
    domain,
    commandId,
    commandFingerprint,
    initialize = null,
    apply
  } = {}) {
    const selected = selectedScope(scope);
    const selectedDomain = normalizeDomain(domain);
    const selectedCommandId = requiredString(commandId, "commandId", 200);
    const selectedFingerprint = sha256(
      commandFingerprint,
      "commandFingerprint"
    );
    invariant(
      typeof apply === "function",
      "invalid_lifecycle_repository",
      "apply is required",
      { status: 500 }
    );
    return authority.service(
      {
        organizationId: selected.organizationId,
        isolation: "serializable"
      },
      async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `sitesourcery.domain-lifecycle:${selected.organizationId}:` +
              `${selected.projectId}:${selectedDomain}`
          ]
        );
        const prior = await client.query(
          `select command.command_fingerprint, command.result_document
             from ss.domain_provider_lifecycle_commands command
             join ss.domain_provider_lifecycle_states state
               on state.organization_id = command.organization_id
              and state.id = command.lifecycle_state_id
            where state.organization_id = $1
              and state.project_id = $2
              and state.domain_name = $3
              and command.command_id = $4`,
          [
            selected.organizationId,
            selected.projectId,
            selectedDomain,
            selectedCommandId
          ]
        );
        if (prior.rowCount > 0) {
          invariant(
            prior.rowCount === 1 &&
              prior.rows[0].command_fingerprint === selectedFingerprint,
            "lifecycle_idempotency_conflict",
            "command ID was reused with different lifecycle input",
            { status: 409 }
          );
          return Object.freeze({
            replayed: true,
            result: clone(prior.rows[0].result_document)
          });
        }

        const retained = await client.query(
          `select *
             from ss.domain_provider_lifecycle_states
            where organization_id = $1
              and project_id = $2
              and domain_name = $3
            for update`,
          [selected.organizationId, selected.projectId, selectedDomain]
        );
        invariant(
          retained.rowCount <= 1,
          "invalid_lifecycle_repository",
          "multiple canonical lifecycle states were found",
          { status: 500 }
        );
        let current = retained.rows[0]?.state_document ?? null;
        if (current === null && typeof initialize === "function") {
          current = await initialize();
        }
        const applied = await apply(clone(current));
        invariant(
          applied && typeof applied === "object" &&
            applied.state && applied.result,
          "invalid_lifecycle_repository",
          "lifecycle transaction returned invalid state",
          { status: 500 }
        );
        const state = exactState(
          applied.state,
          selected,
          selectedDomain
        );
        const pin = await client.query(
          `select id
             from ss.domain_provider_pins
            where organization_id = $1
              and project_id = $2
              and domain_name = $3
              and provider_code = $4
              and registrar_of_record = $5
              and pin_fingerprint = $6`,
          [
            selected.organizationId,
            selected.projectId,
            selectedDomain,
            state.providerCode,
            state.registrarOfRecord,
            state.providerPinFingerprint
          ]
        );
        invariant(
          pin.rowCount === 1,
          "domain_lifecycle_binding_mismatch",
          "canonical lifecycle state requires its exact persisted provider pin",
          { status: 409 }
        );
        if (
          retained.rowCount === 1 &&
          retained.rows[0].provider_pin_id !== pin.rows[0].id
        ) {
          repositoryFailure("canonical lifecycle provider pin changed");
        }
        const stateDigest = digest(state.document);
        const values = [
          selected.organizationId,
          selected.projectId,
          selected.customerId,
          pin.rows[0].id,
          selectedDomain,
          state.providerCode,
          state.providerPinFingerprint,
          state.schema,
          state.lifecycleStatus,
          state.expirationDate,
          state.observedAt,
          state.evidenceDigest,
          state.renewalStatus,
          state.renewalQuoteDigest,
          state.renewalOperationDigest,
          state.renewalOutcomeDigest,
          state.transferStatus,
          state.transferOperationDigest,
          state.transferOutcomeDigest,
          state.reviewReason,
          JSON.stringify(state.document),
          stateDigest,
          state.updatedAt
        ];
        let lifecycleStateId;
        if (retained.rowCount === 0) {
          lifecycleStateId = randomUUID();
          const inserted = await client.query(
            `insert into ss.domain_provider_lifecycle_states (
               id, organization_id, project_id, customer_id,
               provider_pin_id, domain_name, provider_code,
               provider_pin_fingerprint, lifecycle_schema,
               lifecycle_status, expiration_date, lifecycle_observed_at,
               lifecycle_evidence_digest, renewal_status,
               renewal_quote_digest, renewal_operation_digest,
               renewal_outcome_digest, transfer_status,
               transfer_operation_digest, transfer_outcome_digest,
               review_reason, state_document, state_digest,
               revision, updated_at
             ) values (
               $24, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16, $17, $18, $19, $20,
               $21::jsonb, $22, 1, $23
             ) returning id`,
            [...values, lifecycleStateId]
          );
          invariant(
            inserted.rowCount === 1,
            "invalid_lifecycle_repository",
            "canonical lifecycle state was not inserted",
            { status: 500 }
          );
        } else {
          lifecycleStateId = retained.rows[0].id;
          const updated = await client.query(
            `update ss.domain_provider_lifecycle_states
                set lifecycle_status = $2,
                    expiration_date = $3,
                    lifecycle_observed_at = $4,
                    lifecycle_evidence_digest = $5,
                    renewal_status = $6,
                    renewal_quote_digest = $7,
                    renewal_operation_digest = $8,
                    renewal_outcome_digest = $9,
                    transfer_status = $10,
                    transfer_operation_digest = $11,
                    transfer_outcome_digest = $12,
                    review_reason = $13,
                    state_document = $14::jsonb,
                    state_digest = $15,
                    revision = revision + 1,
                    updated_at = $16
              where id = $1
                and organization_id = $17
                and project_id = $18
                and customer_id = $19
                and provider_pin_id = $20
            returning id`,
            [
              lifecycleStateId,
              state.lifecycleStatus,
              state.expirationDate,
              state.observedAt,
              state.evidenceDigest,
              state.renewalStatus,
              state.renewalQuoteDigest,
              state.renewalOperationDigest,
              state.renewalOutcomeDigest,
              state.transferStatus,
              state.transferOperationDigest,
              state.transferOutcomeDigest,
              state.reviewReason,
              JSON.stringify(state.document),
              stateDigest,
              state.updatedAt,
              selected.organizationId,
              selected.projectId,
              selected.customerId,
              pin.rows[0].id
            ]
          );
          invariant(
            updated.rowCount === 1,
            "domain_lifecycle_binding_mismatch",
            "canonical lifecycle state authority changed",
            { status: 409 }
          );
        }
        const resultDocument = clone(applied.result);
        const resultDigest = digest(resultDocument);
        await client.query(
          `insert into ss.domain_provider_lifecycle_commands (
             id, organization_id, project_id, lifecycle_state_id,
             command_id, command_fingerprint, result_document, result_digest
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            randomUUID(),
            selected.organizationId,
            selected.projectId,
            lifecycleStateId,
            selectedCommandId,
            selectedFingerprint,
            JSON.stringify(resultDocument),
            resultDigest
          ]
        );
        return Object.freeze({
          replayed: false,
          result: clone(resultDocument)
        });
      }
    );
  }

  async function read({ scope, domain } = {}) {
    const selected = selectedScope(scope);
    const selectedDomain = normalizeDomain(domain);
    return authority.service(
      {
        organizationId: selected.organizationId,
        readOnly: true
      },
      async (client) => {
        const result = await client.query(
          `select state_document
             from ss.domain_provider_lifecycle_states
            where organization_id = $1
              and project_id = $2
              and customer_id = $3
              and domain_name = $4`,
          [
            selected.organizationId,
            selected.projectId,
            selected.customerId,
            selectedDomain
          ]
        );
        invariant(
          result.rowCount === 1,
          "lifecycle_not_found",
          "domain lifecycle state was not found",
          { status: 404 }
        );
        return clone(result.rows[0].state_document);
      }
    );
  }

  return Object.freeze({ transact, read, readiness });
}
