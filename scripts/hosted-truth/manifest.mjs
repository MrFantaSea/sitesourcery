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
    hostedSha256: "d0832b4d6b97e95d8032b61aee8ec7709d7e0a09bf29ea2b7993465b3fae4c00",
  }),
  slot({
    id: "abracadabra-how-download-state",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "980a9807c84498a5bd5b42f0929f0ef54620c69417efb13ce9ac1e463d80a7db",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-download-state.html",
    hostedSha256: "d80dc797afed983a6649e80e5070ba64556b98622046316336397a774afd9ffd",
  }),
  slot({
    id: "abracadabra-how-head",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "d03eec3d4985b9f73969851469cbd8ca93f8529ba798d92302a3790e289c6ee8",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-head.html",
    hostedSha256: "3cb8c061540cd961cd4b1e5b297a06daf06c4d0059388c0e8e3c7911dd445d1d",
  }),
  slot({
    id: "abracadabra-landing-download-copy",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "031b3cbe2bf68fbbd3a55768dcb2814b6db760d5ca48c40ac1849aed97017103",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-download-copy.html",
    hostedSha256: "b50fee09a4d7602d16c4072d495a115adfa304b81980fe2f3e12908da0244a39",
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
    sourceSha256: "fc130a9d205479c3cf8c3d1c65d678bee032bae8863af5232e98a3436353501d",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-hero-state.html",
    hostedSha256: "405494454fe6122ccd661bed22d18491293b1bd6dc2e7117e27c0c6bca047d46",
  }),
  slot({
    id: "contact-download-availability",
    file: "contact/index.html",
    kind: "html",
    sourceSha256: "6666048c38b46a0e2e21e0442fadea3fc6bdb31aa40907bf74719db04d609538",
    hostedFragment: "scripts/hosted-truth/fragments/contact-download-availability.html",
    hostedSha256: "926453f639ac2af6f0bbc1d3fa0cf553e2589d3b48e0a01fa06ba8af52cd9307",
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
    sourceSha256: "c2789a8251d68d098bec3077c316519c5988556bdbd6c0d939da1ce4cddd3d13",
    hostedFragment: "scripts/hosted-truth/fragments/faq-paths.html",
    hostedSha256: "ba849c4821cf1bef5e9f9527f945d746a7264551b9ccbc07924dfbffb5bda777",
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
    sourceSha256: "79070d37847ac3633ea421ba608767492e8638ad066d2ac7a0a7aebeeed192eb",
    hostedFragment: "scripts/hosted-truth/fragments/home-download-availability.html",
    hostedSha256: "7756427bcff7137ce322896e618c02a707d60774c13e8c3c13842c0d0162d511",
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
    sourceSha256: "785c5a0ca4c6fc617b86a3cf2350816f4c454f2a40f20a72a384836d49ccb0fd",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-ready.js",
    hostedSha256: "bf53e9ef072f97b5dd0d373dca8528df9b454125a691925593641ec55dc652bf",
  }),
  slot({
    id: "abracadabra-app-hero",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "83447cca2a4fe1185f8757d3b3847e98541579226363747518d3f226ca333668",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-hero.html",
    hostedSha256: "446c12972990d854cfdc376a4dbca708e8377d8e88eb5b7eb3f93ee8f9e6f2b5",
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
]);

