import { randomUUID as systemRandomUUID } from "node:crypto";

import {
  createDomainProviderContingency,
  DOMAIN_PROVIDER_OUTCOME_SCHEMA,
  DOMAIN_PROVIDER_PIN_SCHEMA,
  DOMAIN_PROVIDER_ROUTE_SCHEMA
} from "../domain/provider-contingency.mjs";
import {
  digest,
  exactMoney,
  normalizeDomain,
  requiredInteger,
  requiredString
} from "../domain/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const DOMAIN_PROVIDER_ROUTE_SELECTION_SCHEMA =
  "sitesourcery.domain-provider-route-selection/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROVIDER_CODE = /^[a-z][a-z0-9_-]{1,63}$/u;
const PRICE_CLASSES = new Set(["standard", "premium"]);

function uuid(value, field) {
  const selected = String(value ?? "");
  invariant(UUID.test(selected), "INVALID_INPUT", `${field} is invalid.`, {
    status: 400
  });
  return selected;
}

function providerCode(value, field) {
  const selected = requiredString(value, field, 64);
  invariant(
    PROVIDER_CODE.test(selected),
    "INVALID_DOMAIN_PROVIDER",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function exactInstant(value, field) {
  const milliseconds = Date.parse(value ?? "");
  invariant(
    Number.isFinite(milliseconds),
    "INVALID_DOMAIN_PROVIDER_EVIDENCE",
    `${field} is invalid.`,
    { status: 409 }
  );
  return new Date(milliseconds).toISOString();
}

function routeEvidence(value) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_ROUTE_SCHEMA,
    "INVALID_DOMAIN_PROVIDER_ROUTE",
    "Provider route evidence is invalid.",
    { status: 409 }
  );
  const priceClass = value.priceClass === undefined
    ? null
    : requiredString(value.priceClass, "route.priceClass", 16);
  invariant(
    priceClass === null || PRICE_CLASSES.has(priceClass),
    "INVALID_DOMAIN_PROVIDER_ROUTE",
    "Provider route price class is invalid.",
    { status: 409 }
  );
  const route = {
    schema: DOMAIN_PROVIDER_ROUTE_SCHEMA,
    providerCode: providerCode(value.providerCode, "route.providerCode"),
    registrarOfRecord: requiredString(
      value.registrarOfRecord,
      "route.registrarOfRecord",
      128
    ),
    domain: normalizeDomain(value.domain),
    years: requiredInteger(value.years, "route.years", {
      minimum: 1,
      maximum: 10
    }),
    quoteId: requiredString(value.quoteId, "route.quoteId", 256),
    expectedPrice: exactMoney(
      value.expectedPrice,
      "route.expectedPrice"
    ),
    ...(priceClass === null ? {} : { priceClass }),
    observedAt: exactInstant(value.observedAt, "route.observedAt"),
    expiresAt: exactInstant(value.expiresAt, "route.expiresAt")
  };
  invariant(
    value.fingerprint === digest(route),
    "INVALID_DOMAIN_PROVIDER_ROUTE",
    "Provider route evidence changed after selection.",
    { status: 409 }
  );
  return Object.freeze({
    ...route,
    fingerprint: value.fingerprint
  });
}

function pinEvidence(value) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_PIN_SCHEMA,
    "INVALID_DOMAIN_PROVIDER_PIN",
    "Provider pin evidence is invalid.",
    { status: 409 }
  );
  const pin = {
    schema: DOMAIN_PROVIDER_PIN_SCHEMA,
    providerCode: providerCode(value.providerCode, "pin.providerCode"),
    registrarOfRecord: requiredString(
      value.registrarOfRecord,
      "pin.registrarOfRecord",
      128
    ),
    domain: normalizeDomain(value.domain)
  };
  invariant(
    value.fingerprint === digest(pin),
    "INVALID_DOMAIN_PROVIDER_PIN",
    "Provider pin evidence changed after registration readback.",
    { status: 409 }
  );
  return Object.freeze({ ...pin, fingerprint: value.fingerprint });
}

