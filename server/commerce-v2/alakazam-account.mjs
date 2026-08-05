import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";
import {
  getBrowserSafeAlakazamCatalog
} from "./alakazam.mjs";

export const ALAKAZAM_ACCOUNT_SCHEMA =
  "sitesourcery.alakazam-account/v2";
export const ALAKAZAM_SITE_SETUP_SCHEMA =
  "sitesourcery.alakazam-site-setup/v1";

const PLATFORM_BASE_DOMAIN = "sitesourcery.me";
const PUBLIC_LOOKS = Object.freeze({
  clear: Object.freeze({
    lookId: "look_crystal",
    label: "Crystal"
  }),
  warm: Object.freeze({
    lookId: "look_hearth",
    label: "Hearth"
  }),
  arcane: Object.freeze({
    lookId: "look_midnight",
    label: "Midnight"
  })
});
const FULFILLMENT_STATES = new Set([
  "prepared",
  "pending",
  "live",
  "dark",
  "failed"
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SUBSCRIPTION_STATES = new Set([
  "pending",
  "active",
  "grace",
  "suspended",
  "cancelled",
  "ended"
]);
const CHANGE_KINDS = new Set([
  "start",
  "upgrade",
  "downgrade",
  "cancellation"
]);
const CHANGE_STATES = new Set([
  "activation_pending",
  "payment_pending",
  "provider_change_pending",
  "schedule_dispatching",
  "scheduled",
  "cancellation_scheduled",
  "reconciliation_required"
]);
const RECEIPT_KINDS = new Set([
  "start_payment",
  "upgrade_difference",
  "renewal_payment"
]);

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactConfiguredLook(value, field) {
  const selected = requiredText(value, field, 20);
  invariant(
    Object.hasOwn(PUBLIC_LOOKS, selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactAddressLabel(value, field) {
  const selected = requiredText(value, field, 63);
  invariant(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      selected
    ),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactPlatformHostname(value, label, field) {
  const selected = requiredText(value, field, 253);
  invariant(
    selected === `${label}.${PLATFORM_BASE_DOMAIN}`,
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

export function createAlakazamSiteSetupDigest(value) {
  exactKeys(
    value,
    [
      "acceptedVersionId",
      "addressId",
      "addressLabel",
      "artifactDigest",
      "configuredLook",
      "customerId",
      "hostname",
      "projectId",
      "tenantId"
    ],
    "siteSetup"
  );
  const addressLabel = exactAddressLabel(
    value.addressLabel,
    "siteSetup.addressLabel"
  );
  return digest({
    schema: ALAKAZAM_SITE_SETUP_SCHEMA,
    tenantId: exactUuid(
      value.tenantId,
      "siteSetup.tenantId"
    ),
    customerId: exactUuid(
      value.customerId,
      "siteSetup.customerId"
    ),
    projectId: exactUuid(
      value.projectId,
      "siteSetup.projectId"
    ),
    acceptedVersionId: exactUuid(
      value.acceptedVersionId,
      "siteSetup.acceptedVersionId"
    ),
    artifactDigest: requiredDigest(
      value.artifactDigest,
      "siteSetup.artifactDigest"
    ),
    configuredLook: exactConfiguredLook(
      value.configuredLook,
      "siteSetup.configuredLook"
    ),
    addressId: exactUuid(
      value.addressId,
      "siteSetup.addressId"
    ),
    addressLabel,
    hostname: exactPlatformHostname(
      value.hostname,
      addressLabel,
      "siteSetup.hostname"
    )
  });
}

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function nullableIso(value, field) {
  return value === null
    ? null
    : requiredIso(value, field);
}

function exactScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "scope"
  );
  const actorId = exactUuid(value.actorId, "scope.actorId");
  const customerId = exactUuid(
    value.customerId,
    "scope.customerId"
  );
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer billing project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "scope.tenantId"),
    customerId,
    actorId,
    projectId: exactUuid(value.projectId, "scope.projectId")
  });
}

function catalogTier(catalog, tierId, field) {
  const selected = requiredText(tierId, field, 100);
  const tier = catalog.tiers.find(
    (candidate) => candidate.tierId === selected
  );
  invariant(
    tier,
    "repository_conflict",
    "the customer Alakazam tier is unavailable",
    { status: 500 }
  );
  return clone(tier);
}

function exactSubscription(value, catalog) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "amountMinor",
      "cancelAtPeriodEnd",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "firstFailedAt",
      "graceEndsAt",
      "revision",
      "status",
      "tierId"
    ],
    "subscription"
  );
  const status = requiredText(
    value.status,
    "subscription.status",
    50
  );
  invariant(
    SUBSCRIPTION_STATES.has(status) &&
      value.currency === "USD" &&
      typeof value.cancelAtPeriodEnd === "boolean",
    "repository_conflict",
    "the customer Alakazam subscription changed",
    { status: 500 }
  );
  const tier = catalogTier(
    catalog,
    value.tierId,
    "subscription.tierId"
  );
  const amountMinor = positiveInteger(
    value.amountMinor,
    "subscription.amountMinor"
  );
  invariant(
    amountMinor === tier.price.amountMinor,
    "repository_conflict",
    "the customer Alakazam amount changed",
    { status: 500 }
  );
  const currentPeriodStartsAt = nullableIso(
    value.currentPeriodStartsAt,
    "subscription.currentPeriodStartsAt"
  );
  const currentPeriodEndsAt = nullableIso(
    value.currentPeriodEndsAt,
    "subscription.currentPeriodEndsAt"
  );
  invariant(
    (
      status === "pending" &&
      currentPeriodStartsAt === null &&
      currentPeriodEndsAt === null
    ) || (
      status !== "pending" &&
      currentPeriodStartsAt !== null &&
      currentPeriodEndsAt !== null &&
      Date.parse(currentPeriodEndsAt) >
        Date.parse(currentPeriodStartsAt)
    ),
    "repository_conflict",
    "the customer Alakazam period changed",
    { status: 500 }
  );
  const firstFailedAt = nullableIso(
    value.firstFailedAt,
    "subscription.firstFailedAt"
  );
  const graceEndsAt = nullableIso(
    value.graceEndsAt,
    "subscription.graceEndsAt"
  );
  invariant(
    graceEndsAt === null || firstFailedAt !== null,
    "repository_conflict",
    "the customer Alakazam grace period changed",
    { status: 500 }
  );
  const paymentState = {
    pending: "pending",
    active: "paid",
    grace: "attention_required",
    suspended: "suspended",
    cancelled: "cancelled",
    ended: "ended"
  }[status];
  return Object.freeze({
    tier,
    status,
    paymentState,
    price: {
      amountMinor,
      currency: "USD",
      billing: "recurring",
      interval: "month"
    },
    revision: positiveInteger(
      value.revision,
      "subscription.revision"
    ),
    currentPeriod:
      currentPeriodStartsAt === null
        ? null
        : {
            startsAt: currentPeriodStartsAt,
            endsAt: currentPeriodEndsAt
          },
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    firstFailedAt,
    graceEndsAt
  });
}

