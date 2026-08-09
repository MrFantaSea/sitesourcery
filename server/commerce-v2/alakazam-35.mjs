import { createHash } from "node:crypto";

import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_35_SNAPSHOT_SCHEMA =
  "sitesourcery.alakazam-35-snapshot/v1";
export const ALAKAZAM_35_CONFIGURATION_SCHEMA =
  "sitesourcery.alakazam-35-configuration/v1";
export const ALAKAZAM_35_PHOTO_SCHEMA =
  "sitesourcery.alakazam-35-photo/v1";
export const ALAKAZAM_35_CARE_SCHEMA =
  "sitesourcery.alakazam-35-care-request/v1";
export const ALAKAZAM_35_HOLD_REASON =
  "commercial_cutover_not_authorized";
export const ALAKAZAM_35_MAX_PHOTO_BYTES = 2_000_000;
export const ALAKAZAM_35_SECTION_IDS = Object.freeze([
  "about",
  "offerings",
  "practical",
  "contact"
]);
export const ALAKAZAM_35_FONT_CHOICES = deepFreeze([
  { fontChoiceId: "standard", label: "Standard" },
  { fontChoiceId: "alt", label: "Alternate" }
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PHOTO_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png"
});

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
  invariant(UUID.test(selected), "invalid_input", `${field} is invalid`);
  return selected;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function exactScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "scope"
  );
  const actorId = exactUuid(value.actorId, "scope.actorId");
  const customerId = exactUuid(value.customerId, "scope.customerId");
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the Alakazam configuration project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "scope.tenantId"),
    projectId: exactUuid(value.projectId, "scope.projectId"),
    customerId,
    actorId
  });
}

function exactSections(value) {
  exactKeys(value, ALAKAZAM_35_SECTION_IDS, "sections");
  const selected = {};
  for (const sectionId of ALAKAZAM_35_SECTION_IDS) {
    invariant(
      typeof value[sectionId] === "boolean",
      "invalid_input",
      `sections.${sectionId} is invalid`
    );
    selected[sectionId] = value[sectionId];
  }
  return Object.freeze(selected);
}

function exactFontChoice(value) {
  const selected = requiredText(value, "fontChoiceId", 40);
  invariant(
    ALAKAZAM_35_FONT_CHOICES.some(
      (entry) => entry.fontChoiceId === selected
    ),
    "alakazam_font_unavailable",
    "the selected Alakazam font choice is unavailable",
    { status: 409 }
  );
  return selected;
}

function imageDimensions(bytes, mediaType) {
  if (mediaType === "image/png") {
    invariant(
      bytes.length >= 33 &&
        bytes.subarray(0, 8).equals(
          Buffer.from("89504e470d0a1a0a", "hex")
        ) &&
        bytes.subarray(12, 16).toString("ascii") === "IHDR",
      "alakazam_photo_invalid",
      "the Alakazam header photo is not a valid PNG",
      { status: 400 }
    );
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }

  invariant(
    bytes.length >= 11 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9,
    "alakazam_photo_invalid",
    "the Alakazam header photo is not a valid JPEG",
    { status: 400 }
  );
  let offset = 2;
  while (offset + 9 < bytes.length) {
    invariant(
      bytes[offset] === 0xff,
      "alakazam_photo_invalid",
      "the Alakazam header photo is not a valid JPEG",
      { status: 400 }
    );
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    invariant(
      offset + 2 <= bytes.length,
      "alakazam_photo_invalid",
      "the Alakazam header photo is not a valid JPEG",
      { status: 400 }
    );
    const length = bytes.readUInt16BE(offset);
    invariant(
      length >= 2 && offset + length <= bytes.length,
      "alakazam_photo_invalid",
      "the Alakazam header photo is not a valid JPEG",
      { status: 400 }
    );
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
        .includes(marker)
    ) {
      invariant(
        length >= 7,
        "alakazam_photo_invalid",
        "the Alakazam header photo is not a valid JPEG",
        { status: 400 }
      );
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5)
      };
    }
    offset += length;
  }
  invariant(
    false,
    "alakazam_photo_invalid",
    "the Alakazam header photo has no readable dimensions",
    { status: 400 }
  );
}