function outcomeEvidence(value, field) {
  invariant(
    value?.schema === DOMAIN_PROVIDER_OUTCOME_SCHEMA &&
      typeof value.status === "string",
    "INVALID_DOMAIN_PROVIDER_OUTCOME",
    `${field} is invalid.`,
    { status: 409 }
  );
  return structuredClone(value);
}

function publicRoute(row) {
  const priceClass = row.route_evidence?.priceClass;
  const route = Object.freeze({
    schema: row.route_schema,
    providerCode: row.provider_code,
    registrarOfRecord: row.registrar_of_record,
    domain: row.domain_name,
    years: Number(row.term_years),
    quoteId: row.provider_quote_ref,
    expectedPrice: Object.freeze({
      amountMinor: Number(row.expected_price_minor),
      currency: row.currency
    }),
    ...(priceClass === undefined ? {} : { priceClass }),
    observedAt: new Date(row.provider_observed_at).toISOString(),
    expiresAt: new Date(row.provider_expires_at).toISOString(),
    fingerprint: row.route_fingerprint
  });
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    selectionKey: row.selection_key,
    primaryProviderCode: row.primary_provider_code,
    fallbackUsed: row.fallback_used,
    fallbackFromProviderCode: row.fallback_from_provider_code,
    selectionDigest: row.selection_digest,
    selectedAt: new Date(row.selected_at).toISOString(),
    route
  });
}

function publicAttempt(row) {
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    providerRouteId: row.provider_route_id,
    providerCode: row.provider_code,
    domain: row.domain_name,
    attemptKey: row.attempt_key,
    state: row.state,
    operationId: row.external_operation_ref,
    submissionOutcome: row.submission_outcome ?? null,
    submissionOutcomeDigest: row.submission_outcome_digest,
    reconciliationOutcome: row.reconciliation_outcome ?? null,
    reconciliationOutcomeDigest: row.reconciliation_outcome_digest,
    requestedAt: new Date(row.requested_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null
  });
}

function publicPin(row) {
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    providerRouteId: row.provider_route_id,
    registrationAttemptId: row.registration_attempt_id,
    providerDomainRef: row.provider_domain_ref,
    pinnedAt: new Date(row.pinned_at).toISOString(),
    pin: Object.freeze({
      schema: row.pin_schema,
      providerCode: row.provider_code,
      registrarOfRecord: row.registrar_of_record,
      domain: row.domain_name,
      fingerprint: row.pin_fingerprint
    })
  });
}

function routeConflict() {
  return new HostedError(
    "DOMAIN_PROVIDER_ROUTE_CONFLICT",
    "That provider-route selection key is already bound to different evidence.",
    { status: 409 }
  );
}

function attemptConflict() {
  return new HostedError(
    "DOMAIN_PROVIDER_ATTEMPT_CONFLICT",
    "That route or attempt key is already bound to another registration attempt.",
    { status: 409 }
  );
}