function exactPendingChange(value, catalog) {
  if (value === null) return null;
  exactKeys(
    value,
    ["changeKind", "effectiveAt", "state", "targetTierId"],
    "pendingChange"
  );
  const changeKind = requiredText(
    value.changeKind,
    "pendingChange.changeKind",
    50
  );
  const state = requiredText(
    value.state,
    "pendingChange.state",
    100
  );
  invariant(
    CHANGE_KINDS.has(changeKind) &&
      CHANGE_STATES.has(state),
    "repository_conflict",
    "the customer Alakazam pending change changed",
    { status: 500 }
  );
  const targetTier =
    changeKind === "cancellation"
      ? null
      : catalogTier(
          catalog,
          value.targetTierId,
          "pendingChange.targetTierId"
        );
  invariant(
    changeKind === "cancellation"
      ? value.targetTierId === null
      : targetTier !== null,
    "repository_conflict",
    "the customer Alakazam pending target changed",
    { status: 500 }
  );
  const effectiveAt = nullableIso(
    value.effectiveAt,
    "pendingChange.effectiveAt"
  );
  invariant(
    ![
      "downgrade",
      "cancellation"
    ].includes(changeKind) || effectiveAt !== null,
    "repository_conflict",
    "the customer Alakazam effective date changed",
    { status: 500 }
  );
  return Object.freeze({
    changeKind,
    targetTier,
    effectiveAt,
    state
  });
}

