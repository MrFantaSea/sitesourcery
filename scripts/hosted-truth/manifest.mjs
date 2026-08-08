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
    id: "abracadabra-app-head",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "63a855616417377a82ac6e009de7843615aa11638bda2bc0c5944b23f34b627b",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-head.html",
    hostedSha256: "15fd09ee2c727b5163c8ef63190ab384b7bb1871f1df5e3fc9c6cefc13ffaf74",
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
    hostedSha256: "b78c8f894ec0ab2cee71b4bc212561e736f597d17ea0c1401c3dcc49faafb283",
  }),
  slot({
    id: "abracadabra-app-control",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "b98809417c0240085bf70f2a1127f0b622c1514651737e7e4ffac4b39e4da17e",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-customer-control.html",
    hostedSha256: "9b81a13b7eb6c345356d25898869dea6027a04747f4a34af75580c33ee7ed6f1",
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
    sourceSha256: "1ad7d9be7b53fd00b835ec3adbacfa693a2f41d63ab5870fd17f5a42200aa745",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-save-gate.html",
    hostedSha256: "fd6c526a83d6611d270ff8d5396a0c027a4262af2651bfcb3fd8f7ee5d928bbc",
  }),
  slot({
    id: "legal-center-head",
    file: "legal/index.html",
    kind: "html",
    sourceSha256: "46df7946d8b3725a3ba38be74147cdad1ca7d1fcaa51030ae9c8d6a0e1221b38",
    hostedFragment: "scripts/hosted-truth/fragments/legal-center-head.html",
    hostedSha256: "632cee86ca1fca8648760d4da6675b638f9b8396dcdccd57cb7a71b6cff4dc23",
  }),
  slot({
    id: "legal-center-main",
    file: "legal/index.html",
    kind: "html",
    sourceSha256: "91aea7d375d386bb056523c88eb59b01702cb0ea4dfb928705685108e5504796",
    hostedFragment: "scripts/hosted-truth/fragments/legal-center-main.html",
    hostedSha256: "1c445cfcd41568a1cc0f6211a32065001b09bcb585e0f1a6f8a2d54505144049",
  }),
  slot({
    id: "legal-privacy-head",
    file: "legal/privacy/index.html",
    kind: "html",
    sourceSha256: "52290d5bc8a4353afc6bc448d4670eced26fe19583061572218e2e8cecc26933",
    hostedFragment: "scripts/hosted-truth/fragments/legal-privacy-head.html",
    hostedSha256: "3f8bb91b7d7f8088a97f38695e51fea92299767a44e24d7bb0e92a55c4520d61",
  }),
  slot({
    id: "legal-privacy-main",
    file: "legal/privacy/index.html",
    kind: "html",
    sourceSha256: "8928bf10870f30392e260d6615202dc65f2b88b0a22fb151d79f5796fba26b06",
    hostedFragment: "scripts/hosted-truth/fragments/legal-privacy-main.html",
    hostedSha256: "e9208092c4a4e9c3c8ec0b9a64e118473c3d02bc6cc4a8697822b24949e4cfd5",
  }),
  slot({
    id: "legal-website-terms-head",
    file: "legal/website-terms/index.html",
    kind: "html",
    sourceSha256: "2ce5f1a1d43539cc5a10b85ebae826fece3b3c9d5c69277173295bb2c60ca79e",
    hostedFragment: "scripts/hosted-truth/fragments/legal-website-terms-head.html",
    hostedSha256: "83aad959856c4db0344cb2f3d8005cf69d4bc490eefb9f31df80e624ef9cf155",
  }),
  slot({
    id: "legal-website-terms-main",
    file: "legal/website-terms/index.html",
    kind: "html",
    sourceSha256: "76a7c7173012613602dd6e1f231c84f5e8a8b82bcdbcccdc64f9fe2148322b92",
    hostedFragment: "scripts/hosted-truth/fragments/legal-website-terms-main.html",
    hostedSha256: "8df0c8323db3b723c6c74cc6b18044bcaf2cf5fcfcf3ebf3f60882225b6967bc",
  }),
]);

export const hostedStagingAssetSha256 = Object.freeze({
  "abracadabra/app/abracadabra-api.js":
    "321d17e139fa0ebff4830c7dc1da860320cdf3241213da82e15937451ccc23ce",
  "abracadabra/app/abracadabra-control-mode.js":
    "24015f383c2642951ddf5260a62f5a2e38fdbf98d02653d834feb854683f8dc8",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "c4a4ac13709ee585b1c7458ed38eb2022bc6941e8f843e6b8eddf5d5fabeb00f",
  "abracadabra/app/abracadabra-hosted-control.js":
    "cd98aa081170bb59c348dfc91a3f34919df258cd912d16c50b147661abc88eb3",
});

