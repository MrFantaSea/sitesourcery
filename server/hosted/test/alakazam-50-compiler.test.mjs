import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createAlakazam50Configuration
} from "../../commerce-v2/alakazam-50.mjs";
import { resolveAlakazamTier } from "../../commerce-v2/alakazam.mjs";
import { digest } from "../../commerce-v2/canonical.mjs";
import {
  ALAKAZAM_50_COMPILER_SCHEMA,
  createAlakazam50Compiler
} from "../alakazam-50-compiler.mjs";

const IDS = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  customerId: "20000000-0000-4000-8000-000000000001",
  projectId: "30000000-0000-4000-8000-000000000001",
  subscriptionId: "40000000-0000-4000-8000-000000000001",
  commandId: "50000000-0000-4000-8000-000000000001"
};
const NOW = "2026-08-09T12:00:00.000Z";

function authority(tierId = "alakazam_50") {
  const tier = resolveAlakazamTier(tierId);
  const policy = {
    schema: "sitesourcery.alakazam-effective-policy/v1",
    catalogVersion: "alakazam.2026-08-02.v1",
    tierId,
    capabilities: tier.capabilities,
    limits: tier.limits
  };
  return {
    subscriptionId: IDS.subscriptionId,
    subscriptionRevision: 7,
    policy,
    policyDigest: digest(policy)
  };
}

function configuration(overrides = {}) {
  return createAlakazam50Configuration({
    scope: {
      tenantId: IDS.tenantId,
      customerId: IDS.customerId,
      actorId: IDS.customerId,
      projectId: IDS.projectId
    },
    commandId: IDS.commandId,
    subscription: {
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_50",
      status: "active",
      revision: 7
    },
    expectedCurrentRevision: 0,
    cashAppHandle: "cedar.shop",
    venmoHandle: "cedar_shop",
    fontChoiceId: "editorial",
    borderChoiceId: "ornate",
    menu: [
      { target: "contact", label: "Pay Cedar" },
      { target: "about", label: "Our story" }
    ],
    configuredAt: NOW,
    ...overrides
  });
}

function baseHtml({ practical = true } = {}) {
  return [
    "<!doctype html><html><head><style>body{color:black}</style></head><body>",
    '<header class="sitebar"><nav aria-label="Page"><a href="#about">About</a>',
    '<a href="#practical">Details</a><a href="#contact">Contact</a></nav></header>',
    '<section class="section about" id="about"><div class="wrap">About</div></section>',
    practical
      ? '<section class="section practical" id="practical"><div class="wrap">Details</div></section>'
      : "",
    '<section class="section contact" id="contact"><div class="wrap"><div class="actions">Contact</div></div></section>',
    "</body></html>"
  ].join("");
}

function baseCompiler(html = baseHtml()) {
  return {
    compileAlakazam(input) {
      const htmlBytes = Buffer.from(html);
      return {
        schema: "abracadabra.spark/v1",
        fulfillmentSchema: "abracadabra.alakazam-35/v1",
        compilerRevision: `sha256:${"a".repeat(64)}`,
        policyDigest: input.authority.policyDigest,
        artifactDigest: createHash("sha256").update(htmlBytes).digest("hex"),
        artifactSetDigest: "b".repeat(64),
        effectiveFacts: { theme: "clear" },
        html,
        htmlBytes,
        assets: []
      };
    }
  };
}

test("$50 compiler renders exact payment links, menu labels/order, fonts, borders, and provenance", () => {
  const compiler = createAlakazam50Compiler({ baseCompiler: baseCompiler() });
  const selected = compiler.compile({
    authority: authority(),
    configuredFacts: { theme: "clear" },
    configuration: configuration()
  });
  assert.equal(selected.fulfillmentSchema, ALAKAZAM_50_COMPILER_SCHEMA);
  assert.match(selected.html, /Cash App \$cedar\.shop/u);
  assert.match(selected.html, /Venmo @cedar_shop/u);
  assert.match(
    selected.html,
    /<nav aria-label="Page"><a href="#contact">Pay Cedar<\/a><a href="#about">Our story<\/a><\/nav>/u
  );
  assert.match(selected.html, /Iowan Old Style/u);
  assert.match(selected.html, /border-style:double/u);
  assert.match(selected.html, /sitesourcery-alakazam-50-configuration/u);
  assert.equal(selected.assets.length, 0);
  assert.equal(selected.artifactDigest,
    createHash("sha256").update(selected.htmlBytes).digest("hex"));
});

test("$50 compiler fails closed on lower-tier authority and changed configuration", () => {
  const compiler = createAlakazam50Compiler({ baseCompiler: baseCompiler() });
  assert.throws(() => compiler.compile({
    authority: authority("alakazam_35"),
    configuredFacts: { theme: "clear" },
    configuration: configuration()
  }), /exact current/u);
  assert.throws(() => compiler.compile({
    authority: authority(),
    configuredFacts: { theme: "clear" },
    configuration: {
      ...configuration(),
      borderChoiceId: "sharp"
    }
  }), /configuration changed/u);
});

test("$50 compiler rejects payment or menu output targeting a hidden $35 section", () => {
  const compiler = createAlakazam50Compiler({
    baseCompiler: baseCompiler(baseHtml({ practical: false }))
  });
  assert.throws(() => compiler.compile({
    authority: authority(),
    configuredFacts: { theme: "clear" },
    configuration: configuration({
      cashAppHandle: null,
      venmoHandle: null,
      menu: [{ target: "practical", label: "Hours" }]
    })
  }), /hidden section/u);
  const withoutContact = baseHtml().replace(
    /<section class="section contact"[\s\S]*?<\/section>/u,
    ""
  );
  const paymentCompiler = createAlakazam50Compiler({
    baseCompiler: baseCompiler(withoutContact)
  });
  assert.throws(() => paymentCompiler.compile({
    authority: authority(),
    configuredFacts: { theme: "clear" },
    configuration: configuration({
      menu: [{ target: "about", label: "About" }]
    })
  }), /Contact section/u);
});
