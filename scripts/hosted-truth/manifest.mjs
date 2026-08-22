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
    sourceSha256: "8d847cabb4ed3c5a855df8614ca4dcd099a187b05d2125d6f153f4057f84ea5d",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-download-copy.html",
    hostedSha256: "57058b69555aea53804b5e0d71b5198150c7e8595afaf35af8f3edc17dbf1775",
  }),
  slot({
    id: "abracadabra-how-download-state",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "2fba5a3a807a4afe3c4a72dcfbf8ea81d0f89921aeecf3e04f9299e0ddd52279",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-download-state.html",
    hostedSha256: "fdea5b159cf882d731db79da2b83b18afd89fb919aaa9ee5edf288491184769c",
  }),
  slot({
    id: "abracadabra-how-head",
    file: "abracadabra/how/index.html",
    kind: "html",
    sourceSha256: "d03eec3d4985b9f73969851469cbd8ca93f8529ba798d92302a3790e289c6ee8",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-how-head.html",
    hostedSha256: "02772e026119b3a8d42e2501101e58960657669e08bb09dd8c19e91d03f7fcc0",
  }),
  slot({
    id: "abracadabra-landing-download-copy",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "60124bb14dcf843851ec004fdebb30a850b084623a86afce8fd6d424df9f6305",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-download-copy.html",
    hostedSha256: "b5c43b7b9e186302c3e5e8a37dc6975fa1f90a1782edadc6ff5e064890c3add0",
  }),
  slot({
    id: "abracadabra-landing-head",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "fba8b2b899999d11318e6e8269cc85dd600f65d9661623d71e73f2ec14253f45",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-head.html",
    hostedSha256: "688333e4a4dc95a30eb8c475281a5176ee66d9271616ade246b1786f1bfe7cff",
  }),
  slot({
    id: "abracadabra-landing-hero-state",
    file: "abracadabra/index.html",
    kind: "html",
    sourceSha256: "10e072e7a87f09db9291b11a325e6ea6bc58194e6ff65f5781ab322d2f13b165",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-landing-hero-state.html",
    hostedSha256: "406027440d09e43dc2df65b9861ecdf367b58201d622fc411eba4e51f0f78240",
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
    sourceSha256: "d98629b5534a687e9396b7d4064767ac242ff5df82b5a19e2d178312c888fdc6",
    hostedFragment: "scripts/hosted-truth/fragments/faq-abracadabra-now.html",
    hostedSha256: "8b0a151e6b4cff2371e6079187e1a68983420693c34f8d055b7769ba48bf3e31",
  }),
  slot({
    id: "faq-address-choices",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "c3047f9cd4dfe6d2f6fd949e95c9c7dd1ab1c21b14150e4f5097bd0af2bcad74",
    hostedFragment: "scripts/hosted-truth/fragments/faq-address-choices.html",
    hostedSha256: "364c939b1dccd59ae4f0ca6f384d7f12278b2b62dd2c121dc8868c1b11e7f8f5",
  }),
  slot({
    id: "faq-missed-payment",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "0bf3a3b609f2e01eb5d3ce0d659f391fd7b96d763c65eb5ef51853d77bc99958",
    hostedFragment: "scripts/hosted-truth/fragments/faq-missed-payment.html",
    hostedSha256: "6fc7b27576b30268960da31a32597efd504d3cc2ceb3ed9640703eb2da5cfd11",
  }),
  slot({
    id: "faq-paths",
    file: "faq/index.html",
    kind: "html",
    sourceSha256: "3bd88c861c427ce0b4de3f251aa369d4bd25060a9ce7372502d96679a1a3bff0",
    hostedFragment: "scripts/hosted-truth/fragments/faq-paths.html",
    hostedSha256: "b2a9c06ec04cf179fd25923b44b1b397e6564d05ea638a9ff92c495ed4a345f5",
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
    hostedSha256: "e57c27227e586e9a45d576f0aa343f90c185af95f5041cbdfb70b5b965639454",
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
    hostedSha256: "c8a49165d39fe68a03ac798c89f3bf5198b50a015a8b5de6085074fce47d838a",
  }),
  slot({
    id: "abracadabra-app-control",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "b98809417c0240085bf70f2a1127f0b622c1514651737e7e4ffac4b39e4da17e",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-customer-control.html",
    hostedSha256: "5bcbdc7caae33db95e8902bde42f9fd6c0b2da69b488e11735ec17cbb5db7d34",
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
    hostedSha256: "13b0e8118539398244b17a5a2553f24ffb4c8b2b045faa3c033ac6b74db7b2ec",
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
    sourceSha256: "87a828b71b905c8f7692df67ce1114cc2f7297c592ddc2dbbbcaf261280e9922",
    hostedFragment: "scripts/hosted-truth/fragments/legal-website-terms-main.html",
    hostedSha256: "8df0c8323db3b723c6c74cc6b18044bcaf2cf5fcfcf3ebf3f60882225b6967bc",
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
    "fa70dea571e5ef436cafe7902fa1d77b332bdefde679ce6296579bc56bc2eedc",
  "abracadabra/app/abracadabra-billing-views.js":
    "3bd32e18c5ef2a9592eee0acea35cf17c4a3071e64e5ed95e7edf1dca1c5c486",
  "abracadabra/app/abracadabra-care-surfaces.css":
    "b8c5e9be9980f6523e0fb9253c0f4206a91545571a044145cbe1fdd36c104b2b",
  "abracadabra/app/abracadabra-care-surfaces.js":
    "1cd3b2b3d8f6ef157e70e639d72dffd83d58106365eb8366900d072821dbe44f",
  "abracadabra/app/abracadabra-control-mode.js":
    "24015f383c2642951ddf5260a62f5a2e38fdbf98d02653d834feb854683f8dc8",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "9fd0a34054361598287c6e45c16b483e0ccb26dda0d8a396b92327604ab9bbd3",
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
 * These fragments were once hosted replacements for the public landing,
 * guide, FAQ, and chooser copy. They are no longer injected, but remain
 * reviewed source material. Seal them so an obsolete live-Alakazam promise
 * cannot quietly return through a future layout reuse.
 */
export const heldAlakazamCopyFragmentSha256 = Object.freeze({
  "scripts/hosted-truth/fragments/abracadabra-how-head.html":
    "02772e026119b3a8d42e2501101e58960657669e08bb09dd8c19e91d03f7fcc0",
  "scripts/hosted-truth/fragments/abracadabra-how-main.html":
    "6d58b2e4265279a49206e84a9f14fa632e63a0717ddbd64a2130d9a2497af21f",
  "scripts/hosted-truth/fragments/abracadabra-landing-head.html":
    "688333e4a4dc95a30eb8c475281a5176ee66d9271616ade246b1786f1bfe7cff",
  "scripts/hosted-truth/fragments/abracadabra-landing-main.html":
    "4ac47d96ea77d74307a5bac054a9e9507f69a215aa203f97e2275fd427f9120e",
  "scripts/hosted-truth/fragments/faq-abracadabra-now.html":
    "8b0a151e6b4cff2371e6079187e1a68983420693c34f8d055b7769ba48bf3e31",
  "scripts/hosted-truth/fragments/faq-address-choices.html":
    "364c939b1dccd59ae4f0ca6f384d7f12278b2b62dd2c121dc8868c1b11e7f8f5",
  "scripts/hosted-truth/fragments/faq-missed-payment.html":
    "6fc7b27576b30268960da31a32597efd504d3cc2ceb3ed9640703eb2da5cfd11",
  "scripts/hosted-truth/fragments/faq-paths.html":
    "b2a9c06ec04cf179fd25923b44b1b397e6564d05ea638a9ff92c495ed4a345f5",
  "scripts/hosted-truth/fragments/faq-private-sites.html":
    "7c2fc996ea1d5ea252abbb9bf98d9e8580a969a2ec449218ee1b444a96e212dd",
  "scripts/hosted-truth/fragments/home-abracadabra-card.html":
    "c47d978e09756f7db41aaf24512907171ed386b6552ca4128d9a2ae64e6f1527",
  "scripts/hosted-truth/fragments/home-abracadabra-intro.html":
    "e12d90fabdbbf03a57c31c67ac08c69a051ae305ee341533e6e83b2ec06f4092",
  "scripts/hosted-truth/fragments/home-abracadabra-proof.html":
    "868abaa284b15583a7b61dee96d2f849a13392919b54bcf165cd4fb7dcb1694d",
  "scripts/hosted-truth/fragments/start-recommendation-abracadabra.js":
    "aea3cad87399143068ba7028c1ec22aa554953ad037bb0887239399b1983d3d8",
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
    "Three ways to start: make a free preview, get a $350 assessment of the site you have, or commission a custom build from $350.",
    "Make a preview — free.",
    "Neither of these is for sale yet.",
    "Check and ask about a domain",
  ]),
  "vnext.js": Object.freeze([
    "Build and preview privately for free.",
    "Download is $20 once per editor project, not per click or version.",
    "The full $20 is a one-time non-cash credit toward the same account and project's first separately released Alakazam invoice.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Free to See-$20 Download Coming-Alakazam Plans Held",
    "the account and download path are not open yet",
    "Alakazam plans are in development. Public subscriptions and hosting activation are held",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Make your preview in six short steps.",
    "Looking is free. The private Download and Alakazam payment paths remain held",
    "Start building",
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
    "the account and payment path are not open yet",
    "When it opens, Download will be $20 once per editor project",
    "The full $20 will be a one-time non-cash credit toward the same account and project's first separately released Alakazam invoice.",
    "The planned $25, $35, and $50 Alakazam plans are not available.",
    "No Alakazam subscription, hosting activation, publication, or tier feature is offered.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
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
    "The planned $25, $35, and $50 Alakazam plans are not available.",
    "No Alakazam subscription, hosting activation, publication, or tier feature is offered.",
    "Alakazam publishing is held until a separate service and terms are released.",
    "The standard $200 assessment covers one customer, business, public website, and primary goal",
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
    "Your source for websites.",
    "Three ways to start: make a free preview, get a $350 assessment of the site you have, or commission a custom build from $350.",
    "Make a preview — free.",
    "Free preview · $20 Download",
    "The full $20 is a one-time non-cash credit toward that account and project's first separately released Alakazam invoice.",
    "Account required only to save and buy",
    "Neither of these is for sale yet.",
    "Check and ask about a domain",
  ]),
  "vnext.js": Object.freeze([
    "Download is $20 once per editor project, not per click or version.",
    "The full $20 is a one-time non-cash credit toward the same account and project's first separately released Alakazam invoice.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Abracadabra Alakazam",
    "Free preview. $20 Download. Alakazam plans held.",
    "A signed-in account can save the project and buy its HTML Download once for $20.",
    "Repeat downloads from that retained project do not require another Site Sourcery payment",
    "the full $20 is a one-time non-cash credit toward that account and project's first separately released Alakazam invoice.",
    "Alakazam plans are in development. Public subscriptions and hosting activation are held",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Make your preview in six short steps.",
    "Looking is free. Download is $20 once per saved editor project",
    "Sign in only when you want to save the project, review its exact one-time $20 quote and delivery terms, and download the accepted HTML after payment.",
    "Start building",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Build, preview, and download with Abracadabra",
    "Your guest preview is not saved yet.",
    "Made versions may survive a refresh in this tab.",
    "Sign in for the $20 Download.",
    "Alakazam subscriptions and hosting activation remain held.",
    "Create an account or sign in.",
    "A new project has its own one-time $20 Download unlock.",
    "Get the exact $20 quote",
    "Download HTML",
  ]),
  "abracadabra/app/abracadabra-app.js": Object.freeze([
    "Abracadabra ready. Guest work stays only in this tab until you save it to your account.",
  ]),
  "faq/index.html": Object.freeze([
    "Download is $20 once per editor project.",
    "A signed-in customer may buy Download for $20 once per editor project",
    "The full $20 is a one-time non-cash credit toward the same account and project's first separately released Alakazam invoice.",
    "An incomplete checkout creates no Download entitlement, delivers no file, and creates no charge.",
    "Alakazam subscription sales and hosting activation remain held.",
    "Downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
    "this page cannot quote or start setup",
  ]),
  "contact/index.html": Object.freeze([
    "Sign in only when you want to save the project and buy its HTML Download once for $20.",
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
