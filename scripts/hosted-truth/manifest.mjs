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
    sourceSha256: "cefb57386cb8b70d72b12270cb30414c8e8c7d20191c5dd2d790eb00ee6f8573",
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
    sourceSha256: "41f73ecc1403829725cd8439a6807a2c7322649670dcf9e286ee6e77696d1965",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-hero.html",
    hostedSha256: "39baa2fc1b7e38839762a673a25e8c2fb5eadd12edf13a4c60a3564dc0860fc8",
  }),
  slot({
    id: "abracadabra-app-control",
    file: "abracadabra/app/index.html",
    kind: "html",
    sourceSha256: "b98809417c0240085bf70f2a1127f0b622c1514651737e7e4ffac4b39e4da17e",
    hostedFragment: "scripts/hosted-truth/fragments/abracadabra-app-customer-control.html",
    hostedSha256: "015c56e89558af3e5239af72ffc266f46b86231aa12810add61c7d31ad14d05b",
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
    sourceSha256: "0922075088c27cca771ef08fb0928c2ef3095c654c66a27fe66d5d9907b74f97",
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
    sourceSha256: "fd1fef8607b69125496a0919bed59f3024b58eb583bf3a3b27c9ccfc40843082",
    hostedFragment: "scripts/hosted-truth/fragments/legal-privacy-head.html",
    hostedSha256: "e6b1ef4ad3ec7db0b17fa563318e9eecf6e437c13fa5ba0798977d12372e1786",
  }),
  slot({
    id: "legal-privacy-main",
    file: "legal/privacy/index.html",
    kind: "html",
    sourceSha256: "6b95560c3f505d7d7f1710886e6262660cb246c8109754ac94879f2dfa6f6998",
    hostedFragment: "scripts/hosted-truth/fragments/legal-privacy-main.html",
    hostedSha256: "6f226664449e8cdf206a6dc7c8823062a10b3f2b6d8c0b3ff3bc0eae6076c48c",
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
    sourceSha256: "c560ab127eb2dd938535accc3fc09af06bfffc593eeb2bffa53d1742e7ca2552",
    hostedFragment: "scripts/hosted-truth/fragments/legal-website-terms-main.html",
    hostedSha256: "8df0c8323db3b723c6c74cc6b18044bcaf2cf5fcfcf3ebf3f60882225b6967bc",
  }),
]);

export const hostedStagingAssetSha256 = Object.freeze({
  "abracadabra/app/abracadabra-api.js":
    "3fa60502b4ea058c7fcd7d8c4f1e0392edca3dca00864af603b193fefc9da91e",
  "abracadabra/app/abracadabra-control-mode.js":
    "24015f383c2642951ddf5260a62f5a2e38fdbf98d02653d834feb854683f8dc8",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "63a14a9b01a82d81c325ab9a1631265d9b22124bf727d9c0318c194f504e658b",
  "abracadabra/app/abracadabra-hosted-control.js":
    "51a57dd6cf74f2510ff44f5540f74ae6faacfd354aa7a71aed736bcd5c41ea6f",
});

export const hostedCodeTransforms = Object.freeze([]);

export const heldTruthRequirements = Object.freeze({
  "index.html": Object.freeze([
    "A clearer path for your small business online.",
    "Build and preview one page for free.",
    "Download is a one-time $5 unlock for that editor project",
    "Talk through one task that keeps slipping.",
  ]),
  "vnext.js": Object.freeze([
    "Build and preview privately for free.",
    "Download is $5 once per editor project, not per click or version.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Build and preview one page for free.",
    "Download is a one-time $5 unlock for each editor project",
    "Preview for free. Download only when you want the file.",
    "A downloaded file may be modified and self-hosted without another Site Sourcery payment.",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Build and preview your page in six short steps.",
    "The private preview is free. Download is $5 once per editor project.",
    "You may modify it and host it yourself without another Site Sourcery payment.",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Build and preview one page for free.",
    "Your free preview stays in this tab.",
    "Choose only after the preview looks right.",
    "Download is $5 once for this editor project.",
  ]),
  "abracadabra/app/abracadabra-app.js": Object.freeze([
    "Abracadabra ready. Your local draft stays in this tab.",
  ]),
  "faq/index.html": Object.freeze([
    "Build, revise, and test the private preview for free.",
    "Download is a one-time $5 unlock for the editor project",
    "Downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
    "the page cannot place an order or start work",
  ]),
  "legal/index.html": Object.freeze([
    "current device-local Abracadabra rehearsal",
  ]),
  "legal/privacy/index.html": Object.freeze([
    "The current Abracadabra maker creates no account or organization record.",
    "Business facts and made versions stay only in this tab.",
    "The current maker does not ask for payment-card details",
    "processed through Proton Mail",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "Using the current maker does not create an account, control room, project record, or saved acceptance.",
    "Facts and made versions stay only in the current tab; refreshing the page or closing the tab clears them.",
    "This maker has no Publish button or publication state.",
    "exact scope, price, turnaround, and any later credit are stated in writing before purchase.",
  ]),
});

export const heldTruthForbiddenPhrases = Object.freeze({
  "legal/privacy/index.html": Object.freeze([
    "SS-HOSTED-PRIVACY-2026-07-30-V2",
    "An account is required only when you choose to save the preview",
    "A completed $5 payment unlocks Download for that editor project.",
    "accepted saved-version Download",
  ]),
  "legal/website-terms/index.html": Object.freeze([
    "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
    "$5 once per editor project unlocks Download for that project.",
    "A different editor project has its own one-time $5 Download unlock.",
    "The customer may modify it and self-host it without another Site Sourcery payment.",
  ]),
});

export const hostedTruthRequirements = Object.freeze({
  "index.html": Object.freeze([
    "A clearer path for your small business online.",
    "Build and preview one page for free.",
    "Talk through one task that keeps slipping.",
  ]),
  "vnext.js": Object.freeze([
    "Download is $5 once per editor project, not per click or version.",
    "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "abracadabra/index.html": Object.freeze([
    "Build and preview one page for free.",
    "$5 once per editor project",
    "A downloaded file may be modified and self-hosted without another Site Sourcery payment.",
  ]),
  "abracadabra/how/index.html": Object.freeze([
    "Build and preview your page in six short steps.",
    "The private preview is free. Download is $5 once per editor project.",
  ]),
  "abracadabra/app/index.html": Object.freeze([
    "Build and preview first. Pay only when it is right.",
    "Your guest preview is not saved yet.",
    "Create an account or sign in.",
    "A new project has its own one-time $5 Download unlock.",
    "Get the exact $5 quote",
    "Download HTML",
  ]),
  "abracadabra/app/abracadabra-app.js": Object.freeze([
    "Abracadabra ready. Guest work stays only in this tab until you save it to your account.",
  ]),
  "faq/index.html": Object.freeze([
    "Download is a one-time $5 unlock for the editor project",
    "Downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
    "the page cannot place an order or start work",
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
