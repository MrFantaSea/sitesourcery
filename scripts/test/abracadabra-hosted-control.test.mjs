import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  configureHostedAbracadabraHtml,
  hostedStagingAssets,
} from "../configure-abracadabra-hosted-staging.mjs";

const require = createRequire(import.meta.url);
const modeModule = require("../../abracadabra/app/abracadabra-control-mode.js");
const { APIError, createClient } = require("../../abracadabra/app/abracadabra-api.js");
const {
  ControlError,
  createHostedControl,
} = require("../../abracadabra/app/abracadabra-hosted-control.js");
const {
  recoveryRequestOutcome,
} = require("../../abracadabra/app/abracadabra-hosted-control-dom.js");
const customerControl = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
);

function response(status, payload, requestId = "req_hosted") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return "application/json";
        if (name.toLowerCase() === "x-request-id") return requestId;
        return null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function documentFixture(mode, catalog = {}) {
  return {
    querySelector(selector) {
      if (selector !== 'meta[name="sitesourcery-abracadabra-control-mode"]') return null;
      if (mode == null) return null;
      return { getAttribute: () => mode };
    },
    getElementById(id) {
      if (id !== "abracadabra-hosted-catalog") return null;
      return { textContent: JSON.stringify(catalog) };
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function projectLegalAuthorityFixture(overrides = {}) {
  const privacyVersion =
    "SS-HOSTED-PRIVACY-2099-01-01-V3";
  return {
    schema: "sitesourcery.project-legal-authority/v3",
    acceptanceStatement:
      "accepted_exact_project_terms_and_acknowledged_privacy",
    authorityDigest: "a".repeat(64),
    documents: [
      {
        kind: "privacy",
        version: privacyVersion,
        contentDigest: "b".repeat(64),
        contentUri:
          "https://sitesourcery.com/legal/privacy/versions/"
          + privacyVersion + "/",
        effectiveAt: "2099-01-01T00:00:00.000Z",
      },
      {
        kind: "product",
        version:
          "SS-HOSTED-WEBSITE-TERMS-2099-01-01-V3",
        contentDigest: "c".repeat(64),
        contentUri:
          "https://sitesourcery.com/legal/website-terms/#self-service",
        effectiveAt: "2099-01-01T00:00:00.000Z",
      },
      {
        kind: "website",
        version:
          "SS-HOSTED-WEBSITE-TERMS-2099-01-01-V3",
        contentDigest: "c".repeat(64),
        contentUri:
          "https://sitesourcery.com/legal/website-terms/",
        effectiveAt: "2099-01-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function baseApi(overrides = {}) {
  const project = {
    id: "project_1",
    name: "Hosted project",
    draft: { revision: 4, rawFacts: {} },
    versions: [],
  };
  return {
    me: async () => ({ user: { id: "user_1", email: "owner@example.com" } }),
    getProjectLegalAuthority:
      async () => projectLegalAuthorityFixture(),
    listOrganizations: async () => ({ organizations: [{ id: "org_1", name: "Owner org" }] }),
    listProjects: async () => ({ projects: [project] }),
    getProject: async (id) => ({ project: { ...project, id } }),
    subscription: async () => ({ subscription: { id: "sub_1", status: "inactive" } }),
    ...overrides,
  };
}

async function selectedControl(overrides = {}, options = {}) {
  const control = createHostedControl({
    api: baseApi(overrides),
    idempotencyFactory: options.idempotencyFactory || (() => "idem_test"),
    catalog: options.catalog,
  });
  await control.boot();
  await control.selectProject("project_1");
  return control;
}

test("customer control accepts only exact activation fragments, quotes, and Stripe Checkout", () => {
  assert.equal(
    customerControl.registrationTokenFromLocation({
      hash: "#verify-registration=token%2Fwith%20space",
    }),
    "token/with space",
  );
  assert.equal(
    customerControl.recoveryTokenFromLocation({
      hash: "#recovery=recovery_token_1",
    }),
    "recovery_token_1",
  );
  assert.equal(
    customerControl.registrationTokenFromLocation({
      hash: "#recovery=wrong",
    }),
    "",
  );

  const downloadProjectId =
    "9f5a7527-de1d-45ed-b8fb-5e096cbda860";
  assert.deepEqual(
    customerControl.downloadCheckoutReturnFromLocation({
      search:
        "?checkout=cs_test_download_1&download_project="
        + downloadProjectId,
    }),
    {
      checkoutSessionId: "cs_test_download_1",
      projectId: downloadProjectId,
    },
  );
  for (const search of [
    "?checkout=cs_test_download_1",
    "?download_project=" + downloadProjectId,
    "?checkout=not-stripe&download_project="
      + downloadProjectId,
    "?checkout=cs_test_download_1&download_project=project_1",
    "?checkout=cs_test_download_1&checkout=cs_test_download_2&download_project="
      + downloadProjectId,
  ]) {
    assert.equal(
      customerControl
        .downloadCheckoutReturnFromLocation({
          search,
        }),
      null,
    );
  }
  assert.equal(
    customerControl
      .locationWithoutDownloadCheckoutReturn({
        pathname: "/abracadabra/app/",
        search:
          "?keep=1&checkout=cs_test_download_1&download_project="
          + downloadProjectId,
        hash: "#account",
      }),
    "/abracadabra/app/?keep=1#account",
  );

  const assessmentInvoiceId =
    "8e30fb8b-e4fb-4f84-86eb-16e85f20daf3";
  assert.deepEqual(
    customerControl.assessmentCheckoutReturnFromLocation({
      search:
        "?checkout=cs_test_assessment_1&assessment_project="
        + downloadProjectId
        + "&assessment_invoice="
        + assessmentInvoiceId,
    }),
    {
      checkoutSessionId: "cs_test_assessment_1",
      invoiceId: assessmentInvoiceId,
      projectId: downloadProjectId,
    },
  );
  for (const search of [
    "?checkout=cs_test_assessment_1&assessment_project="
      + downloadProjectId,
    "?checkout=cs_test_assessment_1&assessment_project="
      + downloadProjectId
      + "&assessment_invoice=not-an-invoice",
    "?checkout=cs_test_assessment_1&download_project="
      + downloadProjectId
      + "&assessment_project="
      + downloadProjectId
      + "&assessment_invoice="
      + assessmentInvoiceId,
  ]) {
    assert.equal(
      customerControl.assessmentCheckoutReturnFromLocation({ search }),
      null,
    );
  }
  assert.equal(
    customerControl.locationWithoutCheckoutReturn({
      pathname: "/abracadabra/app/",
      search:
        "?keep=1&checkout=cs_test_assessment_1&assessment_project="
        + downloadProjectId
        + "&assessment_invoice="
        + assessmentInvoiceId,
      hash: "#account",
    }),
    "/abracadabra/app/?keep=1#account",
  );

  assert.equal(
    customerControl.safeCheckoutDestination({
      checkoutUrl: "https://checkout.stripe.com/c/pay/test",
    }),
    "https://checkout.stripe.com/c/pay/test",
  );
  for (const destination of [
    "http://checkout.stripe.com/c/pay/test",
    "https://checkout.stripe.com.attacker.test/c/pay/test",
    "https://attacker.test/c/pay/test",
    "/same-origin-but-not-stripe",
  ]) {
    assert.equal(
      customerControl.safeCheckoutDestination({
        checkoutUrl: destination,
      }),
      "",
    );
  }

  const quote = {
    quoteId: "download_quote_1",
    project: { projectId: "project_1" },
    version: { versionId: "version_1" },
    offerId: "spark_download",
    entitlementKind: "spark_download",
    price: {
      amountMinor: 500,
      currency: "USD",
      billing: "one_time",
      interval: null,
    },
    expiresAt: "2099-08-01T00:00:00.000Z",
    disclosure: {
      terms: {
        projectScope:
          "One Download applies to this editor project.",
      },
    },
    disclosureDigest: "d".repeat(64),
    snapshotDigest: "s".repeat(64),
  };
  const view = customerControl.verifiedDownloadQuote(
    quote,
    "project_1",
    "version_1",
    Date.parse("2099-07-01T00:00:00.000Z"),
  );
  assert.equal(view.price, "$5.00 USD");
  assert.equal(
    customerControl.verifiedDownloadQuote(
      {
        ...quote,
        price: { ...quote.price, amountMinor: 501 },
      },
      "project_1",
      "version_1",
      Date.parse("2099-07-01T00:00:00.000Z"),
    ),
    null,
  );
});

test("Download readiness requires exact project, version, settlement, and same-origin delivery evidence", () => {
  const project = {
    id: "project_1",
    versions: [{
      id: "version_1",
      state: "accepted",
    }],
    entitlements: [{
      id: "entitlement_1",
      projectId: "project_1",
      kind: "spark_download",
      scope: "editor_project",
      state: "active",
      activatedAt:
        "2026-07-30T12:00:00.000Z",
      expiresAt: null,
      acceptedDisclosureDigest:
        "d".repeat(64),
      downloadUrl:
        "/api/v1/projects/project_1/versions/version_1/download",
      payment: {
        status: "paid",
        provider: "stripe",
        receiptId: "receipt_1",
        amountMinor: 500,
        currency: "USD",
        settledAt:
          "2026-07-30T12:00:00.000Z",
      },
    }],
  };
  assert.equal(
    customerControl.downloadEntitlement(
      project,
      "version_1"
    ).id,
    "entitlement_1"
  );
  assert.equal(
    customerControl.versionLabel(
      project,
      "version_1"
    ),
    "Version 1"
  );
  for (const entitlement of [
    {
      ...project.entitlements[0],
      projectId: "project_foreign",
    },
    {
      ...project.entitlements[0],
      state: "paid",
    },
    {
      ...project.entitlements[0],
      acceptedDisclosureDigest: "",
    },
    {
      ...project.entitlements[0],
      payment: {
        ...project.entitlements[0].payment,
        status: "pending",
      },
    },
    {
      ...project.entitlements[0],
      downloadUrl:
        "https://attacker.example/file.html",
    },
  ]) {
    assert.equal(
      customerControl.downloadEntitlement(
        {
          ...project,
          entitlements: [entitlement],
        },
        "version_1"
      ),
      null
    );
  }
  assert.equal(
    customerControl.downloadEntitlement(
      project,
      "version_foreign"
    ),
    null
  );
});

test("customer control claims activation or recovery email only from exact delivery evidence", () => {
  assert.deepEqual(
    customerControl.registrationOutcome({
      accepted: true,
      verificationRequired: true,
      delivery: "email",
      emailSent: true,
    }),
    {
      activationReady: true,
      supportRequired: false,
      message:
        "Check your email and open the Site Sourcery activation link.",
    },
  );
  assert.equal(
    customerControl.registrationOutcome({
      accepted: true,
      delivery: "held",
      emailSent: false,
    }).supportRequired,
    true,
  );
  assert.equal(
    customerControl.recoveryOutcome({
      accepted: true,
      delivery: "manual_operator",
      emailSent: false,
    }).supportRequired,
    true,
  );
});

test("control mode is server-configured, invalid or absent configuration holds, and catalog prices fail closed", () => {
  assert.equal(modeModule.resolve(documentFixture(null)).mode, "hold");
  assert.equal(modeModule.resolve(documentFixture("HOSTED")).mode, "hosted");
  assert.equal(modeModule.resolve(documentFixture("local-rehearsal")).localRehearsal, true);
  assert.equal(modeModule.resolve(documentFixture("query-string-hosted")).held, true);

  const configured = modeModule.resolve(documentFixture("hosted", {
    schema: "sitesourcery.abracadabra-public-catalog.v1",
    catalogVersion: "catalog_7",
    termsVersion: "terms_7",
    domainTermsVersion: "domain-terms-2026-07",
    products: {
      spark: {
        label: "Spark",
        summary: "One-page business site.",
        implementationContract: "abracadabra.spark/v1",
      },
      business: {
        label: "Business",
        summary: "Held because no compiler exists.",
        implementationContract: "abracadabra.business/v1",
      },
    },
    tenures: {
      rent: { label: "Rent", summary: "Monthly service." },
      own: { label: "Own", summary: "Customer owns the finished site." },
    },
    offers: {
      "spark.rent": {
        productId: "spark",
        tenureId: "rent",
        eligibleAddressModes: ["licensed", "customer_owned"],
      },
      "spark.own": {
        productId: "spark",
        tenureId: "own",
        eligibleAddressModes: ["customer_owned"],
      },
      "business.rent": {
        productId: "business",
        tenureId: "rent",
        eligibleAddressModes: ["licensed"],
      },
    },
  }));
  assert.equal(configured.catalog.catalogVersion, "catalog_7");
  assert.equal(configured.catalog.termsVersion, "terms_7");
  assert.equal(configured.catalog.domainTermsVersion, "domain-terms-2026-07");
  assert.deepEqual(Object.keys(configured.catalog.products), ["spark"]);
  assert.equal(
    configured.catalog.products.spark.implementationContract,
    "abracadabra.spark/v1",
  );
  assert.deepEqual(Object.keys(configured.catalog.tenures), ["rent", "own"]);
  assert.deepEqual(
    Object.keys(configured.catalog.offers),
    ["spark.rent", "spark.own"],
  );
  assert.equal(Object.hasOwn(configured.catalog.offers["spark.rent"], "priceId"), false);
  assert.deepEqual(
    configured.catalog.offers["spark.own"].eligibleAddressModes,
    ["customer_owned"],
  );
});

test("private staging injection selects hosted mode in strict script order without changing the held public artifact", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(
    publicHtml,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.match(publicHtml, /abracadabra-control-mode\.js/u);
  for (const asset of hostedStagingAssets) {
    if (asset.endsWith("abracadabra-control-mode.js")) continue;
    assert.doesNotMatch(publicHtml, new RegExp(asset, "u"));
  }

  const hosted = configureHostedAbracadabraHtml(publicHtml, {
    catalog: {
      schema: "sitesourcery.abracadabra-public-catalog.v1",
      catalogVersion: "catalog_staging_1",
      termsVersion: "terms-staging-1",
      domainTermsVersion: "domain-terms-staging-1",
      products: [
        {
          productId: "spark",
          name: "Spark",
          description: "One-page business site.",
          implementationContract: "abracadabra.spark/v1",
        },
      ],
      tenures: [
        { tenureId: "rent", name: "Rent", billingShape: { recurring: true } },
      ],
      offers: [
        {
          offerId: "spark.rent",
          productId: "spark",
          tenureId: "rent",
          eligibleAddressModes: ["licensed", "customer_owned"],
        },
      ],
    },
  });
  assert.match(
    hosted,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hosted">/u,
  );
  assert.doesNotMatch(
    hosted,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.match(
    hosted,
    /abracadabra-app\.css">\s*<link rel="stylesheet" href="\/abracadabra\/app\/abracadabra-alakazam-35\.css">\s*<link rel="stylesheet" href="\/abracadabra\/app\/abracadabra-alakazam-50\.css">/u,
  );
  const ordered = [
    "/abracadabra/app/abracadabra-control-mode.js",
    "/abracadabra/app/abracadabra-api.js",
    "/abracadabra/app/abracadabra-hosted-control.js",
    "/abracadabra/app/abracadabra-app.js",
    "/abracadabra/app/abracadabra-alakazam-35.js",
    "/abracadabra/app/abracadabra-alakazam-50.js",
    "/abracadabra/app/abracadabra-customer-control-dom.js",
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = hosted.indexOf(marker);
    assert.ok(next > cursor, marker);
    cursor = next;
  }
  assert.doesNotMatch(
    hosted,
    /\/abracadabra\/app\/abracadabra-control\.js/u,
    "the hosted app must not load the local rehearsal control",
  );
  assert.doesNotMatch(hosted, /abracadabra-hosted-catalog/u);
  assert.doesNotMatch(hosted, /spark\.rent|Rent|Own|Owned \+ managed/u);
  assert.deepEqual(hostedStagingAssets, [...hostedStagingAssets].sort());
});

test("customer account and Download controls progressively enhance the still-usable maker", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  const hosted = configureHostedAbracadabraHtml(publicHtml, {
    catalog: {
      products: [{
        productId: "spark",
        name: "Spark",
        implementationContract: "abracadabra.spark/v1",
      }],
      tenures: [{ tenureId: "own", name: "Own" }],
      offers: [{
        offerId: "spark.own",
        productId: "spark",
        tenureId: "own",
        eligibleAddressModes: ["customer_owned"],
      }],
    },
  });
  const enhancer =
    '  <script src="/abracadabra/app/abracadabra-customer-control-dom.js" defer></script>';
  assert.match(hosted, new RegExp(enhancer.trim().replaceAll("/", "\\/"), "u"));
  const failedEnhancement = hosted.replace(enhancer, "");

  assert.match(
    publicHtml,
    /sitesourcery-abracadabra-control-mode" content="hold"/u,
  );
  assert.doesNotMatch(
    publicHtml,
    /abracadabra-(?:hosted-control|customer-control-dom)\.js/u,
  );
  assert.match(
    failedEnhancement,
    /sitesourcery-abracadabra-control-mode" content="hosted"/u,
  );
  assert.doesNotMatch(
    failedEnhancement,
    /abracadabra-customer-control-dom\.js/u,
  );
  for (const fallback of [
    'name="businessName"',
    'data-load-sample',
    'data-next="facts"',
    'data-step="truth"',
    'data-step="preview"',
    "/abracadabra/app/abracadabra-app.js",
  ]) {
    assert.match(failedEnhancement, new RegExp(fallback, "u"), fallback);
  }
  assert.doesNotMatch(
    failedEnhancement,
    /data-hosted-domain-storefront/u,
    "a failed enhancer must not leave a misleading half-built purchase flow",
  );

  const enhancerSource = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    enhancerSource,
    /data-customer-stage/u,
  );
  assert.match(
    enhancerSource,
    /client\.capabilities\(\)/u,
  );
  assert.match(
    enhancerSource,
    /control\.quoteDownload\(\)/u,
  );
  assert.match(
    enhancerSource,
    /downloadCheckoutReturnFromLocation/u,
  );
  assert.match(
    enhancerSource,
    /control\s*\.refreshSelectedProject\(\)/u,
  );
});

test("staging catalog configuration rejects every private price authority field", async () => {
  const publicHtml = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url),
    "utf8",
  );
  assert.throws(
    () => configureHostedAbracadabraHtml(publicHtml, {
      catalog: {
        products: [{
          productId: "spark",
          name: "Spark",
          implementationContract: "abracadabra.spark/v1",
        }],
        tenures: [{ tenureId: "rent", name: "Rent" }],
        offers: [{
          offerId: "spark.rent",
          productId: "spark",
          tenureId: "rent",
          eligibleAddressModes: ["licensed"],
          stripePriceRefs: { recurring: "price_private" },
        }],
      },
    }),
    /private server price authority/u,
  );
});

test("H1H customer and owner reads are jointly refreshed and stale work responses cannot cross accounts", async () => {
  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /Promise\.all\(\[[\s\S]*?getCustomServicesAssessmentRequest\(selectedProjectId\)[\s\S]*?getCustomServicesAssessmentQuote\(selectedProjectId\)[\s\S]*?getCustomServicesAssessmentInvoice\(selectedProjectId\)[\s\S]*?getCustomServicesAssessmentReport\(selectedProjectId\)[\s\S]*?\]\)/u,
    "request, quote, invoice, and delivered-report truth refresh together",
  );
  assert.match(
    source,
    /report:\s*results\[3\]\.value[\s\S]*?reportError:\s*results\[3\]\.error/u,
    "the customer report is bound to the same selected-project read",
  );
  assert.match(
    source,
    /function ownerAssessmentWorkIsCurrent\(sequence, accountId\)[\s\S]*?sequence === ownerWorkReadSequence[\s\S]*?ownerWorkRead\.accountId === accountId[\s\S]*?lastState\.account/u,
    "owner work responses are fenced by sequence and authenticated account",
  );
  assert.match(
    source,
    /function ownerCustomBuildWorkReadIsCurrent\(sequence, accountId\)[\s\S]*?sequence === ownerCustomBuildWorkReadSequence[\s\S]*?ownerCustomBuildWorkRead\.accountId === accountId[\s\S]*?lastState\.account/u,
    "paid Custom build responses are fenced by sequence and authenticated account",
  );
  assert.match(
    source,
    /function assessmentReadIsCurrent\(sequence, projectId\)[\s\S]*?lastState\.account[\s\S]*?assessmentRead\.accountId[\s\S]*?idOf\(lastState\.project\) === projectId/u,
    "customer assessment reads are fenced by account as well as project",
  );
  assert.match(
    source,
    /assessmentRead\.accountId !== accountId[\s\S]*?assessmentRead\.projectId !== projectId[\s\S]*?requestAssessment\(projectId\)/u,
    "an in-place identity change forces a fresh account-scoped read",
  );
  assert.match(
    source,
    /if \(!verify\(result\)\)[\s\S]*?requestOwnerAssessmentJobs\(selectedAccountId\)/u,
    "a write response is verified before the owner list refreshes",
  );
  assert.match(
    source,
    /sessionStorage\.getItem[\s\S]*?sessionStorage\.setItem[\s\S]*?ownerEvidenceAttempt\.signature === signature[\s\S]*?ownerEvidenceAttempt\.commandId/u,
    "an uncertain evidence upload reuses its session-durable command ID",
  );
  assert.match(
    source,
    /Assessment in progress[\s\S]*?Check for delivered report[\s\S]*?actions\.retry/u,
    "an already-open customer page can refresh into delivered truth",
  );
  assert.match(
    source,
    /!ownerAssessmentCoverageComplete\(current\)[\s\S]*?!ownerAssessmentFindingsReady\(current\)[\s\S]*?deliverOwnerAssessmentReport/u,
    "report delivery is fenced behind exact evidence coverage and finding order",
  );
  assert.doesNotMatch(
    source,
    /reportState\.draft|report\.draft|draftFindings/u,
    "customer rendering never consumes draft findings",
  );
});

test("hosted DOM copy is plain, benefit-led, and free of internal launch jargon", async () => {
  const source = [
    await readFile(
      new URL("../../abracadabra/app/abracadabra-customer-control-dom.js", import.meta.url),
      "utf8",
    ),
    await readFile(
      new URL("../hosted-truth/fragments/abracadabra-app-customer-control.html", import.meta.url),
      "utf8",
    ),
  ].join("\n");
  for (const copy of [
    "Finish one small step at a time.",
    "Create an account or sign in.",
    "Save this preview as a project.",
    "Review Download for this project.",
    "$5 once",
    "No renewal",
    "Your HTML file",
    "Continue to secure payment",
    "Need publishing or a domain too?",
    "Nothing was charged.",
  ]) {
    assert.ok(source.includes(copy), copy);
  }
  assert.doesNotMatch(source, /\b(?:we|us|our)\b|we[’'](?:ll|re)/iu);
  assert.match(source, /href="\/legal\/website-terms\/"/u);
  assert.doesNotMatch(
    source,
    /spark\.rent|Owned \+ managed|Customer owns the finished site|Spark — Own/u
  );
  for (const jargon of [
    "Hosted staging boundary",
    "server-verified",
    "provider authority",
    "owner approval",
    "processing asynchronously",
    "exact accepted version",
    "legal registrant",
    "non-transactional",
    "state-machine",
    "tenure",
  ]) {
    assert.doesNotMatch(source, new RegExp(jargon, "iu"), jargon);
  }
  const quoteAt = source.indexOf("control.quoteDownload()");
  const acceptanceAt = source.indexOf("activeQuote");
  const checkoutAt = source.indexOf("prepareDownloadCheckout()");
  assert.ok(quoteAt >= 0, "server quote call");
  assert.ok(acceptanceAt >= 0, "explicit quote acceptance is required");
  assert.ok(checkoutAt > quoteAt, "checkout follows a server quote");
  assert.doesNotMatch(source, /control\.checkout\s*\(/u);
  assert.doesNotMatch(source, /priceId|stripePrice/u);
  assert.match(
    source,
    /successMessage\s*&&\s*result !== null\s*&&\s*result !== undefined/u,
    "a stale or failed null result cannot announce success",
  );
  assert.match(
    source,
    /control\s*\.signOut\(\)\s*\.then\(function \(\) \{\s*return \{ signedOut: true \};/u,
    "successful sign-out remains distinguishable from a swallowed failure",
  );
  assert.match(
    source,
    /recoveryButton\.disabled\s*=\s*!capabilities\.accountRecoveryEmail/u,
    "recovery cannot unlock while delivery is held",
  );
  assert.match(
    source,
    /projectButton\.disabled\s*=\s*!\([\s\S]*?pendingGuestCandidate[\s\S]*?legalCaptureReady/u,
    "project creation requires a reviewed preview and exact legal capture",
  );
  assert.match(
    source,
    /Date\.parse\(\s*activeQuote\.expiresAt\s*\)\s*>\s*Date\.now\(\)/u,
    "Continue rechecks visible quote expiry",
  );
});

test("async actions expose pending and safe retry state while reusing the original idempotency key", async () => {
  const requestKeys = [];
  let attempt = 0;
  const control = createHostedControl({
    api: baseApi({
      requestRecovery: async (_input, options) => {
        requestKeys.push(options.idempotencyKey);
        attempt += 1;
        if (attempt === 1) {
          throw Object.assign(new Error("Temporary service failure"), {
            code: "TEMPORARY",
            retryable: true,
            requestId: "req_retry",
          });
        }
        return { accepted: true };
      },
    }),
    idempotencyFactory: () => "idem_recovery_stable",
  });

  const first = control.requestRecovery({ email: "owner@example.com" });
  assert.equal(control.getState().operations.requestRecovery.status, "pending");
  assert.equal(control.localFallbackAllowed(), false);
  await assert.rejects(first, /Temporary service failure/u);
  assert.deepEqual(control.getState().operations.requestRecovery, {
    status: "error",
    attempt: 1,
    error: {
      code: "TEMPORARY",
      message: "Temporary service failure",
      retryable: true,
      requestId: "req_retry",
    },
  });

  await control.retry("requestRecovery");
  assert.equal(control.getState().operations.requestRecovery.status, "success");
  assert.equal(control.getState().operations.requestRecovery.attempt, 2);
  assert.deepEqual(requestKeys, ["idem_recovery_stable", "idem_recovery_stable"]);
});

test("recovery copy claims email only from exact delivery evidence", () => {
  assert.deepEqual(
    recoveryRequestOutcome({ delivery: "email", emailSent: true }),
    {
      emailSent: true,
      message: "If that account exists, a recovery email was sent.",
      supportRequired: false,
    },
  );
  for (const held of [
    { delivery: "manual_operator", emailSent: false },
    { delivery: "held", emailSent: false },
  ]) {
    assert.deepEqual(
      recoveryRequestOutcome(held),
      {
        emailSent: false,
        message: "No recovery email was sent. Use the Contact page below for account recovery.",
        supportRequired: true,
      },
    );
  }
  for (const unproven of [
    undefined,
    {},
    { accepted: true },
    { delivery: "email" },
    { delivery: "manual_operator", emailSent: true },
  ]) {
    const outcome = recoveryRequestOutcome(unproven);
    assert.equal(outcome.emailSent, false);
    assert.equal(outcome.supportRequired, true);
    assert.match(outcome.message, /^The app could not confirm/u);
    assert.doesNotMatch(outcome.message, /instructions have been sent/iu);
  }
});

test("same-origin session boot propagates CSRF, idempotency, cookie credentials, and draft revision", async () => {
  const calls = [];
  const project = {
    id: "project_1",
    name: "Revision project",
    draft: { revision: 7, rawFacts: {} },
    versions: [],
  };
  const client = createClient({
    baseUrl: "/api/v1",
    idempotencyFactory: () => {
      assert.fail("the hosted controller must provide every write idempotency key");
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/v1/me") {
        return response(200, { user: { id: "user_1" }, csrfToken: "csrf_session_1" });
      }
      if (url === "/api/v1/organizations") {
        return response(200, { organizations: [{ id: "org_1" }] });
      }
      if (url === "/api/v1/organizations/org_1/projects") {
        return response(200, { projects: [project] });
      }
      if (url === "/api/v1/projects/project_1" && options.method === "GET") {
        return response(200, { project });
      }
      if (url === "/api/v1/projects/project_1/subscription") {
        return response(200, { subscription: { id: "sub_1", status: "current" } });
      }
      if (url === "/api/v1/projects/project_1/draft") {
        return response(200, { revision: 8 });
      }
      return response(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    },
  });
  const control = createHostedControl({
    api: client,
    idempotencyFactory: () => "idem_draft_1",
  });

  await control.boot();
  await control.selectProject("project_1");
  await control.saveDraft({ businessName: "Server saved" });

  const write = calls.find((call) => call.url.endsWith("/draft"));
  assert.ok(write);
  assert.equal(write.options.credentials, "include");
  assert.equal(write.options.headers["X-CSRF-Token"], "csrf_session_1");
  assert.equal(write.options.headers["Idempotency-Key"], "idem_draft_1");
  assert.equal(write.options.headers["If-Match"], "7");
  assert.deepEqual(JSON.parse(write.options.body), {
    rawFacts: { businessName: "Server saved" },
  });
  assert.equal(control.getState().project.draft.revision, 8);
});

test("a late project response cannot replace the newer selection or its operation state", async () => {
  const projectA = deferred();
  const projectB = deferred();
  const control = createHostedControl({
    api: baseApi({
      getProject: async (id) => (id === "project_a" ? projectA.promise : projectB.promise),
      subscription: async (id) => ({ subscription: { id: `sub_${id}` } }),
    }),
    idempotencyFactory: () => "idem_stale",
  });

  const openingA = control.selectProject("project_a");
  const openingB = control.selectProject("project_b");
  await Promise.resolve();
  projectB.resolve({ project: { id: "project_b", draft: { revision: 1 } } });
  await openingB;
  projectA.resolve({ project: { id: "project_a", draft: { revision: 1 } } });
  await openingA;

  assert.equal(control.getState().project.id, "project_b");
  assert.equal(control.getState().subscription, null);
  assert.equal(control.getState().operations.project.status, "success");
});

test("project switching commits only after the visible project accepts opening", async () => {
  const drafts = [];
  let subscriptionCalls = 0;
  const projectA = {
    id: "project_a",
    draft: { revision: 3, rawFacts: {} },
    versions: [],
  };
  const projectB = {
    id: "project_b",
    draft: { revision: 7, rawFacts: {} },
    versions: [],
  };
  const control = createHostedControl({
    api: baseApi({
      listProjects: async () => ({
        projects: [projectA, projectB],
      }),
      getProject: async (id) => ({
        project: id === "project_a"
          ? projectA
          : projectB,
      }),
      subscription: async () => {
        subscriptionCalls += 1;
        throw new Error(
          "legacy subscription must not gate project opening"
        );
      },
      saveDraft: async (input) => {
        drafts.push(input);
        return { revision: 4 };
      },
    }),
    idempotencyFactory: () =>
      "idem_project_switch",
  });

  await control.boot();
  await control.selectProject(
    "project_a",
    () => true
  );
  const canceled = await control.selectProject(
    "project_b",
    () => false
  );
  assert.equal(canceled, null);
  assert.equal(
    control.getState().project.id,
    "project_a"
  );
  await control.saveDraft({
    businessName: "Visible project A",
  });
  assert.equal(
    drafts[0].projectId,
    "project_a"
  );

  await control.selectProject(
    "project_b",
    () => true
  );
  assert.equal(
    control.getState().project.id,
    "project_b"
  );
  assert.equal(subscriptionCalls, 0);
});

test("selected project refresh exposes a newly settled Download without changing selection", async () => {
  let reads = 0;
  const control = createHostedControl({
    api: baseApi({
      getProject: async (id) => {
        reads += 1;
        return {
          project: {
            id,
            name: "Hosted project",
            versions: [
              {
                id: "version_1",
                state: "accepted_release"
              }
            ],
            entitlements:
              reads >= 2
                ? [
                    {
                      id: "entitlement_1",
                      projectId: id,
                      kind: "spark_download",
                      state: "active"
                    }
                  ]
                : []
          }
        };
      }
    }),
    idempotencyFactory: () => "idem_refresh"
  });
  await control.boot();
  await control.selectProject("project_1");
  control.selectVersion("version_1");
  assert.deepEqual(
    control.getState().project.entitlements,
    []
  );

  const refreshed =
    await control.refreshSelectedProject();
  assert.equal(refreshed.id, "project_1");
  assert.equal(
    control.getState().selectedVersionId,
    "version_1"
  );
  assert.equal(
    control.getState().project.entitlements[0].id,
    "entitlement_1"
  );
  assert.equal(
    control.getState().operations.projectRefresh.status,
    "success"
  );
});

test("project creation omits absent options and preserves explicit settings", async () => {
  let received = null;
  const control = createHostedControl({
    api: baseApi({
      createProject: async (input, options) => {
        received = { input, options };
        return {
          project: {
            id: "project_created",
            name: input.name,
            draft: { revision: 1, rawFacts: {} },
            versions: [],
          },
        };
      },
    }),
    idempotencyFactory: () =>
      "idem_create_project",
  });

  await control.boot();
  let legalCapture =
    control.captureProjectLegalAcceptance();
  await control.createProject({
    name: "Customer preview",
    legalAcceptance:
      legalCapture.legalAcceptance,
    legalAcceptanceEpoch: legalCapture.epoch,
  });

  assert.deepEqual(received, {
    input: {
      organizationId: "org_1",
      name: "Customer preview",
      legalAcceptance:
        legalCapture.legalAcceptance,
    },
    options: {
      idempotencyKey: "idem_create_project",
    },
  });
  assert.equal(
    Object.hasOwn(received.input, "address"),
    false,
  );
  assert.equal(
    Object.hasOwn(received.input, "visibility"),
    false,
  );
  assert.equal(
    Object.hasOwn(received.input, "accessPassword"),
    false,
  );

  legalCapture =
    control.captureProjectLegalAcceptance();
  await control.createProject({
    name: "Private customer preview",
    legalAcceptance:
      legalCapture.legalAcceptance,
    legalAcceptanceEpoch: legalCapture.epoch,
    address: {
      kind: "licensed",
      label: "customer-preview",
    },
    visibility: "private",
    accessPassword: "long private preview phrase",
  });
  assert.deepEqual(received.input, {
    organizationId: "org_1",
    name: "Private customer preview",
    legalAcceptance:
      legalCapture.legalAcceptance,
    address: {
      kind: "licensed",
      label: "customer-preview",
    },
    visibility: "private",
    accessPassword: "long private preview phrase",
  });
});

test("legal authority boot is public and fail-closed without breaking the signed-out preview", async () => {
  let authorityReads = 0;
  const unauthorized = Object.assign(
    new Error("Sign in required"),
    { status: 401 },
  );
  const held = Object.assign(
    new Error("Reviewed documents are held"),
    { code: "LEGAL_CONFIGURATION_REQUIRED", status: 503 },
  );
  const control = createHostedControl({
    api: baseApi({
      me: async () => { throw unauthorized; },
      getProjectLegalAuthority: async () => {
        authorityReads += 1;
        throw held;
      },
    }),
    idempotencyFactory: () => "legal-held-key",
  });

  await control.boot();
  const state = control.getState();
  assert.equal(authorityReads, 1);
  assert.equal(state.phase, "signed-out");
  assert.equal(state.projectLegalAuthorityStatus, "held");
  assert.equal(state.projectLegalAuthority, null);
  assert.equal(state.localFallbackAllowed, true);
  assert.throws(
    () => control.captureProjectLegalAcceptance(),
    (error) => error.code === "LEGAL_CONFIGURATION_REQUIRED",
  );
});

test("session and organization changes invalidate an already captured legal snapshot", async () => {
  let createCalls = 0;
  const control = createHostedControl({
    api: baseApi({
      createProject: async () => {
        createCalls += 1;
        return { project: { id: "should_not_exist" } };
      },
      signOut: async () => ({ signedOut: true }),
    }),
    idempotencyFactory: () => "legal-invalidation-key",
  });
  await control.boot();
  const beforeOrganization =
    control.captureProjectLegalAcceptance();
  await control.selectOrganization("org_1");
  await assert.rejects(
    () => control.createProject({
      name: "Stale organization capture",
      legalAcceptance:
        beforeOrganization.legalAcceptance,
      legalAcceptanceEpoch:
        beforeOrganization.epoch,
    }),
    (error) => error.code === "LEGAL_AUTHORITY_CHANGED",
  );
  assert.equal(createCalls, 0);

  const beforeSignOut =
    control.captureProjectLegalAcceptance();
  await control.signOut();
  assert.notEqual(
    control.getState().projectLegalAcceptanceEpoch,
    beforeSignOut.epoch,
  );
  assert.throws(
    () => control.createProject({
      name: "Stale signed-out capture",
      legalAcceptance: beforeSignOut.legalAcceptance,
      legalAcceptanceEpoch: beforeSignOut.epoch,
    }),
    (error) => error.code === "ORGANIZATION_REQUIRED",
  );
  assert.equal(createCalls, 0);
});

test("a stale project write never refetches behind the click and explicit refresh requires recapture", async () => {
  let authorityReads = 0;
  let createCalls = 0;
  const stale = Object.assign(
    new Error("Reviewed authority changed"),
    { code: "LEGAL_AUTHORITY_CHANGED", status: 409, retryable: true },
  );
  const control = createHostedControl({
    api: baseApi({
      getProjectLegalAuthority: async () => {
        authorityReads += 1;
        return projectLegalAuthorityFixture({
          authorityDigest: String(authorityReads).repeat(64),
        });
      },
      createProject: async () => {
        createCalls += 1;
        throw stale;
      },
    }),
    idempotencyFactory: () => "stale-legal-key",
  });
  await control.boot();
  const captured =
    control.captureProjectLegalAcceptance();
  await assert.rejects(
    () => control.createProject({
      name: "Stale legal project",
      legalAcceptance: captured.legalAcceptance,
      legalAcceptanceEpoch: captured.epoch,
    }),
    (error) => error.code === "LEGAL_AUTHORITY_CHANGED",
  );
  assert.equal(createCalls, 1);
  assert.equal(authorityReads, 1);

  await control.refreshProjectLegalAuthority();
  assert.equal(authorityReads, 2);
  await assert.rejects(
    () => control.createProject({
      name: "Old click cannot replay",
      legalAcceptance: captured.legalAcceptance,
      legalAcceptanceEpoch: captured.epoch,
    }),
    (error) => error.code === "LEGAL_AUTHORITY_CHANGED",
  );
  assert.equal(createCalls, 1);
  const refreshed = control.captureProjectLegalAcceptance();
  assert.notEqual(
    refreshed.legalAcceptance.authorityDigest,
    captured.legalAcceptance.authorityDigest,
  );
});

test("hosted mode never falls back to local authority after its first mutation", async () => {
  const pending = deferred();
  const control = createHostedControl({
    api: baseApi({
      requestRecovery: async () => pending.promise,
    }),
    idempotencyFactory: () => "idem_lock",
  });
  assert.equal(control.localFallbackAllowed(), true);
  const request = control.requestRecovery({ email: "owner@example.com" });
  assert.equal(control.localFallbackAllowed(), false);
  pending.resolve({ accepted: true });
  await request;
  assert.equal(control.localFallbackAllowed(), false);
  assert.equal(control.getState().hostedMutationStarted, true);
});

test("registration remains signed out until the emailed activation token completes", async () => {
  const calls = [];
  const control = createHostedControl({
    api: baseApi({
      register: async (input, options) => {
        calls.push(["register", input, options]);
        return {
          accepted: true,
          verificationRequired: true,
          delivery: "email",
          emailSent: true,
          expiresAt: "2099-08-01T00:00:00.000Z",
        };
      },
      completeRegistration: async (input, options) => {
        calls.push(["complete", input, options]);
        return { user: { id: "user_1" } };
      },
    }),
    idempotencyFactory: (() => {
      let value = 0;
      return () => `registration_idem_${++value}`;
    })(),
  });

  const staged = await control.beginRegistration({
    name: "Customer Owner",
    organizationName: "Customer Business",
    email: "owner@example.test",
    password: "correct horse battery staple",
  });
  assert.equal(staged.verificationRequired, true);
  assert.equal(control.getState().account, null);
  assert.equal(control.getState().phase, "idle");

  await control.completeRegistration({
    token: "activation_token_12345678901234567890",
  });
  assert.equal(control.getState().account.id, "user_1");
  assert.equal(control.getState().phase, "ready");
  assert.deepEqual(calls, [
    [
      "register",
      {
        name: "Customer Owner",
        organizationName: "Customer Business",
        email: "owner@example.test",
        password: "correct horse battery staple",
      },
      { idempotencyKey: "registration_idem_1" },
    ],
    [
      "complete",
      {
        token: "activation_token_12345678901234567890",
      },
      { idempotencyKey: "registration_idem_2" },
    ],
  ]);
});

test("checkout is held without an offer, then requires an exact server quote and matching disclosure acceptance", async () => {
  let quoteCall = null;
  let checkoutCall = null;
  const unresolved = await selectedControl({
    createCommerceQuote: async () => {
      assert.fail("held quoting must not reach the API");
    },
    createCommerceCheckout: async () => {
      assert.fail("held checkout must not reach the API");
    },
  });
  assert.equal(unresolved.getState().checkoutEnabled, false);
  await assert.rejects(
    () => unresolved.quoteOffer("spark.rent"),
    (error) => error instanceof ControlError && error.code === "CHECKOUT_HELD",
  );
  await assert.rejects(
    () => unresolved.checkoutQuotedOffer(),
    (error) => error instanceof ControlError && error.code === "QUOTE_REVIEW_REQUIRED",
  );

  const ownOnLicensedAddress = await selectedControl({
    getProject: async () => ({
      project: {
        id: "project_1",
        draft: { revision: 1 },
        address: {
          kind: "licensed",
          label: "example",
          revision: "address_rev_licensed",
        },
        versions: [],
      },
    }),
    createCommerceQuote: async () => {
      assert.fail("an Own quote on a licensed address must not reach the API");
    },
    createCommerceCheckout: async () => {
      assert.fail("an Own checkout on a licensed address must not reach the API");
    },
  }, {
    catalog: {
      catalogVersion: "catalog_1",
      products: {
        spark: {
          label: "Spark",
          implementationContract: "abracadabra.spark/v1",
        },
      },
      tenures: {
        own: { label: "Own" },
      },
      offers: {
        "spark.own": {
          productId: "spark",
          tenureId: "own",
          eligibleAddressModes: ["customer_owned"],
        },
      },
    },
  });
  await assert.rejects(
    () => ownOnLicensedAddress.quoteOffer("spark.own"),
    (error) => error instanceof ControlError && error.code === "OFFER_ADDRESS_INELIGIBLE",
  );

  const resolved = await selectedControl({
    createCommerceQuote: async (projectId, input, options) => {
      quoteCall = { projectId, input, options };
      return {
        quote: {
          quoteId: "commerce_quote_1",
          projectId,
          offerId: input.offerId,
          disclosureDigest: "d".repeat(64),
          addressBinding: {
            mode: "customer_owned",
            revision: "address_rev_1",
          },
          lineItems: [{
            label: "Spark — Own",
            oneTime: { amountMinor: 10000, currency: "USD" },
            terms: {},
          }],
          totals: {
            oneTime: { amountMinor: 10000, currency: "USD" },
            recurring: [],
          },
          expiresAt: "2099-08-01T00:00:00.000Z",
        },
      };
    },
    createCommerceCheckout: async (projectId, quoteId, input, options) => {
      checkoutCall = { projectId, quoteId, input, options };
      return {
        quoteId,
        checkout: { url: "https://checkout.stripe.com/c/pay/test" },
      };
    },
    getProject: async () => ({
      project: {
        id: "project_1",
        draft: { revision: 1 },
        address: {
          kind: "custom",
          hostname: "example.com",
          state: "verified",
          revision: "address_rev_1",
        },
        versions: [],
      },
    }),
  }, {
    catalog: {
      catalogVersion: "catalog_1",
      products: {
        spark: {
          label: "Spark",
          implementationContract: "abracadabra.spark/v1",
        },
      },
      tenures: {
        own: { label: "Own" },
      },
      offers: {
        "spark.own": {
          productId: "spark",
          tenureId: "own",
          eligibleAddressModes: ["customer_owned"],
        },
      },
    },
    idempotencyFactory: () => "idem_checkout",
  });
  assert.equal(resolved.getState().checkoutEnabled, true);
  await assert.rejects(
    () => resolved.checkoutQuotedOffer(),
    (error) => error instanceof ControlError && error.code === "QUOTE_REVIEW_REQUIRED",
  );
  await resolved.quoteOffer("spark.own");
  assert.deepEqual(quoteCall, {
    projectId: "project_1",
    input: { offerId: "spark.own", domainQuoteId: null },
    options: { idempotencyKey: "idem_checkout" },
  });
  assert.equal(Object.hasOwn(quoteCall.input, "amount"), false);
  assert.equal(Object.hasOwn(quoteCall.input, "currency"), false);
  assert.equal(Object.hasOwn(quoteCall.input, "priceId"), false);
  assert.equal(resolved.getState().commerceQuote.quoteId, "commerce_quote_1");

  await resolved.checkoutQuotedOffer();
  assert.deepEqual(checkoutCall, {
    projectId: "project_1",
    quoteId: "commerce_quote_1",
    input: { acceptedDisclosureDigest: "d".repeat(64) },
    options: { idempotencyKey: "idem_checkout" },
  });
  assert.equal(Object.hasOwn(checkoutCall, "amount"), false);
  assert.equal(Object.hasOwn(checkoutCall, "currency"), false);
  assert.equal(Object.hasOwn(checkoutCall, "priceId"), false);
});

test("the accepted $5 Download path binds one saved version and invalidates a stale quote", async () => {
  const calls = [];
  const digest = "d".repeat(64);
  const control = await selectedControl({
    createDownloadQuote: async (projectId, input, options) => {
      calls.push(["quote", projectId, input, options]);
      return {
        schema: "sitesourcery.abracadabra-quote-snapshot.v2",
        quoteId: "download_quote_1",
        project: { projectId },
        version: {
          versionId: input.versionId,
          state: "accepted",
          contentDigest: "a".repeat(64),
        },
        offerId: "spark_download",
        entitlementKind: "spark_download",
        price: {
          amountMinor: 500,
          currency: "USD",
          billing: "one_time",
          interval: null,
        },
        expiresAt: "2099-08-01T00:00:00.000Z",
        disclosureDigest: digest,
        snapshotDigest: "s".repeat(64),
      };
    },
    prepareDownloadCheckout: async (projectId, quoteId, input, options) => {
      calls.push(["checkout", projectId, quoteId, input, options]);
      return {
        quoteId,
        projectId,
        versionId: "version_1",
        offerId: "spark_download",
        state: "held",
        provider: null,
        dispatchAuthorized: false,
      };
    },
  }, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `download_idem_${++value}`;
    })(),
  });

  await assert.rejects(
    () => control.quoteDownload(),
    (error) => error instanceof ControlError && error.code === "VERSION_REQUIRED",
  );
  control.selectVersion("version_1");
  await assert.rejects(
    () => control.prepareDownloadCheckout(),
    (error) => error instanceof ControlError
      && error.code === "DOWNLOAD_QUOTE_REVIEW_REQUIRED",
  );

  const quote = await control.quoteDownload();
  assert.equal(quote.price.amountMinor, 500);
  assert.equal(control.getState().downloadQuote.quoteId, "download_quote_1");
  assert.deepEqual(calls[0], [
    "quote",
    "project_1",
    { versionId: "version_1" },
    { idempotencyKey: "download_idem_1" },
  ]);

  const prepared = await control.prepareDownloadCheckout();
  assert.equal(prepared.dispatchAuthorized, false);
  assert.deepEqual(calls[1], [
    "checkout",
    "project_1",
    "download_quote_1",
    { acceptedDisclosureDigest: digest },
    { idempotencyKey: "download_idem_2" },
  ]);

  control.selectVersion("version_2");
  assert.equal(control.getState().downloadQuote, null);
  await assert.rejects(
    () => control.prepareDownloadCheckout(),
    (error) => error instanceof ControlError
      && error.code === "DOWNLOAD_QUOTE_REVIEW_REQUIRED",
  );
});

test("publication stays disabled without both paid entitlement and a verified address", async () => {
  const unpaid = await selectedControl({
    requestRelease: async () => {
      assert.fail("unpaid publication must not reach the API");
    },
  });
  await assert.rejects(
    () => unpaid.requestRelease("version_1"),
    (error) => error instanceof ControlError && error.code === "PAID_ENTITLEMENT_REQUIRED",
  );

  const unverified = await selectedControl({
    getProject: async () => ({
      project: {
        id: "project_1",
        draft: { revision: 1 },
        address: { kind: "custom", state: "pending" },
        versions: [],
      },
    }),
    subscription: async () => ({ subscription: { status: "current" } }),
    requestRelease: async () => {
      assert.fail("unverified publication must not reach the API");
    },
  });
  await unverified.refreshSubscription();
  await assert.rejects(
    () => unverified.requestRelease("version_1"),
    (error) => error instanceof ControlError && error.code === "VERIFIED_ADDRESS_REQUIRED",
  );
});

test("reviewed versions, addresses, verification, release, billing, support, export, and deletion delegate asynchronously", async () => {
  const calls = [];
  const cancellationDigest = "c".repeat(64);
  const project = {
    id: "project_1",
    draft: { revision: 1 },
    address: { kind: "licensed", state: "configured" },
    versions: [],
  };
  const methods = {
    createVersion: async (input, options) => {
      calls.push(["createVersion", input, options]);
      return { version: { id: "version_1" } };
    },
    markVersionReady: async (...args) => {
      calls.push(["markVersionReady", ...args]);
      return { version: { id: "version_1", state: "ready" } };
    },
    acceptVersion: async (...args) => {
      calls.push(["acceptVersion", ...args]);
      return { version: { id: "version_1", state: "accepted" } };
    },
    selectAddress: async (...args) => {
      calls.push(["selectAddress", ...args]);
      return { accepted: true };
    },
    requestDomainVerification: async (...args) => {
      calls.push(["requestDomainVerification", ...args]);
      return { accepted: true };
    },
    billingPortal: async (...args) => {
      calls.push(["billingPortal", ...args]);
      return { url: "https://billing.example.test/" };
    },
    cancellationPreview: async (...args) => {
      calls.push(["cancellationPreview", ...args]);
      return {
        preview: {
          previewId: "cancel_preview_1",
          projectId: "project_1",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          retentionEndsAt: "2026-10-30T00:00:00.000Z",
          disclosureDigest: cancellationDigest,
        },
      };
    },
    cancelSubscription: async (...args) => {
      calls.push(["cancelSubscription", ...args]);
      return { accepted: true };
    },
    requestRelease: async (...args) => {
      calls.push(["requestRelease", ...args]);
      return { accepted: true };
    },
    unpublish: async (...args) => {
      calls.push(["unpublish", ...args]);
      return { accepted: true };
    },
    setVisibility: async (...args) => {
      calls.push(["setVisibility", ...args]);
      return { accepted: true };
    },
    createSupportTicket: async (...args) => {
      calls.push(["createSupportTicket", ...args]);
      return { accepted: true };
    },
    requestExport: async (...args) => {
      calls.push(["requestExport", ...args]);
      return {
        export: {
          exportId: "export_1",
          projectId: "project_1",
          status: "queued",
          createdAt: "2026-07-28T12:00:00.000Z",
          updatedAt: "2026-07-28T12:00:00.000Z",
        },
      };
    },
    deleteProject: async (...args) => {
      calls.push(["deleteProject", ...args]);
      return { deleted: true };
    },
  };
  const control = await selectedControl({
    ...methods,
    getProject: async () => ({ project }),
    subscription: async () => ({ subscription: { status: "current" } }),
  }, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `idem_${++value}`;
    })(),
  });

  await control.acceptMadeVersion({
    raw: { businessName: "Reviewed" },
    result: { artifactDigest: "a".repeat(64) },
    reviewAttested: true,
  });
  await control.selectAddress({ kind: "custom", path: "connect", hostname: "example.com" });
  await control.requestDomainVerification({
    addressId: "address_1",
    method: "dns_challenge",
    reference: "proof_1",
  });
  await control.billingPortal();
  await control.previewCancellation();
  await control.cancelSubscription();
  await control.requestRelease("version_1");
  await control.unpublish();
  await control.setVisibility({ visibility: "private", accessPassword: "long private phrase" });
  await control.createSupportTicket({ subject: "Help", message: "Please help." });
  await control.requestExport();
  await control.deleteProject();

  const names = calls.map(([name]) => name);
  for (const expected of [
    "createVersion",
    "markVersionReady",
    "acceptVersion",
    "selectAddress",
    "requestDomainVerification",
    "billingPortal",
    "cancellationPreview",
    "cancelSubscription",
    "requestRelease",
    "unpublish",
    "setVisibility",
    "createSupportTicket",
    "requestExport",
    "deleteProject",
  ]) {
    assert.ok(names.includes(expected), expected);
  }
  const cancelCall = calls.find(([name]) => name === "cancelSubscription");
  assert.deepEqual(cancelCall.slice(1, 3), [
    "project_1",
    {
      previewId: "cancel_preview_1",
      acceptedDisclosureDigest: cancellationDigest,
    },
  ]);
  assert.equal(control.getState().project, null);
});

test("cancellation cannot mutate a subscription before the exact server dates are reviewed", async () => {
  const control = await selectedControl({
    cancelSubscription: async () => {
      assert.fail("cancellation without a reviewed preview must not reach the API");
    },
  });

  await assert.rejects(
    () => control.cancelSubscription(),
    (error) => error instanceof ControlError
      && error.code === "CANCELLATION_PREVIEW_REQUIRED",
  );
});

test("hosted export progresses to a one-time download and can regenerate after use", async () => {
  const calls = [];
  let statusRead = 0;
  const timestamps = {
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:01.000Z",
  };
  const control = await selectedControl({
    requestExport: async (...args) => {
      calls.push(["requestExport", ...args]);
      return {
        export: {
          exportId: "export_1",
          projectId: "project_1",
          status: "queued",
          ...timestamps,
        },
      };
    },
    getExport: async (...args) => {
      calls.push(["getExport", ...args]);
      statusRead += 1;
      return {
        export: statusRead === 1
          ? {
              exportId: "export_1",
              projectId: "project_1",
              status: "working",
              ...timestamps,
            }
          : {
              exportId: "export_1",
              projectId: "project_1",
              status: "ready",
              ...timestamps,
              filename: "sitesourcery-project-1.zip",
              download: {
                token: "download_token_1",
                expiresAt: "2099-07-28T12:05:00.000Z",
              },
            },
      };
    },
    downloadExport: async (...args) => {
      calls.push(["downloadExport", ...args]);
      return { blob: { size: 128 }, filename: "sitesourcery-project-1.zip" };
    },
    retryExport: async (...args) => {
      calls.push(["retryExport", ...args]);
      return {
        export: {
          exportId: "export_2",
          projectId: "project_1",
          status: "queued",
          ...timestamps,
        },
      };
    },
  }, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `export_idem_${++value}`;
    })(),
  });

  await assert.rejects(
    () => control.downloadExport(),
    (error) => error.code === "EXPORT_DOWNLOAD_UNAVAILABLE",
  );
  await control.requestExport();
  assert.equal(control.getState().exportJob.status, "queued");
  await control.getExport();
  assert.equal(control.getState().exportJob.status, "working");
  await control.getExport();
  assert.equal(control.getState().exportJob.status, "ready");
  const download = await control.downloadExport();
  assert.equal(download.filename, "sitesourcery-project-1.zip");
  assert.equal(control.getState().exportJob.status, "expired");
  await control.retryExport();
  assert.equal(control.getState().exportJob.exportId, "export_2");
  assert.deepEqual(
    calls.find(([name]) => name === "downloadExport").slice(1),
    ["project_1", "export_1", "download_token_1"],
  );
});

