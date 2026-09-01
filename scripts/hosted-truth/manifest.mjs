export const HOSTED_TRUTH_MANIFEST_SCHEMA =
  "sitesourcery.hosted-truth-manifest/v1";

function slot({
  id,
  file,
  kind,
  sourceSha256,
  hostedFragment,
  hostedSha256,
}) {
  return Object.freeze({
    id,
    file,
    kind,
    sourceSha256,
    hostedFragment,
    hostedSha256,
  });
}

export const hostedTruthSlots = Object.freeze([
  slot({
    id: "abracadabra-how-download-copy",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "283156703bc2fd55827e09b6637f47198e282f5de97aad9260963e325620a13c",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-download-copy.html",
    hostedSha256: "59148f956fbb5df5c99851622d36ae84f7652b958cfc9a19f53e24a681c72071",
  }),
  slot({
    id: "abracadabra-how-download-state",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "376eb74364890ce5a1898c0e2c7b6950580846ba33106bc4f4416bccfe2b7055",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-download-state.html",
    hostedSha256: "f362d7f7eed3fd60413983528d95cfe2acfe34220dc1f51b98ef6f06910c79ab",
  }),
  slot({
    id: "abracadabra-how-head",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "d03eec3d4985b9f73969851469cbd8ca93f8529ba798d92302a3790e289c6ee8",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-head.html",
    hostedSha256: "c28e3c9cd9237d8f59f90fabba711dc208b4a68bce19f070079247bdbf925a6e",
  }),
  slot({
    id: "abracadabra-landing-download-copy",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "031b3cbe2bf68fbbd3a55768dcb2814b6db760d5ca48c40ac1849aed97017103",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-download-copy.html",
    hostedSha256: "6142abd1ee1a24969f4f99f5f2628ed65396f9ae5a5c69e008fdae82620fb9bd",
  }),
  slot({
    id: "abracadabra-landing-head",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "0d47eaa18c4e82fe10a6bdac6864e6080e7f36a679a4bf9f2c57474c65510c21",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-head.html",
    hostedSha256: "f04068ba80c8bae7eb13ec7ddc5e6dab759937d72d9467ced3ca41b3b86baf87",
  }),
  slot({
    id: "abracadabra-landing-hero-state",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "1ee0429a7a5f9f7fa8cd739c54ce7425d514bd5fffb8bde1c708adbefb817337",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-hero-state.html",
    hostedSha256: "912848fb28f76899157d31fc5b90c8e5ad2917fb77b4fe97abf5c2ce867ee0d5",
  }),
  slot({
    id: "contact-download-availability",
    file: "contact/index.html",
    kind: "html",
    sourceSha256: "1d77d21083b022c24ea78cc9c4910185050049d0a987cd28f195acef9dcf9cb9",
    hostedFragment: "scripts/hosted-truth/fragments/contact-download-availability.html",
    hostedSha256: "ac2d488c89f1cd73be33674b40c80ed410b0cf9ec6aa728b4ee526ac3c421e51",
  }),
  slot({
    id: "faq-abracadabra-now",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "3ddca7be8919172fc6531bbb09e51ff60733f6c5f3149178b7913411a6f477a5",
    hostedFragment: "scripts/hosted-truth/fragments/faq-abracadabra-now.html",
    hostedSha256: "9179929314b2cb4e39e76505684d7778652d714524bf655caf5fb00a3e003fbf",
  }),
  slot({
    id: "faq-address-choices",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "6ab33b46cc6bdf7c4a990159b5e746213882fdf267fdb6bf346fb5d4259ec6c7",
    hostedFragment: "scripts/hosted-truth/fragments/faq-address-choices.html",
    hostedSha256: "f795a65b79c1b626477b8bc446ec8ec94b7c7a52f11ecf46acf2049f25b8bf0d",
  }),
  slot({
    id: "faq-missed-payment",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "4e4db9d03ea8128565b8432879e593c4b263ce63c8b03c08f766610165f81c69",
    hostedFragment: "scripts/hosted-truth/fragments/faq-missed-payment.html",
    hostedSha256: "f28e60fc7db6ea74e12e8242545e56448c5c6101c89117a9c6c18399b38727f4",
  }),
  slot({
    id: "faq-paths",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "f94b01b4f71a48e7c03a36e00dd7f148779d0bb205c60384465ab5b6d128adc9",
    hostedFragment: "scripts/hosted-truth/fragments/faq-paths.html",
    hostedSha256: "f7140d030f75db2b5cd9cd3116c444e97030e115980aa1c3a93cba15676ee0b5",
  }),
  slot({
    id: "faq-private-sites",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "c1ae858aac6177b3525855a98cdbc5e5c5ed0640fb2f0a9ddfdcfa4fd1b2a4e0",
    hostedFragment: "scripts/hosted-truth/fragments/faq-private-sites.html",
    hostedSha256: "7c2fc996ea1d5ea252abbb9bf98d9e8580a969a2ec449218ee1b444a96e212dd",
  }),
  slot({
    id: "home-download-availability",
    file: "index.html",
    kind: "html",
    sourceSha256: "6269d5742102bae0ac6a47c3c4583e1e4a1bd7f57ff0af95412f3c9932a18fb7",
    hostedFragment: "scripts/hosted-truth/fragments/home-download-availability.html",
    hostedSha256: "6640a033c79341395ac9b6488dc9f76831bd22872a3368baa3c3531f98aeac74",
  }),
  slot({
    id: "abracadabra-app-head",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "63a855616417377a82ac6e009de7843615aa11638bda2bc0c5944b23f34b627b",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-head.html",
    hostedSha256: "54e0867be617d1137ba88c0d63ae9e06e5db28e8ba78f2018f5d8173a2e7d7a6",
  }),
  slot({
    id: "abracadabra-app-scripts",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "d21e55a1e7a8576405466ddbe8a86ab87b2b41860cd8830b25a1cd9b3dd33193",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-scripts.html",
    hostedSha256: "1bc24e19e1f12bab1d096b65ca9f194a6e82b171f413315093f9f5d7bbf714c5",
  }),
  slot({
    id: "abracadabra-app-ready",
    file: "abracadabra/app/abracadabra-app.js",
    kind: "js",
    sourceSha256: "47c10df061e74b036d4af59e79f433b74c4fea0c20f82ea82e24476bf13e0699",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-ready.js",
    hostedSha256: "2f044c26265c001f3f0da4ba8f3dbeba45b7c40207fd776938aa43dfcad965ae",
  }),
  slot({
    id: "abracadabra-app-hero",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "1090d9d9850c1e94af44c55aecabbc01347d4c0f6885743b4d6e45cf33f9f3a1",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-hero.html",
    hostedSha256: "cf0637001b026761cac5a74a87ec2789156c1e792637ebacdf611f0dba16f5da",
  }),
  slot({
    id: "abracadabra-app-control",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "b98809417c0240085bf70f2a1127f0b622c1514651737e7e4ffac4b39e4da17e",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-customer-control.html",
    hostedSha256: "e2bff892aae6a2f62bd34b92f59552a43c4290aa07dca1ac65232f8f664d09ba",
  }),
  slot({
    id: "abracadabra-app-noscript",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "082e91bf43390a0d5156bfb0d59b1516c507bf6e01d8a641b9a33dcbe9baa3b9",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-noscript.html",
    hostedSha256: "e39b675b3d21985860c706cdb0e8527605d516a04daa5696cc9a94c4a8a2a436",
  }),
  slot({
    id: "abracadabra-app-save-gate",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "262bd3037d1ab8c6a9161e5006fc33f98c0324e55913d46c52aa049fc068dd11",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-save-gate.html",
    hostedSha256: "6ceb1308e30269dd42b74962505e758b480c1c0cff7a1011e76df1553472827e",
  }),
  slot({
    id: "legal-center-head",
    file: "legal/index.html",
    kind: "html",
    sourceSha256: "9fd7eff931a705fa03bd061e90f24732c0ffcb760579a650a105fd3665a1a5c2",
    hostedFragment: "scripts/hosted-truth/fragments/legal-center-head.html",
    hostedSha256: "9784eae2dce22b8feaa51e7fad7438d05db8bbd7a2b6e56d898b45bb6aae863c",
  }),
  slot({
    id: "legal-center-main",
    file: "legal/index.html",
    kind: "html",
    sourceSha256: "bc6f70ab180b69c0ef57ef69662c5c07c31f2d8fa76731e7407e6cea6032d808",
    hostedFragment: "scripts/hosted-truth/fragments/legal-center-main.html",
    hostedSha256: "0e038f55bacdc46e68b07d54acb6cb53c0d27e4e00cc6f9fe11965b6766ac875",
  }),
  slot({
    id: "legal-privacy-head",
    file: "legal/privacy/index.html",
    kind: "html",
    sourceSha256: "f1bd804b78210d1cca0a367d7389fc243efe8fea9027d410d359a1270261b79a",
    hostedFragment: "scripts/hosted-truth/fragments/legal-privacy-head.html",
    hostedSha256: "c02671d601e8a04856f8b5e45efc72206e48d26d128aa52d2ab3b5ff070b61fc",
  }),
  slot({
    id: "legal-privacy-main",
    file: "legal/privacy/index.html",
    kind: "html",
    sourceSha256: "40a509b4689ee4a86849efe1e3deec1bd439e9ab012b7d9b56f15574b0ba78f7",
    hostedFragment: "scripts/hosted-truth/fragments/legal-privacy-main.html",
    hostedSha256: "14e0239c3a3f7eeb7d4012ba628badb63adc4989be3c1a8b36f46ad5649c402a",
  }),
  slot({
    id: "legal-website-terms-head",
    file: "legal/website-terms/index.html",
    kind: "html",
    sourceSha256: "680d185c111b5ae73031ece804cd5ef9b1b86bb0d307e102bbf405d9829d7900",
    hostedFragment: "scripts/hosted-truth/fragments/legal-website-terms-head.html",
    hostedSha256: "feb4592b77c29faa4248ead162e74f2104667321483b47669f4cad59704197f6",
  }),
  slot({
    id: "legal-website-terms-main",
    file: "legal/website-terms/index.html",
    kind: "html",
    sourceSha256: "413bfd52919fab08f7fd28015ff38ab865be472844d7f5fdd996b8baa0fb329e",
    hostedFragment: "scripts/hosted-truth/fragments/legal-website-terms-main.html",
    hostedSha256: "55b17c3584a5bd7b46c940a90ae19053747e223dd176d0ee6b31f5fea1cac7c3",
  }),
]);