function exactReceipts(value) {
  invariant(
    Array.isArray(value) && value.length <= 50,
    "repository_conflict",
    "the customer Alakazam receipt history changed",
    { status: 500 }
  );
  return value.map((receipt, index) => {
    const field = `receipts[${index}]`;
    exactKeys(
      receipt,
      [
        "discountMinor",
        "invoiceAvailable",
        "kind",
        "receiptId",
        "settledAt",
        "subtotalMinor",
        "taxMinor",
        "totalMinor"
      ],
      field
    );
    const kind = requiredText(
      receipt.kind,
      `${field}.kind`,
      50
    );
    invariant(
      RECEIPT_KINDS.has(kind) &&
        typeof receipt.invoiceAvailable === "boolean",
      "repository_conflict",
      "the customer Alakazam receipt changed",
      { status: 500 }
    );
    const subtotalMinor = positiveInteger(
      receipt.subtotalMinor,
      `${field}.subtotalMinor`
    );
    const discountMinor = nonnegativeInteger(
      receipt.discountMinor,
      `${field}.discountMinor`
    );
    const taxMinor = nonnegativeInteger(
      receipt.taxMinor,
      `${field}.taxMinor`
    );
    const totalMinor = nonnegativeInteger(
      receipt.totalMinor,
      `${field}.totalMinor`
    );
    invariant(
      subtotalMinor - discountMinor + taxMinor ===
        totalMinor,
      "repository_conflict",
      "the customer Alakazam receipt total changed",
      { status: 500 }
    );
    return Object.freeze({
      receiptId: exactUuid(
        receipt.receiptId,
        `${field}.receiptId`
      ),
      kind,
      subtotalMinor,
      discountMinor,
      taxMinor,
      totalMinor,
      currency: "USD",
      settledAt: requiredIso(
        receipt.settledAt,
        `${field}.settledAt`
      ),
      invoiceAvailable: receipt.invoiceAvailable
    });
  });
}