test("domain storefront preserves quote, registrant, payment, fresh-price, registration, DNS, renewal, and transfer authority boundaries", async () => {
  const calls = [];
  const domainApi = {
    searchDomains: async (query) => {
      calls.push(["searchDomains", query]);
      return { results: [{ hostname: "cedar.example" }] };
    },
    createDomainQuote: async (projectId, input, options) => {
      calls.push(["createDomainQuote", projectId, input, options]);
      return {
        quote: {
          id: "quote_1",
          projectId,
          hostname: input.hostname,
          amountMinor: 1900,
          currency: "USD",
          years: input.years,
          registrar: "Spaceship",
          termsVersion: "domain-terms-2026-07",
          terms: {
            registrar: "Spaceship",
            renewal: "Renewal is quoted before charge.",
            cancellation: "A completed registration cannot be canceled.",
            ownership: "The customer is the registrant.",
          },
        },
      };
    },
    saveRegistrantContact: async (organizationId, projectId, input, options) => {
      calls.push(["saveRegistrantContact", organizationId, projectId, input, options]);
      return {
        registrantContact: {
          id: "contact_1",
          projectId,
          name: input.name,
        },
      };
    },
    acceptDomainConsent: async (projectId, quoteId, input, options) => {
      calls.push(["acceptDomainConsent", projectId, quoteId, input, options]);
      return { consent: { id: "consent_1", projectId } };
    },
    createDomainOrder: async (projectId, input, options) => {
      calls.push(["createDomainOrder", projectId, input, options]);
      return {
        domainOrder: {
          id: "order_1",
          projectId,
          status: "awaiting_payment",
          paymentUrl: "/api/v1/domain-orders/order_1/payment?projectId=project_1",
        },
      };
    },
    listDomainOrders: async (projectId) => ({
      domainOrders: [{ id: "order_1", projectId, status: "authorized" }],
    }),
    getDomainOrder: async (projectId, orderId) => ({
      domainOrder: { id: orderId, projectId, status: "registration_processing" },
    }),
    refreshDomainPrice: async (projectId, orderId, options) => {
      calls.push(["refreshDomainPrice", projectId, orderId, options]);
      return {
        priceCheck: {
          priceCheckId: "price_check_1",
          projectId,
          orderId,
          status: "ready_to_confirm",
          hostname: "cedar.example",
          available: true,
          finalPrice: { amountMinor: 1900, currency: "USD" },
          checkedAt: "2026-07-28T12:00:00.000Z",
          expiresAt: "2099-07-28T12:05:00.000Z",
        },
      };
    },
    requestDomainRegistration: async (projectId, orderId, input, options) => {
      calls.push(["requestDomainRegistration", projectId, orderId, input, options]);
      return {
        domainOrder: {
          id: orderId,
          projectId,
          status: "registration_processing",
        },
      };
    },
    listDomains: async (_organizationId, projectId) => ({
      domains: [{ id: "domain_1", projectId, hostname: "cedar.example" }],
    }),
    getDomain: async (projectId, domainId) => ({
      domain: { id: domainId, projectId, hostname: "cedar.example" },
    }),
    listDnsRecords: async (projectId) => ({
      records: [{ id: "record_1", projectId, type: "A" }],
    }),
    upsertDnsRecord: async (...args) => {
      calls.push(["upsertDnsRecord", ...args]);
      return { accepted: true };
    },
    deleteDnsRecord: async (...args) => {
      calls.push(["deleteDnsRecord", ...args]);
      return { accepted: true };
    },
    setDomainAutoRenew: async (...args) => {
      calls.push(["setDomainAutoRenew", ...args]);
      return { accepted: true };
    },
    requestDomainRenewalQuote: async (...args) => {
      calls.push(["requestDomainRenewalQuote", ...args]);
      return { quote: { id: "renew_quote_1" } };
    },
    requestDomainTransferOut: async (...args) => {
      calls.push(["requestDomainTransferOut", ...args]);
      return { request: { id: "transfer_1" } };
    },
  };
  const control = await selectedControl(domainApi, {
    idempotencyFactory: (() => {
      let value = 0;
      return () => `domain_idem_${++value}`;
    })(),
  });

  await control.searchDomains("cedar");
  await control.createDomainQuote({ hostname: "cedar.example", years: 1 });
  assert.equal(control.getState().domainQuote.amountMinor, 1900);
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.restartDomainPurchase("owner");
  assert.equal(control.getState().domainQuote.id, "quote_1");
  assert.equal(control.getState().registrantContact, null);
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
    autoRenewRequested: true,
  });
  await control.restartDomainPurchase("review");
  assert.equal(control.getState().domainConsent, null);
  assert.equal(control.getState().registrantContact.id, "contact_1");
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
    autoRenewRequested: true,
  });
  await control.createDomainOrder();
  await assert.rejects(
    () => control.restartDomainPurchase("search"),
    (error) => error.code === "DOMAIN_ORDER_LOCKED",
  );
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: true }),
    (error) => error.code === "FRESH_DOMAIN_PRICE_REQUIRED",
  );
  await control.listDomainOrders();
  await control.refreshDomainPrice();
  assert.deepEqual(control.getState().domainPriceCheck.finalPrice, {
    amountMinor: 1900,
    currency: "USD",
  });
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: false }),
    (error) => error.code === "IRREVERSIBLE_REGISTRATION_CONSENT_REQUIRED",
  );
  await control.requestDomainRegistration({ irreversibleRegistrationAccepted: true });
  await control.pollDomainOrder();
  await control.listDomains();
  await control.selectDomain("domain_1");
  await control.upsertDnsRecord({
    type: "A",
    name: "@",
    content: "192.0.2.1",
    ttl: 3600,
  });
  await control.deleteDnsRecord("record_1");
  await control.setDomainAutoRenew(true);
  await control.requestDomainRenewalQuote(1);
  await control.requestDomainTransferOut();

  const quoteCall = calls.find(([name]) => name === "createDomainQuote");
  assert.equal(quoteCall[1], "project_1");
  const quoteInput = quoteCall[2];
  assert.deepEqual(quoteInput, {
    hostname: "cedar.example",
    years: 1,
    purpose: undefined,
  });
  assert.equal(Object.hasOwn(quoteInput, "amount"), false);
  assert.equal(Object.hasOwn(quoteInput, "currency"), false);
  const registration = calls.find(([name]) => name === "requestDomainRegistration");
  assert.equal(registration[1], "project_1");
  assert.deepEqual(registration[3], {
    priceCheckId: "price_check_1",
    irreversibleRegistrationAccepted: true,
  });
  for (const expected of [
    "upsertDnsRecord",
    "deleteDnsRecord",
    "setDomainAutoRenew",
    "requestDomainRenewalQuote",
    "requestDomainTransferOut",
  ]) {
    assert.ok(calls.some(([name]) => name === expected), expected);
  }
});

