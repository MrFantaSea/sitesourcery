const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const PRIMARY_CLASSES = new Set(["button-primary", "spark-button-primary"]);
const FALLBACKS = new Set([
  "enhancement-with-static-alternative",
  "hosted-progressive",
  "inert-until-javascript",
  "native-disclosure",
  "static",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function selector(options) {
  return options;
}

function topSection(ordinal) {
  return selector({ directMain: true, ordinal, tag: "section" });
}

function topProof() {
  return selector({
    classToken: "proof-strip",
    directMain: true,
    tag: "div",
  });
}

function attribute(tag, name, value) {
  return selector({ attribute: name, tag, value });
}

function classUnit(tag, classToken, options = {}) {
  return selector({ classToken, tag, ...options });
}

function withinClass(tag, classToken, ordinal) {
  return selector({ ordinal, tag, withinClassToken: classToken });
}

function primaryAttribute(name, value = "") {
  return selector({ attribute: name, tag: "button", value });
}

function primaryHref(value) {
  return selector({ attribute: "href", tag: "a", value });
}

function unit({
  action = null,
  copy,
  evidence,
  fallback = "static",
  id,
  job,
  match,
  proof = null,
}) {
  return {
    action,
    copy,
    evidence,
    fallback,
    id,
    job,
    match,
    proof,
  };
}

function top({
  action = null,
  copy,
  evidence,
  fallback = "static",
  id,
  job,
  ordinal,
}) {
  return unit({
    action,
    copy,
    evidence,
    fallback,
    id,
    job,
    match: topSection(ordinal),
  });
}

// The homepage sorts arrivals; it does not sell. Each unit below is one
// question a visitor might have arrived with, in the order they tend to ask
// them: what is this, which lane am I in, can I see it first, what about the
// site I already have, what about my address, is any of this real, what if I
// only need one thing, and who do I talk to.
const HOME_UNITS = [
  top({
    action: primaryHref("#two-paths"),
    copy: "Get your business online without guessing what it costs.",
    evidence: "current-studio-intake",
    id: "home-orientation",
    job: "understand-what-is-offered",
    ordinal: 1,
  }),
  unit({
    copy: "$5 to see it",
    evidence: "public-choice-boundaries",
    id: "home-trust-proof",
    job: "understand-what-stays-true",
    match: topProof(),
  }),
  // The sort routes straight to the two real destinations and carries the live
  // Abracadabra showcase, so the visitor sees an actual generated page in the
  // same breath as the price. A separate "$5 preview" section used to sit below
  // this one repeating the same offer and the same button; it is gone.
  top({
    action: primaryHref("/abracadabra/"),
    copy: "Make it yourself, or have it made.",
    evidence: "self-serve-versus-custom-boundary",
    id: "home-website-choice",
    job: "choose-how-to-get-a-website",
    ordinal: 2,
  }),
  top({
    action: primaryHref("/solutions/#assessment"),
    copy: "Find out what is actually wrong with it — $200.",
    evidence: "assessment-catalog",
    id: "home-existing-site",
    job: "diagnose-an-existing-site",
    ordinal: 3,
  }),
  top({
    action: primaryHref("/work/"),
    copy: "See what is real, fictional, and working.",
    evidence: "labeled-public-proof",
    id: "home-proof-choice",
    job: "inspect-before-deciding",
    ordinal: 4,
  }),
  top({
    copy: "Not every job is a whole website.",
    evidence: "conversation-and-inquiry-boundaries",
    id: "home-other-help",
    job: "choose-another-kind-of-help",
    ordinal: 5,
  }),
  top({
    action: primaryHref("/start/"),
    copy: "Bring the situation, not a product name.",
    evidence: "zero-order-start-chooser",
    id: "home-closing",
    job: "start-with-the-problem",
    ordinal: 6,
  }),
];

const FAQ_DEFINITIONS = [
  ["paths", "compare-the-three-main-paths", "current-product-boundaries", null],
  ["custom-scope", "understand-custom-pricing", "written-quote-catalog", "/custom/scope/"],
  ["custom-payment", "understand-payment-and-ownership", "custom-payment-policy", null],
  ["custom-timing", "understand-schedule-dependencies", "written-scope-policy", null],
  ["ownership", "understand-account-domain-and-data-ownership", "customer-ownership-policy", null],
  ["assessment", "understand-the-assessment", "assessment-catalog", null],
  ["care", "separate-build-from-upkeep", "care-scope-boundary", null],
  ["abracadabra-now", "understand-current-maker-capability", "held-maker-runtime", null],
  ["address-choices", "understand-current-domain-boundary", "held-domain-boundary", null],
  ["private-sites", "understand-preview-privacy-limits", "sensitive-data-boundary", null],
  ["missed-payment", "understand-current-payment-boundary", "hosted-release-boundary", "/legal/website-terms/"],
  ["hive-planner", "understand-hive-is-conversation-only", "hive-conversation-boundary", null],
  ["getting-started", "prepare-a-safe-first-message", "public-intake-boundary", null],
];

const FAQ_UNITS = [
  top({
    action: primaryHref("#custom-scope"),
    copy: "Clear answers before you choose.",
    evidence: "public-faq-truth",
    id: "faq-orientation",
    job: "find-one-answer-before-deciding",
    ordinal: 1,
  }),
  top({
    copy: "Jump to",
    evidence: "faq-topic-ledger",
    fallback: "native-disclosure",
    id: "faq-topics",
    job: "open-only-the-answer-needed",
    ordinal: 2,
  }),
  ...FAQ_DEFINITIONS.map(([id, job, evidence, href]) => unit({
    action: href ? primaryHref(href) : null,
    evidence,
    fallback: "native-disclosure",
    id: `faq-${id}`,
    job,
    match: attribute("details", "data-faq-anchor", id),
  })),
  top({
    action: primaryHref("/contact/"),
    copy: "Ask the question directly.",
    evidence: "public-contact-route",
    id: "faq-contact",
    job: "ask-zack-directly",
    ordinal: 3,
  }),
];

const FAQ_UNITS_HOSTED = FAQ_UNITS;

const HIVE_STAGE_DEFINITIONS = [
  ["1", "pick-one-stuck-moment", "six-conversation-starting-points", null],
  ["2", "describe-a-better-outcome", "selected-moment-outcome", primaryAttribute("data-hive-next", "3")],
  ["3", "name-the-moment-and-human-handoff", "selected-moment-and-handoff", primaryAttribute("data-hive-next", "4")],
  ["4", "set-work-boundaries-and-stop-note", "selected-boundaries-and-stop-note", primaryAttribute("data-hive-next", "5")],
  ["5", "review-notes-and-contact-zack", "browser-notes-and-direct-contact", primaryHref("tel:+18562441220")],
];

const HIVE_STATIC_DEFINITIONS = [
  ["missed-call", "understand-the-missed-call-example"],
  ["booking", "understand-the-booking-example"],
  ["review-request", "understand-the-review-request-example"],
  ["after-hours", "understand-the-after-hours-example"],
  ["follow-up", "understand-the-follow-up-example"],
  ["getting-paid", "understand-the-getting-paid-example"],
];

const HIVE_UNITS = [
  top({
    action: primaryHref("#planner"),
    copy: "Bring one task that keeps slipping.",
    evidence: "conversation-only-product-boundary",
    id: "hive-orientation",
    job: "decide-whether-the-conversation-fits",
    ordinal: 1,
  }),
  top({
    copy: "One real task",
    evidence: "conversation-boundary-summary",
    id: "hive-proof",
    job: "confirm-nothing-starts-from-the-page",
    ordinal: 2,
  }),
  top({
    copy: "Pick the moment you want to talk through.",
    evidence: "deterministic-conversation-guide",
    fallback: "enhancement-with-static-alternative",
    id: "hive-planner",
    job: "frame-one-stuck-task",
    ordinal: 3,
  }),
  ...HIVE_STAGE_DEFINITIONS.map(([id, job, evidence, action]) => unit({
    action,
    evidence,
    fallback: "enhancement-with-static-alternative",
    id: `hive-stage-${id}`,
    job,
    match: attribute("section", "data-hive-stage", id),
  })),
  top({
    copy: "Use the closest example, not the perfect label.",
    evidence: "six-conversation-starting-points",
    id: "hive-examples",
    job: "compare-six-common-moments",
    ordinal: 4,
  }),
  ...HIVE_STATIC_DEFINITIONS.map(([id, job]) => unit({
    evidence: `hive-cell:${id}`,
    id: `hive-example-${id}`,
    job,
    match: attribute("article", "data-hive-static-cell", id),
  })),
  top({
    action: primaryHref("tel:+18562441220"),
    copy: "The conversation ends with a yes, a no, or a small written scope.",
    evidence: "direct-contact-before-written-scope",
    id: "hive-closing",
    job: "call-zack-about-the-task",
    ordinal: 5,
  }),
];

const LEGAL_CENTER_UNITS = [
  top({
    copy: "Find the privacy notice and website terms.",
    evidence: "filed-identity-and-current-product-boundary",
    fallback: "native-disclosure",
    id: "legal-orientation",
    job: "find-the-controlling-legal-page",
    ordinal: 1,
  }),
  unit({
    evidence: "current-product-clause",
    fallback: "native-disclosure",
    id: "legal-current-product",
    job: "separate-current-tools-from-separate-agreements",
    match: attribute("details", "data-legal-topic", "current-product"),
    proof: attribute("div", "data-legal-clause", "current-product"),
  }),
  top({
    copy: "How information is handled",
    evidence: "operative-legal-route-directory",
    id: "legal-directory",
    job: "choose-privacy-terms-or-contact",
    ordinal: 2,
  }),
  unit({
    action: primaryHref("/legal/privacy/"),
    copy: "How information is handled",
    evidence: "privacy-notice-route",
    id: "legal-privacy-card",
    job: "open-the-privacy-notice",
    match: withinClass("article", "card-grid", 1),
  }),
  unit({
    action: primaryHref("/legal/website-terms/"),
    copy: "Rules for pages, tools, and projects",
    evidence: "website-terms-route",
    id: "legal-terms-card",
    job: "open-the-website-terms",
    match: withinClass("article", "card-grid", 2),
  }),
  unit({
    copy: "Ask about a specific situation",
    evidence: "public-legal-contact-routes",
    id: "legal-contact-card",
    job: "find-phone-and-email-recourse",
    match: withinClass("article", "card-grid", 3),
  }),
];

const LEGAL_CENTER_UNITS_HOSTED = [
  top({
    copy: "Privacy and terms for saved editor projects and Download.",
    evidence: "account-download-document-version-boundary",
    fallback: "native-disclosure",
    id: "legal-orientation",
    job: "find-the-controlling-account-download-legal-page",
    ordinal: 1,
  }),
  unit({
    evidence: "account-download-product-clause",
    fallback: "native-disclosure",
    id: "legal-hosted-product",
    job: "understand-when-the-account-documents-apply",
    match: attribute("details", "data-legal-topic", "hosted-product"),
    proof: attribute("div", "data-legal-clause", "hosted-product"),
  }),
  top({
    copy: "What the account and saved project handle",
    evidence: "account-download-legal-route-directory",
    id: "legal-directory",
    job: "choose-account-privacy-terms-or-contact",
    ordinal: 2,
  }),
  unit({
    action: primaryHref("/legal/privacy/"),
    copy: "What the account and saved project handle",
    evidence: "account-download-privacy-notice-route",
    id: "legal-privacy-card",
    job: "open-the-account-download-privacy-notice",
    match: withinClass("article", "card-grid", 1),
  }),
  unit({
    action: primaryHref("/legal/website-terms/"),
    copy: "What free Preview and $5 Download mean",
    evidence: "account-download-website-terms-route",
    id: "legal-terms-card",
    job: "open-the-account-download-website-terms",
    match: withinClass("article", "card-grid", 2),
  }),
  unit({
    copy: "Ask about a specific situation",
    evidence: "public-legal-contact-routes",
    id: "legal-contact-card",
    job: "find-phone-and-email-recourse",
    match: withinClass("article", "card-grid", 3),
  }),
];

const PRIVACY_IDS = [
  "operator",
  "public-pages",
  "accounts",
  "projects",
  "published-sites",
  "hive-planner",
  "network-records",
  "domains",
  "billing",
  "retention",
  "safety-support",
  "communications",
  "choices",
  "security",
  "changes",
  "contact",
];

const TERMS_IDS = [
  "acceptance",
  "self-service",
  "address-modes",
  "customer-domains",
  "billing-cancellation",
  "publication",
  "customer-content",
  "prohibited-uses",
  "safety-holds",
  "custom-work",
  "assessment",
  "hive-planner",
  "care",
  "site-ownership",
  "warranty",
  "limits",
  "changes-contact",
];

function legalTopicUnits(kind, ids) {
  return ids.map((id) => unit({
    evidence: `${kind}-clause:${id}`,
    fallback: "native-disclosure",
    id: `${kind}-${id}`,
    job: `understand-${id}`,
    match: attribute("details", "data-legal-topic", id),
    proof: attribute("div", "data-legal-clause", id),
  }));
}

const PRIVACY_UNITS = [
  top({
    copy: "How Site Sourcery handles information.",
    evidence: "effective-privacy-notice",
    id: "privacy-orientation",
    job: "understand-what-this-notice-covers",
    ordinal: 1,
  }),
  top({
    copy: "Who operates this site",
    evidence: "operative-privacy-topic-index",
    fallback: "native-disclosure",
    id: "privacy-topics",
    job: "open-one-controlling-privacy-topic",
    ordinal: 2,
  }),
  ...legalTopicUnits("privacy", PRIVACY_IDS),
];

const PRIVACY_UNITS_HOSTED = [
  top({
    copy: "How saved editor projects and Download handle information.",
    evidence: "effective-account-download-privacy-notice",
    id: "privacy-orientation",
    job: "understand-what-the-account-download-notice-covers",
    ordinal: 1,
  }),
  top({
    copy: "Who operates this service",
    evidence: "operative-account-download-privacy-topic-index",
    fallback: "native-disclosure",
    id: "privacy-topics",
    job: "open-one-controlling-account-download-privacy-topic",
    ordinal: 2,
  }),
  ...legalTopicUnits("account-download-privacy", PRIVACY_IDS),
];

const TERMS_UNITS = [
  top({
    copy: "Rules for the pages and current tools.",
    evidence: "effective-website-terms",
    id: "terms-orientation",
    job: "understand-what-these-terms-cover",
    ordinal: 1,
  }),
  top({
    copy: "Acceptance and authority",
    evidence: "operative-terms-topic-index",
    fallback: "native-disclosure",
    id: "terms-topics",
    job: "open-one-controlling-terms-topic",
    ordinal: 2,
  }),
  ...legalTopicUnits("terms", TERMS_IDS),
];

const TERMS_UNITS_HOSTED = [
  top({
    copy: "Terms for saved editor projects and the $5 Download.",
    evidence: "effective-account-download-website-terms",
    id: "terms-orientation",
    job: "understand-what-the-account-download-terms-cover",
    ordinal: 1,
  }),
  top({
    copy: "Acceptance and account authority",
    evidence: "operative-account-download-terms-topic-index",
    fallback: "native-disclosure",
    id: "terms-topics",
    job: "open-one-controlling-account-download-terms-topic",
    ordinal: 2,
  }),
  ...legalTopicUnits("account-download-terms", TERMS_IDS),
];

const MAKER_STAGE_JOBS = [
  ["basics", "enter-the-business-basics"],
  ["details", "add-useful-business-details"],
  ["contact", "add-a-real-visitor-next-step"],
  ["look", "choose-the-page-feel"],
  ["review", "confirm-the-exact-details"],
  ["preview", "test-the-working-page"],
];

function abracadabraGridStages(definitions, startOrdinal = 1, evidence = "abracadabra-maker-flow") {
  return definitions.map(([id, job], index) => unit({
    evidence,
    id: `abracadabra-stage-${id}`,
    job,
    match: withinClass("li", "abracadabra-step-grid", startOrdinal + index),
  }));
}

const ABRACADABRA_LANDING_HELD = [
  top({
    action: primaryHref("/abracadabra/app/#workroom"),
    copy: "Build and preview one page for free.",
    evidence: "free-preview-paid-download-boundary",
    fallback: "enhancement-with-static-alternative",
    id: "abracadabra-landing-orientation",
    job: "understand-the-free-preview-path",
    ordinal: 1,
  }),
  top({
    copy: "Free to build",
    evidence: "free-preview-and-file-rights-summary",
    id: "abracadabra-landing-proof",
    job: "confirm-preview-download-and-file-rights",
    ordinal: 2,
  }),
  top({
    copy: "Finish one step, then open the next.",
    evidence: "six-step-maker-flow",
    id: "abracadabra-landing-maker-flow",
    job: "understand-the-six-maker-steps",
    ordinal: 3,
  }),
  ...abracadabraGridStages(MAKER_STAGE_JOBS),
  top({
    copy: "Preview for free. Download only when you want the file.",
    evidence: "one-time-five-dollar-download-boundary",
    id: "abracadabra-landing-download-choice",
    job: "compare-free-preview-and-paid-download",
    ordinal: 4,
  }),
  top({
    copy: "Same facts. Different feel.",
    evidence: "deterministic-three-theme-proof",
    fallback: "enhancement-with-static-alternative",
    id: "abracadabra-landing-looks",
    job: "compare-the-three-looks",
    ordinal: 5,
  }),
  top({
    action: primaryHref("/abracadabra/app/#workroom"),
    copy: "Ready to make the page?",
    evidence: "abracadabra-versus-custom-fit",
    id: "abracadabra-landing-choice",
    job: "choose-abracadabra-or-made-for-you",
    ordinal: 6,
  }),
];

const ABRACADABRA_LANDING_HOSTED = ABRACADABRA_LANDING_HELD;

const HELP_FLOW_STAGES = MAKER_STAGE_JOBS.map(([id, job], index) => unit({
  evidence: "abracadabra-maker-instructions",
  id: `abracadabra-help-stage-${id}`,
  job,
  match: withinClass("li", "help-flow", index + 1),
}));

const HELP_QUESTIONS = [
  ["open", "recover-when-the-maker-does-not-open"],
  ["field", "correct-a-highlighted-field"],
  ["review", "review-again-after-a-change"],
  ["preview-link", "test-a-link-in-the-working-preview"],
  ["earlier-version", "return-to-an-earlier-version"],
  ["more-pages", "choose-custom-for-a-larger-site"],
];

function helpQuestionUnits() {
  return HELP_QUESTIONS.map(([id, job], index) => unit({
    evidence: "current-maker-recovery-instructions",
    fallback: "native-disclosure",
    id: `abracadabra-help-${id}`,
    job,
    match: withinClass("details", "help-recovery", index + 1),
  }));
}

const ABRACADABRA_HOW_HELD = [
  top({
    action: primaryHref("/abracadabra/app/#workroom"),
    copy: "Build and preview your page in six short steps.",
    evidence: "free-preview-six-step-boundary",
    id: "abracadabra-how-orientation",
    job: "understand-the-preview-and-download-path",
    ordinal: 1,
  }),
  top({
    copy: "Bring the basics.",
    evidence: "maker-required-facts",
    id: "abracadabra-how-preflight",
    job: "prepare-the-minimum-useful-facts",
    ordinal: 2,
  }),
  top({
    copy: "Name and describe the business.",
    evidence: "abracadabra-maker-instructions",
    id: "abracadabra-how-maker-flow",
    job: "follow-the-six-maker-steps",
    ordinal: 3,
  }),
  ...HELP_FLOW_STAGES,
  top({
    copy: "The private preview is free. Download is $5 once per editor project.",
    evidence: "one-time-five-dollar-download-boundary",
    fallback: "native-disclosure",
    id: "abracadabra-how-custody",
    job: "understand-preview-download-and-file-rights",
    ordinal: 4,
  }),
  unit({
    evidence: "local-html-custody",
    fallback: "native-disclosure",
    id: "abracadabra-how-file",
    job: "keep-the-downloaded-file-under-your-control",
    match: classUnit("details", "local-state-note"),
  }),
  top({
    copy: "If you get stuck.",
    evidence: "current-maker-recovery-instructions",
    fallback: "native-disclosure",
    id: "abracadabra-how-recovery",
    job: "open-only-the-help-needed",
    ordinal: 5,
  }),
  ...helpQuestionUnits(),
  top({
    action: primaryHref("/abracadabra/app/#workroom"),
    copy: "Build the first version now.",
    evidence: "current-maker-entry-route",
    id: "abracadabra-how-closing",
    job: "start-the-first-version",
    ordinal: 6,
  }),
];

const ABRACADABRA_HOW_HOSTED = ABRACADABRA_HOW_HELD;

const APP_STEP_DEFINITIONS = [
  ["facts", "enter-the-business-basics", primaryAttribute("data-next", "details")],
  ["details", "add-useful-business-details", primaryAttribute("data-next", "contact")],
  ["contact", "add-a-real-visitor-next-step", primaryAttribute("data-next", "vibe")],
  ["vibe", "choose-the-look", primaryAttribute("data-next", "truth")],
  ["truth", "approve-the-exact-details", selector({ attribute: "id", tag: "button", value: "make-preview" })],
  ["preview", "test-the-reviewed-version", selector({ attribute: "id", tag: "button", value: "open-version" })],
];

function appMakerUnits() {
  return APP_STEP_DEFINITIONS.map(([id, job, action]) => unit({
    action,
    evidence: `spark-v1-stage:${id}`,
    fallback: "inert-until-javascript",
    id: `abracadabra-app-${id}`,
    job,
    match: attribute("fieldset", "data-step", id),
  }));
}

const ABRACADABRA_APP_HELD = [
  top({
    action: primaryHref("#workroom"),
    copy: "Build and preview one page for free.",
    evidence: "held-unsaved-browser-maker-boundary",
    id: "abracadabra-app-orientation",
    job: "understand-the-unsaved-maker",
    ordinal: 1,
  }),
  top({
    copy: "Start with the business basics.",
    evidence: "spark-v1-browser-workroom",
    fallback: "inert-until-javascript",
    id: "abracadabra-app-workroom",
    job: "make-one-reviewed-page",
    ordinal: 2,
  }),
  ...appMakerUnits(),
  unit({
    copy: "Project versions",
    evidence: "in-tab-version-history",
    fallback: "inert-until-javascript",
    id: "abracadabra-app-history",
    job: "return-to-an-approved-version",
    match: classUnit("section", "spark-history"),
  }),
  unit({
    action: primaryHref("/abracadabra/#plans"),
    copy: "Choose only after the preview looks right.",
    evidence: "accepted-free-preview-paid-download-boundary",
    fallback: "inert-until-javascript",
    id: "abracadabra-app-save",
    job: "choose-how-to-keep-the-reviewed-page",
    match: classUnit("section", "spark-save-gate"),
  }),
];

const HOSTED_CONTROL_UNITS = [
  top({
    copy: "Save the version you reviewed.",
    evidence: "hosted-save-project-download-boundary",
    fallback: "hosted-progressive",
    id: "abracadabra-control-room",
    job: "save-and-download-the-reviewed-page",
    ordinal: 3,
  }),
  unit({
    copy: "Create an account or sign in.",
    evidence: "hosted-account-entry-stage",
    fallback: "hosted-progressive",
    id: "abracadabra-account-stage",
    job: "choose-how-to-open-an-account",
    match: attribute("section", "data-customer-stage", "account"),
  }),
  unit({
    action: primaryAttribute("data-create-account"),
    copy: "Create your account",
    evidence: "hosted-account-api",
    fallback: "hosted-progressive",
    id: "abracadabra-account-create",
    job: "create-the-customer-account",
    match: attribute("fieldset", "data-auth-panel", "create"),
  }),
  unit({
    action: primaryAttribute("data-complete-registration"),
    copy: "Check your email",
    evidence: "hosted-account-activation-api",
    fallback: "hosted-progressive",
    id: "abracadabra-account-activate",
    job: "activate-the-customer-account",
    match: attribute("fieldset", "data-auth-panel", "activate"),
  }),
  unit({
    action: primaryAttribute("data-sign-in"),
    copy: "Sign in",
    evidence: "hosted-session-api",
    fallback: "hosted-progressive",
    id: "abracadabra-account-sign-in",
    job: "open-saved-projects",
    match: attribute("fieldset", "data-auth-panel", "sign-in"),
  }),
  unit({
    action: primaryAttribute("data-request-recovery"),
    copy: "Recover account access",
    evidence: "hosted-recovery-request-api",
    fallback: "hosted-progressive",
    id: "abracadabra-account-recovery-request",
    job: "request-account-recovery",
    match: attribute("fieldset", "data-auth-panel", "recover"),
  }),
  unit({
    action: primaryAttribute("data-complete-recovery"),
    copy: "Recovery link opened",
    evidence: "hosted-recovery-completion-api",
    fallback: "hosted-progressive",
    id: "abracadabra-account-recovery-complete",
    job: "finish-account-recovery",
    match: attribute("div", "data-recovery-complete", ""),
  }),
  unit({
    copy: "Save this preview as a project.",
    evidence: "hosted-editor-project-stage",
    fallback: "hosted-progressive",
    id: "abracadabra-project-stage",
    job: "choose-the-editor-project",
    match: attribute("section", "data-customer-stage", "project"),
  }),
  unit({
    action: primaryAttribute("data-create-project"),
    copy: "New project",
    evidence: "hosted-project-creation-api",
    fallback: "hosted-progressive",
    id: "abracadabra-project-create",
    job: "save-the-preview-to-a-new-project",
    match: withinClass("fieldset", "customer-control-stage", 5),
  }),
  unit({
    action: primaryAttribute("data-request-download-quote"),
    copy: "Review Download for this project.",
    evidence: "hosted-project-version-quote-gate",
    fallback: "hosted-progressive",
    id: "abracadabra-quote-stage",
    job: "request-the-exact-project-quote",
    match: attribute("section", "data-customer-stage", "quote"),
  }),
  unit({
    action: primaryAttribute("data-continue-download-payment"),
    copy: "Exact quote",
    evidence: "hosted-exact-quote-acceptance",
    fallback: "hosted-progressive",
    id: "abracadabra-quote-review",
    job: "accept-the-exact-project-quote",
    match: attribute("section", "data-download-quote-review", ""),
  }),
  unit({
    action: primaryAttribute("data-download-html"),
    copy: "Download the HTML file.",
    evidence: "hosted-paid-project-download-gate",
    fallback: "hosted-progressive",
    id: "abracadabra-download-stage",
    job: "download-the-accepted-html-file",
    match: attribute("section", "data-customer-stage", "download"),
  }),
  unit({
    copy: "Need publishing or a domain too?",
    evidence: "separate-domain-and-publishing-boundary",
    fallback: "hosted-progressive",
    id: "abracadabra-separate-help",
    job: "ask-about-separately-scoped-help",
    match: classUnit("aside", "customer-separate-help"),
  }),
];

const ABRACADABRA_APP_HOSTED = [
  top({
    action: primaryHref("#workroom"),
    copy: "Build and preview first. Pay only when it is right.",
    evidence: "hosted-free-preview-versus-saved-boundary",
    id: "abracadabra-app-orientation",
    job: "preview-before-saving-or-paying",
    ordinal: 1,
  }),
  top({
    copy: "Start with the business basics.",
    evidence: "spark-v1-browser-workroom",
    fallback: "inert-until-javascript",
    id: "abracadabra-app-workroom",
    job: "make-one-reviewed-page",
    ordinal: 2,
  }),
  ...appMakerUnits(),
  unit({
    copy: "Project versions",
    evidence: "in-tab-version-history",
    fallback: "inert-until-javascript",
    id: "abracadabra-app-history",
    job: "return-to-an-approved-version",
    match: classUnit("section", "spark-history"),
  }),
  unit({
    action: primaryAttribute("data-save-direction"),
    copy: "Save this reviewed version.",
    evidence: "guest-to-account-handoff",
    fallback: "hosted-progressive",
    id: "abracadabra-app-save",
    job: "save-the-reviewed-version-to-an-account",
    match: classUnit("section", "spark-save-gate"),
  }),
  ...HOSTED_CONTROL_UNITS,
];

const TOP_SECTION_INVENTORY = selector({ directMain: true, tag: "section" });
const TOP_PROOF_INVENTORY = selector({
  classToken: "proof-strip",
  directMain: true,
  tag: "div",
});

function route({
  file,
  held,
  hosted = held,
  nestedInventory = [],
  source = "remaining-section-ledger",
}) {
  return {
    file,
    held,
    hosted,
    inventory: [TOP_SECTION_INVENTORY, TOP_PROOF_INVENTORY, ...nestedInventory],
    source,
  };
}

function existing(file, source) {
  return {
    file,
    held: [],
    hosted: [],
    inventory: [],
    source,
  };
}

export const PUBLIC_ROUTE_SECTION_LEDGER = deepFreeze({
  "/": route({
    file: "index.html",
    held: HOME_UNITS,
  }),
  "/websites/": existing("websites/index.html", "trust-intake-contracts"),
  "/websites/made-for-you/": existing("websites/made-for-you/index.html", "trust-intake-contracts"),
  "/custom/": existing("custom/index.html", "paid-route-contracts"),
  "/custom/scope/": existing("custom/scope/index.html", "paid-route-contracts"),
  "/custom/process/": existing("custom/process/index.html", "paid-route-contracts"),
  "/abracadabra/": route({
    file: "abracadabra/index.html",
    held: ABRACADABRA_LANDING_HELD,
    hosted: ABRACADABRA_LANDING_HOSTED,
    nestedInventory: [
      selector({ tag: "li", withinClassToken: "abracadabra-step-grid" }),
    ],
  }),
  "/abracadabra/how/": route({
    file: "abracadabra/how/index.html",
    held: ABRACADABRA_HOW_HELD,
    hosted: ABRACADABRA_HOW_HOSTED,
    nestedInventory: [
      selector({ tag: "li", withinClassToken: "help-flow" }),
      selector({ tag: "li", withinClassToken: "abracadabra-step-grid" }),
      selector({ classToken: "local-state-note", tag: "details" }),
      selector({ tag: "details", withinClassToken: "help-recovery" }),
    ],
  }),
  "/abracadabra/app/": route({
    file: "abracadabra/app/index.html",
    held: ABRACADABRA_APP_HELD,
    hosted: ABRACADABRA_APP_HOSTED,
    nestedInventory: [
      selector({ attribute: "data-step", tag: "fieldset" }),
      selector({ classToken: "spark-history", tag: "section" }),
      selector({ classToken: "spark-save-gate", tag: "section" }),
      selector({ attribute: "data-customer-stage", tag: "section" }),
      selector({ attribute: "data-auth-panel", tag: "fieldset" }),
      selector({ attribute: "data-recovery-complete", tag: "div" }),
      selector({
        ordinal: 5,
        tag: "fieldset",
        withinClassToken: "customer-control-stage",
      }),
      selector({ attribute: "data-download-quote-review", tag: "section" }),
      selector({ classToken: "customer-separate-help", tag: "aside" }),
    ],
  }),
  "/hive/": route({
    file: "hive/index.html",
    held: HIVE_UNITS,
    nestedInventory: [
      selector({ attribute: "data-hive-stage", tag: "section" }),
      selector({ attribute: "data-hive-static-cell", tag: "article" }),
    ],
  }),
  "/solutions/": existing("solutions/index.html", "paid-route-contracts"),
  "/work/": existing("work/index.html", "trust-intake-contracts"),
  "/about/": existing("about/index.html", "trust-intake-contracts"),
  "/faq/": route({
    file: "faq/index.html",
    held: FAQ_UNITS,
    hosted: FAQ_UNITS_HOSTED,
    nestedInventory: [
      selector({ attribute: "data-faq-anchor", tag: "details" }),
    ],
  }),
  "/contact/": existing("contact/index.html", "trust-intake-contracts"),
  "/start/": existing("start/index.html", "trust-intake-contracts"),
  "/legal/": route({
    file: "legal/index.html",
    held: LEGAL_CENTER_UNITS,
    hosted: LEGAL_CENTER_UNITS_HOSTED,
    nestedInventory: [
      selector({ attribute: "data-legal-topic", tag: "details" }),
      selector({ tag: "article", withinClassToken: "card-grid" }),
    ],
  }),
  "/legal/privacy/": route({
    file: "legal/privacy/index.html",
    held: PRIVACY_UNITS,
    hosted: PRIVACY_UNITS_HOSTED,
    nestedInventory: [
      selector({ attribute: "data-legal-topic", tag: "details" }),
    ],
  }),
  "/legal/website-terms/": route({
    file: "legal/website-terms/index.html",
    held: TERMS_UNITS,
    hosted: TERMS_UNITS_HOSTED,
    nestedInventory: [
      selector({ attribute: "data-legal-topic", tag: "details" }),
    ],
  }),
});

export const REMAINING_LEDGER_ROUTES = Object.freeze(
  Object.entries(PUBLIC_ROUTE_SECTION_LEDGER)
    .filter(([, entry]) => entry.source === "remaining-section-ledger")
    .map(([routeName]) => routeName),
);

function parseAttributes(raw) {
  const attributes = new Map();
  const expression = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of raw.matchAll(expression)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name)) throw new Error(`duplicate HTML attribute ${name}`);
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function parseDocument(source) {
  const root = {
    attributes: new Map(),
    children: [],
    end: source.length,
    name: "#document",
    parent: null,
    start: 0,
  };
  const nodes = [];
  const stack = [root];
  const expression = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b([^>]*)>/giu;
  for (const match of source.matchAll(expression)) {
    if (!match[1]) continue;
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (closing) {
      const node = stack.at(-1);
      if (node?.name === name) {
        node.end = match.index + match[0].length;
        stack.pop();
      }
      continue;
    }
    const attributes = parseAttributes(match[2] ?? "");
    const parent = stack.at(-1);
    const node = {
      attributes,
      children: [],
      end: match.index + match[0].length,
      name,
      parent,
      start: match.index,
    };
    parent.children.push(node);
    nodes.push(node);
    if (!VOID_ELEMENTS.has(name) && !match[0].endsWith("/>")) stack.push(node);
  }
  return { nodes, root };
}

function classTokens(node) {
  return new Set((node.attributes.get("class") ?? "").split(/\s+/u).filter(Boolean));
}

function hasClass(node, token) {
  return classTokens(node).has(token);
}

function ancestor(node, predicate) {
  let cursor = node.parent;
  while (cursor && cursor.name !== "#document") {
    if (predicate(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return null;
}

function matchesBase(node, match) {
  if (match.tag && node.name !== match.tag) return false;
  if (match.classToken && !hasClass(node, match.classToken)) return false;
  if (match.attribute && !node.attributes.has(match.attribute)) return false;
  if (
    match.attribute
    && Object.prototype.hasOwnProperty.call(match, "value")
    && node.attributes.get(match.attribute) !== match.value
  ) {
    return false;
  }
  if (
    match.directMain
    && node.parent?.name !== "main"
  ) {
    return false;
  }
  if (
    match.withinClassToken
    && !ancestor(node, (candidate) => hasClass(candidate, match.withinClassToken))
  ) {
    return false;
  }
  return true;
}

function selectNodes(nodes, match) {
  const candidates = nodes.filter((node) => matchesBase(node, match));
  if (match.ordinal == null) return candidates;
  return candidates[match.ordinal - 1] ? [candidates[match.ordinal - 1]] : [];
}

function textOf(source, node) {
  return source
    .slice(node.start, node.end)
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&(?:rarr|larr);/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function nodeSpan(node) {
  return Math.max(0, node.end - node.start);
}

function contains(outer, inner) {
  return outer.start <= inner.start && outer.end >= inner.end;
}

function assignedOwner(node, units) {
  return units
    .filter((unitNode) => contains(unitNode, node))
    .sort((left, right) => nodeSpan(left) - nodeSpan(right))[0] ?? null;
}

function styledPrimary(node) {
  if (node.name !== "a" && node.name !== "button") return false;
  return [...classTokens(node)].some((token) => PRIMARY_CLASSES.has(token));
}

function describeSelector(match) {
  return JSON.stringify(match);
}

function validateFallback(source, node, contract, variant, failures, prefix) {
  if (!FALLBACKS.has(contract.fallback)) {
    failures.push(`${prefix} has unknown fallback ${JSON.stringify(contract.fallback)}`);
    return;
  }
  if (contract.fallback === "native-disclosure" && node.name !== "details") {
    const details = selectNodes(
      node.children.flatMap(function flatten(child) {
        return [child, ...child.children.flatMap(flatten)];
      }),
      { tag: "details" },
    );
    if (details.length === 0) failures.push(`${prefix} lacks a native details fallback`);
  }
  if (
    contract.fallback === "enhancement-with-static-alternative"
    && !/<noscript\b/iu.test(source)
  ) {
    failures.push(`${prefix} lacks its JavaScript-off alternative`);
  }
  if (contract.fallback === "inert-until-javascript") {
    const inertAncestor = ancestor(node, (candidate) =>
      candidate.attributes.has("inert")
      || candidate.attributes.get("aria-disabled") === "true");
    if (
      !node.attributes.has("inert")
      && !node.attributes.has("hidden")
      && !inertAncestor
      && !/<noscript\b/iu.test(source)
    ) {
      failures.push(`${prefix} is not held safely before JavaScript`);
    }
  }
  if (contract.fallback === "hosted-progressive" && variant !== "hosted") {
    failures.push(`${prefix} exposes a hosted-only fallback in the held variant`);
  }
}

export function validateCustomerSectionLedger(routeSources, {
  variant = "held",
} = {}) {
  if (variant !== "held" && variant !== "hosted") {
    throw new Error(`unknown customer section ledger variant: ${variant}`);
  }
  const failures = [];
  for (const routeName of REMAINING_LEDGER_ROUTES) {
    const entry = PUBLIC_ROUTE_SECTION_LEDGER[routeName];
    const sourceEntry = routeSources.get(routeName);
    if (!sourceEntry) {
      failures.push(`${entry.file}: missing ${variant} section-ledger route ${routeName}`);
      continue;
    }
    const source = typeof sourceEntry === "string" ? sourceEntry : sourceEntry.source;
    const file = typeof sourceEntry === "string" ? entry.file : sourceEntry.file;
    let document;
    try {
      document = parseDocument(source);
    } catch (error) {
      failures.push(`${file}: section ledger could not parse HTML: ${error.message}`);
      continue;
    }
    const contracts = entry[variant];
    const inventoryNodes = [...new Set(
      entry.inventory.flatMap((match) => selectNodes(document.nodes, match)),
    )].sort((left, right) => left.start - right.start);
    const resolved = [];
    for (const contract of contracts) {
      const matches = selectNodes(document.nodes, contract.match);
      const prefix = `${file}: ${contract.id}`;
      if (matches.length !== 1) {
        failures.push(
          `${prefix} selector ${describeSelector(contract.match)} matched ${matches.length}; expected 1`,
        );
        continue;
      }
      const node = matches[0];
      resolved.push({ contract, node });
      if (!contract.job || !contract.evidence) {
        failures.push(`${prefix} lacks an explicit customer job or evidence basis`);
      }
      if (contract.copy && !textOf(source, node).includes(contract.copy)) {
        failures.push(`${prefix} no longer states ${JSON.stringify(contract.copy)}`);
      }
      if (contract.proof) {
        const proofMatches = selectNodes(document.nodes, contract.proof)
          .filter((candidate) => contains(node, candidate));
        if (proofMatches.length !== 1) {
          failures.push(`${prefix} lacks its exact evidence node`);
        }
      }
      validateFallback(source, node, contract, variant, failures, prefix);
    }

    const resolvedNodes = resolved.map(({ node }) => node);
    if (
      inventoryNodes.length !== resolvedNodes.length
      || inventoryNodes.some((node, index) => node !== resolvedNodes[index])
    ) {
      failures.push(
        `${file}: ${variant} customer units are missing, duplicated, misordered, or uncontracted `
        + `(inventory ${inventoryNodes.length}; contracts ${resolvedNodes.length})`,
      );
    }
    const ids = contracts.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      failures.push(`${file}: ${variant} section ledger contains duplicate customer-unit ids`);
    }

    const controls = document.nodes.filter((node) => node.name === "a" || node.name === "button");
    for (const { contract, node } of resolved) {
      const prefix = `${file}: ${contract.id}`;
      const ownedControls = controls.filter(
        (control) => assignedOwner(control, resolvedNodes) === node,
      );
      const styled = ownedControls.filter(styledPrimary);
      if (styled.length > 1) {
        failures.push(`${prefix} exposes ${styled.length} primary actions; maximum is 1`);
      }
      if (!contract.action) {
        if (styled.length !== 0) {
          failures.push(`${prefix} has an uncontracted primary action`);
        }
        continue;
      }
      const actionMatches = ownedControls.filter((control) =>
        matchesBase(control, contract.action));
      if (actionMatches.length !== 1) {
        failures.push(
          `${prefix} primary action ${describeSelector(contract.action)} matched `
          + `${actionMatches.length}; expected 1`,
        );
      } else if (styled.length === 1 && styled[0] !== actionMatches[0]) {
        failures.push(`${prefix} styled primary action does not match its contracted next step`);
      }
    }
  }
  return [...new Set(failures)].sort();
}

export function routeSourcesFromFileMap(fileSources) {
  return new Map(
    Object.entries(PUBLIC_ROUTE_SECTION_LEDGER).map(([routeName, entry]) => [
      routeName,
      {
        file: entry.file,
        source: fileSources.get(entry.file),
      },
    ]).filter(([, entry]) => typeof entry.source === "string"),
  );
}