export const hostedStagingAssetSha256 = Object.freeze({
  "abracadabra/app/abracadabra-alakazam-35.css":
    "f626e50f198761409fd10db139c70f442880d0c6ecc22b31cf707bd9312e8585",
  "abracadabra/app/abracadabra-alakazam-35.js":
    "b74943215910d6f4cf043d65f8fab5f143752f3da3e9729b7d650b9a84a7134a",
  "abracadabra/app/abracadabra-alakazam-50.css":
    "5615189885bf84667cb28c8657f730b77cc40eb619c29460d5b33dce876ea167",
  "abracadabra/app/abracadabra-alakazam-50.js":
    "5d35c479c63404e65252ea41cc49a2700a64a24014f3bfd1bce38f63bb3d5cfb",
  "abracadabra/app/abracadabra-alakazam-retained-premium.css":
    "6378fb96895dd7cdd8d0961998f9a1d09573cbfcbdbf9d4591a0862add7080d0",
  "abracadabra/app/abracadabra-alakazam-retained-premium.js":
    "5cc58c5211c0983be18bd4645702bdc13bfb4d4d7008b605624560120ebe22d1",
  "abracadabra/app/abracadabra-api.js":
    "9e53ff3d9ff1d6112ae129b5f63dbb7666ccc8090725b197f72996bed6217408",
  "abracadabra/app/abracadabra-billing-views.js":
    "ab279cc5d8560716e7f6236bfbff4aae1204abe1339a3deee21af7e14215c2fa",
  "abracadabra/app/abracadabra-care-surfaces.css":
    "b8c5e9be9980f6523e0fb9253c0f4206a91545571a044145cbe1fdd36c104b2b",
  "abracadabra/app/abracadabra-care-surfaces.js":
    "1cd3b2b3d8f6ef157e70e639d72dffd83d58106365eb8366900d072821dbe44f",
  "abracadabra/app/abracadabra-control-mode.js":
    "24015f383c2642951ddf5260a62f5a2e38fdbf98d02653d834feb854683f8dc8",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "fa676a170ccf9a4d98cbbaa6ecc8349481cb90a80a034b1af240cbaedfae9a71",
  "abracadabra/app/abracadabra-hosted-control.js":
    "cc3336358e99f252a4694d08d307dc37550525c7cf8ebf4e9c00e96fba5a6274",
  "abracadabra/app/abracadabra-responder-surfaces.css":
    "f087bd1da001450a7a522be70c0840df66037fb0d83e08dfe29f5f1f0399fd4f",
  "abracadabra/app/abracadabra-responder-surfaces.js":
    "72c42160095982860f6f31359eefa7ac43173b9e01f5ef724ca5a1b61481dc72",
  "abracadabra/app/abracadabra-service-surfaces.css":
    "b9e1638af7b35e855c607d1ded6ae4077465e666366ca53eb89559292b99734c",
  "abracadabra/app/abracadabra-service-surfaces.js":
    "778b1bdb26c558f7e9854e4d2df8c995f6fc234cbceb90f7a34687c8f720f7c9",
});

