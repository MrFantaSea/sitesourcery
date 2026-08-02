import {
  ALAKAZAM_CATALOG_VERSION,
  ALAKAZAM_CHANGE_QUOTE_SCHEMA,
  ALAKAZAM_TERMS_VERSION,
  quoteAlakazamChange,
  resolveAlakazamTier
} from "./alakazam.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_BILLING_RELEASE_SCHEMA =
  "sitesourcery.alakazam-billing-release.v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TAX_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);
const QUOTE_TTL_MS = 30 * 60 * 1000;

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}
function exactKeys(value, expected, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message
  );
  return value;
}

export function createAlakazamBillingRelease({
  approved = false,
  taxMode = null
} = {}) {
  invariant(
    typeof approved === "boolean" &&
      (
        approved
          ? TAX_MODES.has(taxMode)
          : taxMode === null
      ),
    "invalid_configuration",
    "Alakazam billing release configuration is invalid",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_BILLING_RELEASE_SCHEMA,
    approved,
    provider: "stripe",
    productId: "alakazam_hosting",
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    termsVersion: ALAKAZAM_TERMS_VERSION,
    taxMode
  });
}

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value &&
      JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam billing release does not match the reviewed tier contract",
    { status: 500 }
  );
  return expected;
}

function exactClock(clock) {
  const value = clock.now();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

function validatePorts(repository, provider, clock) {
  for (const [name, value, methods] of [
    ["repository", repository, ["createQuote"]],
    ["provider", provider, ["readiness"]],
    ["clock", clock, ["now"]]
  ]) {
    invariant(
      value &&
        methods.every(
          (method) =>
            typeof value[method] === "function"
        ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  return { repository, provider, clock };
}

function exactQuoteInput(value) {
  exactKeys(
    value,
    [
      "customerId",
      "projectId",
      "quoteId",
      "targetTierId",
      "tenantId"
    ],
    "invalid_input",
    "Alakazam quote accepts only project, target tier, and idempotency identity"
  );
  const target = resolveAlakazamTier(
    value.targetTierId
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(
      value.projectId,
      "projectId"
    ),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    targetTierId: target.tierId
  });
}

function quoteWithoutDigest(value) {
  const selected = clone(value);
  delete selected.quoteDigest;
  return selected;
}

function exactAuthorizedQuote(value, input, taxMode, now) {
  invariant(
    value?.schema === ALAKAZAM_CHANGE_QUOTE_SCHEMA &&
      value.quoteId === input.quoteId &&
      value.tenantId === input.tenantId &&
      value.customerId === input.customerId &&
      value.projectId === input.projectId &&
      value.catalogVersion === ALAKAZAM_CATALOG_VERSION &&
      value.termsVersion === ALAKAZAM_TERMS_VERSION &&
      value.state === "quoted" &&
      value.providerEffectsAuthorized === true &&
      value.targetTier?.tierId === input.targetTierId &&
      value.dueNow?.currency === "USD" &&
      value.dueNow?.taxState === taxMode &&
      value.nextRenewal?.tierId === input.targetTierId &&
      value.nextRenewal?.currency === "USD" &&
      value.nextRenewal?.interval === "month" &&
      value.disclosure?.dueNow?.taxState === taxMode &&
      digest(value.disclosure) ===
        value.disclosureDigest &&
      digest(quoteWithoutDigest(value)) ===
        value.quoteDigest,
    "repository_conflict",
    "the durable Alakazam quote failed its exact server contract",
    { status: 500 }
  );
  requiredDigest(
    value.disclosureDigest,
    "quote.disclosureDigest"
  );
  requiredDigest(value.quoteDigest, "quote.quoteDigest");
  const issuedAt = requiredIso(
    value.issuedAt,
    "quote.issuedAt"
  );
  const expiresAt = requiredIso(
    value.expiresAt,
    "quote.expiresAt"
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(now) &&
      Date.parse(expiresAt) > Date.parse(issuedAt) &&
      Date.parse(expiresAt) - Date.parse(issuedAt) <=
        QUOTE_TTL_MS,
    "alakazam_quote_expired",
    "Request a fresh Alakazam quote before continuing.",
    { status: 409 }
  );
  return deepFreeze(clone(value));
}

export function createAlakazamBillingService({
  repository,
  provider,
  clock,
  release = createAlakazamBillingRelease()
} = {}) {
  const ports = validatePorts(repository, provider, clock);
  const authority = exactRelease(release);

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        quote: false,
        payment: false,
        state: "held",
        code: "alakazam_billing_release_held"
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        quote: false,
        payment: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready"
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxMode !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        quote: false,
        payment: false,
        state: "unavailable",
        code:
          status?.code ??
          "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      quote: true,
      payment: false,
      state: "quote_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  return Object.freeze({
    readiness,

    async createQuote(input) {
      const selected = exactQuoteInput(input);
      const status = await readiness();
      invariant(
        status.ready === true && status.quote === true,
        "alakazam_billing_unavailable",
        "Alakazam billing is not open. Nothing was charged.",
        { status: 503 }
      );
      const issuedAt = exactClock(ports.clock);
      const expiresAt = new Date(
        Date.parse(issuedAt) + QUOTE_TTL_MS
      ).toISOString();
      const quote = await ports.repository.createQuote({
        ...selected,
        issuedAt,
        expiresAt,
        taxMode: authority.taxMode
      });
      return exactAuthorizedQuote(
        quote,
        selected,
        authority.taxMode,
        issuedAt
      );
    }
  });
}