function validateDimensions({ width, height }) {
  invariant(
    Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width >= 320 &&
      width <= 4096 &&
      height >= 160 &&
      height <= 2160 &&
      width / height >= 1 &&
      width / height <= 4,
    "alakazam_photo_dimensions_invalid",
    "the Alakazam header photo dimensions are outside the safe header bounds",
    { status: 400 }
  );
  return { width, height };
}

function exactPhotoMetadata(value) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "assetDigest",
      "assetId",
      "assetPath",
      "byteCount",
      "height",
      "mediaType",
      "uploadedAt",
      "width"
    ],
    "photo"
  );
  const mediaType = requiredText(value.mediaType, "photo.mediaType", 40);
  const assetDigest = requiredDigest(
    value.assetDigest,
    "photo.assetDigest"
  );
  invariant(
    PHOTO_TYPES[mediaType] &&
      value.assetPath ===
        `assets/alakazam-header-${assetDigest}.${PHOTO_TYPES[mediaType]}`,
    "alakazam_photo_invalid",
    "the Alakazam header photo path is invalid",
    { status: 409 }
  );
  const dimensions = validateDimensions({
    width: positiveInteger(value.width, "photo.width"),
    height: positiveInteger(value.height, "photo.height")
  });
  const byteCount = positiveInteger(
    value.byteCount,
    "photo.byteCount"
  );
  invariant(
    byteCount <= ALAKAZAM_35_MAX_PHOTO_BYTES,
    "alakazam_photo_invalid",
    "the Alakazam header photo is too large",
    { status: 409 }
  );
  return Object.freeze({
    assetId: exactUuid(value.assetId, "photo.assetId"),
    assetDigest,
    assetPath: value.assetPath,
    mediaType,
    byteCount,
    ...dimensions,
    uploadedAt: requiredIso(value.uploadedAt, "photo.uploadedAt")
  });
}

export function prepareAlakazam35PhotoUpload(input) {
  exactKeys(
    input,
    ["assetId", "mediaBase64", "mediaType", "uploadedAt"],
    "photoUpload"
  );
  const mediaType = requiredText(
    input.mediaType,
    "photoUpload.mediaType",
    40
  );
  invariant(
    Boolean(PHOTO_TYPES[mediaType]),
    "alakazam_photo_type_invalid",
    "Alakazam header photos must be PNG or JPEG",
    { status: 400 }
  );
  invariant(
    typeof input.mediaBase64 === "string" &&
      input.mediaBase64.length >= 4 &&
      input.mediaBase64.length <=
        Math.ceil(ALAKAZAM_35_MAX_PHOTO_BYTES / 3) * 4 + 4 &&
      input.mediaBase64.length % 4 === 0 &&
      BASE64.test(input.mediaBase64),
    "alakazam_photo_invalid",
    "the Alakazam header photo encoding is invalid",
    { status: 400 }
  );
  const mediaBytes = Buffer.from(input.mediaBase64, "base64");
  invariant(
    mediaBytes.length > 0 &&
      mediaBytes.length <= ALAKAZAM_35_MAX_PHOTO_BYTES &&
      mediaBytes.toString("base64") === input.mediaBase64,
    "alakazam_photo_invalid",
    "the Alakazam header photo encoding is invalid",
    { status: 400 }
  );
  const dimensions = validateDimensions(
    imageDimensions(mediaBytes, mediaType)
  );
  const assetDigest = createHash("sha256")
    .update(mediaBytes)
    .digest("hex");
  return Object.freeze({
    schema: ALAKAZAM_35_PHOTO_SCHEMA,
    assetId: exactUuid(input.assetId, "photoUpload.assetId"),
    mediaType,
    mediaBytes,
    byteCount: mediaBytes.length,
    assetDigest,
    assetPath:
      `assets/alakazam-header-${assetDigest}.${PHOTO_TYPES[mediaType]}`,
    ...dimensions,
    state: "held",
    holdReason: ALAKAZAM_35_HOLD_REASON,
    uploadedAt: requiredIso(input.uploadedAt, "photoUpload.uploadedAt")
  });
}

