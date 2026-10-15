import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { digest, normalizeDomain } from "../domain/canonical.mjs";
import { createSpaceshipDomainReadAdapter } from "../domain/adapters/spaceship.mjs";
import { createHeldDomainProviderLifecycle, DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA } from "../domain/provider-lifecycle.mjs";
import { createPostgresDomainLifecycleRepository } from "./domain-lifecycle-postgres.mjs";
import { invariant } from "./errors.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const APPROVAL_PATH = "/etc/sitesourcery/domain/readback-approval.json";
const CREDENTIAL_DIRECTORY = "/run/credentials/sitesourcery-hq-workers.service";
const CREDENTIAL_NAME = "spaceship-domain-readonly.json";
const STATES = Object.freeze({ registered: "active", grace1: "grace", grace2: "grace", redemption: "redemption" });
const LIMITING_EPP = new Set(["clientHold", "serverHold", "pendingDelete", "redemptionPeriod", "serverTransferProhibited"]);

function fail(code, message) { invariant(false, code, message, { status: 503 }); }
function manual(reason) {
  return Object.freeze({ receiptKind: "manual_review", result: { terminal: false, reason, providerEffects: false } });
}
function validateClaim(claim) {
  const lifecycle = claim?.lifecycle;
  invariant(claim?.schema === "sitesourcery.domain-lifecycle-worker-claim/v1" &&
    [claim.jobId, claim.organizationId, claim.projectId, claim.lifecycleStateId].every(id => UUID.test(id ?? "")) &&
    Number.isSafeInteger(claim.fence) && claim.fence > 0 && Number.isFinite(Date.parse(claim.leaseExpiresAt)) &&
    claim.action === "refresh_authoritative" && lifecycle?.schema === "sitesourcery.domain-provider-lifecycle/v1" &&
    lifecycle.scope?.organizationId === claim.organizationId && lifecycle.scope?.projectId === claim.projectId &&
    UUID.test(lifecycle.scope?.customerId ?? "") && lifecycle.scope.actorId === lifecycle.scope.customerId &&
    lifecycle.pin?.providerCode === "spaceship" && typeof lifecycle.pin?.domain === "string",
  "DOMAIN_LIFECYCLE_CLAIM_INVALID", "Domain readback claim is invalid.", { status: 409 });
  const { fingerprint, ...pin } = lifecycle.pin;
  invariant(fingerprint === digest(pin) && normalizeDomain(pin.domain) === pin.domain,
    "DOMAIN_LIFECYCLE_CLAIM_INVALID", "Domain provider pin is invalid.", { status: 409 });
  return lifecycle;
}

async function assertClaim(client, claim, { lock = false, matchState = true } = {}) {
  // pg exposes timestamps as millisecond JS Dates. Compare that claim precision,
  // but check actual expiry against the database clock without rounding it.
  const result = await client.query(`
    select job.id
      from ss.domain_lifecycle_worker_jobs job
      join ss.domain_provider_lifecycle_states lifecycle on lifecycle.id = job.lifecycle_state_id
     where job.id = $1 and job.organization_id = $2 and job.project_id = $3
       and job.lifecycle_state_id = $4 and job.state = 'running' and job.lease_fence = $5
       and date_trunc('milliseconds', job.lease_expires_at) = $6::timestamptz
       and job.lease_expires_at > clock_timestamp()
       and lifecycle.organization_id = $2 and lifecycle.project_id = $3
       and lifecycle.provider_code = 'spaceship'
       and (not $8::boolean or lifecycle.state_digest = $7)
     ${lock ? "for update of job, lifecycle" : ""}
  `, [claim.jobId, claim.organizationId, claim.projectId, claim.lifecycleStateId,
    claim.fence, claim.leaseExpiresAt, digest(claim.lifecycle), matchState]);
  invariant(result.rowCount === 1, "DOMAIN_LIFECYCLE_WORKER_LEASE_LOST",
    "Domain readback claim expired, changed or was replaced.", { status: 409 });
}