test("domain work requires one selected project and a project change resets every domain stage", async () => {
  let domainCalls = 0;
  const api = baseApi({
    searchDomains: async () => ({
      results: [{ hostname: "reset.example", available: true }],
    }),
    createDomainQuote: async (projectId, input) => {
      domainCalls += 1;
      return {
        quote: {
          id: "quote_reset",
          projectId,
          hostname: input.hostname,
          termsVersion: "domain-terms-2026-07",
        },
      };
    },
    saveRegistrantContact: async (_organizationId, projectId) => {
      domainCalls += 1;
      return {
        registrantContact: {
          id: "contact_reset",
          projectId,
          name: "Customer Owner",
        },
      };
    },
    listDomains: async (_organizationId, projectId) => {
      domainCalls += 1;
      return {
        domains: [{
          id: "domain_reset",
          projectId,
          hostname: "reset.example",
        }],
      };
    },
    getDomain: async (projectId, domainId) => ({
      domain: { id: domainId, projectId, hostname: "reset.example" },
    }),
    listDnsRecords: async (projectId) => ({
      records: [{
        id: "record_reset",
        projectId,
        type: "A",
        name: "@",
        content: "192.0.2.8",
      }],
    }),
  });
  const control = createHostedControl({
    api,
    idempotencyFactory: () => "domain_reset_idem",
  });
  await control.boot();
  assert.throws(
    () => control.createDomainQuote({
      hostname: "reset.example",
      years: 1,
    }),
    (error) => error.code === "PROJECT_REQUIRED",
  );
  assert.throws(
    () => control.saveRegistrantContact({ name: "Customer Owner" }),
    (error) => error.code === "PROJECT_REQUIRED",
  );
  assert.throws(
    () => control.listDomains(),
    (error) => error.code === "PROJECT_REQUIRED",
  );
  assert.equal(domainCalls, 0);

  await control.selectProject("project_1");
  await control.searchDomains("reset");
  await control.createDomainQuote({
    hostname: "reset.example",
    years: 1,
  });
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.listDomains();
  await control.selectDomain("domain_reset");
  assert.equal(control.getState().domainQuote.projectId, "project_1");
  assert.equal(control.getState().dnsRecords.length, 1);

  await control.selectProject("project_2");
  const reset = control.getState();
  assert.equal(reset.project.id, "project_2");
  assert.deepEqual(reset.domainSearchResults, []);
  assert.equal(reset.domainQuote, null);
  assert.equal(reset.registrantContact, null);
  assert.equal(reset.domainConsent, null);
  assert.equal(reset.domainOrder, null);
  assert.equal(reset.domainPriceCheck, null);
  assert.deepEqual(reset.domains, []);
  assert.equal(reset.selectedDomain, null);
  assert.deepEqual(reset.dnsRecords, []);
});