export function createAlakazam35Configuration(input) {
  exactKeys(
    input,
    [
      "commandId",
      "configuredAt",
      "expectedCurrentRevision",
      "fontChoiceId",
      "photo",
      "scope",
      "sections",
      "subscription"
    ],
    "configuration"
  );
  const scope = exactScope(input.scope);
  exactKeys(
    input.subscription,
    ["revision", "status", "subscriptionId", "tierId"],
    "subscription"
  );
  invariant(
    ["alakazam_35", "alakazam_50"].includes(
      input.subscription.tierId
    ) && ["active", "grace"].includes(input.subscription.status),
    "alakazam_35_unavailable",
    "the active Alakazam tier does not include the $35 controls",
    { status: 409 }
  );
  const expectedCurrentRevision = nonnegativeInteger(
    input.expectedCurrentRevision,
    "expectedCurrentRevision"
  );
  const photo = exactPhotoMetadata(input.photo);
  const configuration = {
    schema: ALAKAZAM_35_CONFIGURATION_SCHEMA,
    ...scope,
    commandId: exactUuid(input.commandId, "commandId"),
    subscriptionId: exactUuid(
      input.subscription.subscriptionId,
      "subscription.subscriptionId"
    ),
    subscriptionRevision: positiveInteger(
      input.subscription.revision,
      "subscription.revision"
    ),
    configurationRevision: expectedCurrentRevision + 1,
    fontChoiceId: exactFontChoice(input.fontChoiceId),
    sections: clone(exactSections(input.sections)),
    photo,
    state: "held",
    holdReason: ALAKAZAM_35_HOLD_REASON,
    configuredAt: requiredIso(input.configuredAt, "configuredAt")
  };
  return deepFreeze({
    ...configuration,
    configurationDigest: digest(configuration)
  });
}

export function createAlakazam35CareRequest(input) {
  exactKeys(
    input,
    ["commandId", "message", "requestedAt", "scope", "subscription"],
    "careRequest"
  );
  const scope = exactScope(input.scope);
  exactKeys(
    input.subscription,
    ["revision", "status", "subscriptionId", "tierId"],
    "subscription"
  );
  invariant(
    ["alakazam_35", "alakazam_50"].includes(
      input.subscription.tierId
    ) && ["active", "grace"].includes(input.subscription.status),
    "alakazam_care_unavailable",
    "the active Alakazam tier does not include care requests",
    { status: 409 }
  );
  const request = {
    schema: ALAKAZAM_35_CARE_SCHEMA,
    ...scope,
    commandId: exactUuid(input.commandId, "commandId"),
    subscriptionId: exactUuid(
      input.subscription.subscriptionId,
      "subscription.subscriptionId"
    ),
    subscriptionRevision: positiveInteger(
      input.subscription.revision,
      "subscription.revision"
    ),
    careClass: "modest",
    message: requiredText(input.message, "message", 1000),
    state: "held",
    holdReason: ALAKAZAM_35_HOLD_REASON,
    requestedAt: requiredIso(input.requestedAt, "requestedAt")
  };
  return deepFreeze({
    ...request,
    requestDigest: digest(request)
  });
}