/*
 * These fragments were once hosted replacements for the public landing,
 * guide, FAQ, and chooser copy. They are no longer injected, but remain
 * reviewed source material. Seal them so an obsolete live-Alakazam promise
 * cannot quietly return through a future layout reuse.
 */
export const heldAlakazamCopyFragmentSha256 = Object.freeze({
  "scripts/hosted-truth/fragments/abracadabra-how-head.html":
    "7b4176ec1579dd361a55a5e63c64c4f03fe5d0a5a52400dab5fcc3546b37c82e",
  "scripts/hosted-truth/fragments/abracadabra-how-main.html":
    "3078fd4a1b278127ed9f6e3885176ba9e9478d4a04c5b41c1315cd9337ca8dd2",
  "scripts/hosted-truth/fragments/abracadabra-landing-head.html":
    "67ff8a9a6851a1f18efccc13736fed4d1e67eebb9199e47684eba3aac7e6bb73",
  "scripts/hosted-truth/fragments/abracadabra-landing-main.html":
    "274a88bddb8832b10596647bd807749963aa93f1efd57991342c0d0dd6e3cd37",
  "scripts/hosted-truth/fragments/faq-abracadabra-now.html":
    "1f8a9819a0e22675a888dba2e2dda99b4c55cfb66751c02709a091262f89715e",
  "scripts/hosted-truth/fragments/faq-address-choices.html":
    "6c878981bdf46078f95a1b670e94042b67c1b781269f96eb669781c08202c297",
  "scripts/hosted-truth/fragments/faq-missed-payment.html":
    "6c5daac54a11b686b3756330adaeec55730e6c1923bc464635dabddea4a176e7",
  "scripts/hosted-truth/fragments/faq-paths.html":
    "197c10656603f6735f690524882183d1b2f8ecef218322a8d8b152d6eaa1c764",
  "scripts/hosted-truth/fragments/faq-private-sites.html":
    "7c2fc996ea1d5ea252abbb9bf98d9e8580a969a2ec449218ee1b444a96e212dd",
  "scripts/hosted-truth/fragments/home-abracadabra-card.html":
    "37d6f12fcb8ec1476c903b878c190bc84fc443046e111c4864245dd0285bf0fd",
  "scripts/hosted-truth/fragments/home-abracadabra-intro.html":
    "7dd6774efa26740d94eebf8a1d3269c30042bca4c47511c6bacd0c260ebffc0e",
  "scripts/hosted-truth/fragments/home-abracadabra-proof.html":
    "87b96709f9ab949e28551f9d3cc4ad6268d61283528297ef68cd531e2cb56eba",
  "scripts/hosted-truth/fragments/start-recommendation-abracadabra.js":
    "bfe3a4a4fe7f69c7a7687ce520bfa1a2c2945d1c44c66bdd5ca3c860f08b5bf8",
});

export const heldAlakazamCustomerArtifactFiles = Object.freeze([
  "abracadabra/app/index.html",
  "abracadabra/index.html",
  "faq/index.html",
  "index.html",
  "vnext.js",
]);

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
 * Alakazam remains held. These source files may stay in the repository as
 * historical implementation evidence, but no public or hosted artifact may
 * contain them. The executable patterns catch equivalent lifecycle,
 * domain-purchase, live-publication, or local-entitlement authority if it is
 * moved into a differently named shipped JavaScript file.
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
    "Your source for websites.",
    "Premade Website Download $5-Custom Sites from $400",
    "Abracadabra builds it. Alakazam is still held.",
    "No setup or monthly plan is for sale",
    "Check and ask about a domain",
  ]),
  "vnext.js": Object.freeze([
    "Build and preview privately for free.",
    "Download is $5 once per editor project, not per click or version.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Free to See-$5 Account Download-Alakazam Plans Held",
    "Alakazam plans are in development. Public subscriptions and hosting activation are held",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "http-equiv=\"refresh\" content=\"0;url=/abracadabra/\"",
    "This page folded into the lane.",
    "Continue to Abracadabra · Alakazam.",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Lives in this tab only — close it and it's gone.",
    "Saving and payment are unavailable here.",
    "Account path unavailable",
  ]),
  "abracadabra/app/abracadabra-app.js": Object.freeze([
    "Abracadabra ready. Your local draft stays in this tab.",
  ]),
  "faq/index.html": Object.freeze([
    "Download is $5 once per editor project",
    "Alakazam’s complete three-plan ladder is approved, but public subscription sales remain held.",
    "Downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
    "this page cannot quote or start setup",
  ]),
  "legal/index.html": Object.freeze([
    "current device-local Abracadabra rehearsal",
  ]),
  "legal/privacy/index.html": Object.freeze([
    "The free guest preview needs no account. Saving an editor project or using its $5 Download requires sign-in.",
    "Choosing to retain it as an editor project requires the signed-in account path and accepted project documents.",
    "Made versions are stored in this tab’s session storage so they can survive a refresh or a payment return.",
    "Download does not create a public Internet address or an ongoing website-hosting service.",
    "When you press the Domains page’s check button, the browser cleans the typed candidate and sends its .com, .net, and .org names in NS queries to Cloudflare’s public DNS-over-HTTPS resolver at cloudflare-dns.com.",
    "Cloudflare processes the query and connection data under its",
    "Site Sourcery’s preflight does not call a registrar availability, pricing, reservation, or purchase API.",
    "If Site Sourcery keeps personal data about you, you may ask what it processes and request access, correction, deletion, or a portable copy.",
    "Not effective — release identity pending",
    "processed through Proton Mail",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "Using the current maker does not create an account, control room, project record, or saved acceptance.",
    "The free guest maker makes temporary tab-only versions and previews. It offers no account, saved project, Checkout, or Download.",
    "Facts and made versions stay only in the current tab; refreshing the page or closing the tab clears them.",
    "Only the separate signed-in hosted account path can retain an editor project and unlock that project’s HTML Download after a completed one-time $5 payment.",
    "Alakazam publishing is held until a separate service and terms are released.",
    "The standard $200 assessment covers one customer, business, public website, and primary goal",
  ]),
});