test("late and cross-project domain responses cannot cross the current project selection", async () => {
  const quoteDeferred = deferred();
  const domainDeferred = deferred();
  let quoteCalls = 0;
  const control = await selectedControl({
    createDomainQuote: async () => {
      quoteCalls += 1;
      if (quoteCalls === 1) return quoteDeferred.promise;
      return {
        quote: {
          id: "quote_wrong_project",
          projectId: "project_1",
          hostname: "wrong.example",
        },
      };
    },
    listDomains: async (_organizationId, projectId) => ({
      domains: [{
        id: "domain_race",
        projectId,
        hostname: "race.example",
      }],
    }),
    getDomain: async () => domainDeferred.promise,
    listDnsRecords: async () => ({
      records: [],
    }),
  });

  const lateQuote = control.createDomainQuote({
    hostname: "race.example",
    years: 1,
  });
  await Promise.resolve();
  await control.selectProject("project_2");
  quoteDeferred.resolve({
    quote: {
      id: "quote_late",
      projectId: "project_1",
      hostname: "race.example",
    },
  });
  assert.equal(await lateQuote, null);
  assert.equal(control.getState().domainQuote, null);

  await assert.rejects(
    () => control.createDomainQuote({
      hostname: "wrong.example",
      years: 1,
    }),
    (error) => error.code === "DOMAIN_PROJECT_RESPONSE_INVALID",
  );
  assert.equal(control.getState().domainQuote, null);

  await control.listDomains();
  const lateDomain = control.selectDomain("domain_race");
  await Promise.resolve();
  await control.selectProject("project_3");
  domainDeferred.resolve({
    domain: {
      id: "domain_race",
      projectId: "project_2",
      hostname: "race.example",
    },
  });
  assert.equal(await lateDomain, null);
  assert.equal(control.getState().selectedDomain, null);
  assert.deepEqual(control.getState().dnsRecords, []);
});

