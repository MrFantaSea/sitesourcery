import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";
import { notificationMailEvidence } from
  "./notification-mail-dispatcher.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TEMPLATE = /^[a-z0-9][a-z0-9._:-]{1,79}$/u;
const MESSAGE_TYPES = new Set([
  "support_notification",
  "commerce_customer_notification",
  "commerce_operator_notification",
  "purpose_customer_notification"
]);

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "NOTIFICATION_PRIVATE_RESOLUTION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function boundary(value, method, field) {
  invariant(
    value &&
      value.providerEffects === false &&
      typeof value.readiness === "function" &&
      typeof value[method] === "function",
    "NOTIFICATION_PRIVATE_RESOLUTION_CONFIGURATION_REQUIRED",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function held(kind, method, code) {
  return Object.freeze({
    kind,
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind,
        mode: "held",
        providerEffects: false,
        code
      });
    },
    async [method]() {
      throw new HostedError(
        code,
        "Private notification resolution is held.",
        { status: 503, details: { providerEffects: false } }
      );
    }
  });
}

export function createHeldNotificationRecipientResolver() {
  return held(
    "notification-recipient-resolver",
    "resolve",
    "NOTIFICATION_RECIPIENT_RESOLUTION_HELD"
  );
}

export function createHeldNotificationTemplateRegistry() {
  return held(
    "notification-template-registry",
    "render",
    "NOTIFICATION_TEMPLATE_REGISTRY_HELD"
  );
}

export function createHeldPrivateNotificationMailRenderer() {
  return held(
    "private-notification-mail-renderer",
    "render",
    "NOTIFICATION_PRIVATE_RENDERER_HELD"
  );
}

export function createPrivateNotificationMailRenderer({
  recipientResolver,
  templateRegistry
} = {}) {
  const recipients = boundary(
    recipientResolver,
    "resolve",
    "The private recipient resolver"
  );
  const templates = boundary(
    templateRegistry,
    "render",
    "The private template registry"
  );

  async function readiness() {
    const [recipientStatus, templateStatus] = await Promise.all([
      recipients.readiness(),
      templates.readiness()
    ]);
    const ready = recipientStatus?.ready === true &&
      recipientStatus?.verified === true &&
      templateStatus?.ready === true &&
      templateStatus?.verified === true;
    return deepFreeze({
      ready,
      verified: ready,
      kind: "private-notification-mail-renderer",
      mode: "private-resolvers",
      providerEffects: false,
      code: ready
        ? null
        : recipientStatus?.code ?? templateStatus?.code ??
          "NOTIFICATION_PRIVATE_RENDERER_NOT_READY"
    });
  }

  async function render(input) {
    exactObject(
      input,
      [
        "contentDigest",
        "messageId",
        "messageType",
        "observedAt",
        "recipientDigest",
        "sourceKind",
        "sourceReservationDigest",
        "sourceReservationId",
        "subjectReferenceDigest",
        "templateVersion"
      ],
      "Private render request"
    );
    invariant(
      UUID.test(input.messageId) &&
        MESSAGE_TYPES.has(input.messageType) &&
        typeof input.observedAt === "string" &&
        Number.isFinite(Date.parse(input.observedAt)) &&
        new Date(input.observedAt).toISOString() === input.observedAt &&
        SHA256.test(input.recipientDigest) &&
        SHA256.test(input.subjectReferenceDigest) &&
        SHA256.test(input.contentDigest) &&
        ["support", "commerce", "purpose"].includes(input.sourceKind) &&
        UUID.test(input.sourceReservationId) &&
        SHA256.test(input.sourceReservationDigest) &&
        TEMPLATE.test(input.templateVersion),
      "NOTIFICATION_PRIVATE_RESOLUTION_INVALID",
      "Private render identity is invalid.",
      { status: 400 }
    );
    const source = deepFreeze({
      messageId: input.messageId,
      messageType: input.messageType,
      sourceKind: input.sourceKind,
      sourceReservationId: input.sourceReservationId,
      sourceReservationDigest: input.sourceReservationDigest,
      observedAt: input.observedAt
    });
    const [recipient, template] = await Promise.all([
      recipients.resolve(deepFreeze({
        ...source,
        recipientDigest: input.recipientDigest
      })),
      templates.render(deepFreeze({
        ...source,
        templateVersion: input.templateVersion
      }))
    ]);
    exactObject(recipient, ["recipientDigest", "to"], "Resolved recipient");
    exactObject(
      template,
      ["html", "subject", "subjectReference", "templateVersion", "text"],
      "Resolved template"
    );
    invariant(
      recipient.recipientDigest === input.recipientDigest &&
        template.templateVersion === input.templateVersion,
      "NOTIFICATION_PRIVATE_RESOLUTION_CONFLICT",
      "Private resolution changed durable notification identity.",
      { status: 409, details: { providerEffects: false } }
    );
    const rendered = {
      to: recipient.to,
      subject: template.subject,
      subjectReference: template.subjectReference,
      text: template.text,
      html: template.html,
      templateVersion: template.templateVersion
    };
    const evidence = notificationMailEvidence(rendered);
    invariant(
      evidence.recipientDigest === input.recipientDigest &&
        evidence.subjectReferenceDigest === input.subjectReferenceDigest &&
        evidence.contentDigest === input.contentDigest,
      "NOTIFICATION_PRIVATE_RESOLUTION_CONFLICT",
      "Private notification content does not match its durable digests.",
      { status: 409, details: { providerEffects: false } }
    );
    return deepFreeze(rendered);
  }

  return Object.freeze({
    kind: "private-notification-mail-renderer",
    mode: "private-resolvers",
    providerEffects: false,
    readiness,
    render
  });
}
