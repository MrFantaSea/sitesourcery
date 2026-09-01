import {
  createHash,
  createHmac,
  randomUUID as systemRandomUUID
} from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  validateProjectLegalAcceptance
} from "./project-legal-authority.mjs";
import {
  canonicalJson,
  normalizeEmail,
  requiredText,
  validatePassword
} from "./security.mjs";

export const ENGAGEMENT_INVITATION_SCHEMA =
  "sitesourcery.customer-engagement-invitation/v1";
export const ENGAGEMENT_CLAIM_SCHEMA =
  "sitesourcery.customer-engagement-claim/v1";
export const ENGAGEMENT_HTTP_ROUTES = deepFreeze({
  issue: Object.freeze({
    method: "POST",
    path: "/api/v1/operator/engagement-invitations",
    session: "operator",
    bodyKeys: Object.freeze([
      "commandId",
      "customerEmail",
      "customerName",
      "organizationId",
      "organizationName",
      "projectName",
      "provenance",
      "site",
      "sourceAssessmentReportId"
    ])
  }),
  claim: Object.freeze({
    method: "POST",
    path: "/api/v1/auth/engagement-claim",
    session: "sessionless",
    bodyKeys: Object.freeze([
      "commandId",
      "legalAcceptance",
      "password",
      "token"
    ]),
    boundaryInputKeys: Object.freeze([
      "commandId",
      "legalAcceptance",
      "password",
      "token",
      "userAgentDigest"
    ])
  })
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMAND = /^[^\u0000-\u001f\u007f]{8,200}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const MAXIMUM_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function exactKeys(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "INVALID_ENGAGEMENT_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_ENGAGEMENT_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      COMMAND.test(value),
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement idempotency key is invalid.",
    { status: 400 }
  );
  return value;
}

function iso(value) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "The engagement clock is invalid.",
    { status: 500 }
  );
  return selected.toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalExternalSite(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  invariant(
    parsed !== null &&
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.pathname === "/" &&
      parsed.hostname === parsed.hostname.toLowerCase() &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u
        .test(parsed.hostname) &&
      parsed.toString() === value,
    "INVALID_ENGAGEMENT_INPUT",
    "The external site must be its canonical HTTPS root URL.",
    { status: 400 }
  );
  return Object.freeze({
    kind: "external_site",
    publicUrl: parsed.toString(),
    hostname: parsed.hostname
  });
}

function site(value) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement site is invalid.",
    { status: 400 }
  );
  if (value.kind === "new_site") {
    exactKeys(value, ["kind"], "site");
    return Object.freeze({ kind: "new_site", publicUrl: null, hostname: null });
  }
  exactKeys(value, ["kind", "publicUrl"], "site");
  invariant(
    value.kind === "external_site",
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement site kind is invalid.",
    { status: 400 }
  );
  return canonicalExternalSite(value.publicUrl);
}

export function validateEngagementInvitationIssue(input) {
  exactKeys(input, ENGAGEMENT_HTTP_ROUTES.issue.bodyKeys, "invitation");
  const provenance = input.provenance;
  invariant(
    provenance === "direct_custom_inquiry" ||
      provenance === "delivered_assessment_successor",
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement provenance is invalid.",
    { status: 400 }
  );
  const organizationId = uuid(
    input.organizationId,
    "organizationId",
    { nullable: true }
  );
  const sourceAssessmentReportId = uuid(
    input.sourceAssessmentReportId,
    "sourceAssessmentReportId",
    { nullable: true }
  );
  invariant(
    (provenance === "direct_custom_inquiry" &&
      sourceAssessmentReportId === null) ||
      (provenance === "delivered_assessment_successor" &&
        organizationId !== null &&
        sourceAssessmentReportId !== null),
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement provenance binding is invalid.",
    { status: 400 }
  );
  const organizationName = input.organizationName === null
    ? null
    : requiredText(input.organizationName, "Organization name", 120, 2);
  invariant(
    organizationId === null
      ? organizationName !== null
      : organizationName === null,
    "INVALID_ENGAGEMENT_INPUT",
    "Organization name is required only for a new customer organization.",
    { status: 400 }
  );
  return deepFreeze({
    commandId: commandId(input.commandId),
    customerEmail: normalizeEmail(input.customerEmail),
    customerName: requiredText(input.customerName, "Customer name", 100),
    organizationId,
    organizationName,
    projectName: requiredText(input.projectName, "Project name", 120, 2),
    provenance,
    site: site(input.site),
    sourceAssessmentReportId
  });
}

export function validateEngagementClaim(input, legalAuthority) {
  exactKeys(
    input,
    ENGAGEMENT_HTTP_ROUTES.claim.boundaryInputKeys,
    "claim"
  );
  invariant(
    typeof input.token === "string" && TOKEN.test(input.token),
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement claim is invalid.",
    { status: 400 }
  );
  invariant(
    input.userAgentDigest === null ||
      (typeof input.userAgentDigest === "string" &&
        /^[a-f0-9]{64}$/u.test(input.userAgentDigest)),
    "INVALID_ENGAGEMENT_INPUT",
    "The engagement claim client digest is invalid.",
    { status: 400 }
  );
  return Object.freeze({
    commandId: commandId(input.commandId),
    legalAcceptance: validateProjectLegalAcceptance(
      input.legalAcceptance,
      legalAuthority
    ),
    password: validatePassword(input.password),
    token: input.token,
    userAgentDigest: input.userAgentDigest
  });
}

