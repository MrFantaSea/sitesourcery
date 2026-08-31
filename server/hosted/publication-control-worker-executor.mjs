import { invariant } from "./errors.mjs";

const PURPOSE = "alakazam-publication";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ACTIONS = new Set(["publish", "rollback", "unpublish"]);

function exactClaim(value) {
  invariant(
    value && typeof value === "object" &&
      UUID.test(value.jobId) && UUID.test(value.projectId) &&
      ACTIONS.has(value.action) &&
      typeof value.hostname === "string" && value.hostname.length > 0 &&
      Number.isSafeInteger(value.fence) && value.fence > 0 &&
      Number.isSafeInteger(value.attemptCount) && value.attemptCount > 0 &&
      (
        value.action === "unpublish"
          ? value.proof === null && value.releaseId === null
          : value.proof && UUID.test(value.releaseId)
      ),
    "PUBLICATION_CONTROL_JOB_INVALID",
    "The publication-control job is invalid.",
    { status: 409 }
  );
  return value;
}

function exactAppliedResult(claim, result) {
  invariant(
    result && typeof result === "object" &&
      typeof result.providerRequestId === "string" &&
      result.providerRequestId.length > 0,
    "PUBLICATION_CONTROL_EFFECT_UNCONFIRMED",
    "The publication result was not confirmed.",
    { status: 503 }
  );
  if (claim.action === "unpublish") {
    invariant(
      result.status === "unpublished" && result.published === false,
      "PUBLICATION_CONTROL_EFFECT_UNCONFIRMED",
      "The site was not confirmed unpublished.",
      { status: 503 }
    );
    return Object.freeze({
      action: claim.action,
      providerRequestId: result.providerRequestId,
      status: "unpublished",
      published: false,
      replay: result.replay === true,
      releaseId: null,
      manifestDigest: null,
      bindingRevision:
        Number.isSafeInteger(result.bindingRevision) &&
          result.bindingRevision >= 0
          ? result.bindingRevision
          : null
    });
  }
  invariant(
    result.status === "released" && result.published === true &&
      result.releaseId === claim.releaseId &&
      SHA256.test(result.manifestDigest) &&
      Number.isSafeInteger(result.bindingRevision) &&
      result.bindingRevision >= 0,
    "PUBLICATION_CONTROL_EFFECT_UNCONFIRMED",
    "The requested release was not confirmed live.",
    { status: 503 }
  );
  return Object.freeze({
    action: claim.action,
    providerRequestId: result.providerRequestId,
    status: "released",
    published: true,
    replay: result.replay === true,
    releaseId: result.releaseId,
    manifestDigest: result.manifestDigest,
    bindingRevision: result.bindingRevision
  });
}

export function createPublicationControlWorkerExecutor({
  publicationPort
} = {}) {
  invariant(
    publicationPort &&
      typeof publicationPort.readiness === "function" &&
      typeof publicationPort.request === "function" &&
      typeof publicationPort.rollback === "function" &&
      typeof publicationPort.unpublish === "function",
    "PUBLICATION_CONTROL_WORKER_CONFIGURATION_REQUIRED",
    "The private publication command client is required.",
    { status: 500 }
  );

  return Object.freeze({
    kind: `${PURPOSE}-executor`,
    providerEffects: true,
    async readiness() {
      const current = await publicationPort.readiness();
      const ready = current?.ready === true && current?.held === false;
      return Object.freeze({
        ready,
        verified: ready,
        providerEffects: ready,
        code: ready ? null : "PUBLICATION_CONTROL_PORT_NOT_RELEASED"
      });
    },
    async execute(value) {
      const claim = exactClaim(value);
      try {
        const result = claim.action === "publish"
          ? await publicationPort.request(claim.proof)
          : claim.action === "rollback"
            ? await publicationPort.rollback(claim.proof)
            : await publicationPort.unpublish({
                projectId: claim.projectId,
                hostname: claim.hostname
              });
        return Object.freeze({
          receiptKind: "publication_applied",
          result: exactAppliedResult(claim, result)
        });
      } catch (error) {
        if (error?.details?.effectCertainty !== "unknown") throw error;
        return Object.freeze({
          receiptKind: "reconciliation_required",
          result: Object.freeze({
            action: claim.action,
            providerRequestId: null,
            status: "unknown",
            published: null,
            replay: false,
            releaseId: claim.releaseId,
            manifestDigest: null,
            bindingRevision: null,
            failureCode:
              typeof error?.code === "string"
                ? error.code.slice(0, 128)
                : "PUBLICATION_CONTROL_EFFECT_AMBIGUOUS"
          })
        });
      }
    }
  });
}