export const heldTruthForbiddenPhrases = Object.freeze({
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
  ]),
});

export const hostedTruthRequirements = Object.freeze({
  "index.html": Object.freeze([
    "Your source for websites.",
    "Premade Website Download $5-Custom Sites from $400",
    "Abracadabra builds it. Alakazam is still held.",
    "No setup or monthly plan is for sale",
    "Check and ask about a domain",
  ]),
  "vnext.js": Object.freeze([
    "Download is $5 once per editor project, not per click or version.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Free to See-$5 Account Download-Alakazam Plans Held",
    "Alakazam plans are in development. Public subscriptions and hosting activation are held",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "http-equiv=\"refresh\" content=\"0;url=/abracadabra/\"",
    "This page folded into the lane.",
    "Continue to Abracadabra · Alakazam.",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Build, preview, and download with Abracadabra",
    "Your guest preview is not saved yet.",
    "Made versions may survive a refresh in this tab.",
    "Sign in for the $5 Download.",
    "Alakazam subscriptions and hosting activation remain held.",
    "Create an account or sign in.",
    "A new project has its own one-time $5 Download unlock.",
    "Get the exact $5 quote",
    "Download HTML",
  ]),
  "abracadabra/app/abracadabra-app.js": Object.freeze([
    "Abracadabra ready. Guest work stays only in this tab until you save it to your account.",
  ]),
  "faq/index.html": Object.freeze([
    "Download is $5 once per editor project",
    "Alakazam’s complete three-plan ladder is approved, but public subscription sales remain held.",
    "Downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
    "this page cannot quote or start setup",
  ]),
  "legal/index.html": Object.freeze([
    "Privacy and terms for saved editor projects and Download.",
    "Effective July 30, 2026",
    "What free Preview and $5 Download mean",
  ]),
  "legal/privacy/index.html": Object.freeze([
    "SS-HOSTED-PRIVACY-2026-07-30-V2",
    "An account is required only when you choose to save the preview as an editor project",
    "A completed $5 payment unlocks Download for that editor project.",
    "repeat downloads from the same retained editor project do not require another Site Sourcery purchase",
    "The $5 Download includes no domain, hosting, DNS change, or Site Sourcery publication service.",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
    "$5 once per editor project unlocks Download for that project.",
    "A different editor project has its own one-time $5 Download unlock.",
    "The customer may modify it and self-host it without another Site Sourcery payment.",
    "Made-for-you design, writing, migration, integrations, domain help, and publishing need a separate written scope.",
  ]),
});

export const heldOnlyPhrases = Object.freeze([
  "Abracadabra ready. Your local draft stays in this tab.",
  "current device-local Abracadabra rehearsal",
  "Using the current maker does not create an account, control room, project record, or saved acceptance.",
  "This maker has no Publish button or publication state.",
]);

export const hostedOnlyPhrases = Object.freeze([
  "Abracadabra ready. Guest work stays only in this tab until you save it to your account.",
  "Create an account or sign in.",
  "SS-HOSTED-PRIVACY-2026-07-30-V2",
  "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
  "A completed $5 payment unlocks Download for that editor project.",
]);
