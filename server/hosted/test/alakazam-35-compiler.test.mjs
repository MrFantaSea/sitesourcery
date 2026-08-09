import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazam35Configuration,
  prepareAlakazam35PhotoUpload
} from "../../commerce-v2/alakazam-35.mjs";
import { digest } from "../../commerce-v2/canonical.mjs";
import {
  ALAKAZAM_35_COMPILER_SCHEMA,
  createAlakazam35Compiler
} from "../alakazam-35-compiler.mjs";
import {
  SPARK_COMPILER_SCHEMA,
  createSparkCompilerPort
} from "../spark-compiler-port.mjs";

const IDS = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  customerId: "20000000-0000-4000-8000-000000000001",
  projectId: "30000000-0000-4000-8000-000000000001",
  subscriptionId: "40000000-0000-4000-8000-000000000001",
  commandId: "50000000-0000-4000-8000-000000000001",
  photoId: "60000000-0000-4000-8000-000000000001"
};
const NOW = "2026-08-08T12:00:00.000Z";

function photo() {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(320, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return prepareAlakazam35PhotoUpload({
    assetId: IDS.photoId,
    mediaType: "image/png",
    mediaBase64: bytes.toString("base64"),
    uploadedAt: NOW
  });
}

function metadata(selected) {
  const { mediaBytes, schema, state, holdReason, ...value } = selected;
  return value;
}

function authority() {
  const policy = {
    schema: "sitesourcery.alakazam-effective-policy/v1",
    catalogVersion: "alakazam.2026-08-02.v1",
    tierId: "alakazam_35",
    capabilities: [
      "expanded_fonts",
      "photo_header",
      "section_toggles",
      "version_history"
    ],
    limits: {
      careClass: "modest",
      versionHistory: 3,
      fontControls: "expanded",
      borderControls: "base"
    }
  };
  return { policy, policyDigest: digest(policy) };
}

function configuration(selectedPhoto = photo()) {
  return createAlakazam35Configuration({
    scope: {
      tenantId: IDS.tenantId,
      customerId: IDS.customerId,
      actorId: IDS.customerId,
      projectId: IDS.projectId
    },
    commandId: IDS.commandId,
    subscription: {
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_35",
      status: "active",
      revision: 4
    },
    expectedCurrentRevision: 0,
    fontChoiceId: "alt",
    sections: {
      about: true,
      offerings: false,
      practical: false,
      contact: true
    },
    photo: metadata(selectedPhoto),
    configuredAt: NOW
  });
}

function facts() {
  return {
    theme: "clear",
    businessName: "Cedar Workshop",
    summary: "Furniture made locally.",
    about: "Built one careful piece at a time.",
    offerings: ["Tables", "Shelves"],
    location: "Camden, New Jersey",
    hours: "Weekdays",
    phone: "856-555-0123",
    email: "hello@example.com",
    website: "https://example.com",
    primaryAction: "phone",
    cashapp: "rogue",
    venmo: "rogue"
  };
}

test("Alakazam 35 compiler emits deterministic HTML plus exact immutable photo asset", async () => {
  const mediaAsset = photo();
  const compiler = createAlakazam35Compiler({
    baseCompiler: await createSparkCompilerPort()
  });
  const input = {
    authority: authority(),
    configuredFacts: facts(),
    configuration: configuration(mediaAsset),
    mediaAsset
  };
  const first = compiler.compile(input);
  const second = compiler.compile(input);
  assert.equal(first.schema, SPARK_COMPILER_SCHEMA);
  assert.equal(first.fulfillmentSchema, ALAKAZAM_35_COMPILER_SCHEMA);
  assert.equal(first.artifactDigest, second.artifactDigest);
  assert.equal(first.artifactSetDigest, second.artifactSetDigest);
  assert.equal(first.assets.length, 1);
  assert.equal(first.assets[0].assetDigest, mediaAsset.assetDigest);
  assert.deepEqual(first.assets[0].bytes, mediaAsset.mediaBytes);
  assert.match(first.html, /class="alakazam-photo"/u);
  assert.match(first.html, new RegExp(mediaAsset.assetDigest, "u"));
  assert.doesNotMatch(first.html, /id="offerings"/u);
  assert.doesNotMatch(first.html, /id="practical"/u);
  assert.doesNotMatch(first.html, /Cash App|Venmo/u);
  assert.match(first.html, /font-family:Georgia/u);
});

test("Alakazam 35 compiler can intentionally omit a photo without phantom assets", async () => {
  const config = createAlakazam35Configuration({
    scope: {
      tenantId: IDS.tenantId,
      customerId: IDS.customerId,
      actorId: IDS.customerId,
      projectId: IDS.projectId
    },
    commandId: IDS.commandId,
    subscription: {
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_35",
      status: "active",
      revision: 4
    },
    expectedCurrentRevision: 0,
    fontChoiceId: "standard",
    sections: {
      about: true,
      offerings: true,
      practical: true,
      contact: true
    },
    photo: null,
    configuredAt: NOW
  });
  const compiler = createAlakazam35Compiler({
    baseCompiler: await createSparkCompilerPort()
  });
  const result = compiler.compile({
    authority: authority(),
    configuredFacts: facts(),
    configuration: config,
    mediaAsset: null
  });
  assert.equal(result.assets.length, 0);
  assert.doesNotMatch(result.html, /alakazam-photo/u);
});

test("Alakazam 35 compiler hides contact without invalidating reviewed source facts", async () => {
  const selected = configuration(photo());
  const hiddenContact = createAlakazam35Configuration({
    scope: {
      tenantId: IDS.tenantId,
      customerId: IDS.customerId,
      actorId: IDS.customerId,
      projectId: IDS.projectId
    },
    commandId: IDS.commandId,
    subscription: {
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_35",
      status: "active",
      revision: 4
    },
    expectedCurrentRevision: 0,
    fontChoiceId: "alt",
    sections: {
      about: selected.sections.about,
      offerings: selected.sections.offerings,
      practical: selected.sections.practical,
      contact: false
    },
    photo: selected.photo,
    configuredAt: NOW
  });
  const compiler = createAlakazam35Compiler({
    baseCompiler: await createSparkCompilerPort()
  });
  const result = compiler.compile({
    authority: authority(),
    configuredFacts: facts(),
    configuration: hiddenContact,
    mediaAsset: photo()
  });
  assert.doesNotMatch(result.html, /id="contact"/u);
  assert.doesNotMatch(result.html, /href="#contact"/u);
  assert.doesNotMatch(result.html, /856-555-0123|hello@example\.com/u);
});

test("Alakazam 35 compiler rejects substituted photo bytes and unexpected assets", async () => {
  const mediaAsset = photo();
  const compiler = createAlakazam35Compiler({
    baseCompiler: await createSparkCompilerPort()
  });
  assert.throws(() => compiler.compile({
    authority: authority(),
    configuredFacts: facts(),
    configuration: configuration(mediaAsset),
    mediaAsset: {
      ...mediaAsset,
      mediaBytes: Buffer.from("substituted")
    }
  }), /immutable asset/u);
  const withoutPhoto = createAlakazam35Configuration({
    scope: {
      tenantId: IDS.tenantId,
      customerId: IDS.customerId,
      actorId: IDS.customerId,
      projectId: IDS.projectId
    },
    commandId: IDS.commandId,
    subscription: {
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_35",
      status: "active",
      revision: 4
    },
    expectedCurrentRevision: 0,
    fontChoiceId: "standard",
    sections: {
      about: true,
      offerings: true,
      practical: true,
      contact: true
    },
    photo: null,
    configuredAt: NOW
  });
  assert.throws(() => compiler.compile({
    authority: authority(),
    configuredFacts: facts(),
    configuration: withoutPhoto,
    mediaAsset
  }), /unexpected/u);
});