test("a changed final domain price voids the reviewed purchase path and cannot register", async () => {
  const control = await selectedControl({
    createDomainQuote: async (projectId, input) => ({
      quote: {
        id: "quote_changed",
        projectId,
        hostname: input.hostname,
        amountMinor: 1900,
        currency: "USD",
        years: 1,
        registrar: "Spaceship",
        termsVersion: "domain-terms-2026-07",
        terms: {
          registrar: "Spaceship",
          renewal: "Renewal is quoted before charge.",
          cancellation: "A completed registration cannot be canceled.",
          ownership: "The customer is the registrant.",
        },
      },
    }),
    saveRegistrantContact: async (_organizationId, projectId) => ({
      registrantContact: {
        id: "contact_changed",
        projectId,
        name: "Customer Owner",
      },
    }),
    acceptDomainConsent: async (projectId) => ({
      consent: { id: "consent_changed", projectId },
    }),
    createDomainOrder: async (projectId) => ({
      domainOrder: {
        id: "order_changed",
        projectId,
        status: "awaiting_payment",
        paymentUrl: "/api/v1/domain-orders/order_changed/payment?projectId=project_1",
      },
    }),
    listDomainOrders: async (projectId) => ({
      domainOrders: [{ id: "order_changed", projectId, status: "authorized" }],
    }),
    refreshDomainPrice: async (projectId, orderId) => ({
      priceCheck: {
        priceCheckId: "price_check_changed",
        projectId,
        orderId,
        status: "changed",
        hostname: "cedar.example",
        available: true,
        finalPrice: { amountMinor: 2400, currency: "USD" },
        checkedAt: "2026-07-28T12:00:00.000Z",
        expiresAt: "2099-07-28T12:05:00.000Z",
      },
    }),
    requestDomainRegistration: async () => {
      assert.fail("a changed price must not reach registration");
    },
  });

  await control.createDomainQuote({ hostname: "cedar.example", years: 1 });
  await control.saveRegistrantContact({
    name: "Customer Owner",
    email: "owner@example.com",
    phone: "+1 856 555 0100",
    addressLine1: "1 Main Street",
    city: "Camden",
    region: "NJ",
    postalCode: "08102",
    countryCode: "US",
  });
  await control.acceptDomainConsent({
    termsVersion: "domain-terms-2026-07",
    registrationAgreementAccepted: true,
    registrantCertificationAccepted: true,
  });
  await control.createDomainOrder();
  await control.listDomainOrders();
  await control.refreshDomainPrice();

  const state = control.getState();
  assert.equal(state.domainPriceCheck.status, "changed");
  assert.equal(state.domainQuote, null);
  assert.equal(state.domainConsent, null);
  assert.equal(state.domainOrder, null);
  await assert.rejects(
    () => control.requestDomainRegistration({ irreversibleRegistrationAccepted: true }),
    (error) => error.code === "FRESH_DOMAIN_PRICE_REQUIRED",
  );
});

test("browser API rejects nested domain authority claims before network access", () => {
  const client = createClient({
    fetch: async () => {
      assert.fail("forged nested authority must not reach the API");
    },
    idempotencyFactory: () => "idem_forged_domain",
  });

  assert.throws(
    () => client.createProject({
      organizationId: "org_1",
      name: "Forged domain project",
      acceptedTerms: true,
      address: {
        kind: "custom",
        hostname: "example.com",
        registrationState: "registered",
      },
    }),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
  assert.throws(
    () => client.createDomainQuote("project_1", {
      hostname: "example.com",
      years: 1,
      currency: "USD",
    }),
    (error) => error instanceof APIError && error.code === "OWNER_AUTHORITY_REJECTED",
  );
});
