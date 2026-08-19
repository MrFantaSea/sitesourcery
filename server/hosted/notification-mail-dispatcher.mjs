import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,499}$/u;
const SAFE_PROVIDER = /^[a-z][a-z0-9_-]{1,39}$/u;
const SAFE_TEMPLATE = /^[a-z0-9][a-z0-9._:-]{1,79}$/u;
const SAFE_WORKER = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const DISPATCHABLE_TYPES = new Set([
  "support_notification",
  "commerce_customer_notification",
  "commerce_operator_notification",
  "purpose_customer_notification"
]);
const NON_DISPATCHABLE_STATES = new Set([
  "provider_accepted",
  "delivered",
  "bounced",
  "complained",
  "suppressed",
  "expired"
]);

function exactObject(value, keys, field, {
  code = "NOTIFICATION_MAIL_INVALID",
  status = 400
} = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    code,
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "NOTIFICATION_MAIL_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function now(clock) {
  const selected = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "NOTIFICATION_MAIL_CONFIGURATION_REQUIRED",
    "The notification mail clock is invalid.",
    { status: 500 }
  );
  return selected;
}

function text(value, field, maximum) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
    "NOTIFICATION_MAIL_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function address(value) {
  const selected = text(value, "Notification recipient", 320).trim().toLowerCase();
  invariant(
    selected === value &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(selected),
    "NOTIFICATION_MAIL_INVALID",
    "Notification recipient is invalid.",
    { status: 400 }
  );
  return selected;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "NOTIFICATION_MAIL_INVALID",
    `${field} must be a lowercase SHA-256 digest.`,
    { status: 400 }
  );
  return value;
}

export function notificationMailEvidence(input) {
  exactObject(
    input,
    ["html", "subject", "subjectReference", "templateVersion", "text", "to"],
    "Rendered notification"
  );
  const to = address(input.to);
  const templateVersion = text(input.templateVersion, "Template version", 80);
  invariant(
    SAFE_TEMPLATE.test(templateVersion),
    "NOTIFICATION_MAIL_INVALID",
    "Template version is invalid.",
    { status: 400 }
  );
  const subjectReference = text(
    input.subjectReference,
    "Subject reference",
    500
  );
  const subject = text(input.subject, "Notification subject", 300);
  const bodyText = text(input.text, "Notification text", 100_000);
  const html = input.html === null
    ? null
    : text(input.html, "Notification HTML", 200_000);
  const recipientDigest = digest(to);
  const subjectReferenceDigest = digest({
    schema: "sitesourcery.notification-mail-subject-reference/v1",
    subjectReference,
    templateVersion
  });
  const contentDigest = digest({
    schema: "sitesourcery.notification-mail-content/v1",
    templateVersion,
    recipientDigest,
    subjectReferenceDigest,
    subject,
    text: bodyText,
    html
  });
  return deepFreeze({
    to,
    subject,
    text: bodyText,
    html,
    templateVersion,
    recipientDigest,
    subjectReferenceDigest,
    contentDigest
  });
}