function exactRepositorySite(value, scope, catalog) {
  exactKeys(
    value,
    [
      "acceptedVersionId",
      "addressId",
      "addressLabel",
      "artifactDigest",
      "configuredLook",
      "fulfillmentState",
      "fulfillmentSubscriptionRevision",
      "fulfillmentTierId",
      "hostname",
      "updatedAt"
    ],
    "accountSnapshot.site"
  );
  const hasVersion = value.acceptedVersionId !== null;
  invariant(
    hasVersion === (value.artifactDigest !== null) &&
      hasVersion === (value.configuredLook !== null),
    "repository_conflict",
    "the customer website version binding changed",
    { status: 500 }
  );
  const acceptedVersionId = hasVersion
    ? exactUuid(
        value.acceptedVersionId,
        "accountSnapshot.site.acceptedVersionId"
      )
    : null;
  const artifactDigest = hasVersion
    ? requiredDigest(
        value.artifactDigest,
        "accountSnapshot.site.artifactDigest"
      )
    : null;
  const configuredLook = hasVersion
    ? exactConfiguredLook(
        value.configuredLook,
        "accountSnapshot.site.configuredLook"
      )
    : null;

  const hasAddress = value.addressId !== null;
  invariant(
    hasAddress === (value.addressLabel !== null) &&
      hasAddress === (value.hostname !== null),
    "repository_conflict",
    "the customer website address binding changed",
    { status: 500 }
  );
  const addressId = hasAddress
    ? exactUuid(
        value.addressId,
        "accountSnapshot.site.addressId"
      )
    : null;
  const addressLabel = hasAddress
    ? exactAddressLabel(
        value.addressLabel,
        "accountSnapshot.site.addressLabel"
      )
    : null;
  const hostname = hasAddress
    ? exactPlatformHostname(
        value.hostname,
        addressLabel,
        "accountSnapshot.site.hostname"
      )
    : null;

  const hasFulfillment = value.fulfillmentState !== null;
  const fulfillmentState = hasFulfillment
    ? requiredText(
        value.fulfillmentState,
        "accountSnapshot.site.fulfillmentState",
        50
      )
    : null;
  invariant(
    fulfillmentState === null ||
      FULFILLMENT_STATES.has(fulfillmentState),
    "repository_conflict",
    "the customer website fulfillment state changed",
    { status: 500 }
  );
  const hasFulfillmentAuthority =
    value.fulfillmentTierId !== null ||
    value.fulfillmentSubscriptionRevision !== null;
  const hasCompleteFulfillmentAuthority =
    value.fulfillmentTierId !== null &&
    value.fulfillmentSubscriptionRevision !== null;
  invariant(
    !hasFulfillment
      ? !hasFulfillmentAuthority
      : fulfillmentState === "prepared"
        ? hasVersion && hasAddress &&
          !hasFulfillmentAuthority
        : fulfillmentState === "failed"
          ? !(
              hasFulfillmentAuthority &&
              !hasCompleteFulfillmentAuthority
            ) &&
            (
              (hasVersion && hasAddress) ||
              hasCompleteFulfillmentAuthority
            )
          : hasVersion && hasAddress &&
            hasCompleteFulfillmentAuthority,
    "repository_conflict",
    "the customer website fulfillment binding changed",
    { status: 500 }
  );
  if (hasFulfillmentAuthority) {
    catalogTier(
      catalog,
      value.fulfillmentTierId,
      "accountSnapshot.site.fulfillmentTierId"
    );
    positiveInteger(
      value.fulfillmentSubscriptionRevision,
      "accountSnapshot.site.fulfillmentSubscriptionRevision"
    );
  }
  const updatedAt = nullableIso(
    value.updatedAt,
    "accountSnapshot.site.updatedAt"
  );
  invariant(
    !(hasVersion || hasAddress || hasFulfillment) ||
      updatedAt !== null,
    "repository_conflict",
    "the customer website update time changed",
    { status: 500 }
  );

  const setupReady = hasVersion && hasAddress;
  const setupDigest = setupReady
    ? createAlakazamSiteSetupDigest({
        tenantId: scope.tenantId,
        customerId: scope.customerId,
        projectId: scope.projectId,
        acceptedVersionId,
        artifactDigest,
        configuredLook,
        addressId,
        addressLabel,
        hostname
      })
    : null;
  const state = hasFulfillment
    ? {
        prepared: "payment_pending",
        pending: "publishing",
        live: "live",
        dark: "attention_required",
        failed: "attention_required"
      }[fulfillmentState]
    : setupReady
      ? "ready_for_checkout"
      : "setup_required";
  return Object.freeze({
    acceptedVersionId,
    addressLabel,
    hostname,
    look: configuredLook
      ? clone(PUBLIC_LOOKS[configuredLook])
      : null,
    setupDigest,
    state,
    updatedAt,
    url: state === "live"
      ? `https://${hostname}/`
      : null
  });
}

function accountState(subscription) {
  if (!subscription) return "available";
  if (subscription.status === "pending") {
    return "activation_pending";
  }
  if (["grace", "suspended"].includes(subscription.status)) {
    return "attention_required";
  }
  if (["cancelled", "ended"].includes(subscription.status)) {
    return "ended";
  }
  return "active";
}