// Uses the existing canonical lifecycle reducer and repository. The worker lease
// is locked and checked in the same transaction as every lifecycle write.
export function createSpaceshipDomainLifecycleExecutor({ authority, reader, clock = { now: () => new Date().toISOString() } } = {}) {
  invariant(authority?.kind === "canonical-postgres" && typeof authority.service === "function" &&
    reader?.readOnly === true && reader?.providerEffects === false && typeof reader.getDomain === "function",
  "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED", "A canonical read-only Domain adapter is required.", { status: 500 });
  const repository = createPostgresDomainLifecycleRepository({ authority });
  return Object.freeze({ kind: "domain-lifecycle-executor", readOnly: true, providerEffects: false,
    async readiness() {
      const storage = await repository.readiness();
      return Object.freeze({ ready: storage.ready, verified: storage.ready, mode: "reviewed_readonly",
        readOnly: true, providerEffects: false, providerAuthenticationVerified: false });
    },
    async execute(claim, { signal } = {}) {
      const lifecycle = validateClaim(claim);
      if (signal?.aborted) fail("DOMAIN_LIFECYCLE_READBACK_ABORTED", "Domain readback was cancelled.");
      await authority.service({ actorKind: "system", organizationId: claim.organizationId, readOnly: true },
        client => assertClaim(client, claim));
      let observed;
      try { observed = await reader.getDomain({ domain: lifecycle.pin.domain, signal }); }
      catch (error) {
        if (error?.code === "spaceship_http_404") return manual("provider_domain_not_found_requires_review");
        fail("DOMAIN_LIFECYCLE_READBACK_UNAVAILABLE", "The registrar readback could not be verified.");
      }
      if (signal?.aborted) fail("DOMAIN_LIFECYCLE_READBACK_ABORTED", "Domain readback was cancelled.");
      const observedAt = new Date(clock.now()).toISOString();
      if (observed.name !== lifecycle.pin.domain || !STATES[observed.lifecycleStatus] ||
          observed.autoRenew !== false || !Number.isFinite(Date.parse(observed.expirationDate)) ||
          !Array.isArray(observed.eppStatuses) || !Array.isArray(observed.suspensions)) {
        return manual("provider_lifecycle_requires_review");
      }
      if (observed.suspensions.length || observed.eppStatuses.some(status => LIMITING_EPP.has(status)) ||
          (observed.lifecycleStatus === "registered" && Date.parse(observed.expirationDate) <= Date.parse(observedAt))) {
        return manual("provider_restriction_requires_review");
      }
      // GET domain info cannot prove the operation that renewed/transferred a
      // domain. Do not manufacture those IDs or complete uncertain operations.
      const readback = Object.freeze({
        schema: DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA,
        authoritative: true, providerCode: "spaceship", domain: lifecycle.pin.domain,
        lifecycleStatus: STATES[observed.lifecycleStatus], expirationDate: observed.expirationDate,
        autoRenew: false, transferStatus: observed.eppStatuses.includes("pendingTransfer") ? "pending" : "none",
        transferEligible: false, transferLocked: observed.eppStatuses.includes("clientTransferProhibited"),
        observedAt, providerReference: `spaceship-domain:${digest({ domain: observed.name, lifecycleStatus: observed.lifecycleStatus,
          expirationDate: observed.expirationDate, autoRenew: observed.autoRenew, eppStatuses: observed.eppStatuses })}`,
        renewalOperationId: null, transferOperationId: null
      });
      const fencedAuthority = { kind: "canonical-postgres", service(options, callback) {
        return authority.service({ ...options, actorKind: "system" }, async client => {
          await assertClaim(client, claim, { lock: true });
          const result = await callback(client);
          await assertClaim(client, claim, { matchState: false });
          return result;
        });
      } };
      const core = createHeldDomainProviderLifecycle({
        repository: createPostgresDomainLifecycleRepository({ authority: fencedAuthority }), clock,
        providerReadPort: {
          async readLifecycle() { return readback; },
          async previewRenewal() { fail("DOMAIN_RENEWAL_PREVIEW_HELD", "Renewal pricing remains held."); }
        }
      });
      const result = await core.refreshAuthoritative({ scope: lifecycle.scope, pin: lifecycle.pin,
        commandId: `worker-readback-${claim.jobId}-${claim.fence}` });
      const unresolved = [result.customer?.renewal?.status, result.customer?.transfer?.status]
        .some(status => ["submitted", "uncertain", "dispatching"].includes(status));
      const review = result.customer?.review ?? result.operator?.review ??
        (unresolved ? { reason: "operation_readback_requires_review" } : null);
      return Object.freeze({ receiptKind: review ? "manual_review" : "lifecycle_refreshed",
        result: { terminal: false, lifecycleStatus: readback.lifecycleStatus,
          evidenceDigest: digest(readback), reviewReason: review?.reason ?? null, providerEffects: false } });
    }
  });
}

export async function readPrivateSpaceshipJson(filename, { secret = true, uid = process.getuid?.(), metadataOnly = false } = {}) {
  invariant(path.isAbsolute(filename) && await realpath(path.dirname(filename)) === path.dirname(filename),
    "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID", "The private readback file path is invalid.", { status: 500 });
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    invariant(stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= 8192 &&
      (secret ? stat.uid === uid && (stat.mode & 0o077) === 0 : [0, uid].includes(stat.uid) && (stat.mode & 0o022) === 0),
    "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID", "The private readback file custody is invalid.", { status: 500 });
    return metadataOnly ? {} : { bytes: await file.readFile() };
  } finally { await file.close(); }
}

export async function createSiteSourceryDomainLifecycleExecutor({ authority, clock, environment = process.env } = {}) {
  invariant(environment.SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODE === "reviewed" &&
    environment.SITESOURCERY_SPACESHIP_READBACK_APPROVAL_FILE === APPROVAL_PATH &&
    /^[a-f0-9]{64}$/u.test(environment.SITESOURCERY_SPACESHIP_READBACK_APPROVAL_SHA256 ?? "") &&
    environment.CREDENTIALS_DIRECTORY === CREDENTIAL_DIRECTORY,
  "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED", "Reviewed domain readback custody is not configured.", { status: 500 });
  const { bytes } = await readPrivateSpaceshipJson(APPROVAL_PATH, { secret: false });
  invariant(createHash("sha256").update(bytes).digest("hex") === environment.SITESOURCERY_SPACESHIP_READBACK_APPROVAL_SHA256,
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED", "Readback approval bytes changed.", { status: 500 });
  const liveApproval = JSON.parse(bytes.toString("utf8"));
  await readPrivateSpaceshipJson(path.join(CREDENTIAL_DIRECTORY, CREDENTIAL_NAME), { metadataOnly: true });
  const vault = { async readProviderCredentials() {
    try {
      const file = await readPrivateSpaceshipJson(path.join(CREDENTIAL_DIRECTORY, CREDENTIAL_NAME));
      const parsed = JSON.parse(file.bytes.toString("utf8"));
      invariant(Object.keys(parsed).sort().join() === "apiKey,apiSecret", "DOMAIN_LIFECYCLE_CREDENTIALS_INVALID", "Credential fields are invalid.");
      return parsed;
    } catch { fail("DOMAIN_LIFECYCLE_CREDENTIALS_INVALID", "Domain readback credentials are unavailable."); }
  } };
  const reader = createSpaceshipDomainReadAdapter({ mode: "approved_live", liveApproval, vault, clock });
  return createSpaceshipDomainLifecycleExecutor({ authority, reader, clock });
}