function exactHistory(value) {
  invariant(
    Array.isArray(value) && value.length <= 3,
    "repository_conflict",
    "the Alakazam version history is invalid",
    { status: 500 }
  );
  return value.map((entry, index) => {
    exactKeys(
      entry,
      [
        "acceptedAt",
        "artifactDigest",
        "isCurrent",
        "versionId",
        "versionNumber"
      ],
      `history[${index}]`
    );
    invariant(
      typeof entry.isCurrent === "boolean",
      "repository_conflict",
      "the Alakazam version history is invalid",
      { status: 500 }
    );
    return Object.freeze({
      versionId: exactUuid(entry.versionId, `history[${index}].versionId`),
      versionNumber: positiveInteger(
        entry.versionNumber,
        `history[${index}].versionNumber`
      ),
      artifactDigest: requiredDigest(
        entry.artifactDigest,
        `history[${index}].artifactDigest`
      ),
      acceptedAt: requiredIso(
        entry.acceptedAt,
        `history[${index}].acceptedAt`
      ),
      isCurrent: entry.isCurrent
    });
  });
}

export function createAlakazam35Snapshot(input) {
  exactKeys(
    input,
    ["care", "configuration", "history", "photo", "projectId", "subscription"],
    "snapshot"
  );
  exactKeys(
    input.subscription,
    ["revision", "status", "subscriptionId", "tierId"],
    "snapshot.subscription"
  );
  invariant(
    ["alakazam_35", "alakazam_50"].includes(
      input.subscription.tierId
    ) && ["active", "grace"].includes(input.subscription.status),
    "alakazam_35_unavailable",
    "the active Alakazam tier does not include the $35 controls",
    { status: 409 }
  );
  const photo = exactPhotoMetadata(input.photo);
  const history = exactHistory(input.history);
  invariant(
    history.filter((entry) => entry.isCurrent).length <= 1,
    "repository_conflict",
    "the Alakazam version history has multiple current versions",
    { status: 500 }
  );
  const configuration = input.configuration === null
    ? null
    : deepFreeze(clone(input.configuration));
  invariant(
    input.care &&
      Number.isSafeInteger(input.care.requestCount) &&
      input.care.requestCount >= 0 &&
      (input.care.lastRequestedAt === null ||
        requiredIso(
          input.care.lastRequestedAt,
          "care.lastRequestedAt"
        )),
    "repository_conflict",
    "the Alakazam care accounting is invalid",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_35_SNAPSHOT_SCHEMA,
    state: "held",
    providerEffects: false,
    holdReason: ALAKAZAM_35_HOLD_REASON,
    projectId: exactUuid(input.projectId, "projectId"),
    subscription: {
      subscriptionId: exactUuid(
        input.subscription.subscriptionId,
        "snapshot.subscription.subscriptionId"
      ),
      tierId: input.subscription.tierId,
      status: input.subscription.status,
      revision: positiveInteger(
        input.subscription.revision,
        "snapshot.subscription.revision"
      )
    },
    controls: {
      photoHeader: {
        enabled: true,
        mediaTypes: Object.keys(PHOTO_TYPES),
        maxBytes: ALAKAZAM_35_MAX_PHOTO_BYTES,
        photo
      },
      fonts: clone(ALAKAZAM_35_FONT_CHOICES),
      sections: clone(ALAKAZAM_35_SECTION_IDS),
      versionHistoryLimit: 3,
      careClass: "modest"
    },
    configuration,
    history,
    care: {
      state: "held",
      requestCount: input.care.requestCount,
      lastRequestedAt: input.care.lastRequestedAt
    }
  });
}