/*
 * These fragments are retired source material and are no longer injected.
 * Seal them so obsolete lifecycle or local-authority behavior cannot quietly
 * return through a future layout reuse. Active release fragments are sealed by
 * hostedTruthSlots above.
 */
export const heldAlakazamCopyFragmentSha256 = Object.freeze({
  "scripts/hosted-truth/fragments/abracadabra-how-main.html":
    "6d58b2e4265279a49206e84a9f14fa632e63a0717ddbd64a2130d9a2497af21f",
  "scripts/hosted-truth/fragments/abracadabra-landing-main.html":
    "4ac47d96ea77d74307a5bac054a9e9507f69a215aa203f97e2275fd427f9120e",
  "scripts/hosted-truth/fragments/home-abracadabra-card.html":
    "c47d978e09756f7db41aaf24512907171ed386b6552ca4128d9a2ae64e6f1527",
  "scripts/hosted-truth/fragments/home-abracadabra-intro.html":
    "e12d90fabdbbf03a57c31c67ac08c69a051ae305ee341533e6e83b2ec06f4092",
  "scripts/hosted-truth/fragments/home-abracadabra-proof.html":
    "868abaa284b15583a7b61dee96d2f849a13392919b54bcf165cd4fb7dcb1694d",
  "scripts/hosted-truth/fragments/start-recommendation-abracadabra.js":
    "aea3cad87399143068ba7028c1ec22aa554953ad037bb0887239399b1983d3d8",
});

