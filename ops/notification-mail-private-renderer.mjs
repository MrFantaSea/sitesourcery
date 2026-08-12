import { createHash } from "node:crypto";

const REGISTRY_SCHEMA =
  "sitesourcery.notification-mail-template-registry/v1";
const PREVIEW_SCHEMA =
  "sitesourcery.notification-mail-template-preview/v1";
const REDACTION_POLICY = "no-log-no-arbitrary-content-v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const TEMPLATE_VERSION = /^[a-z0-9][a-z0-9.-]{1,79}$/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

// This value is updated only with the canonical registry manifest below. The
// root-owned worker configuration must repeat it independently.
export const REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 =
  "7d9d2c440484930d30fc0440c8976f5447463c0c2d81bae332832924498e4b57";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  ).join(",")}}`;
}

function digest(value) {
  const source = typeof value === "string" || value instanceof Uint8Array
    ? value
    : canonicalJson(value);
  return createHash("sha256").update(source).digest("hex");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const selected of Object.values(value)) deepFreeze(selected);
  }
  return value;
}

function mailError(code, message, status = 400) {
  const error = new Error(message);
  error.name = "NotificationMailPrivateRendererError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ providerEffects: false });
  return error;
}

function exactObject(value, keys, field) {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_INVALID",
      `${field} is invalid.`
    );
  }
  return value;
}

function canonicalEmail(value) {
  const selected = String(value ?? "").trim().toLowerCase();
  if (
    selected !== value || selected.length < 3 || selected.length > 254 ||
    !EMAIL.test(selected) ||
    /[\u0000-\u001f\u007f]/u.test(selected)
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_RECIPIENT_INVALID",
      "The private recipient is invalid."
    );
  }
  return selected;
}

const SUPPORT_TEMPLATES = Object.freeze([
  [
    "support-case-acknowledgment.v1",
    "acknowledgment",
    "We received your Site Sourcery request",
    "Your request was received and is available in your account."
  ],
  [
    "support-case-response.v1",
    "response",
    "Your Site Sourcery request has an update",
    "A reviewed response is available in your account."
  ],
  [
    "support-case-denial.v1",
    "denial",
    "A decision is available for your Site Sourcery request",
    "A reviewed decision is available in your account."
  ],
  [
    "support-case-appeal-acknowledgment.v1",
    "appeal_acknowledgment",
    "We received your Site Sourcery appeal",
    "Your appeal was received and is available in your account."
  ],
  [
    "support-case-closure.v1",
    "closure",
    "Your Site Sourcery request was closed",
    "The current closure record is available in your account."
  ]
]);

const CARE_TEMPLATES = Object.freeze([
  [
    "care-ticket-acknowledgment.v1",
    "care_ticket_acknowledgment",
    "We received your Site Sourcery Care ticket",
    "Your Care ticket was received and is available in your account."
  ],
  [
    "care-ticket-update.v1",
    "care_ticket_update",
    "Your Site Sourcery Care ticket has an update",
    "A reviewed Care update is available in your account."
  ],
  [
    "care-ticket-resolved.v1",
    "care_ticket_resolved",
    "Your Site Sourcery Care ticket was resolved",
    "The current Care resolution is available in your account."
  ]
]);

const COMMERCE_TEMPLATES = deepFreeze({
  assessment_quote_issued: {
    audience: "customer",
    states: ["issued"],
    subject: "Your Site Sourcery assessment quote is ready",
    lead: "Your reviewed assessment quote is available in your account."
  },
  assessment_invoice_prepared: {
    audience: "customer",
    states: ["tax_calculation_pending"],
    subject: "Your Site Sourcery assessment invoice is being prepared",
    lead: "Your assessment invoice record is available in your account."
  },
  assessment_payment_settled: {
    audience: "customer",
    states: ["paid"],
    subject: "Your Site Sourcery assessment payment was recorded",
    lead: "Your settled assessment payment is available in your account."
  },
  assessment_report_delivered: {
    audience: "customer",
    states: ["delivered"],
    subject: "Your Site Sourcery assessment report is ready",
    lead: "Your assessment report is available in your account."
  },
  custom_quote_issued: {
    audience: "customer",
    states: ["issued"],
    subject: "Your Site Sourcery Custom quote is ready",
    lead: "Your reviewed Custom quote is available in your account."
  },
  custom_initial_invoice_prepared: {
    audience: "customer",
    states: ["tax_calculation_pending"],
    subject: "Your Site Sourcery Custom invoice is being prepared",
    lead: "Your initial Custom invoice record is available in your account."
  },
  custom_initial_payment_settled: {
    audience: "customer",
    states: ["paid"],
    subject: "Your Site Sourcery Custom payment was recorded",
    lead: "Your settled initial Custom payment is available in your account."
  },
  custom_change_quote_issued: {
    audience: "customer",
    states: ["issued"],
    subject: "Your Site Sourcery change quote is ready",
    lead: "Your reviewed change quote is available in your account."
  },
  custom_change_invoice_prepared: {
    audience: "customer",
    states: ["tax_calculation_pending"],
    subject: "Your Site Sourcery change invoice is being prepared",
    lead: "Your change invoice record is available in your account."
  },
  custom_change_payment_settled: {
    audience: "customer",
    states: ["paid"],
    subject: "Your Site Sourcery change payment was recorded",
    lead: "Your settled change payment is available in your account."
  },
  custom_completion_ready: {
    audience: "customer",
    states: ["ready_for_final_payment", "ready_for_delivery"],
    subject: "Your Site Sourcery Custom project has a completion update",
    lead: "Your current Custom completion record is available in your account."
  },
  custom_final_invoice_prepared: {
    audience: "customer",
    states: ["tax_calculation_pending"],
    subject: "Your Site Sourcery final invoice is being prepared",
    lead: "Your final invoice record is available in your account."
  },
  custom_final_payment_settled: {
    audience: "customer",
    states: ["paid"],
    subject: "Your Site Sourcery final payment was recorded",
    lead: "Your settled final payment is available in your account."
  },
  custom_handoff_completed: {
    audience: "customer",
    states: ["handed_off"],
    subject: "Your Site Sourcery Custom handoff is ready",
    lead: "Your completed Custom handoff is available in your account."
  },
  professional_reversal_recorded: {
    audience: "customer",
    states: ["active", "held", "terminated"],
    subject: "Your Site Sourcery payment record has an update",
    lead: "Your current payment reversal record is available in your account."
  },
  assessment_payment_reconciliation_required: {
    audience: "operator",
    states: ["reconciliation_required"],
    subject: "Operator review: assessment payment reconciliation",
    lead: "An assessment payment requires operator reconciliation."
  },
  custom_initial_payment_reconciliation_required: {
    audience: "operator",
    states: ["reconciliation_required"],
    subject: "Operator review: initial Custom payment reconciliation",
    lead: "An initial Custom payment requires operator reconciliation."
  },
  custom_change_payment_reconciliation_required: {
    audience: "operator",
    states: ["reconciliation_required"],
    subject: "Operator review: Custom change payment reconciliation",
    lead: "A Custom change payment requires operator reconciliation."
  },
  custom_final_payment_reconciliation_required: {
    audience: "operator",
    states: ["reconciliation_required"],
    subject: "Operator review: final Custom payment reconciliation",
    lead: "A final Custom payment requires operator reconciliation."
  },
  professional_reversal_review_required: {
    audience: "operator",
    states: ["active", "held", "terminated"],
    subject: "Operator review: professional payment reversal",
    lead: "A professional-services payment reversal requires operator review."
  },
  invoice_finalization_failed: {
    audience: "operator",
    states: ["open"],
    subject: "Operator review: invoice finalization failed",
    lead: "An invoice finalization failure requires operator review."
  }
});

function descriptor({
  version,
  family,
  messageType,
  sourceKind,
  eventKind,
  audience,
  states,
  subject,
  lead
}) {
  const variables = family === "commerce"
    ? Object.freeze({
        reference: "safe-reference:1..200",
        revision: "safe-integer:0..9007199254740991",
        state: `enum:${states.join("|")}`
      })
    : Object.freeze({ reference: "uuid" });
  const manifest = {
    schema: "sitesourcery.notification-mail-template/v1",
    version,
    family,
    messageType,
    sourceKind,
    eventKind,
    audience,
    states,
    variables,
    subject,
    lead,
    footer:
      "Sign in to Site Sourcery to review current details. Never send passwords, payment credentials, or private keys by email."
  };
  return deepFreeze({ ...manifest, templateDigest: digest(manifest) });
}

const DESCRIPTORS = [
  ...SUPPORT_TEMPLATES.map(([version, eventKind, subject, lead]) =>
    descriptor({
      version,
      family: "support",
      messageType: "support_notification",
      sourceKind: "support",
      eventKind,
      audience: "customer",
      states: [],
      subject,
      lead
    })
  ),
  ...CARE_TEMPLATES.map(([version, eventKind, subject, lead]) =>
    descriptor({
      version,
      family: "care",
      messageType: "support_notification",
      sourceKind: "care",
      eventKind,
      audience: "customer",
      states: [],
      subject,
      lead
    })
  ),
  ...Object.entries(COMMERCE_TEMPLATES).map(([eventKind, selected]) =>
    descriptor({
      version: `commerce-${eventKind.replaceAll("_", "-")}.v1`,
      family: "commerce",
      messageType: selected.audience === "customer"
        ? "commerce_customer_notification"
        : "commerce_operator_notification",
      sourceKind: "commerce",
      eventKind,
      audience: selected.audience,
      states: selected.states,
      subject: selected.subject,
      lead: selected.lead
    })
  )
].sort((left, right) => left.version.localeCompare(right.version));

if (
  DESCRIPTORS.length !== 29 ||
  new Set(DESCRIPTORS.map((item) => item.version)).size !== DESCRIPTORS.length ||
  DESCRIPTORS.some((item) => !TEMPLATE_VERSION.test(item.version))
) {
  throw new Error("The reviewed notification template manifest is invalid.");
}

const REGISTRY_MANIFEST = deepFreeze({
  schema: REGISTRY_SCHEMA,
  templates: DESCRIPTORS.map((item) => ({
    version: item.version,
    templateDigest: item.templateDigest
  }))
});
export const CALCULATED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 =
  digest(REGISTRY_MANIFEST);
const BY_VERSION = new Map(DESCRIPTORS.map((item) => [item.version, item]));

export const REVIEWED_NOTIFICATION_TEMPLATE_MANIFEST = REGISTRY_MANIFEST;
export const REVIEWED_NOTIFICATION_TEMPLATE_DEFINITIONS = Object.freeze(
  [...DESCRIPTORS]
);
export const REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS = Object.freeze(
  DESCRIPTORS.map((item) => item.version)
);

function assertRegistryIdentity() {
  if (
    !SHA256.test(REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256) ||
    REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 !==
      CALCULATED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_REGISTRY_DRIFT",
      "The reviewed notification template registry identity drifted.",
      500
    );
  }
}

function normalizedVariables(template, input) {
  const expected = template.family === "commerce"
    ? ["reference", "revision", "state"]
    : ["reference"];
  exactObject(input, expected, "Template variables");
  if (
    typeof input.reference !== "string" ||
    (
      template.family === "commerce"
        ? !SAFE_REFERENCE.test(input.reference)
        : !UUID.test(input.reference)
    )
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_VARIABLE_INVALID",
      "The template reference is invalid."
    );
  }
  if (template.family !== "commerce") {
    return deepFreeze({ reference: input.reference });
  }
  if (
    !Number.isSafeInteger(input.revision) || input.revision < 0 ||
    typeof input.state !== "string" ||
    !template.states.includes(input.state)
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_VARIABLE_INVALID",
      "The commerce template state or revision is invalid."
    );
  }
  return deepFreeze({
    reference: input.reference,
    revision: input.revision,
    state: input.state
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderedTemplate(template, variables) {
  const referenceLine = `Reference: ${variables.reference}`;
  const stateLine = template.family === "commerce"
    ? `Recorded state: ${variables.state}. Revision: ${variables.revision}.`
    : null;
  const footer = template.footer;
  const text = [
    template.lead,
    referenceLine,
    ...(stateLine === null ? [] : [stateLine]),
    footer
  ].join("\n\n");
  const html = [
    `<p>${escapeHtml(template.lead)}</p>`,
    `<p><strong>Reference:</strong> <code>${escapeHtml(
      variables.reference
    )}</code></p>`,
    ...(stateLine === null
      ? []
      : [`<p><strong>Recorded state:</strong> ${escapeHtml(
          variables.state
        )}. <strong>Revision:</strong> ${variables.revision}.</p>`]),
    `<p>${escapeHtml(footer)}</p>`
  ].join("");
  return deepFreeze({
    subject: template.subject,
    subjectReference:
      `sitesourcery:${template.family}:${template.eventKind}:` +
      variables.reference,
    text,
    html,
    templateVersion: template.version
  });
}

function evidence(to, rendered) {
  const recipientDigest = digest(to);
  const subjectReferenceDigest = digest({
    schema: "sitesourcery.notification-mail-subject-reference/v1",
    subjectReference: rendered.subjectReference,
    templateVersion: rendered.templateVersion
  });
  const contentDigest = digest({
    schema: "sitesourcery.notification-mail-content/v1",
    templateVersion: rendered.templateVersion,
    recipientDigest,
    subjectReferenceDigest,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html
  });
  return deepFreeze({ recipientDigest, subjectReferenceDigest, contentDigest });
}

export function previewReviewedNotificationMail(input = {}) {
  assertRegistryIdentity();
  exactObject(input, ["templateVersion", "to", "variables"], "Mail preview");
  const template = BY_VERSION.get(input.templateVersion);
  if (!template) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_TEMPLATE_UNAVAILABLE",
      "That notification template is not reviewed."
    );
  }
  const to = canonicalEmail(input.to);
  const variables = normalizedVariables(template, input.variables);
  const rendered = renderedTemplate(template, variables);
  return deepFreeze({
    schema: PREVIEW_SCHEMA,
    templateVersion: template.version,
    templateDigest: template.templateDigest,
    templateRegistrySha256: REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    variables,
    rendered: { to, ...rendered },
    evidence: evidence(to, rendered),
    providerEffects: false
  });
}

function validateRenderInput(input) {
  exactObject(input, [
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
  ], "Private render request");
  if (
    !UUID.test(input.messageId) ||
    !["support_notification", "commerce_customer_notification",
      "commerce_operator_notification"].includes(input.messageType) ||
    !["support", "commerce"].includes(input.sourceKind) ||
    !UUID.test(input.sourceReservationId) ||
    !SHA256.test(input.sourceReservationDigest) ||
    !SHA256.test(input.recipientDigest) ||
    !SHA256.test(input.subjectReferenceDigest) ||
    !SHA256.test(input.contentDigest) ||
    !TEMPLATE_VERSION.test(input.templateVersion) ||
    typeof input.observedAt !== "string" ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    new Date(input.observedAt).toISOString() !== input.observedAt
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_INVALID",
      "The private render identity is invalid."
    );
  }
  return deepFreeze({ ...input });
}

function databaseAuthority(authority) {
  if (
    authority?.kind !== "canonical-postgres" ||
    typeof authority.service !== "function"
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_CONFIGURATION_REQUIRED",
      "Canonical private recipient authority is required.",
      500
    );
  }
  return authority;
}

const SUPPORT_SOURCE_SQL = `
  /* notification-private-renderer:support-source */
  select mail.id as message_id, mail.message_type, mail.template_version,
         mail.recipient_digest, reservation.id as source_reservation_id,
         reservation.reservation_digest as source_reservation_digest,
         reservation.notification_kind as event_kind,
         support_case.id::text as reference_id,
         account_user.email as recipient_email
    from ss.hosted_support_case_mail_reservations reservation
    join ss.hosted_mail_deliveries mail
      on mail.id = reservation.mail_message_id
    join ss.hosted_support_cases support_case
      on support_case.id = reservation.case_id
    join auth.users account_user
      on account_user.id = mail.customer_user_id
     and account_user.disabled_at is null
   where mail.id = $1 and reservation.id = $2
     and reservation.reservation_digest = $3
   limit 2`;

const COMMERCE_SOURCE_SQL = `
  /* notification-private-renderer:commerce-source */
  select mail.id as message_id, mail.message_type, mail.template_version,
         mail.recipient_digest, reservation.id as source_reservation_id,
         reservation.reservation_digest as source_reservation_digest,
         reservation.notification_kind as event_kind,
         reservation.audience_kind, reservation.source_id as reference_id,
         reservation.source_revision, reservation.source_state,
         account_user.email as recipient_email
    from ss.commerce_transition_notification_outbox reservation
    join ss.hosted_mail_deliveries mail
      on mail.id = reservation.mail_message_id
    left join auth.users account_user
      on account_user.id = reservation.source_customer_user_id
     and account_user.disabled_at is null
   where mail.id = $1 and reservation.id = $2
     and reservation.reservation_digest = $3
     and reservation.state = 'held'
     and not reservation.provider_effects_authorized
     and not reservation.delivery_claimed
   limit 2`;

export function createPrivateNotificationRecipientResolver({
  authority,
  operatorRecipient
} = {}) {
  const database = databaseAuthority(authority);
  const selectedOperator = canonicalEmail(operatorRecipient);

  async function readiness() {
    try {
      const result = await database.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(
          `/* notification-private-renderer:readiness */
           select
             to_regclass('ss.hosted_mail_deliveries') is not null
             and to_regclass(
               'ss.hosted_support_case_mail_reservations'
             ) is not null
             and to_regclass(
               'ss.commerce_transition_notification_outbox'
             ) is not null
             and to_regclass('auth.users') is not null
               as relations_ready,
             to_regprocedure('ss.hosted_mail_dispatch_contract_v1()')
               is not null
             and ss.hosted_mail_dispatch_contract_v1() =
               'canonical-mail-dispatch-v1-leased-digest-only-held'
               as contract_ready,
             (
               select count(*) = 1
                 from auth.users account_user
                where lower(account_user.email) = $1
                  and account_user.disabled_at is null
                  and ss.service_operator_has_capability(
                    account_user.id,
                    'service_payment_reconcile',
                    clock_timestamp()
                  )
             ) as operator_ready`,
          [selectedOperator]
        )
      );
      const row = result?.rows?.[0];
      const ready = result?.rowCount === 1 &&
        row?.relations_ready === true &&
        row?.contract_ready === true &&
        row?.operator_ready === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "notification-recipient-resolver",
        mode: "canonical-private-postgres",
        providerEffects: false,
        code: ready ? null : "NOTIFICATION_PRIVATE_RECIPIENT_NOT_READY"
      });
    } catch {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "notification-recipient-resolver",
        mode: "canonical-private-postgres",
        providerEffects: false,
        code: "NOTIFICATION_PRIVATE_RECIPIENT_NOT_READY"
      });
    }
  }

  async function resolve(rawInput) {
    const input = validateRenderInput(rawInput);
    const template = BY_VERSION.get(input.templateVersion);
    if (
      !template || template.sourceKind !== input.sourceKind ||
      template.messageType !== input.messageType ||
      template.family === "care"
    ) {
      throw mailError(
        "NOTIFICATION_PRIVATE_RENDERER_TEMPLATE_UNAVAILABLE",
        "The reservation does not match a reviewed dispatch template."
      );
    }
    const query = input.sourceKind === "support"
      ? SUPPORT_SOURCE_SQL
      : COMMERCE_SOURCE_SQL;
    const result = await database.service(
      { actorKind: "system", readOnly: true },
      (client) => client.query(query, [
        input.messageId,
        input.sourceReservationId,
        input.sourceReservationDigest
      ])
    );
    if (result?.rowCount !== 1) {
      throw mailError(
        "NOTIFICATION_PRIVATE_RENDERER_SOURCE_UNAVAILABLE",
        "The private notification source is unavailable.",
        409
      );
    }
    const row = result.rows[0];
    if (
      row.message_id !== input.messageId ||
      row.message_type !== input.messageType ||
      row.template_version !== input.templateVersion ||
      row.recipient_digest !== input.recipientDigest ||
      row.source_reservation_id !== input.sourceReservationId ||
      row.source_reservation_digest !== input.sourceReservationDigest ||
      row.event_kind !== template.eventKind
    ) {
      throw mailError(
        "NOTIFICATION_PRIVATE_RENDERER_SOURCE_CONFLICT",
        "The private notification source identity changed.",
        409
      );
    }
    let to;
    let variables;
    if (template.family === "support") {
      if (!UUID.test(row.reference_id)) {
        throw mailError(
          "NOTIFICATION_PRIVATE_RENDERER_SOURCE_CONFLICT",
          "The support notification source is invalid.",
          409
        );
      }
      to = canonicalEmail(row.recipient_email);
      variables = { reference: row.reference_id };
    } else {
      const revision = Number(row.source_revision);
      if (
        row.audience_kind !== template.audience ||
        !SAFE_REFERENCE.test(row.reference_id) ||
        !Number.isSafeInteger(revision) || revision < 0 ||
        !template.states.includes(row.source_state)
      ) {
        throw mailError(
          "NOTIFICATION_PRIVATE_RENDERER_SOURCE_CONFLICT",
          "The commerce notification source is invalid.",
          409
        );
      }
      to = template.audience === "operator"
        ? selectedOperator
        : canonicalEmail(row.recipient_email);
      variables = {
        reference: row.reference_id,
        revision,
        state: row.source_state
      };
      if (template.audience === "operator") {
        const operator = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(
            `/* notification-private-renderer:operator-recipient */
             select account_user.id
               from auth.users account_user
              where lower(account_user.email) = $1
                and account_user.disabled_at is null
                and ss.service_operator_has_capability(
                  account_user.id,
                  'service_payment_reconcile',
                  $2::timestamptz
                )
              limit 2`,
            [selectedOperator, input.observedAt]
          )
        );
        if (operator?.rowCount !== 1) {
          throw mailError(
            "NOTIFICATION_PRIVATE_RENDERER_RECIPIENT_UNAVAILABLE",
            "The reviewed operator recipient is unavailable.",
            409
          );
        }
      }
    }
    if (digest(to) !== input.recipientDigest) {
      throw mailError(
        "NOTIFICATION_PRIVATE_RENDERER_RECIPIENT_CONFLICT",
        "The private recipient does not match durable evidence.",
        409
      );
    }
    return deepFreeze({
      to,
      recipientDigest: input.recipientDigest,
      templateVersion: input.templateVersion,
      variables: normalizedVariables(template, variables)
    });
  }

  return Object.freeze({
    kind: "notification-recipient-resolver",
    mode: "canonical-private-postgres",
    providerEffects: false,
    readiness,
    resolve
  });
}

function heldRenderer() {
  return Object.freeze({
    kind: "private-notification-mail-renderer",
    mode: "held",
    providerEffects: false,
    redactionPolicy: REDACTION_POLICY,
    templateRegistrySha256: REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    supportedTemplateVersions: REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "private-notification-mail-renderer",
        mode: "held",
        providerEffects: false,
        code: "NOTIFICATION_PRIVATE_RENDERER_HELD"
      });
    },
    async render() {
      throw mailError(
        "NOTIFICATION_PRIVATE_RENDERER_HELD",
        "Private notification rendering is held.",
        503
      );
    }
  });
}

export function createNotificationMailPrivateRenderer({
  authority,
  configuration
} = {}) {
  assertRegistryIdentity();
  if (configuration === undefined || configuration?.mode === "held") {
    if (
      configuration !== undefined &&
      canonicalJson(configuration) !== canonicalJson({ mode: "held" })
    ) {
      throw mailError(
        "NOTIFICATION_PRIVATE_RENDERER_CONFIGURATION_REQUIRED",
        "Held private renderer configuration is invalid.",
        500
      );
    }
    return heldRenderer();
  }
  exactObject(
    configuration,
    ["mode", "operatorRecipient", "templateRegistrySha256"],
    "Private renderer configuration"
  );
  if (
    configuration.mode !== "reviewed" ||
    configuration.templateRegistrySha256 !==
      REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256
  ) {
    throw mailError(
      "NOTIFICATION_PRIVATE_RENDERER_CONFIGURATION_REQUIRED",
      "The reviewed private renderer configuration is incomplete.",
      500
    );
  }
  const resolver = createPrivateNotificationRecipientResolver({
    authority,
    operatorRecipient: configuration.operatorRecipient
  });

  return Object.freeze({
    kind: "private-notification-mail-renderer",
    mode: "private-resolvers",
    providerEffects: false,
    redactionPolicy: REDACTION_POLICY,
    templateRegistrySha256: REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    supportedTemplateVersions: REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS,
    async readiness() {
      const status = await resolver.readiness();
      const ready = status?.ready === true && status?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "private-notification-mail-renderer",
        mode: "private-resolvers",
        providerEffects: false,
        code: ready ? null : status?.code ??
          "NOTIFICATION_PRIVATE_RENDERER_NOT_READY",
        templateRegistrySha256:
          REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
        redactionPolicy: REDACTION_POLICY
      });
    },
    async render(rawInput) {
      const input = validateRenderInput(rawInput);
      const resolved = await resolver.resolve(input);
      const preview = previewReviewedNotificationMail({
        templateVersion: input.templateVersion,
        to: resolved.to,
        variables: resolved.variables
      });
      if (
        preview.evidence.recipientDigest !== input.recipientDigest ||
        preview.evidence.subjectReferenceDigest !==
          input.subjectReferenceDigest ||
        preview.evidence.contentDigest !== input.contentDigest
      ) {
        throw mailError(
          "NOTIFICATION_PRIVATE_RENDERER_EVIDENCE_CONFLICT",
          "Reviewed notification output does not match durable evidence.",
          409
        );
      }
      return preview.rendered;
    }
  });
}