function actorId(actor) {
  invariant(
    actor && typeof actor.userId === "string" && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in before issuing customer engagement invitations.",
    { status: 401 }
  );
  return actor.userId;
}

function deriveToken(secret, purpose) {
  return createHmac("sha256", secret)
    .update(purpose, "utf8")
    .digest("base64url");
}

function genericClaimFailure() {
  return new HostedError(
    "ENGAGEMENT_CLAIM_FAILED",
    "That engagement invitation is invalid, expired, or already used.",
    { status: 409 }
  );
}

export function createHeldHostedEngagementBootstrap() {
  const held = () => {
    throw new HostedError(
      "ENGAGEMENT_BOOTSTRAP_HELD",
      "Customer engagement invitations are not configured.",
      { status: 503 }
    );
  };
  return Object.freeze({
    readiness: () => Object.freeze({ state: "held", providerEffects: false }),
    issueInvitation: held,
    claimInvitation: held
  });
}

export function createHostedEngagementBootstrap({
  repository,
  legalAuthority,
  tokenSecret,
  clock = () => new Date(),
  randomUUID = systemRandomUUID,
  invitationTtlMs = INVITATION_TTL_MS
} = {}) {
  invariant(
    repository &&
      typeof repository.issueInvitation === "function" &&
      typeof repository.claimInvitation === "function",
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "The customer engagement repository is required.",
    { status: 500 }
  );
  invariant(
    legalAuthority?.acceptanceSchema ===
      "sitesourcery.project-legal-acceptance/v7" &&
      typeof legalAuthority.authorityDigest === "string",
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "Released joint legal V7 authority is required for engagement claims.",
    { status: 500 }
  );
  invariant(
    Buffer.isBuffer(tokenSecret) && tokenSecret.byteLength >= 32,
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "The engagement token secret must contain at least 32 bytes.",
    { status: 500 }
  );
  invariant(
    Number.isInteger(invitationTtlMs) &&
      invitationTtlMs >= 60 * 60 * 1000 &&
      invitationTtlMs <= MAXIMUM_INVITATION_TTL_MS,
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "The engagement invitation lifetime is invalid.",
    { status: 500 }
  );

  return Object.freeze({
    async readiness() {
      const storage = typeof repository.readiness === "function"
        ? await repository.readiness()
        : { ready: false, code: "ENGAGEMENT_REPOSITORY_READINESS_REQUIRED" };
      return Object.freeze({
        state: storage.ready === true ? "ready" : "held",
        providerEffects: false,
        invitationSchema: ENGAGEMENT_INVITATION_SCHEMA,
        claimSchema: ENGAGEMENT_CLAIM_SCHEMA,
        ...(storage.ready === true
          ? {}
          : { code: storage.code ?? "ENGAGEMENT_REPOSITORY_NOT_READY" })
      });
    },

    async issueInvitation(actor, input) {
      const operatorUserId = actorId(actor);
      const selected = validateEngagementInvitationIssue(input);
      const requestDigest = sha256(canonicalJson(selected));
      const issuedAt = iso(clock());
      const expiresAt = new Date(
        Date.parse(issuedAt) + invitationTtlMs
      ).toISOString();
      const claimToken = deriveToken(
        tokenSecret,
        `engagement-invitation/v1\u0000${operatorUserId}\u0000${selected.commandId}\u0000${requestDigest}`
      );
      const result = await repository.issueInvitation({
        ...selected,
        accountCandidateUserId: randomUUID(),
        invitationId: randomUUID(),
        legalAcceptanceSchema: legalAuthority.acceptanceSchema,
        legalAuthorityDigest: legalAuthority.authorityDigest,
        operatorUserId,
        requestDigest,
        reservedOrganizationId: selected.organizationId ?? randomUUID(),
        reservedProjectId: randomUUID(),
        tokenDigest: sha256(claimToken),
        issuedAt,
        expiresAt
      });
      return deepFreeze({
        ...result,
        schema: ENGAGEMENT_INVITATION_SCHEMA,
        claimToken
      });
    },

    async claimInvitation(input) {
      const selected = validateEngagementClaim(input, legalAuthority);
      const claimRequestDigest = sha256(canonicalJson({
        commandId: selected.commandId,
        legalAcceptance: selected.legalAcceptance,
        userAgentDigest: selected.userAgentDigest
      }));
      const sessionToken = deriveToken(
        tokenSecret,
        `engagement-session/v1\u0000${selected.token}\u0000${selected.commandId}`
      );
      try {
        const result = await repository.claimInvitation({
          claimCommandId: selected.commandId,
          claimRequestDigest,
          engagementId: randomUUID(),
          legalAcceptance: selected.legalAcceptance,
          password: selected.password,
          sessionId: randomUUID(),
          sessionToken,
          tokenDigest: sha256(selected.token),
          userAgentDigest: selected.userAgentDigest
        });
        return deepFreeze({
          ...result,
          schema: ENGAGEMENT_CLAIM_SCHEMA,
          sessionToken
        });
      } catch (error) {
        if (
          error?.code === "ENGAGEMENT_CONFIGURATION_ERROR" ||
          error?.code === "LEGAL_CONFIGURATION_REQUIRED"
        ) {
          throw error;
        }
        throw genericClaimFailure();
      }
    }
  });
}