export const heldAlakazamCustomerArtifactFiles = Object.freeze([]);

export const heldAlakazamCopyForbiddenSemantics = Object.freeze([
  Object.freeze({
    id: "fixed-lifecycle-promise",
    pattern: "\\b14[- ]day\\b|\\bday 15\\b|\\b90[- ]day\\b|\\b90 days after suspension\\b",
    example: "A 14-day grace period starts before day 15 and 90-day retention.",
  }),
  Object.freeze({
    id: "available-recurring-hosting",
    pattern: "\\brecurring hosting for\\b|\\b(?:eligible|selected) hosted tenure\\b|\\bChoose (?:Spark with |released Spark with )?Rent, Own, or Owned \\+ managed\\b",
    example: "Choose Rent, Own, or Owned + managed for recurring hosting.",
  }),
  Object.freeze({
    id: "customer-domain-offer",
    pattern: "\\bBuy one here or connect one you own\\b|\\bbuy a customer-owned domain through Site Sourcery\\b|\\bdomain purchase receives its own final price check\\b",
    example: "Buy one here or connect one you own.",
  }),
  Object.freeze({
    id: "active-cancellation-path",
    pattern: "\\bExport or cancel from your account\\b|\\bCancel from your account\\b|\\bmanage billing and domains[^.]*cancel\\b",
    example: "Export or cancel from your account.",
  }),
  Object.freeze({
    id: "active-publication-path",
    pattern: "\\bbuild and publish one page\\b|\\bone clear path from account to publication\\b|\\bPublish (?:only )?(?:the|that|your) (?:accepted|reviewed) version\\b|\\bAccount, address, tenure, and publishing\\b",
    example: "Publish only the accepted version.",
  }),
]);

export const hostedCodeTransforms = Object.freeze([]);

/*
 * These obsolete local-authority prototypes remain held. The released service
 * uses authenticated server authority instead, so no public or hosted artifact
 * may contain these files. The executable patterns catch equivalent unsafe
 * local lifecycle, purchase, publication, or entitlement authority if moved.
 */
export const heldAlakazamArtifactExcludedFiles = Object.freeze([
  "abracadabra/app/abracadabra-account.js",
  "abracadabra/app/abracadabra-paid-download.js",
  "abracadabra/platform/abracadabra-platform.js",
  "abracadabra/site/index.html",
  "abracadabra/site/viewer.css",
  "abracadabra/site/viewer.js",
]);