export function createPostgresDomainProviderRouteRepository({
  authority,
  clock = { now: () => new Date().toISOString() },
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "DOMAIN_PROVIDER_ROUTE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );

  async function readiness() {
    try {
      const row = await authority.service(
        { readOnly: true },
        async (client) => (
          await client.query(`
            select
              ss.domain_provider_route_persistence_contract_v1() =
                'canonical-domain-provider-route-persistence-v1-held'
                as contract_ready,
              bool_and(table_record.relrowsecurity)
                and bool_and(table_record.relforcerowsecurity)
                as forced_rls
              from pg_class table_record
             where table_record.oid in (
               'ss.domain_provider_routes'::regclass,
               'ss.domain_provider_registration_attempts'::regclass,
               'ss.domain_provider_pins'::regclass
             )
          `)
        ).rows[0]
      );
      return Object.freeze({
        ready: row?.contract_ready === true && row?.forced_rls === true,
        providerEffects: false,
        paymentEffects: false,
        dnsEffects: false,
        renewalEffects: false
      });
    } catch {
      return Object.freeze({
        ready: false,
        providerEffects: false,
        paymentEffects: false,
        dnsEffects: false,
        renewalEffects: false
      });
    }
  }

  async function persistRoute({
    organizationId,
    projectId,
    selectionKey,
    primaryProviderCode,
    fallbackUsed,
    route
  } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const key = requiredString(selectionKey, "selectionKey", 200);
    invariant(
      key.length >= 8,
      "INVALID_INPUT",
      "selectionKey is invalid.",
      { status: 400 }
    );
    const selectedRoute = routeEvidence(route);
    const primary = providerCode(
      primaryProviderCode,
      "primaryProviderCode"
    );
    const usedFallback = fallbackUsed === true;
    invariant(
      usedFallback
        ? selectedRoute.providerCode !== primary
        : selectedRoute.providerCode === primary,
      "INVALID_DOMAIN_PROVIDER_FALLBACK",
      "Provider fallback evidence does not match the selected route.",
      { status: 409 }
    );
    const selectedAt = exactInstant(clock.now(), "Selection time");
    invariant(
      Date.parse(selectedRoute.observedAt) <= Date.parse(selectedAt) &&
        Date.parse(selectedRoute.expiresAt) > Date.parse(selectedAt),
      "DOMAIN_PROVIDER_ROUTE_STALE",
      "Provider route evidence is stale or future-dated.",
      { status: 409 }
    );
    const routeDocument = structuredClone(selectedRoute);
    delete routeDocument.fingerprint;
    const selectionDigest = digest({
      schema: DOMAIN_PROVIDER_ROUTE_SELECTION_SCHEMA,
      organizationId: orgId,
      projectId: selectedProjectId,
      selectionKey: key,
      primaryProviderCode: primary,
      fallbackUsed: usedFallback,
      fallbackFromProviderCode: usedFallback ? primary : null,
      routeFingerprint: selectedRoute.fingerprint
    });
    return authority.service(
      { organizationId: orgId },
      async (client) => {
        await client.query(
          `insert into ss.domain_provider_routes (
             id, organization_id, project_id, selection_key,
             route_schema, provider_code, registrar_of_record,
             primary_provider_code, fallback_used,
             fallback_from_provider_code, domain_name, term_years,
             provider_quote_ref, expected_price_minor, currency,
             provider_observed_at, provider_expires_at,
             route_evidence, route_fingerprint,
             selection_digest, selected_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18::jsonb,
             $19, $20, $21
           ) on conflict (organization_id, selection_key) do nothing`,
          [
            randomUUID(),
            orgId,
            selectedProjectId,
            key,
            selectedRoute.schema,
            selectedRoute.providerCode,
            selectedRoute.registrarOfRecord,
            primary,
            usedFallback,
            usedFallback ? primary : null,
            selectedRoute.domain,
            selectedRoute.years,
            selectedRoute.quoteId,
            selectedRoute.expectedPrice.amountMinor,
            selectedRoute.expectedPrice.currency,
            selectedRoute.observedAt,
            selectedRoute.expiresAt,
            JSON.stringify(routeDocument),
            selectedRoute.fingerprint,
            selectionDigest,
            selectedAt
          ]
        );
        const selected = await client.query(
          `select *
             from ss.domain_provider_routes
            where organization_id = $1
              and selection_key = $2`,
          [orgId, key]
        );
        invariant(
          selected.rowCount === 1,
          "DOMAIN_PROVIDER_ROUTE_PERSISTENCE_FAILED",
          "The provider route was not persisted.",
          { status: 503 }
        );
        if (
          selected.rows[0].project_id !== selectedProjectId ||
          selected.rows[0].selection_digest !== selectionDigest
        ) {
          throw routeConflict();
        }
        return publicRoute(selected.rows[0]);
      }
    );
  }

  async function readRoute({ organizationId, projectId, routeId } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const id = uuid(routeId, "Provider route ID");
    return authority.service(
      { organizationId: orgId, readOnly: true },
      async (client) => {
        const selected = await client.query(
          `select *
             from ss.domain_provider_routes
            where organization_id = $1
              and project_id = $2
              and id = $3`,
          [orgId, selectedProjectId, id]
        );
        invariant(
          selected.rowCount === 1,
          "NOT_FOUND",
          "The requested provider route was not found.",
          { status: 404 }
        );
        return publicRoute(selected.rows[0]);
      }
    );
  }

  async function beginRegistrationAttempt({
    organizationId,
    projectId,
    routeId,
    attemptKey
  } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const selectedRouteId = uuid(routeId, "Provider route ID");
    const key = requiredString(attemptKey, "attemptKey", 200);
    invariant(key.length >= 8, "INVALID_INPUT", "attemptKey is invalid.", {
      status: 400
    });
    const requestedAt = exactInstant(clock.now(), "Attempt time");
    return authority.service(
      { organizationId: orgId },
      async (client) => {
        const route = await client.query(
          `select * from ss.domain_provider_routes
            where organization_id = $1 and project_id = $2 and id = $3`,
          [orgId, selectedProjectId, selectedRouteId]
        );
        invariant(route.rowCount === 1, "NOT_FOUND", "The provider route was not found.", {
          status: 404
        });
        const existing = await client.query(
          `select *
             from ss.domain_provider_registration_attempts
            where organization_id = $1
              and (provider_route_id = $2 or attempt_key = $3)
            for update`,
          [orgId, selectedRouteId, key]
        );
        if (existing.rowCount > 0) {
          const row = existing.rows[0];
          if (
            existing.rowCount !== 1 ||
            row.project_id !== selectedProjectId ||
            row.provider_route_id !== selectedRouteId ||
            row.attempt_key !== key
          ) {
            throw attemptConflict();
          }
          return Object.freeze({
            claimed: false,
            route: publicRoute(route.rows[0]),
            attempt: publicAttempt(row)
          });
        }
        const attemptId = randomUUID();
        const inserted = await client.query(
          `insert into ss.domain_provider_registration_attempts (
             id, organization_id, project_id, provider_route_id,
             provider_code, domain_name, attempt_key, state,
             requested_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, 'dispatching', $8, $8
           ) returning *`,
          [
            attemptId,
            orgId,
            selectedProjectId,
            selectedRouteId,
            route.rows[0].provider_code,
            route.rows[0].domain_name,
            key,
            requestedAt
          ]
        );
        return Object.freeze({
          claimed: true,
          route: publicRoute(route.rows[0]),
          attempt: publicAttempt(inserted.rows[0])
        });
      }
    );
  }

  async function recordRegistrationOutcome({
    organizationId,
    projectId,
    attemptId,
    outcome
  } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const selectedAttemptId = uuid(attemptId, "Provider attempt ID");
    const selectedOutcome = outcomeEvidence(outcome, "Registration outcome");
    const outcomeDigest = digest(selectedOutcome);
    return authority.service(
      { organizationId: orgId },
      async (client) => {
        const selected = await client.query(
          `select *
             from ss.domain_provider_registration_attempts
            where organization_id = $1 and project_id = $2 and id = $3
            for update`,
          [orgId, selectedProjectId, selectedAttemptId]
        );
        invariant(selected.rowCount === 1, "NOT_FOUND", "The provider attempt was not found.", {
          status: 404
        });
        const current = selected.rows[0];
        invariant(
          selectedOutcome.providerCode === current.provider_code,
          "INVALID_DOMAIN_PROVIDER_OUTCOME",
          "Registration outcome changed the selected provider.",
          { status: 409 }
        );
        if (current.state !== "dispatching") {
          if (current.submission_outcome_digest !== outcomeDigest) {
            throw attemptConflict();
          }
          return publicAttempt(current);
        }
        let state;
        let operationId = null;
        if (selectedOutcome.status === "submitted") {
          state = "submitted";
          operationId = requiredString(
            selectedOutcome.operationId,
            "outcome.operationId",
            256
          );
        } else {
          invariant(
            selectedOutcome.status === "held" &&
              ["not_submitted", "submitted", "uncertain"].includes(
                selectedOutcome.effect
              ),
            "INVALID_DOMAIN_PROVIDER_OUTCOME",
            "Registration outcome is not terminally classified.",
            { status: 409 }
          );
          state = selectedOutcome.effect === "not_submitted"
            ? "not_submitted"
            : "uncertain";
          operationId = selectedOutcome.operationId ?? null;
        }
        const completedAt = state === "submitted"
          ? null
          : exactInstant(clock.now(), "Attempt completion time");
        const updated = await client.query(
          `update ss.domain_provider_registration_attempts
              set state = $2,
                  external_operation_ref = $3,
                  submission_outcome = $4::jsonb,
                  submission_outcome_digest = $5,
                  updated_at = $6,
                  completed_at = $7
            where id = $1 and state = 'dispatching'
          returning *`,
          [
            selectedAttemptId,
            state,
            operationId,
            JSON.stringify(selectedOutcome),
            outcomeDigest,
            exactInstant(clock.now(), "Attempt update time"),
            completedAt
          ]
        );
        invariant(
          updated.rowCount === 1,
          "DOMAIN_PROVIDER_ATTEMPT_PERSISTENCE_FAILED",
          "The provider outcome was not persisted.",
          { status: 409 }
        );
        return publicAttempt(updated.rows[0]);
      }
    );
  }

  async function persistSuccessfulPin({
    organizationId,
    projectId,
    attemptId,
    providerDomainRef,
    reconciliationOutcome
  } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const selectedAttemptId = uuid(attemptId, "Provider attempt ID");
    const selectedOutcome = outcomeEvidence(
      reconciliationOutcome,
      "Registration reconciliation"
    );
    invariant(
      selectedOutcome.status === "active",
      "INVALID_DOMAIN_PROVIDER_OUTCOME",
      "Only verified active registration readback can create a provider pin.",
      { status: 409 }
    );
    const pin = pinEvidence(selectedOutcome.providerPin);
    const pinDocument = structuredClone(pin);
    delete pinDocument.fingerprint;
    const domainRef = requiredString(
      providerDomainRef,
      "providerDomainRef",
      256
    );
    const reconciliationDigest = digest(selectedOutcome);
    const pinnedAt = exactInstant(clock.now(), "Provider pin time");
    return authority.service(
      { organizationId: orgId },
      async (client) => {
        const selected = await client.query(
          `select attempt.*, route.registrar_of_record,
                  route.route_fingerprint,
                  pin.id as pin_id, pin.pin_schema,
                  pin.registrar_of_record as pin_registrar_of_record,
                  pin.provider_domain_ref, pin.pin_fingerprint,
                  pin.pinned_at
             from ss.domain_provider_registration_attempts attempt
             join ss.domain_provider_routes route
               on route.organization_id = attempt.organization_id
              and route.id = attempt.provider_route_id
             left join ss.domain_provider_pins pin
               on pin.organization_id = attempt.organization_id
              and pin.registration_attempt_id = attempt.id
            where attempt.organization_id = $1
              and attempt.project_id = $2
              and attempt.id = $3
            for update of attempt`,
          [orgId, selectedProjectId, selectedAttemptId]
        );
        invariant(selected.rowCount === 1, "NOT_FOUND", "The provider attempt was not found.", {
          status: 404
        });
        const current = selected.rows[0];
        invariant(
          ["submitted", "uncertain", "succeeded"].includes(current.state) &&
            current.external_operation_ref === selectedOutcome.operationId &&
            current.provider_code === pin.providerCode &&
            current.domain_name === pin.domain &&
            current.registrar_of_record === pin.registrarOfRecord,
          "DOMAIN_PROVIDER_PIN_MISMATCH",
          "The provider pin does not match the persisted route and attempt.",
          { status: 409 }
        );
        if (current.pin_id) {
          if (
            current.pin_fingerprint !== pin.fingerprint ||
            current.provider_domain_ref !== domainRef ||
            current.reconciliation_outcome_digest !== reconciliationDigest
          ) {
            throw attemptConflict();
          }
          return Object.freeze({
            replayed: true,
            attempt: publicAttempt(current),
            pin: publicPin({
              id: current.pin_id,
              organization_id: current.organization_id,
              project_id: current.project_id,
              provider_route_id: current.provider_route_id,
              registration_attempt_id: current.id,
              pin_schema: current.pin_schema,
              provider_code: current.provider_code,
              registrar_of_record: current.pin_registrar_of_record,
              domain_name: current.domain_name,
              provider_domain_ref: current.provider_domain_ref,
              pin_fingerprint: current.pin_fingerprint,
              pinned_at: current.pinned_at
            })
          });
        }
        const updated = await client.query(
          `update ss.domain_provider_registration_attempts
              set state = 'succeeded',
                  reconciliation_outcome = $2::jsonb,
                  reconciliation_outcome_digest = $3,
                  updated_at = $4,
                  completed_at = $4
            where id = $1 and state in ('submitted', 'uncertain')
          returning *`,
          [
            selectedAttemptId,
            JSON.stringify(selectedOutcome),
            reconciliationDigest,
            pinnedAt
          ]
        );
        invariant(
          updated.rowCount === 1,
          "DOMAIN_PROVIDER_PIN_PERSISTENCE_FAILED",
          "The successful provider readback was not persisted.",
          { status: 409 }
        );
        const pinId = randomUUID();
        const inserted = await client.query(
          `insert into ss.domain_provider_pins (
             id, organization_id, project_id, provider_route_id,
             registration_attempt_id, pin_schema, pin_evidence, provider_code,
             registrar_of_record, domain_name, provider_domain_ref,
             pin_fingerprint, pinned_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10,
             $11, $12, $13
           ) returning *`,
          [
            pinId,
            orgId,
            selectedProjectId,
            current.provider_route_id,
            selectedAttemptId,
            pin.schema,
            JSON.stringify(pinDocument),
            pin.providerCode,
            pin.registrarOfRecord,
            pin.domain,
            domainRef,
            pin.fingerprint,
            pinnedAt
          ]
        );
        return Object.freeze({
          replayed: false,
          attempt: publicAttempt(updated.rows[0]),
          pin: publicPin(inserted.rows[0])
        });
      }
    );
  }

  async function readPin({ organizationId, projectId, domain } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const selectedDomain = normalizeDomain(domain);
    return authority.service(
      { organizationId: orgId, readOnly: true },
      async (client) => {
        const selected = await client.query(
          `select *
             from ss.domain_provider_pins
            where organization_id = $1
              and project_id = $2
              and domain_name = $3`,
          [orgId, selectedProjectId, selectedDomain]
        );
        invariant(
          selected.rowCount === 1,
          "NOT_FOUND",
          "The requested provider pin was not found.",
          { status: 404 }
        );
        return publicPin(selected.rows[0]);
      }
    );
  }

  async function readRegistrationAttempt({
    organizationId,
    projectId,
    routeId,
    attemptKey
  } = {}) {
    const orgId = uuid(organizationId, "Organization ID");
    const selectedProjectId = uuid(projectId, "Project ID");
    const selectedRouteId = uuid(routeId, "Provider route ID");
    const key = requiredString(attemptKey, "attemptKey", 200);
    invariant(key.length >= 8, "INVALID_INPUT", "attemptKey is invalid.", {
      status: 400
    });
    return authority.service(
      { organizationId: orgId, readOnly: true },
      async (client) => {
        const selected = await client.query(
          `select attempt.*, route.route_schema, route.route_evidence,
                  route.registrar_of_record,
                  route.primary_provider_code, route.fallback_used,
                  route.fallback_from_provider_code,
                  route.selection_key, route.provider_quote_ref,
                  route.expected_price_minor, route.currency,
                  route.provider_observed_at, route.provider_expires_at,
                  route.route_fingerprint, route.selection_digest,
                  route.selected_at, route.term_years,
                  pin.id as pin_id, pin.pin_schema,
                  pin.registrar_of_record as pin_registrar_of_record,
                  pin.provider_domain_ref, pin.pin_fingerprint,
                  pin.pinned_at
             from ss.domain_provider_registration_attempts attempt
             join ss.domain_provider_routes route
               on route.organization_id = attempt.organization_id
              and route.project_id = attempt.project_id
              and route.id = attempt.provider_route_id
             left join ss.domain_provider_pins pin
               on pin.organization_id = attempt.organization_id
              and pin.registration_attempt_id = attempt.id
            where attempt.organization_id = $1
              and attempt.project_id = $2
              and attempt.provider_route_id = $3
              and attempt.attempt_key = $4`,
          [orgId, selectedProjectId, selectedRouteId, key]
        );
        invariant(
          selected.rowCount === 1,
          "NOT_FOUND",
          "The requested provider registration attempt was not found.",
          { status: 404 }
        );
        const row = selected.rows[0];
        return Object.freeze({
          route: publicRoute({
            ...row,
            id: row.provider_route_id,
            organization_id: row.organization_id,
            project_id: row.project_id,
            provider_code: row.provider_code,
            domain_name: row.domain_name
          }),
          attempt: publicAttempt(row),
          pin: row.pin_id
            ? publicPin({
                id: row.pin_id,
                organization_id: row.organization_id,
                project_id: row.project_id,
                provider_route_id: row.provider_route_id,
                registration_attempt_id: row.id,
                pin_schema: row.pin_schema,
                provider_code: row.provider_code,
                registrar_of_record: row.pin_registrar_of_record,
                domain_name: row.domain_name,
                provider_domain_ref: row.provider_domain_ref,
                pin_fingerprint: row.pin_fingerprint,
                pinned_at: row.pinned_at
              })
            : null
        });
      }
    );
  }

  return Object.freeze({
    readiness,
    persistRoute,
    readRoute,
    beginRegistrationAttempt,
    recordRegistrationOutcome,
    persistSuccessfulPin,
    readRegistrationAttempt,
    readPin
  });
}

export function createPostgresDomainProviderRouteComposition({
  repository,
  registrarProviders
} = {}) {
  invariant(
    repository &&
      [
        "persistRoute",
        "beginRegistrationAttempt",
        "recordRegistrationOutcome",
        "persistSuccessfulPin",
        "readPin"
      ].every((method) => typeof repository[method] === "function"),
    "DOMAIN_PROVIDER_ROUTE_CONFIGURATION_REQUIRED",
    "A durable provider-route repository is required.",
    { status: 500 }
  );
  const routing = createDomainProviderContingency(registrarProviders);
  const defaultPrimaryProviderCode = providerCode(
    registrarProviders?.preference?.[0] ??
      registrarProviders?.primary?.code,
    "registrarProviders.preference[0]"
  );

  async function preflightRoute({
    organizationId,
    projectId,
    selectionKey,
    input,
    preferredProviderCode = null
  } = {}) {
    const preferred = preferredProviderCode === null
      ? defaultPrimaryProviderCode
      : providerCode(preferredProviderCode, "preferredProviderCode");
    const outcome = await routing.preflightRegistration({
      input,
      preferredProviderCode: preferred
    });
    if (outcome.status !== "ready") {
      return Object.freeze({ outcome, route: null });
    }
    const route = await repository.persistRoute({
      organizationId,
      projectId,
      selectionKey,
      primaryProviderCode: preferred,
      fallbackUsed: outcome.fallbackUsed,
      route: outcome.route
    });
    return Object.freeze({ outcome, route });
  }

  function heldReplay(route, attempt) {
    return Object.freeze({
      schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
      status: "held",
      operation: "confirmRegistration",
      providerCode: route.route.providerCode,
      registrarOfRecord: route.route.registrarOfRecord,
      attemptId: attempt.attemptKey,
      operationId: attempt.operationId,
      effect: "uncertain",
      reason: "persisted_dispatch_requires_reconciliation",
      providerErrorCode: null,
      reconciliationRequired: true,
      newPreflightRequired: false,
      automaticProviderSwitch: false
    });
  }

  async function submitRegistration({
    organizationId,
    projectId,
    routeId,
    attemptKey,
    input = {}
  } = {}) {
    const claim = await repository.beginRegistrationAttempt({
      organizationId,
      projectId,
      routeId,
      attemptKey
    });
    if (!claim.claimed) {
      return Object.freeze({
        replayed: true,
        route: claim.route,
        attempt: claim.attempt,
        outcome:
          claim.attempt.reconciliationOutcome ??
          claim.attempt.submissionOutcome ??
          heldReplay(claim.route, claim.attempt)
      });
    }
    const outcome = await routing.submitRegistration({
      route: claim.route.route,
      input: {
        ...structuredClone(input),
        attemptId: claim.attempt.attemptKey,
        domain: claim.route.route.domain,
        years: claim.route.route.years,
        expectedPrice: claim.route.route.expectedPrice
      }
    });
    const attempt = await repository.recordRegistrationOutcome({
      organizationId,
      projectId,
      attemptId: claim.attempt.id,
      outcome
    });
    return Object.freeze({
      replayed: false,
      route: claim.route,
      attempt,
      outcome
    });
  }

  async function reconcileRegistration({
    organizationId,
    projectId,
    routeId,
    attemptKey,
    expectedRegistrantContactId
  } = {}) {
    const claim = await repository.beginRegistrationAttempt({
      organizationId,
      projectId,
      routeId,
      attemptKey
    });
    const { route, attempt } = claim;
    if (attempt.state === "succeeded") {
      return Object.freeze({
        replayed: true,
        route,
        attempt,
        outcome: attempt.reconciliationOutcome,
        pin: await repository.readPin({
          organizationId,
          projectId,
          domain: route.route.domain
        })
      });
    }
    if (
      !["submitted", "uncertain"].includes(attempt.state) ||
      !attempt.operationId
    ) {
      return Object.freeze({
        replayed: true,
        route,
        attempt,
        outcome:
          attempt.submissionOutcome ?? heldReplay(route, attempt),
        pin: null
      });
    }
    const outcome = await routing.reconcileRegistration({
      route: route.route,
      operationId: attempt.operationId,
      expectedRegistrantContactId
    });
    if (outcome.status !== "active") {
      return Object.freeze({
        replayed: false,
        route,
        attempt,
        outcome,
        pin: null
      });
    }
    const persisted = await repository.persistSuccessfulPin({
      organizationId,
      projectId,
      attemptId: attempt.id,
      providerDomainRef: route.route.domain,
      reconciliationOutcome: outcome
    });
    return Object.freeze({
      replayed: persisted.replayed,
      route,
      attempt: persisted.attempt,
      outcome,
      pin: persisted.pin
    });
  }

  return Object.freeze({
    preflightRoute,
    submitRegistration,
    reconcileRegistration
  });
}