export function applyAlakazam35EffectiveFacts({
  authority,
  configuredFacts,
  configuration
}) {
  exactKeys(
    authority,
    ["policy", "policyDigest"],
    "authority"
  );
  invariant(
    authority.policy &&
      Array.isArray(authority.policy.capabilities) &&
      [
        "expanded_fonts",
        "photo_header",
        "section_toggles",
        "version_history"
      ].every((capability) =>
        authority.policy.capabilities.includes(capability)
      ) &&
      authority.policy.limits?.fontControls === "expanded" &&
      authority.policy.limits?.versionHistory === 3,
    "alakazam_35_authority_invalid",
    "the Alakazam $35 compiler authority is invalid",
    { status: 409 }
  );
  invariant(
    configuredFacts &&
      typeof configuredFacts === "object" &&
      !Array.isArray(configuredFacts),
    "invalid_input",
    "configuredFacts is invalid"
  );
  invariant(
    configuration?.schema === ALAKAZAM_35_CONFIGURATION_SCHEMA &&
      configuration.configurationDigest ===
        digest(
          Object.fromEntries(
            Object.entries(configuration).filter(
              ([key]) => key !== "configurationDigest"
            )
          )
        ),
    "alakazam_35_configuration_invalid",
    "the Alakazam $35 configuration changed",
    { status: 409 }
  );
  const effectiveFacts = clone(configuredFacts);
  effectiveFacts.fontPair = exactFontChoice(
    configuration.fontChoiceId
  );
  effectiveFacts.borderStyle = "soft";
  effectiveFacts.sectionVisibility = clone(
    exactSections(configuration.sections)
  );
  effectiveFacts.photoHeader = configuration.photo === null
    ? null
    : clone(exactPhotoMetadata(configuration.photo));
  delete effectiveFacts.cashapp;
  delete effectiveFacts.venmo;
  delete effectiveFacts.menu;
  return deepFreeze({
    policy: clone(authority.policy),
    policyDigest: requiredDigest(
      authority.policyDigest,
      "authority.policyDigest"
    ),
    configurationDigest: configuration.configurationDigest,
    effectiveFacts
  });
}

function validateServicePorts(repository, clock) {
  invariant(
    repository &&
      [
        "read",
        "readiness",
        "recordCare",
        "saveConfiguration",
        "storePhoto"
      ].every((method) => typeof repository[method] === "function"),
    "invalid_configuration",
    "the Alakazam $35 repository is required",
    { status: 500 }
  );
  invariant(
    clock && typeof clock.now === "function",
    "invalid_configuration",
    "the Alakazam $35 clock is required",
    { status: 500 }
  );
  return { repository, clock };
}

export function createAlakazam35Service({ repository, clock } = {}) {
  const ports = validateServicePorts(repository, clock);
  function now() {
    const value = ports.clock.now();
    return requiredIso(
      value instanceof Date ? value.toISOString() : value,
      "clock.now"
    );
  }
  return Object.freeze({
    readiness() {
      return ports.repository.readiness();
    },
    read(scope) {
      return ports.repository.read(exactScope(scope));
    },
    async uploadPhoto(scope, input) {
      exactKeys(
        input,
        ["commandId", "mediaBase64", "mediaType"],
        "photoUpload"
      );
      const selectedScope = exactScope(scope);
      const photo = prepareAlakazam35PhotoUpload({
        assetId: input.commandId,
        mediaBase64: input.mediaBase64,
        mediaType: input.mediaType,
        uploadedAt: now()
      });
      await ports.repository.storePhoto(selectedScope, photo);
      return ports.repository.read(selectedScope);
    },
    async configure(scope, input) {
      exactKeys(
        input,
        [
          "commandId",
          "expectedCurrentRevision",
          "fontChoiceId",
          "photoAssetId",
          "sections"
        ],
        "configuration"
      );
      const selectedScope = exactScope(scope);
      await ports.repository.saveConfiguration(selectedScope, {
        commandId: exactUuid(input.commandId, "commandId"),
        expectedCurrentRevision: nonnegativeInteger(
          input.expectedCurrentRevision,
          "expectedCurrentRevision"
        ),
        fontChoiceId: exactFontChoice(input.fontChoiceId),
        photoAssetId: input.photoAssetId === null
          ? null
          : exactUuid(input.photoAssetId, "photoAssetId"),
        sections: exactSections(input.sections),
        configuredAt: now()
      });
      return ports.repository.read(selectedScope);
    },
    async requestCare(scope, input) {
      exactKeys(
        input,
        ["commandId", "message"],
        "careRequest"
      );
      const selectedScope = exactScope(scope);
      await ports.repository.recordCare(selectedScope, {
        commandId: exactUuid(input.commandId, "commandId"),
        message: requiredText(input.message, "message", 1000),
        requestedAt: now()
      });
      return ports.repository.read(selectedScope);
    }
  });
}