export const hostedStagingAssetSha256 = Object.freeze({
  "abracadabra/app/abracadabra-alakazam-35.css":
    "708e4b2b7fd98e25282f78ac85bc953c12b61e7abc2623c898b81706a2673091",
  "abracadabra/app/abracadabra-alakazam-35.js":
    "b74943215910d6f4cf043d65f8fab5f143752f3da3e9729b7d650b9a84a7134a",
  "abracadabra/app/abracadabra-alakazam-50.css":
    "1bf874925c7d8f8f2d368302d26ef9549807753b3ac2aef0ee2876ce7405e272",
  "abracadabra/app/abracadabra-alakazam-50.js":
    "5d35c479c63404e65252ea41cc49a2700a64a24014f3bfd1bce38f63bb3d5cfb",
  "abracadabra/app/abracadabra-alakazam-retained-premium.css":
    "514750690814afcfd534eca9f467cf0ae1155642e565c64eb3cfb183c88b735a",
  "abracadabra/app/abracadabra-alakazam-retained-premium.js":
    "5cc58c5211c0983be18bd4645702bdc13bfb4d4d7008b605624560120ebe22d1",
  "abracadabra/app/abracadabra-api.js":
    "0bbc8bea1130bfcb760f0481d31654b941146958aa7446e6a6dddb55547a7eea",
  "abracadabra/app/abracadabra-billing-views.js":
    "ab279cc5d8560716e7f6236bfbff4aae1204abe1339a3deee21af7e14215c2fa",
  "abracadabra/app/abracadabra-care-catalog.css":
    "d3669fa1a413b45e36f18c8854aac21df38a75f2afb763ac7b27abe98cbebb6e",
  "abracadabra/app/abracadabra-care-catalog.js":
    "ee3cf7307bdff27416f5b1e462c183a1e3f8c44f50b33d40003a57006a9aa472",
  "abracadabra/app/abracadabra-care-surfaces.css":
    "adef81dd8541d0a5410bc0a3acee303ea9c64b98b322e7b9edc1127a3239ef3e",
  "abracadabra/app/abracadabra-care-surfaces.js":
    "1cd3b2b3d8f6ef157e70e639d72dffd83d58106365eb8366900d072821dbe44f",
  "abracadabra/app/abracadabra-control-mode.js":
    "24015f383c2642951ddf5260a62f5a2e38fdbf98d02653d834feb854683f8dc8",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "ec5fe0fbfb93c4c479b1888644f8411e8619279aa1063cb700c850bde9d8d7b9",
  "abracadabra/app/abracadabra-hosted-control.js":
    "d19a4b5df1e88de4bb91cf924de8e05e1db9837c1ad7205fcab167b93d12a3b5",
  "abracadabra/app/abracadabra-responder-surfaces.css":
    "913692390b62568661e68b41589599dc11523f1f1550c5c241d27314cac0d829",
  "abracadabra/app/abracadabra-responder-surfaces.js":
    "a0311f161a9ca6c718105b7f162065c88b2ca3f52aeb698fcaf1703de9ddf51b",
  "abracadabra/app/abracadabra-service-surfaces.css":
    "b9e1638af7b35e855c607d1ded6ae4077465e666366ca53eb89559292b99734c",
  "abracadabra/app/abracadabra-service-surfaces.js":
    "1ff8bd05300d6e1dfcee25ba2221a8fe2522576191875f7cae8d881ce9ce9518",
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
    "Website builds and repairs.",
    "$300 setup · $250 a month",
    "Domain search, registration in your name, and connection to your website.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Make a one-page website for free.",
    "Build a one-page site for your business in the browser for free.",
    "Choose Alakazam for $25, $35, or $50 a month.",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Make your page in six short steps.",
    "Alakazam hosting is $25, $35, or $50 a month",
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
});

export const heldTruthForbiddenPhrases = Object.freeze({
  "faq/index.html": Object.freeze([
    "Alakazam’s complete three-plan ladder is approved",
  ]),
});

export const hostedTruthRequirements = Object.freeze({
  "index.html": Object.freeze([
    "Website builds and repairs.",
    "$300 setup · $250 a month",
    "Domain search, registration in your name, and connection to your website.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Make a one-page website for free.",
    "Build a one-page site for your business in the browser for free.",
    "Save it when you are ready. The HTML file is $20",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Make your page in six short steps.",
    "Alakazam hosting is $25, $35, or $50 a month",
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
});

export const heldOnlyPhrases = Object.freeze([
  "Open the signed-in maker",
]);

export const hostedOnlyPhrases = Object.freeze([
  "Save and continue",
]);