function claimedReservation(value) {
  exactObject(
    value,
    [
      "attemptNumber",
      "claimedAt",
      "contentDigest",
      "expiresAt",
      "fenceToken",
      "leaseExpiresAt",
      "messageId",
      "messageType",
      "providerEffects",
      "providerIdempotencyKey",
      "recipientDigest",
      "sourceKind",
      "sourceReservationDigest",
      "sourceReservationId",
      "state",
      "status",
      "subjectReferenceDigest",
      "templateVersion",
      "workerId"
    ],
    "Claimed notification reservation"
  );
  invariant(
    UUID.test(value.messageId) &&
      DISPATCHABLE_TYPES.has(value.messageType) &&
      SAFE_TEMPLATE.test(value.templateVersion) &&
      value.state === "pending" &&
      value.status === "claimed" &&
      value.providerEffects === false &&
      ["support", "commerce", "purpose"].includes(value.sourceKind) &&
      UUID.test(value.sourceReservationId) &&
      SHA256.test(value.sourceReservationDigest) &&
      SAFE_WORKER.test(value.workerId) &&
      Number.isSafeInteger(value.attemptNumber) &&
      value.attemptNumber >= 1 &&
      Number.isSafeInteger(value.fenceToken) &&
      value.fenceToken >= 1 &&
      value.providerIdempotencyKey ===
        `sitesourcery-notification/${value.messageId}`,
    "NOTIFICATION_MAIL_INVALID",
    "Notification dispatch claim identity is invalid.",
    { status: 400 }
  );
  const claimedAt = instant(value.claimedAt, "Claim time");
  const leaseExpiresAt = instant(value.leaseExpiresAt, "Claim lease expiry");
  invariant(
    Date.parse(leaseExpiresAt) > Date.parse(claimedAt) &&
      Date.parse(leaseExpiresAt) <= Date.parse(claimedAt) + 300_000,
    "NOTIFICATION_MAIL_INVALID",
    "Notification dispatch lease is invalid.",
    { status: 400 }
  );
  return deepFreeze({
    messageId: value.messageId,
    messageType: value.messageType,
    recipientDigest: sha256(value.recipientDigest, "Recipient digest"),
    subjectReferenceDigest: sha256(
      value.subjectReferenceDigest,
      "Subject reference digest"
    ),
    contentDigest: sha256(value.contentDigest, "Content digest"),
    templateVersion: value.templateVersion,
    state: value.state,
    expiresAt: instant(value.expiresAt, "Notification expiry"),
    sourceKind: value.sourceKind,
    sourceReservationId: value.sourceReservationId,
    sourceReservationDigest: value.sourceReservationDigest,
    workerId: value.workerId,
    attemptNumber: value.attemptNumber,
    fenceToken: value.fenceToken,
    claimedAt,
    leaseExpiresAt,
    providerIdempotencyKey: value.providerIdempotencyKey
  });
}

function boundary(value, methods, field, { providerEffects }) {
  invariant(
    value &&
      value.providerEffects === providerEffects &&
      methods.every((method) => typeof value[method] === "function"),
    "NOTIFICATION_MAIL_CONFIGURATION_REQUIRED",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

async function ready(value) {
  const status = await value.readiness();
  return status?.ready === true && status?.verified === true;
}

function heldError() {
  return new HostedError(
    "NOTIFICATION_MAIL_DISPATCH_HELD",
    "Notification dispatch is held.",
    { status: 503, details: { providerEffects: false } }
  );
}

export function createHeldNotificationMailDispatcher() {
  return Object.freeze({
    kind: "notification-mail-dispatcher",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "notification-mail-dispatcher",
        mode: "held",
        providerEffects: false,
        code: "NOTIFICATION_MAIL_DISPATCH_HELD"
      });
    },
    async dispatch() { throw heldError(); }
  });
}