function nextRenewal(subscription, pendingChange) {
  if (
    !subscription ||
    !subscription.currentPeriod ||
    subscription.cancelAtPeriodEnd ||
    ["cancelled", "ended"].includes(subscription.status)
  ) {
    return null;
  }
  const scheduledTier =
    pendingChange?.changeKind === "downgrade" &&
    pendingChange.state === "scheduled"
      ? pendingChange.targetTier
      : subscription.tier;
  return Object.freeze({
    tierId: scheduledTier.tierId,
    amountMinor: scheduledTier.price.amountMinor,
    currency: "USD",
    dueAt: subscription.currentPeriod.endsAt,
    state: ["grace", "suspended"].includes(
      subscription.status
    )
      ? "attention_required"
      : "scheduled"
  });
}

function tierChangeAvailable(
  subscription,
  pendingChange,
  catalog,
  site
) {
  return Boolean(
    subscription &&
      subscription.status === "active" &&
      subscription.paymentState === "paid" &&
      subscription.currentPeriod !== null &&
      subscription.cancelAtPeriodEnd === false &&
      pendingChange === null &&
      site.state === "live" &&
      catalog.tiers.some(
        (tier) => tier.rank !== subscription.tier.rank
      )
  );
}

function exactRepositorySnapshot(value, scope) {
  exactKeys(
    value,
    [
      "downloadCreditAvailable",
      "pendingChange",
      "projectId",
      "receipts",
      "site",
      "subscription"
    ],
    "accountSnapshot"
  );
  invariant(
    value.projectId === scope.projectId &&
      typeof value.downloadCreditAvailable === "boolean",
    "repository_conflict",
    "the customer Alakazam account binding changed",
    { status: 500 }
  );
  return value;
}

export function createAlakazamAccountService({
  repository
} = {}) {
  invariant(
    repository &&
      typeof repository.readCustomerAccount === "function",
    "invalid_configuration",
    "the Alakazam account repository is incomplete",
    { status: 500 }
  );
  const catalog = getBrowserSafeAlakazamCatalog();
  return Object.freeze({
    async read(scopeInput) {
      const scope = exactScope(scopeInput);
      const stored = exactRepositorySnapshot(
        await repository.readCustomerAccount(scope),
        scope
      );
      const subscription = exactSubscription(
        stored.subscription,
        catalog
      );
      const pendingChange = exactPendingChange(
        stored.pendingChange,
        catalog
      );
      const site = exactRepositorySite(
        stored.site,
        scope,
        catalog
      );
      const downloadCreditAvailable =
        stored.downloadCreditAvailable &&
        subscription === null;
      const configureSiteAvailable =
        subscription === null &&
        pendingChange === null &&
        [
          "setup_required",
          "ready_for_checkout"
        ].includes(site.state);
      const startAvailable =
        configureSiteAvailable &&
        site.state === "ready_for_checkout";
      const changeTierAvailable = tierChangeAvailable(
        subscription,
        pendingChange,
        catalog,
        site
      );
      const actionReason =
        site.state === "setup_required" &&
        configureSiteAvailable
          ? "site_setup_required"
          : startAvailable
            ? "only_start_composed"
            : site.state === "payment_pending"
              ? "site_payment_pending"
              : site.state === "publishing"
                ? "site_publishing"
                : changeTierAvailable
                  ? "only_tier_change_composed"
                  : site.state === "attention_required"
                    ? "site_attention_required"
                    : "customer_commands_not_composed";
      return deepFreeze({
        schema: ALAKAZAM_ACCOUNT_SCHEMA,
        projectId: scope.projectId,
        state: accountState(subscription),
        catalog: clone(catalog),
        downloadCredit: {
          available: downloadCreditAvailable,
          amountMinor: downloadCreditAvailable
            ? catalog.ladder.downloadCreditMinor
            : 0,
          currency: "USD"
        },
        subscription,
        pendingChange,
        nextRenewal: nextRenewal(
          subscription,
          pendingChange
        ),
        site,
        receipts: exactReceipts(stored.receipts),
        actions: {
          configureSite: configureSiteAvailable,
          start: startAvailable,
          changeTier: changeTierAvailable,
          manageBilling: false,
          cancel: false,
          reason: actionReason
        }
      });
    }
  });
}