export const heldAlakazamExecutableSemantics = Object.freeze([
  Object.freeze({
    id: "fixed-lifecycle-windows",
    pattern: "\\b(?:GRACE_DAYS|RETENTION_DAYS)\\b|\\b(?:graceDays|retentionDays)\\s*:",
    example: "var GRACE_DAYS = 14; var RETENTION_DAYS = 90;",
  }),
  Object.freeze({
    id: "domain-purchase-mode",
    pattern: "\\[\\s*[\"']purchase[\"']\\s*,\\s*[\"']byod[\"']\\s*\\]|\\.path\\s*===\\s*[\"']purchase[\"']",
    example: "if ([\"purchase\", \"byod\"].includes(address.path)) activate();",
  }),
  Object.freeze({
    id: "live-publication-mutation",
    pattern: "\\.serving\\.state\\s*=\\s*[\"']live[\"']|function\\s+publish\\s*\\(|\\bpublish\\s*:\\s*publish\\b",
    example: "project.serving.state = \"live\";",
  }),
  Object.freeze({
    id: "local-entitlement-bypass",
    pattern: "URLSearchParams\\s*\\([^)]*location\\.search|sessionStorage\\.getItem\\s*\\(\\s*[\"']abracadabra\\.(?:paid|alakazam)[\"']",
    example: "new URLSearchParams(location.search).get(\"paid\");",
  }),
]);

export const heldTruthRequirements = Object.freeze({
  "index.html": Object.freeze([
    "Look good online. Stop losing leads.",
    "$300 setup · $250 a month",
    "I can check a name, register it in your name, connect it to your website, and help manage it.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Make a one-page website for your business free · $20 to download · hosting from $25 a month",
    "Choose Alakazam for $25, $35, or $50 a month.",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Make your preview in six short steps.",
    "host the saved project with Alakazam for $25, $35, or $50 a month",
    "Start building",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Open the signed-in maker",
    "choose Alakazam hosting for $25, $35, or $50 a month",
  ]),
  "faq/index.html": Object.freeze([
    "Alakazam hosting is $25, $35, or $50 a month",
    "$300 to set up and $250 a month",
  ]),
  "legal/index.html": Object.freeze([
    "These pages cover the public website and Site Sourcery tools.",
  ]),
  "legal/privacy/index.html": Object.freeze([
    "Draft for review",
    "This draft is not effective or published yet.",
    "Saving a project or using its $20 Download requires sign-in.",
    "The public Responder page does not send a text or collect caller information.",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "Draft for review",
    "This draft is not effective or published yet.",
    "A completed one-time $20 payment unlocks Download for one saved project.",
    "The one-time $300 setup and separate $250 monthly service begin only under a customer agreement.",
  ]),
});

export const heldTruthForbiddenPhrases = Object.freeze({
  "faq/index.html": Object.freeze([
    "Alakazam’s complete three-plan ladder is approved",
  ]),
  "legal/privacy/index.html": Object.freeze([
    "SS-HOSTED-PRIVACY-2026-07-30-V2",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
    "$5 once per editor project unlocks Download for that project.",
    "A different editor project has its own one-time $5 Download unlock.",
    "The customer may modify it and self-host it without another Site Sourcery payment.",
    "Make temporary versions, preview them, and download chosen HTML.",
    "open a working preview, and download a chosen self-contained HTML file.",
    "The browser may process, compile, display, and download that material on the customer’s device",
    "Alakazam has three plans",
    "has an approved three-plan ladder",
    "difference-only upgrade rule",
  ]),
});

export const hostedTruthRequirements = Object.freeze({
  "index.html": Object.freeze([
    "Look good online. Stop losing leads.",
    "$300 setup · $250 a month",
    "I can check a name, register it in your name, connect it to your website, and help manage it.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Make a one-page website for your business free · $20 to download · hosting from $25 a month",
    "Sign in to save the project, then pay $20 once to download the HTML file",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Make your preview in six short steps.",
    "host the saved project with Alakazam for $25, $35, or $50 a month",
    "Start building",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Save and continue",
    "Create an account to save the project, download the HTML for $20",
    "choose Alakazam hosting for $25, $35, or $50 a month",
  ]),
  "faq/index.html": Object.freeze([
    "Alakazam hosting is $25, $35, or $50 a month",
    "$300 to set up and $250 a month",
  ]),
  "legal/index.html": Object.freeze([
    "These pages cover the public website and Site Sourcery tools.",
  ]),
  "legal/privacy/index.html": Object.freeze([
    "Draft for review",
    "This draft is not effective or published yet.",
    "Saving a project or using its $20 Download requires sign-in.",
    "The public Responder page does not send a text or collect caller information.",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "Draft for review",
    "This draft is not effective or published yet.",
    "A completed one-time $20 payment unlocks Download for one saved project.",
    "The one-time $300 setup and separate $250 monthly service begin only under a customer agreement.",
  ]),
});

export const heldOnlyPhrases = Object.freeze([
  "Open the signed-in maker",
]);

export const hostedOnlyPhrases = Object.freeze([
  "Save and continue",
]);