export function createNotificationMailDispatcher({
  source,
  renderer,
  providerPort,
  lifecycle,
  leaseMs = 120_000,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selectedSource = boundary(
    source,
    ["readiness", "claimForDispatch", "completeDispatch"],
    "The durable notification source",
    { providerEffects: false }
  );
  const selectedRenderer = boundary(
    renderer,
    ["readiness", "render"],
    "The notification renderer",
    { providerEffects: false }
  );
  const selectedProvider = boundary(
    providerPort,
    ["readiness", "sendNotification"],
    "The notification provider",
    { providerEffects: true }
  );
  const selectedLifecycle = boundary(
    lifecycle,
    ["readiness", "recordProviderAcceptance"],
    "The durable mail lifecycle",
    { providerEffects: false }
  );
  invariant(
    Number.isSafeInteger(leaseMs) && leaseMs >= 30_000 && leaseMs <= 300_000,
    "NOTIFICATION_MAIL_CONFIGURATION_REQUIRED",
    "The notification dispatch lease is invalid.",
    { status: 500 }
  );

  async function readiness() {
    const statuses = await Promise.all([
      selectedSource.readiness(),
      selectedRenderer.readiness(),
      selectedProvider.readiness(),
      selectedLifecycle.readiness()
    ]);
    const allReady = statuses.every(
      (status) => status?.ready === true && status?.verified === true
    );
    return deepFreeze({
      ready: allReady,
      verified: allReady,
      kind: "notification-mail-dispatcher",
      mode: "provider-bound-held-wiring",
      providerEffects: true,
      code: allReady
        ? null
        : statuses.find(
            (status) => status?.ready !== true || status?.verified !== true
          )?.code ?? "NOTIFICATION_MAIL_DISPATCH_NOT_READY"
    });
  }

  async function dispatch(input = {}) {
    exactObject(input, ["messageId", "workerId"], "Notification dispatch");
    const { messageId, workerId } = input;
    invariant(
      typeof messageId === "string" && UUID.test(messageId) &&
        typeof workerId === "string" && SAFE_WORKER.test(workerId),
      "NOTIFICATION_MAIL_INVALID",
      "Notification message or worker ID is invalid.",
      { status: 400 }
    );
    invariant(
      await ready(selectedSource) &&
        await ready(selectedRenderer) &&
        await ready(selectedProvider) &&
        await ready(selectedLifecycle),
      "NOTIFICATION_MAIL_DISPATCH_NOT_READY",
      "Notification mail dispatch is not ready.",
      { status: 503, details: { providerEffects: false } }
    );
    const claim = await selectedSource.claimForDispatch({
      messageId,
      workerId,
      leaseMs
    });
    if (claim?.status === "already_recorded") {
      invariant(
        claim.messageId === messageId &&
          NON_DISPATCHABLE_STATES.has(claim.lifecycleState) &&
          claim.providerEffects === false,
        "NOTIFICATION_MAIL_SOURCE_CONFLICT",
        "The notification source returned invalid recorded state.",
        { status: 409 }
      );
      return deepFreeze({
        schema: "sitesourcery.notification-mail-dispatch-receipt/v1",
        messageId,
        dispatchState: "already_recorded",
        lifecycleState: claim.lifecycleState,
        providerEffects: false
      });
    }
    if (claim?.status === "busy") {
      invariant(
        claim.messageId === messageId &&
          claim.providerEffects === false &&
          typeof claim.busyUntil === "string" &&
          Number.isFinite(Date.parse(claim.busyUntil)),
        "NOTIFICATION_MAIL_SOURCE_CONFLICT",
        "The notification source returned invalid busy state.",
        { status: 409 }
      );
      return deepFreeze({
        schema: "sitesourcery.notification-mail-dispatch-receipt/v1",
        messageId,
        dispatchState: "busy",
        lifecycleState: "pending",
        retryAfter: new Date(claim.busyUntil).toISOString(),
        providerEffects: false
      });
    }
    if (claim?.status === "expired") {
      invariant(
        claim.messageId === messageId && claim.providerEffects === false,
        "NOTIFICATION_MAIL_SOURCE_CONFLICT",
        "The notification source returned invalid expiry state.",
        { status: 409 }
      );
      return deepFreeze({
        schema: "sitesourcery.notification-mail-dispatch-receipt/v1",
        messageId,
        dispatchState: "expired",
        lifecycleState: "pending",
        providerEffects: false
      });
    }
    const selected = claimedReservation(claim);
    invariant(
      selected.messageId === messageId && selected.workerId === workerId,
      "NOTIFICATION_MAIL_SOURCE_CONFLICT",
      "The notification source returned a different claim.",
      { status: 409 }
    );
    const requestedAt = now(clock);
    invariant(
      Date.parse(selected.expiresAt) > Date.parse(requestedAt),
      "NOTIFICATION_MAIL_EXPIRED",
      "The notification reservation has expired.",
      { status: 409, details: { providerEffects: false } }
    );
    const rendered = notificationMailEvidence(
      await selectedRenderer.render({
        messageId: selected.messageId,
        messageType: selected.messageType,
        templateVersion: selected.templateVersion,
        recipientDigest: selected.recipientDigest,
        subjectReferenceDigest: selected.subjectReferenceDigest,
        contentDigest: selected.contentDigest,
        sourceKind: selected.sourceKind,
        sourceReservationId: selected.sourceReservationId,
        sourceReservationDigest: selected.sourceReservationDigest,
        observedAt: requestedAt
      })
    );
    invariant(
      rendered.templateVersion === selected.templateVersion &&
        rendered.recipientDigest === selected.recipientDigest &&
        rendered.subjectReferenceDigest === selected.subjectReferenceDigest &&
        rendered.contentDigest === selected.contentDigest,
      "NOTIFICATION_MAIL_EVIDENCE_CONFLICT",
      "Rendered notification evidence does not match its durable reservation.",
      { status: 409, details: { providerEffects: false } }
    );
    const dispatchAt = now(clock);
    invariant(
      Date.parse(dispatchAt) < Date.parse(selected.leaseExpiresAt) &&
        Date.parse(dispatchAt) < Date.parse(selected.expiresAt),
      "NOTIFICATION_MAIL_LEASE_EXPIRED",
      "The notification dispatch lease expired before provider access.",
      { status: 409, details: { providerEffects: false } }
    );
    const idempotencyKey = selected.providerIdempotencyKey;
    const providerRequest = deepFreeze({
      messageType: selected.messageType,
      templateVersion: selected.templateVersion,
      to: rendered.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      idempotencyKey
    });
    let providerReceipt;
    try {
      providerReceipt = await selectedProvider.sendNotification(
        providerRequest
      );
    } catch {
      // A provider can accept a request and still lose the response. Never
      // expose provider/private error material; a retry must reuse this exact
      // idempotency key so the lifecycle can reconcile one acceptance.
      throw new HostedError(
        "NOTIFICATION_MAIL_PROVIDER_UNAVAILABLE",
        "The notification provider did not return a verified receipt.",
        {
          status: 502,
          details: {
            providerEffects: "unknown",
            retryWithSameIdempotencyKey: true
          }
        }
      );
    }
    const recordedAt = now(clock);
    exactObject(
      providerReceipt,
      [
        "acceptedAt",
        "idempotencyKey",
        "payloadDigest",
        "provider",
        "providerMessageId",
        "state"
      ],
      "Provider acceptance receipt",
      { code: "NOTIFICATION_MAIL_PROVIDER_INVALID", status: 502 }
    );
    const acceptedAt = instant(
      providerReceipt.acceptedAt,
      "Provider acceptance time"
    );
    invariant(
      providerReceipt.state === "provider_accepted" &&
        providerReceipt.idempotencyKey === idempotencyKey &&
        SAFE_PROVIDER.test(providerReceipt.provider) &&
        SAFE_PROVIDER_ID.test(providerReceipt.providerMessageId) &&
        providerReceipt.payloadDigest === digest(providerRequest) &&
        Date.parse(acceptedAt) <= Date.parse(recordedAt) &&
        Date.parse(acceptedAt) < Date.parse(selected.expiresAt),
      "NOTIFICATION_MAIL_PROVIDER_INVALID",
      "The notification provider returned invalid acceptance evidence.",
      { status: 502 }
    );
    const providerMessageIdDigest = digest(providerReceipt.providerMessageId);
    const acceptanceEvidenceDigest = digest({
      schema: "sitesourcery.notification-mail-acceptance-evidence/v1",
      messageId,
      messageType: selected.messageType,
      templateVersion: selected.templateVersion,
      recipientDigest: selected.recipientDigest,
      subjectReferenceDigest: selected.subjectReferenceDigest,
      contentDigest: selected.contentDigest,
      provider: providerReceipt.provider,
      providerMessageIdDigest,
      payloadDigest: providerReceipt.payloadDigest,
      idempotencyKey,
      acceptedAt
    });
    const acceptance = await selectedLifecycle.recordProviderAcceptance({
      commandId: `notify-accept:${messageId}`,
      messageId,
      provider: providerReceipt.provider,
      providerMessageIdDigest,
      evidenceDigest: acceptanceEvidenceDigest,
      acceptedAt
    });
    invariant(
      acceptance?.acceptanceState === "provider_accepted",
      "NOTIFICATION_MAIL_ACCEPTANCE_INVALID",
      "The mail lifecycle did not record provider acceptance.",
      { status: 500 }
    );
    const completion = await selectedSource.completeDispatch({
      messageId,
      workerId,
      fenceToken: selected.fenceToken,
      closureEvidenceDigest: acceptanceEvidenceDigest
    });
    invariant(
      completion?.status === "closed" &&
        completion.messageId === messageId &&
        completion.lifecycleState === "provider_accepted" &&
        completion.fenceToken === selected.fenceToken &&
        completion.providerEffects === false,
      "NOTIFICATION_MAIL_COMPLETION_INVALID",
      "The durable dispatch claim did not close after acceptance.",
      { status: 500 }
    );
    return deepFreeze({
      schema: "sitesourcery.notification-mail-dispatch-receipt/v1",
      messageId,
      dispatchState: "provider_accepted",
      lifecycleState: "provider_accepted",
      provider: providerReceipt.provider,
      providerMessageIdDigest,
      acceptedAt,
      providerEffects: true
    });
  }

  return Object.freeze({
    kind: "notification-mail-dispatcher",
    mode: "provider-bound-held-wiring",
    providerEffects: true,
    readiness,
    dispatch
  });
}
