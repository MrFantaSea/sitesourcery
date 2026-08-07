#!/usr/bin/env node

/*
 * ARCHIVED VNEXT INSPECTOR — NOT A CURRENT RELEASE GATE
 *
 * Its exact route, copy, product, and CSS contracts describe an earlier site.
 * Current authority is documented and machine-checked by checker-authority.mjs.
 * Use --historical-inspection explicitly if you need its old diagnostics.
 */

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildPagesArtifact,
  excludedTopLevel,
  publicFileAllowlist,
} from "./build-pages.mjs";
import {
  BRAND_IDENTITY_DISCLOSURE,
  CANONICAL_MAILBOX,
  CANONICAL_PHONE,
  CANONICAL_ROUTE_FILES,
  CANONICAL_ROUTES,
  FUNCTIONAL_APP_ROUTE_FILES,
  LEGACY_REDIRECTS,
  LEGAL_SELLER,
  SITE_ORIGIN,
  validateRouteContract,
} from "./check-routes.mjs";
import {
  PRIVACY_SECTION_IDS,
  TERMS_SECTION_IDS,
} from "./legal-section-ids.mjs";

export { PRIVACY_SECTION_IDS, TERMS_SECTION_IDS } from "./legal-section-ids.mjs";

export const HOME_DOORS = Object.freeze(["websites", "hive", "services"]);
export const HIVE_CELLS = Object.freeze([
  "missed-call",
  "booking",
  "review-request",
  "after-hours",
  "follow-up",
  "getting-paid",
]);
export const SOLUTION_ANCHORS = Object.freeze([
  "assessment",
  "foundations",
  "care",
  "domains",
  "email",
  "commerce",
  "interfaces",
  "studio",
  "network",
]);
export const START_PATHS = Object.freeze(["website", "system", "service"]);
export const INTAKE_CATEGORIES = Object.freeze(["website", "system", "service"]);
export const CUSTOMER_SECTION_CONTRACTS = Object.freeze({
  // /websites/ used to re-ask the question the homepage had just answered: it
  // opened on its own "two ways" sort, so an arrival picked a lane twice and the
  // top of this page repeated the section above it. The homepage now routes
  // straight to /abracadabra/ and /custom/, and this page opens on what a
  // visitor genuinely cannot infer — that the self-serve lane is two paid tiers,
  // and where the finished page ends up living.
  "/websites/": Object.freeze([
    Object.freeze({
      id: "make-it-yourself",
      elementId: "make-it-yourself",
      labelledBy: "self-serve-title",
      job: "understand-self-serve-tiers",
      copy: "Abracadabra, then Alacazam.",
      action: Object.freeze({ id: "make-a-preview", href: "/abracadabra/" }),
    }),
    Object.freeze({
      id: "website-addresses",
      elementId: "addresses",
      labelledBy: "addresses-title",
      job: "choose-an-address",
      copy: "Four ways to have an address.",
      action: Object.freeze({ id: "compare-addresses", href: "/domains/" }),
    }),
    Object.freeze({
      id: "have-it-made",
      elementId: "have-it-made",
      labelledBy: "custom-title",
      job: "understand-custom-work",
      copy: "A website designed around your business.",
      action: Object.freeze({ id: "explore-custom-work", href: "/custom/" }),
    }),
    Object.freeze({
      id: "website-help",
      elementId: "website-help",
      labelledBy: "website-help-title",
      job: "ask-about-website-fit",
      copy: "Ask without choosing first.",
      action: Object.freeze({ id: "ask-about-website-fit", href: "/contact/#about-custom-website" }),
    }),
  ]),
  // Domains was only an anchor inside /solutions/. Every arrival needs an
  // address whichever lane they take, so it gets its own route.
  //
  // FOUR options, not three. Buying a domain through Site Sourcery and having
  // Site Sourcery manage it afterwards are separate choices: the first is a
  // one-time purchase the customer then runs themselves, the second adds
  // ongoing care. The commerce tenures (rent / own / owned_managed) currently
  // model only three, so the standalone purchase has no tenure yet.
  "/domains/": Object.freeze([
    Object.freeze({
      id: "domains-overview",
      elementId: "domains-overview",
      labelledBy: "domains-title",
      job: "understand-address-options",
      copy: "Four ways to have an address.",
      action: Object.freeze({ id: "compare-domain-options", href: "#domains-compare" }),
    }),
    Object.freeze({
      id: "domains-compare",
      elementId: "domains-compare",
      labelledBy: "domains-compare-title",
      job: "compare-address-options",
      copy: "Buy it, have it looked after, bring your own, or rent monthly.",
      action: null,
    }),
    Object.freeze({
      id: "domains-ownership",
      elementId: "domains-ownership",
      labelledBy: "domains-ownership-title",
      job: "understand-domain-ownership",
      copy: "You are the owner on record.",
      action: null,
    }),
    Object.freeze({
      id: "domains-help",
      elementId: "domains-help",
      labelledBy: "domains-help-title",
      job: "ask-about-domains",
      copy: "Not sure which address fits?",
      action: Object.freeze({ id: "ask-about-domains", href: "/contact/" }),
    }),
  ]),
  "/websites/made-for-you/": Object.freeze([
    Object.freeze({
      id: "made-for-you-overview",
      elementId: "made-for-you-overview",
      labelledBy: "made-for-you-title",
      job: "understand-made-for-you-fit",
      copy: "A website planned and built around your business.",
      action: Object.freeze({ id: "ask-about-made-for-you", href: "/contact/#about-custom-website" }),
    }),
    Object.freeze({
      id: "made-for-you-includes",
      elementId: "made-for-you-includes",
      labelledBy: "made-for-you-includes-title",
      job: "understand-made-for-you-work",
      copy: "What does made-for-you include?",
      action: null,
    }),
    Object.freeze({
      id: "made-for-you-process",
      elementId: "made-for-you-process",
      labelledBy: "made-for-you-process-title",
      job: "follow-made-for-you-process",
      copy: "A clear path from first conversation to handoff.",
      action: null,
    }),
    Object.freeze({
      id: "made-for-you-proof",
      elementId: "made-for-you-proof",
      labelledBy: "made-for-you-proof-title",
      job: "inspect-made-for-you-proof",
      copy: "See real and clearly labeled example work.",
      action: Object.freeze({ id: "see-made-for-you-examples", href: "/work/" }),
    }),
    Object.freeze({
      id: "made-for-you-contact",
      elementId: "made-for-you-contact",
      labelledBy: "made-for-you-contact-title",
      job: "start-made-for-you-inquiry",
      copy: "Start with the business problem.",
      action: Object.freeze({ id: "contact-about-made-for-you", href: "/contact/#about-custom-website" }),
    }),
  ]),
  "/start/": Object.freeze([
    Object.freeze({
      id: "choose-help",
      elementId: "start-path",
      labelledBy: "start-path-title",
      job: "choose-help",
      copy: "Find the right kind of help.",
      action: null,
    }),
    Object.freeze({
      id: "ask-zack",
      elementId: "direct-contact",
      labelledBy: "start-human-title",
      job: "ask-zack",
      copy: "You do not need a polished brief.",
      action: Object.freeze({ id: "start-contact", href: "/contact/" }),
    }),
  ]),
  "/work/": Object.freeze([
    Object.freeze({
      id: "evidence-overview",
      elementId: "work-overview",
      labelledBy: "work-title",
      job: "separate-the-proof",
      copy: "See what is real, fictional, and working.",
      action: Object.freeze({ id: "work-contact", href: "/contact/#direct-contact" }),
    }),
    Object.freeze({
      id: "founder-owned-example",
      elementId: "scone-sourcery",
      labelledBy: "scone-title",
      job: "inspect-real-example",
      copy: "Inspect the real venture.",
      action: null,
    }),
    Object.freeze({
      id: "fictional-range",
      elementId: "fictional-studies",
      labelledBy: "demonstrations-title",
      job: "inspect-fictional-range",
      copy: "See two styles without fake client claims.",
      action: null,
    }),
    Object.freeze({
      id: "working-tools",
      elementId: "working-tools",
      labelledBy: "working-proof-title",
      job: "try-working-tools",
      copy: "Try the working tools yourself.",
      action: null,
    }),
    Object.freeze({
      id: "website-inquiry",
      elementId: "work-inquiry",
      labelledBy: "work-closing-title",
      job: "ask-about-your-site",
      copy: "Ask about a website built for your business.",
      action: Object.freeze({ id: "work-closing-contact", href: "/contact/#direct-contact" }),
    }),
  ]),
  "/about/": Object.freeze([
    Object.freeze({
      id: "studio-owner",
      elementId: "about-studio",
      labelledBy: "about-studio-title",
      job: "know-who-is-responsible",
      copy: "Work with the person doing the work.",
      action: Object.freeze({ id: "about-contact", href: "/contact/#direct-contact" }),
    }),
    Object.freeze({
      id: "one-person-model",
      elementId: "the-difference",
      labelledBy: "one-person-title",
      job: "understand-one-person-model",
      copy: "Why work with one person?",
      action: null,
    }),
    Object.freeze({
      id: "accountable-process",
      elementId: "accountable-process",
      labelledBy: "accountable-process-title",
      job: "follow-the-work",
      copy: "How will the work stay clear?",
      action: null,
    }),
    Object.freeze({
      id: "inspectable-proof",
      elementId: "inspectable-proof",
      labelledBy: "inspectable-proof-title",
      job: "inspect-before-deciding",
      copy: "What can you inspect before deciding?",
      action: null,
    }),
    Object.freeze({
      id: "direct-inquiry",
      elementId: "about-contact",
      labelledBy: "about-contact-title",
      job: "explain-the-problem",
      copy: "Want to explain the problem directly?",
      action: Object.freeze({ id: "about-closing-contact", href: "/contact/#direct-contact" }),
    }),
  ]),
  "/contact/": Object.freeze([
    Object.freeze({
      id: "contact-overview",
      elementId: "contact-overview",
      labelledBy: "contact-title",
      job: "reach-zack",
      copy: "Call or email Zack.",
      action: Object.freeze({ id: "choose-contact-method", href: "#direct-contact" }),
    }),
    Object.freeze({
      id: "contact-methods",
      elementId: "direct-contact",
      labelledBy: "direct-contact-title",
      job: "choose-contact-method",
      copy: "Choose the contact method that works for you.",
      action: null,
    }),
    Object.freeze({
      id: "inquiry-types",
      elementId: "inquiry-types",
      labelledBy: "inquiry-types-title",
      job: "choose-inquiry-type",
      copy: "Start with the closest kind of help.",
      action: null,
    }),
    Object.freeze({
      id: "first-note",
      elementId: "first-note",
      labelledBy: "first-note-title",
      job: "prepare-first-note",
      copy: "A short first note is enough.",
      action: Object.freeze({ id: "contact-start-chooser", href: "/start/" }),
    }),
  ]),
});
export const CUSTOMER_EVIDENCE_CONTRACTS = Object.freeze({
  "/work/": Object.freeze([
    Object.freeze({ id: "founder-owned-current-site", kind: "founder-owned-venture" }),
    Object.freeze({ id: "founder-owned-live-link", kind: "founder-owned-venture" }),
    Object.freeze({ id: "fictional-hospitality", kind: "fictional-design-study" }),
    Object.freeze({ id: "fictional-local-service", kind: "fictional-design-study" }),
    Object.freeze({ id: "working-abracadabra", kind: "working-browser-tool" }),
    Object.freeze({ id: "working-hive", kind: "working-planner" }),
  ]),
  "/about/": Object.freeze([
    Object.freeze({ id: "studio-base", kind: "studio-stated" }),
    Object.freeze({ id: "entity-formed", kind: "public-record" }),
    Object.freeze({ id: "studio-operator", kind: "studio-stated" }),
    Object.freeze({ id: "legal-seller", kind: "public-record" }),
    Object.freeze({ id: "labeled-work", kind: "labeled-example-index" }),
    Object.freeze({ id: "published-scope", kind: "published-scope" }),
    Object.freeze({ id: "working-maker", kind: "working-browser-tool" }),
    Object.freeze({ id: "working-planner", kind: "working-planner" }),
  ]),
});
export const ARTIFACT_SIZE_BUDGETS = Object.freeze({
  total: 4 * 1024 * 1024,
  html: 48 * 1024,
  css: 96 * 1024,
  javascript: 96 * 1024,
  image: 640 * 1024,
});
export const START_DECISION_COPY = Object.freeze([
  "made-for-you",
  "website-unsure",
  "How do you want the website made?",
  "Build and preview privately for free.",
  "Download is $5 once per editor project, not per click or version.",
  "The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  "detailTrail",
  "showPreviousDetail",
  "focusAndReveal",
  "data-start-reveal",
  "start-chooser-page",
  "window.scrollTo",
]);
export const ABOUT_TRUST_FACTS = Object.freeze(["base", "established", "operator", "seller"]);
export const ABOUT_PROOFS = Object.freeze(["work", "scope", "abracadabra", "hive"]);
export const CUSTOM_TIERS = Object.freeze([
  "card",
  "card-plus",
  "site",
  "site-plus",
  "signature",
  "flagship",
  "scale",
]);
export const CUSTOM_CREATIVITY = Object.freeze(["essential", "distinctive", "atelier"]);
export const CUSTOM_CREATIVE_PROOFS = Object.freeze(["essential", "distinctive", "atelier"]);
export const CUSTOM_COMPONENTS = Object.freeze([
  "basic_form",
  "standard_tool",
  "hosted_provider",
  "static_collection",
  "copy_expansion",
  "additional_connection",
  "extra_revision_round",
  "priority_production_window",
]);
export const CUSTOM_PROCESS_PHASES = Object.freeze([
  "intake",
  "scope",
  "direction",
  "production",
  "release",
  "closeout",
]);
export const CUSTOM_QUOTE_FIELDS = Object.freeze([
  "outcome",
  "footprint",
  "direction",
  "systems",
  "transition",
  "responsibilities",
  "schedule",
  "commercial",
  "handoff",
]);
export const PAID_ROUTE_SECTION_CONTRACTS = Object.freeze({
  "/custom/": Object.freeze([
    "custom-fit|ask-zack|written-quote",
    "custom-principles|scan-principles|project-rules",
    "custom-result|scan-results|agreed-deliverables",
    "custom-quote|compare-scope|catalog-boundaries",
    "assessment-alternative|see-assessment|assessment-deliverable",
    "custom-intake|ask-zack|intake-checklist",
  ]),
  "/custom/scope/": Object.freeze([
    "scope-fit|ask-zack|quote-only",
    "scope-size|compare-sizes|catalog-limits",
    "scope-design|compare-design|creativity-catalog",
    "scope-tools|compare-tools|addon-catalog",
    "scope-move|plan-replacement|domain-ownership",
    "scope-intake|ask-zack|commercial-boundaries",
  ]),
  "/custom/process/": Object.freeze([
    "process-fit|ask-zack|written-quote",
    "process-steps|scan-steps|six-phase-model",
    "process-quote|open-quote-fields|quote-anatomy",
    "process-duties|open-responsibilities|roles-and-gates",
    "process-changes|review-change-rules|change-and-schedule-rules",
    "process-intake|ask-zack|intake-checklist",
  ]),
  "/solutions/": Object.freeze([
    "service-fit|see-assessment|public-assessment",
    "service-choices|compare-services|inquiry-boundary",
    "service-assessment|open-details|assessment-catalog",
    "service-foundations|open-details|written-scope",
    "service-care|open-details|separate-care-scope",
    "service-domain|open-details|registrant-boundary",
    "service-email|open-details|account-custody",
    "service-commerce|open-details|customer-payment-account",
    "service-interface|open-details|bounded-task",
    "service-design|open-details|single-piece-scope",
    "service-listings|open-details|business-facts",
    "service-intake|ask-zack|written-scope",
  ]),
});
export const PAID_ROUTE_INTAKE_TOPICS = Object.freeze({
  "/custom/": Object.freeze(["custom-website", "custom-website"]),
  "/custom/scope/": Object.freeze(["custom-website", "custom-website"]),
  "/custom/process/": Object.freeze(["custom-website", "custom-website"]),
  "/solutions/": Object.freeze([
    "website-assessment",
    "website-foundations",
    "website-care",
    "customer-domain",
    "business-email",
    "online-selling",
    "staff-tool",
    "design-piece",
    "local-listings",
    "focused-service",
  ]),
});
export const INTAKE_TOPIC_LABELS = Object.freeze({
  "custom-website": "a made-for-you website",
  "website-assessment": "a website assessment",
  "website-foundations": "the website basics",
  "website-care": "ongoing website upkeep",
  "customer-domain": "a web address or domain",
  "business-email": "business email",
  "online-selling": "selling online",
  "staff-tool": "a staff tool",
  "design-piece": "design or artwork",
  "local-listings": "local listings",
  "focused-service": "a focused website job",
});
export const PAID_ROUTE_REQUIRED_COPY = Object.freeze({
  "/custom/": Object.freeze([
    "Card and Card Plus, the one-page sizes, are paid in full before work starts.",
    "Site through Scale use half before work starts; the final half becomes due only after completion and before final handoff.",
    "Completion itself does not authorize an automatic charge.",
    "The agreed client deliverables become yours after final payment; the quote lists any exceptions.",
    "A customer-owned web address stays in the customer’s name.",
  ]),
  "/custom/scope/": Object.freeze([
    "These are work limits, not prices.",
    "Card and Card Plus, the one-page sizes, are paid in full before work starts.",
    "Site through Scale use half before work starts; the final half becomes due only after completion and before final handoff.",
    "Completion itself does not authorize an automatic charge.",
    "The agreed client deliverables become yours after final payment; the quote lists any exceptions.",
    "A customer-owned web address stays in the customer’s name.",
  ]),
  "/custom/process/": Object.freeze([
    "Dates are confirmed after the scope is accepted and the needed payment, materials, access, and decision-maker are ready.",
    "Card and Card Plus, the one-page sizes, are paid in full before work starts.",
    "Site through Scale use half before work starts; the final half becomes due only after completion and before final handoff.",
    "Completion itself does not authorize an automatic charge.",
    "The agreed client deliverables become yours after final payment; the quote lists any exceptions.",
    "A customer-owned web address stays in your name",
  ]),
  "/solutions/": Object.freeze([
    "A website assessment gives you written findings and screenshots.",
    "Every job on this page is inquiry-only",
    "the customer is the registrant and Site Sourcery does not become the owner",
    "The customer keeps control of the payment account and money.",
  ]),
});
export const FAQ_ANCHORS = Object.freeze([
  "paths",
  "custom-scope",
  "custom-payment",
  "custom-timing",
  "ownership",
  "assessment",
  "care",
  "abracadabra-now",
  "address-choices",
  "private-sites",
  "missed-payment",
  "hive-planner",
  "getting-started",
]);
export const HOME_HIVE_COPY = Object.freeze([
  "Talk through one task that keeps slipping.",
  "Hive is a short phone or in-person conversation with Zack. If work is useful, scope and price come in writing before you decide.",
]);
export const HOME_EVIDENCE_COPY =
  "one real founder-owned venture and two fictional design studies that are not client work";
// The self-serve lane is two paid tiers, not one free tool with a paid button.
// Abracadabra ends at the preview; Alacazam is the service that follows. The $5
// is an entry price credited forward, the same shape as the website assessment
// being credited toward an accepted build.
export const HOME_ABRACADABRA_COPY = Object.freeze([
  "See your own page before you pay for a website.",
  "Five dollars, no salesperson, no commitment",
  "comes off the price if you go further",
]);
export const ABRACADABRA_STATE_BADGE = Object.freeze([
  "Local working rehearsal",
  "Makes and downloads real HTML",
  "does not host, charge, email, or change DNS",
]);
export const ABRACADABRA_PRODUCT_COPY = Object.freeze({
  "/abracadabra/": Object.freeze([
    "One-page website maker",
    "Make your preview for $5.",
    "Abracadabra ends at the preview.",
    "Your $5 comes off Alacazam",
    "Paid preview",
    "Credited forward",
    "Finish one step, then open the next.",
    "Basics",
    "Details",
    "Contact",
    "Look",
    "Review",
    "Preview",
  ]),
  "/abracadabra/how/": Object.freeze([
    "Make your preview in six short steps.",
    "The preview costs $5, and that $5 comes off Alacazam if you continue.",
    "Basics",
    "Details",
    "Contact",
    "Look",
    "Review",
    "Preview",
    "Make the first version now.",
  ]),
  "/abracadabra/app/": Object.freeze([
    "Make your preview for $5.",
    "Your preview stays in this tab.",
    "Refresh or close the tab and you will start over.",
    "Basics",
    "Details",
    "Contact",
    "Look",
    "Review",
    "Preview",
    "Project versions",
    "Choose only after the preview looks right.",
  ]),
});
export const PUBLIC_TRUTH_COPY = Object.freeze({
  "/faq/": Object.freeze([
    "Abracadabra makes a one-page preview for $5",
    "that $5 is credited toward Alacazam",
    "Alacazam is the paid service that follows the preview",
    "Downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
  ]),
  "/legal/": Object.freeze([
    "filed alternate name SITESOURCERY",
    "brand presentation of the filed alternate name SITESOURCERY",
    "current device-local Abracadabra rehearsal",
    "separately released hosted service",
  ]),
  "/legal/privacy/": Object.freeze([
    "Desiderata Labs LLC operates this website under the filed alternate name",
    "Site Sourcery is the brand presentation of SITESOURCERY",
    "The full text under each topic is the privacy notice that controls.",
    "The Start chooser uses the buttons you select only to show a recommendation on the current page.",
    "The current Abracadabra maker creates no account or organization record.",
    "Business facts and made versions stay only in this tab.",
    "That chosen HTML download is the only maker output that leaves the browser.",
    "The current maker does not collect registrar credentials, domain proof, DNS records, or a domain order.",
    "The current maker does not ask for payment-card details",
    "The current maker has no account, saved project, product database",
    "This maker cannot review safety",
    "processed through Proton Mail",
  ]),
  "/legal/website-terms/": Object.freeze([
    "The full text under each topic contains the terms that control.",
    "Browsing the ordinary public pages does not record affirmative acceptance.",
    "Using the current maker does not create an account, control room, project record, or saved acceptance.",
    "Facts and made versions stay only in the current tab; refreshing the page or closing the tab clears them.",
    "The current maker does not offer either mode",
    "The current maker has no plan-activation control",
    "<strong>Make my preview</strong>",
    "This maker has no Publish button or publication state.",
    "does not place the website on the public Internet",
    "Desiderata Labs LLC does not receive or store it through the current on-device maker",
    "separately accepts a hosted service",
    "This maker cannot review safety",
  ]),
  "/about/": Object.freeze([
    "brand presentation of the filed alternate name",
    "SITESOURCERY",
    "Desiderata Labs LLC",
  ]),
});
export const BUSINESS_EMAIL_COPY = Object.freeze({
  "/solutions/": Object.freeze([
    "role addresses",
    "domain authentication",
    "controlled routing",
    "recoverable access",
    "clean migration and exit plan",
    "Custody and exit documentation",
  ]),
  "/contact/": Object.freeze([
    'data-business-email="public-intake"',
    "This is Site Sourcery’s current public email address.",
    "copy the address above",
  ]),
});
const RETIRED_PUBLIC_TRUTH_COPY = Object.freeze([
  "Using the ordinary public pages accepts these terms for that use.",
  "A public release can be opened by anyone who knows its address.",
  "The customer grants Desiderata Labs LLC the limited permission needed to store, compile, publish, protect, and export",
  "Site Sourcery is an alternate name of Desiderata Labs LLC.",
  "Desiderata Labs LLC d/b/a Site Sourcery",
  "Abracadabra records the account holder’s name",
  "A saved project can include",
  "Abracadabra’s private build contains local billing-lifecycle rehearsal states",
  "Terminal project deletion in this build acts only on this browser’s local project store",
  "The current tool stores a local hold reason",
  "Abracadabra provides a full project export",
  "Creating a project in the current private tool requires explicit acceptance",
  "The current tool lets an owner create a local account and project",
  "The current owner-side activation control changes only local rehearsal state",
  "Project deletion is terminal in the current device-local tool",
  "Publish accepted version",
  "The current tool records local hold, appeal, restoration",
]);

const HOME_DOOR_HREFS = Object.freeze({
  websites: "/websites/",
  hive: "/hive/",
  services: "/solutions/",
});
const REQUIRED_RELEASE_FLAGS = Object.freeze([
  "allowsDeployment",
  "allowsCommercialDeployment",
  "allowsContainmentDeployment",
  "allowsPublicTruthReconciliationDeployment",
]);
const EXCLUDED_ARTIFACT_TOP_LEVEL = Object.freeze([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_hosted",
  "_site",
  "data",
  "flyer.html",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "QUALITY.md",
  "scripts",
  "server",
]);
const PUBLIC_ALLOWLIST_COUNT = 74;
const SOURCE_ONLY_LEGACY_REDIRECT = "thanks.html";
const EXPECTED_ARTIFACT_ROUTE_ERROR =
  "thanks.html: missing legacy redirect to /contact/";
const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".xml"]);
const CSS_VALUE_ATTRIBUTES = new Set([
  "clip-path",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
  "style",
]);
const PRICE = /(?:[$£€¥]\s*\d[\d,.]*|\b(?:USD|EUR|GBP|CAD|AUD)\s*\d[\d,.]*|\bUS\$\s*\d[\d,.]*|\b\d+(?:\.\d+)?\s*(?:\/\s*(?:mo|month|yr|year)\b|per\s+(?:month|year)\b))/giu;

/**
 * Every dollar figure the public site is permitted to print, derived from the
 * catalog rather than restated here — so repricing the catalog reprices the
 * guard, and a page that keeps an old number fails instead of quietly lying.
 *
 * Any field whose name ends in "Cents" is treated as money. $5 is added
 * explicitly: it is the Abracadabra preview price and belongs to the product
 * proposition rather than to the build catalog.
 */
const CATALOG_PRICES = (() => {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const catalogPath = path.join(repoRoot, "data", "public-catalog.json");
  const amounts = new Set([5]);
  const walk = (value, key) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
      return;
    }
    if (typeof value === "number" && /cents$/iu.test(key ?? "")) {
      amounts.add(value / 100);
    }
  };
  walk(JSON.parse(readFileSync(catalogPath, "utf8")), null);
  return amounts;
})();
const PRICE_ATTRIBUTE = /(?:\bdata-(?:price|monthly|minimum|premium|rate|amount|cost|fee)[a-z-]*\s*=|"(?:price|lowPrice|highPrice|priceCurrency)"\s*:)/iu;
const FIVE_DOLLAR_PROPOSITION_FILES = new Set([
  "abracadabra/app/abracadabra-app.js",
  "abracadabra/app/index.html",
  "abracadabra/how/index.html",
  "abracadabra/index.html",
  "faq/index.html",
  "index.html",
  "legal/website-terms/index.html",
  "vnext.js",
  "websites/index.html",
]);
const OFFER = /(?:"@type"\s*:\s*(?:\[[^\]]*?"Offer"|"Offer")|schema\.org\/Offer\b|\bitemtype\s*=\s*["'][^"']*\/Offer\b|\bitemprop\s*=\s*["'](?:price|priceCurrency)["'])/iu;
const PAYMENT_ENDPOINT = /(?:buy\.stripe\.com|checkout\.stripe\.com|js\.stripe\.com|api\.stripe\.com|paypal\.com|paypalobjects\.com|braintreegateway\.com|checkout\.com|squareup\.com|square\.link|payment_intent|createCheckoutSession|apple-pay|google-pay)/iu;
const NETWORK_SINK = /\b(?:fetch\s*\(|XMLHttpRequest\b|sendBeacon\s*\(|WebSocket\s*\(|EventSource\s*\(|RTCPeerConnection\b|importScripts\s*\(|new\s+(?:Shared)?Worker\s*\()/u;
const EXTERNAL_MODULE = /\bimport\s*(?:(?:[^"'`;]*?\sfrom\s*)?["']https?:\/\/|\(\s*["']https?:\/\/)/u;
const SUBMISSION_SINK = /\b(?:requestSubmit|submit)\s*\(|\bFormData\s*\(/u;
const STORAGE_SINK = /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|caches\s*\.|CacheStorage|document\s*\.\s*cookie)\b/u;
const DYNAMIC_RESOURCE_SINK = /document\s*\.\s*createElement\s*\(\s*["'](?:script|iframe)["']/u;
const FILE_ACCESS = /(?:<input\b[^>]*\btype\s*=\s*["']?file\b|\bFileReader\b|\bshowOpenFilePicker\s*\()/iu;
const PROHIBITED_COPY = Object.freeze([
  Object.freeze({ label: "excluded DAARX name", expression: /\bdaarx\b/iu }),
  Object.freeze({ label: "excluded Pride Pot name", expression: /\bpride[\s_-]*pot\b/iu }),
  Object.freeze({ label: "retired Hive Heart Home name", expression: /\bhive[\s_-]*heart[\s_-]*home\b/iu }),
  Object.freeze({ label: "coming-soon language", expression: /\bcoming[\s-]+soon\b/iu }),
  Object.freeze({ label: "future-state language", expression: /\bfuture\b/iu }),
  Object.freeze({ label: "pre-launch language", expression: /\bpre[\s-]*launch\b/iu }),
  Object.freeze({ label: "waitlist language", expression: /\bwait[\s-]*list\b/iu }),
  Object.freeze({ label: "unavailable language", expression: /\bunavailable\b/iu }),
]);
const STORAGE_ALLOWED_FILES = new Set();
const RETIRED_ABRACADABRA_PRODUCT_COPY = Object.freeze([
  "The whole path",
  "exact four-step Abracadabra flow",
  "refreshing or closing clears them",
  "Your draft and in-session versions stay in this tab",
  "already-made versions remain available in the current tab",
  "I want to make a private page",
  "complete browser-based Spark maker",
  "Open Spark",
  "non-transactional",
  "authoritative hosted persistence",
  "Local candidate boundary",
  "Rehearse plan activation",
  "Simulate missed payment",
  "Multi-tab writing is unsupported",
]);
const RETIRED_HOME_HIVE_COPY = Object.freeze([
  "Ready-made and commissioned systems",
  "Start with After-Hours for missed calls",
  "Plan one handoff that keeps slipping.",
  "The planner shows the steps but does not turn anything on.",
]);
const TARGET_CUSTOMER_ROUTES = Object.freeze([
  "/",
  "/websites/",
  "/websites/made-for-you/",
  "/start/",
  "/work/",
  "/about/",
  "/contact/",
]);
const FORBIDDEN_CUSTOMER_INVENTIONS = Object.freeze([
  Object.freeze({
    label: "false fixed Start question count",
    expression: /\b(?:answer three questions|answer three plain questions|three quick questions)\b/iu,
  }),
  Object.freeze({
    label: "invented response-time promise",
    expression: /\b(?:reply|respond|hear back)\b[^.!?]{0,48}\b(?:within|same|next)\b[^.!?]{0,24}\b(?:hour|day|week)s?\b/iu,
  }),
  Object.freeze({
    label: "invented delivery timeline",
    expression: /\b(?:deliver|finish|launch|complete|ready)\w*\b[^.!?]{0,48}\b(?:in|within)\s+(?:\d+|one|two|three|four|five|six)\s+(?:business\s+)?(?:hour|day|week)s?\b/iu,
  }),
  Object.freeze({
    label: "invented service area",
    expression: /\b(?:serve|serving)\s+(?:all\s+of\s+)?(?:business(?:es)?|clients?|customers?)?\s*(?:in|across|throughout)?\s*(?:New Jersey|South Jersey|Pennsylvania|Philadelphia)\b/iu,
  }),
  Object.freeze({
    label: "invented client result",
    expression: /\b(?:our clients?|client success|clients? (?:doubled|increased|grew)|helped (?:a |the )?client)\b/iu,
  }),
]);

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posix(relative) {
  return relative.split(path.sep).join("/");
}

function report(errors, file, message) {
  errors.push(`${file}: ${message}`);
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => lexical(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = posix(path.relative(root, absolute));
    if (entry.isSymbolicLink()) {
      files.push({ relative, kind: "symlink" });
    } else if (entry.isDirectory()) {
      files.push(...await walkFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push({ relative, kind: "file" });
    } else {
      files.push({ relative, kind: "other" });
    }
  }
  return files;
}

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

function openingTags(source) {
  const found = [];
  for (const match of source.matchAll(/<([a-z][a-z0-9:-]*)\b([^>]*)>/giu)) {
    found.push({
      name: match[1].toLowerCase(),
      attributes: parseAttributes(match[2]),
      raw: match[0],
    });
  }
  return found;
}

function markedElements(file, source, attribute, errors) {
  try {
    return openingTags(source)
      .filter(({ attributes }) => attributes.has(attribute))
      .map(({ name, attributes }) => ({
        name,
        value: attributes.get(attribute),
        href: attributes.get("href"),
        id: attributes.get("id"),
        tabindex: attributes.get("tabindex"),
      }));
  } catch (error) {
    report(errors, file, error.message);
    return [];
  }
}

function checkExactValues(file, label, actual, expected, errors) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    report(errors, file, `${label} must exactly equal ${expected.join(", ")} in order; received ${actual.join(", ")}`);
  }
  if (new Set(actual).size !== actual.length) report(errors, file, `${label} values must be unique`);
}

function customerSectionBlocks(file, source, errors) {
  const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1] ?? "";
  const sections = [];
  try {
    for (const match of main.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/giu)) {
      sections.push({
        attributes: parseAttributes(match[1]),
        body: match[2],
      });
    }
  } catch (error) {
    report(errors, file, error.message);
  }
  return sections;
}

function checkCustomerSections(routeSources, errors) {
  for (const [route, expectedSections] of Object.entries(CUSTOMER_SECTION_CONTRACTS)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const sections = customerSectionBlocks(entry.file, entry.source, errors);
    const actualIds = sections.map(({ attributes }) => attributes.get("data-customer-section") ?? "");
    checkExactValues(
      entry.file,
      "customer section jobs",
      actualIds,
      expectedSections.map(({ id }) => id),
      errors,
    );
    for (const [index, expected] of expectedSections.entries()) {
      const section = sections[index];
      if (!section) continue;
      if (
        section.attributes.get("id") !== expected.elementId
        || section.attributes.get("aria-labelledby") !== expected.labelledBy
      ) {
        report(
          errors,
          entry.file,
          `customer section ${expected.id} must be #${expected.elementId} labelled by #${expected.labelledBy}`,
        );
      }
      let tags = [];
      try {
        tags = openingTags(section.body);
      } catch (error) {
        report(errors, entry.file, error.message);
      }
      const jobs = tags.filter(({ attributes }) => attributes.has("data-customer-job"));
      if (
        jobs.length !== 1
        || !["h1", "h2"].includes(jobs[0]?.name)
        || jobs[0]?.attributes.get("data-customer-job") !== expected.job
        || jobs[0]?.attributes.get("id") !== expected.labelledBy
      ) {
        report(
          errors,
          entry.file,
          `customer section ${expected.id} must contain exactly one labelled h1/h2 job ${expected.job}`,
        );
      }
      if (!section.body.includes(expected.copy)) {
        report(errors, entry.file, `customer section ${expected.id} is missing exact job copy ${JSON.stringify(expected.copy)}`);
      }
      const actions = tags.filter(({ attributes }) => attributes.has("data-primary-action"));
      if (!expected.action) {
        if (actions.length !== 0) {
          report(errors, entry.file, `customer section ${expected.id} must not claim a primary action`);
        }
      } else if (
        actions.length !== 1
        || actions[0].name !== "a"
        || actions[0].attributes.get("data-primary-action") !== expected.action.id
        || actions[0].attributes.get("href") !== expected.action.href
      ) {
        report(
          errors,
          entry.file,
          `customer section ${expected.id} must contain exactly one primary anchor ${expected.action.id} to ${expected.action.href}`,
        );
      }
    }
  }
}

function checkCustomerEvidence(routeSources, errors) {
  for (const [route, expectedEvidence] of Object.entries(CUSTOMER_EVIDENCE_CONTRACTS)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    let evidence = [];
    try {
      evidence = openingTags(entry.source)
        .filter(({ attributes }) => attributes.has("data-evidence-id"));
    } catch (error) {
      report(errors, entry.file, error.message);
    }
    const actualIds = evidence.map(({ attributes }) => attributes.get("data-evidence-id"));
    checkExactValues(
      entry.file,
      "customer evidence labels",
      actualIds,
      expectedEvidence.map(({ id }) => id),
      errors,
    );
    for (const [index, expected] of expectedEvidence.entries()) {
      if (evidence[index]?.attributes.get("data-evidence-kind") !== expected.kind) {
        report(
          errors,
          entry.file,
          `customer evidence ${expected.id} must retain kind ${expected.kind}`,
        );
      }
    }
  }
}

function checkIntakeCongruence(routeSources, errors) {
  const start = routeSources.get("/start/");
  const contact = routeSources.get("/contact/");
  if (start) {
    const categories = markedElements(start.file, start.source, "data-intake-category", errors);
    checkExactValues(
      start.file,
      "Start intake categories",
      categories.map(({ value }) => value),
      INTAKE_CATEGORIES,
      errors,
    );
    for (const category of categories) {
      if (category.name !== "button" || category.href != null) {
        report(errors, start.file, `Start intake category ${category.value} must remain a non-navigating button`);
      }
    }
    const fallbacks = markedElements(start.file, start.source, "data-start-fallback", errors);
    checkExactValues(
      start.file,
      "Start non-JavaScript and skip fallbacks",
      fallbacks.map(({ value }) => value),
      ["no-script", "skip"],
      errors,
    );
    for (const marker of [
      "The question tool needs JavaScript turned on.",
      'href="/websites/"',
      'href="/hive/"',
      'href="/solutions/"',
      'href="tel:+18562441220"',
      'data-start-back',
      'data-start-restart',
    ]) {
      if (!start.source.includes(marker)) {
        report(errors, start.file, `missing exact chooser fallback or return path ${JSON.stringify(marker)}`);
      }
    }
  }
  if (contact) {
    const categories = markedElements(contact.file, contact.source, "data-intake-category", errors);
    checkExactValues(
      contact.file,
      "Contact intake categories",
      categories.map(({ value }) => value),
      INTAKE_CATEGORIES,
      errors,
    );
    const hrefs = new Map([
      ["website", "/websites/"],
      ["system", "/hive/"],
      ["service", "/solutions/"],
    ]);
    for (const category of categories) {
      if (category.name !== "a" || category.href !== hrefs.get(category.value)) {
        report(errors, contact.file, `Contact intake category ${category.value} must link to ${hrefs.get(category.value)}`);
      }
    }
    const methods = markedElements(contact.file, contact.source, "data-contact-method", errors);
    checkExactValues(
      contact.file,
      "native contact methods",
      methods.map(({ value }) => value),
      ["phone", "email"],
      errors,
    );
    const fallbacks = markedElements(contact.file, contact.source, "data-native-fallback", errors);
    checkExactValues(
      contact.file,
      "native contact copy fallbacks",
      fallbacks.map(({ value }) => value),
      ["copy-phone", "copy-email"],
      errors,
    );
  }
}

function targetCustomerText(source) {
  const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1] ?? "";
  return main
    .replace(/<blockquote\b[^>]*data-personal-quote="[^"]+"[^>]*>[\s\S]*?<\/blockquote>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function checkTargetCustomerClaims(routeSources, errors) {
  for (const route of TARGET_CUSTOMER_ROUTES) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const text = targetCustomerText(entry.source);
    const firstPersonPlural = text.match(/\b(?:we|we['’](?:re|ve|ll)|us|our|ours|ourselves)\b/iu);
    if (firstPersonPlural) {
      report(
        errors,
        entry.file,
        `contains one-person-studio contradiction outside an explicit personal quote ${JSON.stringify(firstPersonPlural[0])}`,
      );
    }
    for (const forbidden of FORBIDDEN_CUSTOMER_INVENTIONS) {
      const match = text.match(forbidden.expression);
      if (match) {
        report(errors, entry.file, `contains ${forbidden.label} ${JSON.stringify(match[0])}`);
      }
    }
  }
}

function checkContactSelectionContract(source, errors) {
  const file = "vnext.css";
  for (const marker of [
    'a[href^="tel:"]',
    'a[href^="mailto:"]',
    "-webkit-user-select: text",
    "user-select: text",
  ]) {
    if (!source.includes(marker)) {
      report(errors, file, `missing selectable phone/email contract ${JSON.stringify(marker)}`);
    }
  }
}

function checkHomeDoors(source, errors) {
  const file = "index.html";
  const doors = markedElements(file, source, "data-home-door", errors);
  checkExactValues(file, "home doors", doors.map(({ value }) => value), HOME_DOORS, errors);
  for (const door of doors) {
    const expectedHref = HOME_DOOR_HREFS[door.value];
    if (door.name !== "a" || door.href !== expectedHref) {
      report(errors, file, `home door ${door.value} must be an anchor to ${expectedHref ?? "no route"}`);
    }
  }
  const lowerSource = source.toLocaleLowerCase("en-US");
  for (const phrase of HOME_HIVE_COPY) {
    if (!lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
      report(errors, file, `missing Hive conversation-versus-written-scope copy ${JSON.stringify(phrase)}`);
    }
  }
  for (const phrase of HOME_ABRACADABRA_COPY) {
    if (!lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
      report(errors, file, `missing plain-language Abracadabra state copy ${JSON.stringify(phrase)}`);
    }
  }
  if (!lowerSource.includes(HOME_EVIDENCE_COPY)) {
    report(errors, file, `missing exact home evidence disclosure ${JSON.stringify(HOME_EVIDENCE_COPY)}`);
  }
  for (const phrase of RETIRED_HOME_HIVE_COPY) {
    if (lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
      report(errors, file, `contains retired Hive product model ${JSON.stringify(phrase)}`);
    }
  }
}

function checkHiveCells(source, errors) {
  const file = "hive/index.html";
  const cells = markedElements(file, source, "data-hive-cell", errors);
  checkExactValues(file, "Hive planner cells", cells.map(({ value }) => value), HIVE_CELLS, errors);
}

function checkSolutionAnchors(source, errors) {
  const file = "solutions/index.html";
  const anchors = markedElements(file, source, "data-solution-anchor", errors);
  checkExactValues(file, "solution anchors", anchors.map(({ value }) => value), SOLUTION_ANCHORS, errors);
  for (const anchor of anchors) {
    if (anchor.id !== anchor.value) {
      report(errors, file, `solution anchor ${anchor.value} must carry matching id="${anchor.value}"`);
    }
  }
}

function checkStartPaths(source, errors) {
  const file = "start/index.html";
  const paths = markedElements(file, source, "data-start-path", errors);
  checkExactValues(file, "Start chooser paths", paths.map(({ value }) => value), START_PATHS, errors);
  for (const pathChoice of paths) {
    if (pathChoice.name !== "button" || pathChoice.href != null) {
      report(
        errors,
        file,
        `Start chooser path ${pathChoice.value} must be a button without navigation fallback`,
      );
    }
  }
  for (const marker of [
    '<h2 data-start-question tabindex="-1">',
    'data-start-result role="status" aria-live="polite" tabindex="-1"',
  ]) {
    if (!source.includes(marker)) {
      report(errors, file, `missing Start focus or live-region semantics ${JSON.stringify(marker)}`);
    }
  }
}

function checkStartDecisionLogic(source, errors) {
  const file = "vnext.js";
  for (const phrase of START_DECISION_COPY) {
    if (!source.includes(phrase)) {
      report(errors, file, `missing fail-closed Start decision marker ${JSON.stringify(phrase)}`);
    }
  }
  for (const forbidden of [
    'key: "abracadabra",\n            label: "Let me make it"',
    "Make a new one or replace the one I have.",
    "There is no existing site, URL inventory, or content that must survive.",
    "focusWithoutScroll",
  ]) {
    if (source.includes(forbidden)) {
      report(errors, file, `contains retired Start migration logic ${JSON.stringify(forbidden)}`);
    }
  }
}

function checkStartMotionContract(source, errors) {
  const file = "vnext.css";
  for (const marker of [
    "html.start-chooser-page",
    "overflow-anchor: none",
    ".js .start-chooser.reveal",
    "transition: none",
  ]) {
    if (!source.includes(marker)) {
      report(errors, file, `missing layout-stable Start chooser marker ${JSON.stringify(marker)}`);
    }
  }
}

function checkAbracadabraShowcaseCopy(source, errors) {
  const file = "abracadabra/abracadabra-showcase.js";
  const failureCopy = "The generated example did not open. Reload this page to try again.";
  if (source.split(failureCopy).length - 1 !== 2) {
    report(errors, file, "generated-example failure status must remain exact in both runtime paths");
  }
  if (!source.includes(" generated example ready.")) {
    report(errors, file, "missing exact generated-example success status");
  }
  if (source.toLocaleLowerCase("en-US").includes("live example")) {
    report(errors, file, "contains retired live-example runtime status");
  }
}

function checkPublicTruthCoherence(routeSources, errors) {
  for (const [route, phrases] of Object.entries(PUBLIC_TRUTH_COPY)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    for (const phrase of phrases) {
      if (!entry.source.includes(phrase)) {
        report(errors, entry.file, `missing filed-name or local-versus-hosted truth ${JSON.stringify(phrase)}`);
      }
    }
  }
  for (const { file, source } of routeSources.values()) {
    for (const phrase of RETIRED_PUBLIC_TRUTH_COPY) {
      if (source.includes(phrase)) {
        report(errors, file, `contains retired public-truth statement ${JSON.stringify(phrase)}`);
      }
    }
  }
}

function checkBusinessEmailCoherence(routeSources, errors) {
  for (const [route, phrases] of Object.entries(BUSINESS_EMAIL_COPY)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    for (const phrase of phrases) {
      if (!entry.source.includes(phrase)) {
        report(errors, entry.file, `missing business-email custody copy ${JSON.stringify(phrase)}`);
      }
    }
  }
  for (const { file, source } of routeSources.values()) {
    if (/personal mailbox as (?:its|your|the) public identity/iu.test(source)) {
      report(errors, file, "contains judgmental personal-mailbox copy");
    }
  }
}

function checkCustomCatalogSurface(source, errors) {
  const file = "custom/scope/index.html";
  const tiers = markedElements(file, source, "data-custom-tier", errors);
  checkExactValues(file, "Custom footprint tiers", tiers.map(({ value }) => value), CUSTOM_TIERS, errors);
  const creativity = markedElements(file, source, "data-creative-level", errors);
  checkExactValues(
    file,
    "Custom creative levels",
    creativity.map(({ value }) => value),
    CUSTOM_CREATIVITY,
    errors,
  );
  const creativeProofs = markedElements(file, source, "data-creative-proof", errors);
  checkExactValues(
    file,
    "Custom creative proof variants",
    creativeProofs.map(({ value }) => value),
    CUSTOM_CREATIVE_PROOFS,
    errors,
  );
  const components = markedElements(file, source, "data-custom-component", errors);
  checkExactValues(
    file,
    "Custom component shelf",
    components.map(({ value }) => value),
    CUSTOM_COMPONENTS,
    errors,
  );
  const scaleMarker = 'data-custom-tier="scale" data-pages="30" data-scale-base="flagship" data-scale-min-units="1" data-scale-max-units="15" data-scale-unit-pages="1" data-scale-unit-sections="4" data-scale-unit-layouts="1" data-scale-unit-words="500" data-scale-unit-media="4"';
  if (!source.includes(scaleMarker)) {
    report(errors, file, "Scale must expose the exact non-price Flagship-plus-capacity-unit rule");
  }
}

function checkCustomProcess(source, errors) {
  const file = "custom/process/index.html";
  const phases = markedElements(file, source, "data-process-phase", errors);
  checkExactValues(
    file,
    "Custom process phases",
    phases.map(({ value }) => value),
    CUSTOM_PROCESS_PHASES,
    errors,
  );
  const quoteFields = markedElements(file, source, "data-receipt-field", errors);
  checkExactValues(
    file,
    "Custom quote anatomy fields",
    quoteFields.map(({ value }) => value),
    CUSTOM_QUOTE_FIELDS,
    errors,
  );
  if (!source.includes('data-process-mechanics="review-change-schedule"')) {
    report(errors, file, "Custom process must retain explicit review, change, and schedule mechanics");
  }
}

function checkPaidRouteSectionContracts(routeSources, errors) {
  for (const [route, expectedContracts] of Object.entries(PAID_ROUTE_SECTION_CONTRACTS)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    let tags;
    let contractTags;
    try {
      tags = openingTags(entry.source);
      contractTags = tags.filter(({ name, attributes }) =>
        name === "section"
        || (
          route === "/solutions/"
          && name === "article"
          && attributes.has("data-solution-anchor")
        ));
    } catch (error) {
      report(errors, entry.file, error.message);
      continue;
    }
    const actualContracts = contractTags.map(({ attributes }) => [
      attributes.get("data-customer-job"),
      attributes.get("data-section-action") ?? "",
      attributes.get("data-section-evidence") ?? "",
    ].join("|"));
    checkExactValues(
      entry.file,
      "paid-route customer job, action, and evidence contracts",
      actualContracts,
      expectedContracts,
      errors,
    );
    for (const tag of tags.filter(({ attributes }) => attributes.has("data-customer-job"))) {
      if (tag.name !== "section" && tag.name !== "article") {
        report(
          errors,
          entry.file,
          `customer job ${JSON.stringify(tag.attributes.get("data-customer-job"))} must mark a section or article`,
        );
      }
    }

    const expectedTopics = PAID_ROUTE_INTAKE_TOPICS[route] ?? [];
    const intakeLinks = openingTags(entry.source)
      .filter(({ attributes }) => attributes.has("data-intake-topic"));
    const actualTopics = intakeLinks.map(({ attributes }) => attributes.get("data-intake-topic"));
    if (JSON.stringify(actualTopics) !== JSON.stringify(expectedTopics)) {
      report(
        errors,
        entry.file,
        `intake topics must exactly equal ${expectedTopics.join(", ")} in order; received ${actualTopics.join(", ")}`,
      );
    }
    for (const link of intakeLinks) {
      const topic = link.attributes.get("data-intake-topic");
      const expectedHref = `/contact/#about-${topic}`;
      if (link.name !== "a" || link.attributes.get("href") !== expectedHref) {
        report(
          errors,
          entry.file,
          `intake topic ${JSON.stringify(topic)} must be an anchor to ${expectedHref}`,
        );
      }
      if (!Object.prototype.hasOwnProperty.call(INTAKE_TOPIC_LABELS, topic)) {
        report(errors, entry.file, `intake topic ${JSON.stringify(topic)} is not allowlisted`);
      }
    }
    if (entry.source.includes('href="/contact/#direct-contact"')) {
      report(errors, entry.file, "contains a context-free paid-route contact handoff");
    }
    for (const phrase of PAID_ROUTE_REQUIRED_COPY[route] ?? []) {
      if (!entry.source.includes(phrase)) {
        report(
          errors,
          entry.file,
          `missing paid-route price, payment, timing, ownership, or domain boundary ${JSON.stringify(phrase)}`,
        );
      }
    }
  }

  const contact = routeSources.get("/contact/");
  if (contact) {
    const contexts = markedElements(contact.file, contact.source, "data-intake-context", errors);
    const targets = markedElements(contact.file, contact.source, "data-intake-topic-target", errors);
    if (contexts.length !== 1 || contexts[0].name !== "div") {
      report(errors, contact.file, "must contain one intake-context container");
    }
    checkExactValues(
      contact.file,
      "direct-contact intake targets",
      targets.map(({ value }) => value),
      Object.keys(INTAKE_TOPIC_LABELS),
      errors,
    );
    for (const target of targets) {
      if (
        target.name !== "li"
        || target.id !== `about-${target.value}`
        || target.tabindex !== "-1"
      ) {
        report(
          errors,
          contact.file,
          `intake target ${JSON.stringify(target.value)} must be a focusable list item with id="about-${target.value}"`,
        );
      }
    }
  }
}

function checkCssTypeFloor(file, source, errors) {
  const customProperties = new Map();
  for (const match of source.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;{}]+)/giu)) {
    customProperties.set(match[1], match[2].trim());
  }

  function resolveValue(raw, visited = new Set()) {
    const value = raw.trim().replace(/\s*!important\s*$/iu, "");
    const variable = /^var\(\s*(--[a-z0-9_-]+)(?:\s*,[\s\S]*)?\)$/iu.exec(value);
    if (!variable) return value;
    if (visited.has(variable[1]) || !customProperties.has(variable[1])) return null;
    visited.add(variable[1]);
    return resolveValue(customProperties.get(variable[1]), visited);
  }

  function firstFunctionArgument(value, name) {
    const prefix = `${name}(`;
    if (!value.toLocaleLowerCase("en-US").startsWith(prefix)) return null;
    let depth = 0;
    for (let index = prefix.length; index < value.length; index += 1) {
      if (value[index] === "(") depth += 1;
      else if (value[index] === ")") depth -= 1;
      else if (value[index] === "," && depth === 0) {
        return value.slice(prefix.length, index).trim();
      }
    }
    return null;
  }

  function pixels(value) {
    const resolved = resolveValue(value);
    if (!resolved) return null;
    const clampMinimum = firstFunctionArgument(resolved, "clamp");
    if (clampMinimum) return pixels(clampMinimum);
    const match = /^(-?[0-9]*\.?[0-9]+)\s*(px|rem|em|%)$/iu.exec(resolved);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    if (match[2].toLowerCase() === "px") return amount;
    if (match[2] === "%") return amount * 0.16;
    return amount * 16;
  }

  for (const declaration of source.matchAll(/\b(font-size|font)\s*:\s*([^;{}]+)/giu)) {
    const property = declaration[1].toLowerCase();
    const rawValue = declaration[2].trim();
    let candidate = rawValue;
    if (property === "font") {
      const functionValue = /(clamp\([^;{}]+\)|var\([^;{}]+\))/iu.exec(rawValue);
      const literalValue = /(-?[0-9]*\.?[0-9]+\s*(?:px|rem|em|%))/iu.exec(rawValue);
      candidate = functionValue?.[1] ?? literalValue?.[1] ?? "";
    }
    if (!candidate) continue;
    const computedPixels = pixels(candidate);
    if (computedPixels !== null && computedPixels < 12) {
      report(errors, file, `public text size ${JSON.stringify(candidate)} is below the 12px floor`);
    } else if (
      computedPixels === null
      && /^(?:var|calc|min|max)\(/iu.test(candidate)
    ) {
      report(errors, file, `public text size ${JSON.stringify(candidate)} cannot prove the 12px floor`);
    }
  }
}

function checkAboutTrust(source, errors) {
  const file = "about/index.html";
  const facts = markedElements(file, source, "data-about-trust", errors);
  checkExactValues(
    file,
    "About verified trust facts",
    facts.map(({ value }) => value),
    ABOUT_TRUST_FACTS,
    errors,
  );
  const proofs = markedElements(file, source, "data-about-proof", errors);
  checkExactValues(
    file,
    "About inspectable proof routes",
    proofs.map(({ value }) => value),
    ABOUT_PROOFS,
    errors,
  );
  const expectedHrefs = new Map([
    ["work", "/work/"],
    ["scope", "/custom/scope/"],
    ["abracadabra", "/abracadabra/app/"],
    ["hive", "/hive/"],
  ]);
  for (const proof of proofs) {
    if (proof.name !== "a" || proof.href !== expectedHrefs.get(proof.value)) {
      report(errors, file, `About proof ${proof.value} must link to ${expectedHrefs.get(proof.value)}`);
    }
  }
}

function checkWorkExternalProof(source, errors) {
  const file = "work/index.html";
  if (
    !source.includes('data-external-proof="scone-sourcery" data-proof-state="verified-founder-owned"')
  ) {
    report(errors, file, "featured Scone Sourcery proof must remain labeled as verified founder-owned work");
  }
  for (const phrase of [
    "Explore the live venture",
    "separate founder-owned venture, not a client engagement",
    "current interface and current business state",
  ]) {
    if (!source.includes(phrase)) {
      report(errors, file, `featured founder-owned proof is missing ${JSON.stringify(phrase)}`);
    }
  }
  let proofLinks = [];
  try {
    proofLinks = openingTags(source)
      .filter(({ attributes }) => attributes.has("data-external-proof-link"));
  } catch (error) {
    report(errors, file, error.message);
  }
  if (proofLinks.length !== 1) {
    report(errors, file, "featured founder-owned proof must contain exactly one marked external link");
    return;
  }
  const [proofLink] = proofLinks;
  if (
    proofLink.name !== "a"
    || proofLink.attributes.get("data-external-proof-link") !== "scone-sourcery"
    || proofLink.attributes.get("href") !== "https://sconesourcery.com/"
    || proofLink.attributes.get("rel") !== "external"
  ) {
    report(errors, file, "featured founder-owned proof link must be the exact Scone Sourcery external anchor");
  }
}

function checkInformationWayfinding(routeSources, errors) {
  for (const [route, expected] of [
    ["/legal/privacy/", PRIVACY_SECTION_IDS],
    ["/legal/website-terms/", TERMS_SECTION_IDS],
  ]) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    let sections = [];
    try {
      sections = openingTags(entry.source)
        .filter(({ name, attributes }) => name === "h2" && attributes.has("id"))
        .map(({ attributes }) => attributes.get("id"));
    } catch (error) {
      report(errors, entry.file, error.message);
    }
    checkExactValues(entry.file, "stable legal section ids", sections, expected, errors);
  }

  const faq = routeSources.get("/faq/");
  if (!faq) return;
  const anchors = markedElements(faq.file, faq.source, "data-faq-anchor", errors);
  checkExactValues(faq.file, "stable FAQ anchors", anchors.map(({ value }) => value), FAQ_ANCHORS, errors);
  for (const anchor of anchors) {
    if (anchor.name !== "details" || anchor.id !== anchor.value) {
      report(errors, faq.file, `FAQ anchor ${anchor.value} must be a details element with matching id`);
    }
  }
}

function checkAbracadabraProductCoherence(routeSources, errors) {
  for (const [route, requiredPhrases] of Object.entries(ABRACADABRA_PRODUCT_COPY)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const lowerSource = entry.source.toLocaleLowerCase("en-US");
    for (const phrase of requiredPhrases) {
      if (!lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
        report(errors, entry.file, `missing Abracadabra product-coherence copy ${JSON.stringify(phrase)}`);
      }
    }
    for (const phrase of RETIRED_ABRACADABRA_PRODUCT_COPY) {
      if (lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
        report(errors, entry.file, `contains retired Abracadabra product model ${JSON.stringify(phrase)}`);
      }
    }
  }

  const landing = routeSources.get("/abracadabra/");
  if (landing) {
    const firstAction = landing.source.indexOf('href="/abracadabra/app/#workroom"');
    const hero = firstAction >= 0 ? landing.source.slice(0, firstAction) : "";
    for (const phrase of [
      "One-page website maker",
      "Make your preview for $5.",
      "Abracadabra ends at the preview.",
      "your $5 comes off Alacazam",
    ]) {
      if (!hero.includes(phrase)) {
        report(errors, landing.file, `missing above-fold Abracadabra product truth ${JSON.stringify(phrase)}`);
      }
    }
    const firstContentSection = landing.source.indexOf('<section class="section abracadabra-looks">');
    const heroAndProof = firstContentSection >= 0
      ? landing.source.slice(0, firstContentSection)
      : "";
    for (const phrase of ["Paid preview", "Credited forward", "No account", "Nothing published"]) {
      if (!heroAndProof.includes(phrase)) {
        report(errors, landing.file, `missing above-fold local-only proof ${JSON.stringify(phrase)}`);
      }
    }
    if (landing.source.toLocaleLowerCase("en-US").includes("live example")) {
      report(errors, landing.file, "contains retired live-example wording for a generated srcdoc demonstration");
    }
    const pathCardCopy = "Make the preview for $5 and see your own page. Continue to Alacazam only if you like it.";
    if (landing.source.split(pathCardCopy).length - 1 !== 1) {
      report(errors, landing.file, "Abracadabra path-card proof paragraph must appear exactly once");
    }
  }

  for (const route of ["/abracadabra/", "/abracadabra/how/"]) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const journeys = markedElements(entry.file, entry.source, "data-abracadabra-journey", errors);
    checkExactValues(
      entry.file,
      "Abracadabra preview-then-Alacazam journey markers",
      journeys.map(({ value }) => value),
      ["paid-preview-then-alacazam"],
      errors,
    );
  }
  for (const route of ["/abracadabra/", "/abracadabra/how/"]) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const stateModels = markedElements(entry.file, entry.source, "data-abracadabra-state-model", errors);
    checkExactValues(
      entry.file,
      "Abracadabra editor-project state markers",
      stateModels.map(({ value }) => value),
      ["editor-project"],
      errors,
    );
  }
}

function checkCanonicalPublicEmail(file, source, errors) {
  const emails = source.match(/\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu) ?? [];
  for (const email of emails) {
    if (email !== CANONICAL_MAILBOX) {
      report(errors, file, `alternate public email is forbidden: ${email}`);
    }
  }
}

function checkContactTruth(file, source, errors) {
  for (const marker of [
    CANONICAL_PHONE.display,
    CANONICAL_PHONE.tel,
    CANONICAL_MAILBOX,
    LEGAL_SELLER,
    BRAND_IDENTITY_DISCLOSURE,
  ]) {
    if (!source.includes(marker)) report(errors, file, `missing exact global marker ${JSON.stringify(marker)}`);
  }

  const displayedPhones = source.match(/\(?\d{3}\)?[ .-]+\d{3}[ .-]+\d{4}\b/gu) ?? [];
  for (const phone of displayedPhones) {
    if (phone !== CANONICAL_PHONE.display) {
      report(errors, file, `alternate phone display is forbidden: ${phone}`);
    }
  }
  const compactPhones = source.match(/\b\d{10,11}\b/gu) ?? [];
  for (const phone of compactPhones) {
    if (phone !== "18562441220") report(errors, file, `alternate compact phone is forbidden: ${phone}`);
  }
}

function checkInteractions(file, route, source, errors) {
  if (/\bcontenteditable\s*=/iu.test(source)) report(errors, file, "contenteditable regions are forbidden");
  if (/<(?:button|input)\b[^>]*\btype\s*=\s*["']?(?:submit|image)\b/iu.test(source)) {
    report(errors, file, "submit controls are forbidden");
  }
  if (/\bformaction\s*=/iu.test(source)) report(errors, file, "formaction controls are forbidden");
  const controls = source.match(/<(?:input|select|textarea)\b/giu) ?? [];
  if (route !== "/abracadabra/app/" && controls.length !== 0) {
    report(errors, file, "input, select, and textarea controls are allowed only on reviewed Abracadabra app routes");
  }
}

function checkMainFocusTarget(file, source, errors) {
  let elements;
  try {
    elements = openingTags(source);
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const main = elements.find(({ name, attributes }) =>
    name === "main" && attributes.get("id") === "main"
  );
  if (!main) {
    report(errors, file, 'must contain <main id="main"> for the skip link');
    return;
  }
  if (main.attributes.get("tabindex") !== "-1") {
    report(errors, file, 'main skip target must carry tabindex="-1"');
  }
}

function checkPublicSource(file, source, { route = null } = {}, errors) {
  if (/<form\b/iu.test(source)) report(errors, file, "form elements are forbidden");
  for (const { label, expression } of PROHIBITED_COPY) {
    const match = source.match(expression);
    if (match) report(errors, file, `contains ${label}: ${JSON.stringify(match[0])}`);
  }
  // Public prices are shown, not hidden — the owner's call, reversing an
  // agent-introduced rule that allowed no figure but $5 anywhere on the site.
  // The guard still exists, but it now checks the opposite thing: every price a
  // page prints must be a real price from data/public-catalog.json. That still
  // catches the failure the original rule was aimed at — a page inventing a
  // number, or drifting after the catalog is repriced — without forcing the
  // site to keep its own prices secret.
  for (const price of source.match(PRICE) ?? []) {
    const amount = Number(price.replace(/[^\d.]/gu, ""));
    if (!Number.isFinite(amount) || !CATALOG_PRICES.has(amount)) {
      report(
        errors,
        file,
        `contains a public price that is not in data/public-catalog.json: ${JSON.stringify(price)}`,
      );
    }
  }
  const priceAttribute = source.match(PRICE_ATTRIBUTE);
  if (priceAttribute) report(errors, file, `contains public price-bearing attribute: ${JSON.stringify(priceAttribute[0])}`);
  const offer = source.match(OFFER);
  if (offer) report(errors, file, `contains active Offer data: ${JSON.stringify(offer[0])}`);
  const payment = source.match(PAYMENT_ENDPOINT);
  if (payment) report(errors, file, `contains payment endpoint: ${JSON.stringify(payment[0])}`);
  const network = source.match(NETWORK_SINK);
  if (network) report(errors, file, `contains network sink: ${JSON.stringify(network[0])}`);
  const externalModule = source.match(EXTERNAL_MODULE);
  if (externalModule) report(errors, file, `contains external module sink: ${JSON.stringify(externalModule[0])}`);
  const submission = source.match(SUBMISSION_SINK);
  if (submission) report(errors, file, `contains submission sink: ${JSON.stringify(submission[0])}`);
  const storage = source.match(STORAGE_SINK);
  if (storage && !STORAGE_ALLOWED_FILES.has(file)) {
    report(errors, file, `contains client storage sink: ${JSON.stringify(storage[0])}`);
  }
  const dynamicResource = source.match(DYNAMIC_RESOURCE_SINK);
  if (dynamicResource) report(errors, file, `contains dynamic resource sink: ${JSON.stringify(dynamicResource[0])}`);
  const fileAccess = source.match(FILE_ACCESS);
  if (fileAccess) report(errors, file, `contains file/upload access: ${JSON.stringify(fileAccess[0])}`);
  if (path.extname(file).toLowerCase() === ".html") checkInteractions(file, route, source, errors);
}

function checkCssReferences(file, source, publicFiles, errors) {
  if (/@import\b/iu.test(source)) report(errors, file, "CSS @import is forbidden");
  for (const match of source.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/giu)) {
    const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!reference || reference.startsWith("#") || reference.startsWith("data:")) continue;
    if (reference.startsWith("//")) {
      report(errors, file, `external CSS resource is forbidden: ${reference}`);
      continue;
    }
    let pathname = reference.split(/[?#]/u)[0];
    if (/^https?:/iu.test(reference)) {
      let url;
      try {
        url = new URL(reference);
      } catch {
        report(errors, file, `invalid CSS resource: ${reference}`);
        continue;
      }
      if (url.origin !== SITE_ORIGIN) {
        report(errors, file, `external CSS resource is forbidden: ${reference}`);
        continue;
      }
      pathname = url.pathname;
    }
    if (reference.includes("?")) report(errors, file, `CSS resource queries are forbidden: ${reference}`);
    const target = pathname.startsWith("/")
      ? path.posix.normalize(pathname.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname));
    if (target.startsWith("../") || !publicFiles.has(target)) {
      report(errors, file, `missing or escaped CSS resource: ${reference}`);
    }
  }
}

function checkEmbeddedStyles(file, source, publicFiles, errors) {
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    checkCssReferences(file, match[1], publicFiles, errors);
    checkCssTypeFloor(file, match[1], errors);
  }
  let elements;
  try {
    elements = openingTags(source);
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  for (const { attributes } of elements) {
    for (const [name, value] of attributes) {
      if (name === "style") checkCssTypeFloor(file, `.inline { ${value} }`, errors);
      if (name === "font-size") checkCssTypeFloor(file, `.svg-text { font-size: ${value}; }`, errors);
      if (CSS_VALUE_ATTRIBUTES.has(name) && value.includes("url(")) {
        checkCssReferences(file, value, publicFiles, errors);
      }
    }
  }
}

function checkSvgReferences(file, source, publicFiles, errors) {
  let elements;
  try {
    elements = openingTags(source);
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const ids = new Set(elements.map(({ attributes }) => attributes.get("id")).filter(Boolean));
  for (const { attributes } of elements) {
    for (const attribute of ["href", "src", "xlink:href"]) {
      if (!attributes.has(attribute)) continue;
      const reference = attributes.get(attribute);
      if (!reference) {
        report(errors, file, `${attribute} must not be empty`);
        continue;
      }
      if (reference.startsWith("#")) {
        if (!ids.has(reference.slice(1))) report(errors, file, `missing SVG fragment ${reference}`);
        continue;
      }
      if (reference.startsWith("data:")) continue;
      let target;
      try {
        target = new URL(reference, new URL(`/${file}`, `${SITE_ORIGIN}/`));
      } catch {
        report(errors, file, `invalid SVG ${attribute}: ${reference}`);
        continue;
      }
      if (target.origin !== SITE_ORIGIN) {
        report(errors, file, `external SVG ${attribute} is forbidden: ${reference}`);
        continue;
      }
      if (target.search) report(errors, file, `SVG ${attribute} queries are forbidden: ${reference}`);
      if (CANONICAL_ROUTES.includes(target.pathname)) continue;
      let targetFile;
      try {
        targetFile = decodeURIComponent(target.pathname).replace(/^\//u, "");
      } catch {
        report(errors, file, `invalid SVG ${attribute}: ${reference}`);
        continue;
      }
      if (!publicFiles.has(targetFile)) report(errors, file, `missing SVG resource: ${reference}`);
    }
  }
}

function skipWhitespace(text, cursor) {
  while (cursor.index < text.length && /\s/u.test(text[cursor.index])) cursor.index += 1;
}

function parseStringToken(text, cursor) {
  const start = cursor.index;
  cursor.index += 1;
  let escaped = false;
  while (cursor.index < text.length) {
    const character = text[cursor.index];
    cursor.index += 1;
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      return JSON.parse(text.slice(start, cursor.index));
    }
  }
  throw new Error("JSON string is unterminated");
}

function scanJsonValue(text, cursor, depth = 0) {
  if (depth > 32) throw new Error("JSON is too deeply nested");
  skipWhitespace(text, cursor);
  const character = text[cursor.index];
  if (character === "{") {
    cursor.index += 1;
    const keys = new Set();
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== '"') throw new Error("JSON object key syntax is invalid");
      const key = parseStringToken(text, cursor);
      if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
      if (PROHIBITED_JSON_KEYS.has(key)) throw new Error(`prohibited JSON key: ${key}`);
      keys.add(key);
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== ":") throw new Error("JSON object is missing a colon");
      cursor.index += 1;
      scanJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "}") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") throw new Error("JSON object separator is invalid");
      cursor.index += 1;
    }
    throw new Error("JSON object is unterminated");
  }
  if (character === "[") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      scanJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "]") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") throw new Error("JSON array separator is invalid");
      cursor.index += 1;
    }
    throw new Error("JSON array is unterminated");
  }
  if (character === '"') {
    parseStringToken(text, cursor);
    return;
  }
  const start = cursor.index;
  while (cursor.index < text.length && !/[\s,\]}]/u.test(text[cursor.index])) cursor.index += 1;
  if (cursor.index === start) throw new Error("JSON value syntax is invalid");
  JSON.parse(text.slice(start, cursor.index));
}

function parseStrictJson(text) {
  if (Buffer.byteLength(text) > 128 * 1024) throw new Error("JSON exceeds 128 KiB");
  const cursor = { index: 0 };
  scanJsonValue(text, cursor);
  skipWhitespace(text, cursor);
  if (cursor.index !== text.length) throw new Error("JSON has trailing content");
  return JSON.parse(text);
}

function checkFalseAllows(value, trail, errors) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = `${trail}.${key}`;
    if (key.startsWith("allows") && child !== false) {
      report(errors, "data/release-control.json", `${nextTrail} must be false`);
    }
    checkFalseAllows(child, nextTrail, errors);
  }
}

async function checkReleaseControl(root, errors) {
  const file = "data/release-control.json";
  let control;
  try {
    control = parseStrictJson(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    report(errors, file, `must be strict JSON: ${error.message}`);
    return;
  }
  if (!control || typeof control !== "object" || Array.isArray(control)) {
    report(errors, file, "root must be an object");
    return;
  }
  if (control.state !== "hold") report(errors, file, "state must be hold");
  for (const flag of REQUIRED_RELEASE_FLAGS) {
    if (!Object.hasOwn(control, flag) || control[flag] !== false) {
      report(errors, file, `${flag} must exist and be false`);
    }
  }
  checkFalseAllows(control, "$", errors);
  const publicTruth = control.publicTruthReconciliation;
  if (!publicTruth || typeof publicTruth !== "object" || Array.isArray(publicTruth)) {
    report(errors, file, "publicTruthReconciliation must be an object");
    return;
  }
  if (publicTruth.state !== "hold") report(errors, file, "publicTruthReconciliation.state must be hold");
  if (publicTruth.approvedCandidateSha !== null) {
    report(errors, file, "publicTruthReconciliation.approvedCandidateSha must be null");
  }
  if (publicTruth.authorityReceiptSha256 !== null) {
    report(errors, file, "publicTruthReconciliation.authorityReceiptSha256 must be null");
  }
}

async function check404(root, publicFiles, errors) {
  const file = "404.html";
  if (!publicFiles.has(file)) {
    report(errors, file, "missing public 404 page");
    return;
  }
  const source = await readFile(path.join(root, file), "utf8");
  checkMainFocusTarget(file, source, errors);
  const h1Count = (source.match(/<h1\b[^>]*>/giu) ?? []).length;
  if (h1Count !== 1) report(errors, file, `must contain exactly one h1; found ${h1Count}`);
  let hasNoindex = false;
  try {
    hasNoindex = openingTags(source).some(({ name, attributes }) =>
      name === "meta"
      && (attributes.get("name") ?? "").toLowerCase() === "robots"
      && (attributes.get("content") ?? "").toLowerCase().split(/[\s,]+/u).includes("noindex")
    );
  } catch (error) {
    report(errors, file, error.message);
  }
  if (!hasNoindex) report(errors, file, "must carry a robots noindex directive");
}

function checkPublicAllowlist(errors) {
  if (publicFileAllowlist.length !== PUBLIC_ALLOWLIST_COUNT) {
    report(
      errors,
      "scripts/build-pages.mjs",
      `public file allowlist must contain exactly ${PUBLIC_ALLOWLIST_COUNT} entries; found ${publicFileAllowlist.length}`,
    );
  }
  const sorted = [...publicFileAllowlist].sort(lexical);
  if (JSON.stringify(publicFileAllowlist) !== JSON.stringify(sorted)) {
    report(errors, "scripts/build-pages.mjs", "public file allowlist must remain bytewise sorted");
  }
  if (new Set(publicFileAllowlist).size !== publicFileAllowlist.length) {
    report(errors, "scripts/build-pages.mjs", "public file allowlist must not contain duplicates");
  }
  const excluded = new Set(EXCLUDED_ARTIFACT_TOP_LEVEL);
  for (const file of publicFileAllowlist) {
    if (
      typeof file !== "string"
      || file === ""
      || file.startsWith("/")
      || file.includes("\\")
      || path.posix.normalize(file) !== file
      || file.split("/").includes("..")
    ) {
      report(errors, "scripts/build-pages.mjs", `invalid public allowlist path ${JSON.stringify(file)}`);
      continue;
    }
    if (excluded.has(file.split("/")[0])) {
      report(errors, "scripts/build-pages.mjs", `public allowlist crosses excluded boundary: ${file}`);
    }
  }

  const expectedHtml = [
    "404.html",
    ...Object.values(CANONICAL_ROUTE_FILES),
    ...Object.values(FUNCTIONAL_APP_ROUTE_FILES),
    ...Object.keys(LEGACY_REDIRECTS).filter((file) => file !== SOURCE_ONLY_LEGACY_REDIRECT),
  ].sort(lexical);
  const actualHtml = publicFileAllowlist.filter((file) => file.endsWith(".html"));
  if (JSON.stringify(actualHtml) !== JSON.stringify(expectedHtml)) {
    report(
      errors,
      "scripts/build-pages.mjs",
      "public HTML allowlist must exactly contain canonical routes, 404, and artifact legacy redirects",
    );
  }
  if (publicFileAllowlist.includes(SOURCE_ONLY_LEGACY_REDIRECT)) {
    report(errors, "scripts/build-pages.mjs", `${SOURCE_ONLY_LEGACY_REDIRECT} must remain source-only`);
  }
  return new Set(publicFileAllowlist);
}

async function compareArtifact(root, routeResult, errors) {
  if (JSON.stringify(excludedTopLevel) !== JSON.stringify(EXCLUDED_ARTIFACT_TOP_LEVEL)) {
    report(errors, "scripts/build-pages.mjs", "artifact exclusion list does not match the locked vNext contract");
    return;
  }
  let temporary;
  try {
    temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-vnext-"));
    const output = path.join(temporary, "artifact");
    buildPagesArtifact({ root, output });
    const topLevel = new Set((await readdir(output)).sort(lexical));
    for (const excluded of EXCLUDED_ARTIFACT_TOP_LEVEL) {
      if (topLevel.has(excluded)) report(errors, "_site", `built artifact includes excluded top-level entry ${excluded}`);
    }
    const artifactEntries = await walkFiles(output);
    for (const entry of artifactEntries) {
      if (entry.kind !== "file") report(errors, `_site/${entry.relative}`, `unsupported artifact entry: ${entry.kind}`);
    }
    const artifactFiles = artifactEntries
      .filter(({ kind }) => kind === "file")
      .map(({ relative }) => relative)
      .sort(lexical);
    const expectedFiles = [...publicFileAllowlist];
    if (JSON.stringify(artifactFiles) !== JSON.stringify(expectedFiles)) {
      report(errors, "_site", "built artifact file ledger differs from the exact public allowlist");
    }
    let artifactTotalBytes = 0;
    for (const file of expectedFiles.filter((entry) => artifactFiles.includes(entry))) {
      const [sourceBytes, artifactBytes] = await Promise.all([
        readFile(path.join(root, file)),
        readFile(path.join(output, file)),
      ]);
      if (!sourceBytes.equals(artifactBytes)) report(errors, `_site/${file}`, "built bytes differ from source");
      artifactTotalBytes += artifactBytes.length;
      const extension = path.extname(file).toLowerCase();
      const category = extension === ".html"
        ? "html"
        : extension === ".css"
          ? "css"
          : extension === ".js"
            ? "javascript"
            : [".ico", ".png", ".svg", ".webp"].includes(extension)
              ? "image"
              : null;
      if (category && artifactBytes.length > ARTIFACT_SIZE_BUDGETS[category]) {
        report(
          errors,
          `_site/${file}`,
          `${category} performance budget is ${ARTIFACT_SIZE_BUDGETS[category]} bytes; `
          + `received ${artifactBytes.length}`,
        );
      }
    }
    if (artifactTotalBytes > ARTIFACT_SIZE_BUDGETS.total) {
      report(
        errors,
        "_site",
        `total performance budget is ${ARTIFACT_SIZE_BUDGETS.total} bytes; `
        + `received ${artifactTotalBytes}`,
      );
    }
    const artifactRoutes = await validateRouteContract(output);
    if (routeResult.ok) {
      const routeErrors = new Set(artifactRoutes.errors);
      if (!routeErrors.delete(EXPECTED_ARTIFACT_ROUTE_ERROR)) {
        report(errors, "_site", "artifact route validation did not preserve the expected source-only thanks omission");
      }
      for (const error of routeErrors) report(errors, "_site", error);
    }
    if (artifactRoutes.counts.canonicalRoutes !== CANONICAL_ROUTES.length) {
      report(errors, "_site", "artifact must contain every canonical route");
    }
    if (artifactRoutes.counts.legacyRedirects !== Object.keys(LEGACY_REDIRECTS).length - 1) {
      report(errors, "_site", "artifact must contain every allowlisted legacy redirect and omit only thanks.html");
    }
    for (const [route, file] of Object.entries(CANONICAL_ROUTE_FILES)) {
      if (!artifactFiles.includes(file) || !routeResult.sources.has(route)) {
        report(errors, "_site", `canonical route ${route} was not validated through exact source bytes`);
      }
    }
  } catch (error) {
    report(errors, "_site", `artifact validation failed: ${error.message}`);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export async function validateSiteVnext(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const errors = [];
  const routeResult = await validateRouteContract(absoluteRoot);
  errors.push(...routeResult.errors);

  const sourceFiles = checkPublicAllowlist(errors);
  const sourceEntries = new Map(
    routeResult.files.map(({ relative, kind }) => [relative, kind]),
  );
  const availableSourceFiles = new Set();
  for (const file of sourceFiles) {
    if (sourceEntries.get(file) === "file") {
      availableSourceFiles.add(file);
    } else {
      report(errors, file, "allowlisted public source must exist as a regular file");
    }
  }

  for (const [route, { file, source }] of routeResult.sources) {
    if (!sourceFiles.has(file)) continue;
    checkContactTruth(file, source, errors);
    checkCanonicalPublicEmail(file, source, errors);
    checkMainFocusTarget(file, source, errors);
    checkPublicSource(file, source, { route }, errors);
    checkEmbeddedStyles(file, source, sourceFiles, errors);
  }

  const home = routeResult.sources.get("/")?.source;
  if (home) checkHomeDoors(home, errors);
  const hive = routeResult.sources.get("/hive/")?.source;
  if (hive) checkHiveCells(hive, errors);
  const solutions = routeResult.sources.get("/solutions/")?.source;
  if (solutions) checkSolutionAnchors(solutions, errors);
  const start = routeResult.sources.get("/start/")?.source;
  if (start) checkStartPaths(start, errors);
  if (availableSourceFiles.has("vnext.js")) {
    checkStartDecisionLogic(await readFile(path.join(absoluteRoot, "vnext.js"), "utf8"), errors);
  }
  const customScope = routeResult.sources.get("/custom/scope/")?.source;
  if (customScope) checkCustomCatalogSurface(customScope, errors);
  const customProcess = routeResult.sources.get("/custom/process/")?.source;
  if (customProcess) checkCustomProcess(customProcess, errors);
  checkPaidRouteSectionContracts(routeResult.sources, errors);
  const about = routeResult.sources.get("/about/")?.source;
  if (about) checkAboutTrust(about, errors);
  const work = routeResult.sources.get("/work/")?.source;
  if (work) checkWorkExternalProof(work, errors);
  checkCustomerSections(routeResult.sources, errors);
  checkCustomerEvidence(routeResult.sources, errors);
  checkIntakeCongruence(routeResult.sources, errors);
  checkTargetCustomerClaims(routeResult.sources, errors);
  checkInformationWayfinding(routeResult.sources, errors);
  checkAbracadabraProductCoherence(routeResult.sources, errors);
  checkPublicTruthCoherence(routeResult.sources, errors);
  checkBusinessEmailCoherence(routeResult.sources, errors);

  for (const file of [...sourceFiles].sort(lexical)) {
    if (!availableSourceFiles.has(file)) continue;
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    if ([...routeResult.sources.values()].some((entry) => entry.file === file)) continue;
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    checkCanonicalPublicEmail(file, source, errors);
    const functionalRoute = Object.entries(FUNCTIONAL_APP_ROUTE_FILES)
      .find(([, routeFile]) => routeFile === file)?.[0] ?? null;
    checkPublicSource(file, source, { route: functionalRoute }, errors);
    if (extension === ".css") {
      checkCssReferences(file, source, sourceFiles, errors);
      checkCssTypeFloor(file, source, errors);
      if (file === "vnext.css") {
        checkStartMotionContract(source, errors);
        checkContactSelectionContract(source, errors);
      }
    }
    if (file === "abracadabra/abracadabra-showcase.js") {
      checkAbracadabraShowcaseCopy(source, errors);
    }
    if (extension === ".html" || extension === ".svg") {
      checkEmbeddedStyles(file, source, sourceFiles, errors);
    }
    if (extension === ".svg") checkSvgReferences(file, source, sourceFiles, errors);
  }
  for (const file of sourceFiles) {
    for (const { label, expression } of PROHIBITED_COPY) {
      const match = file.match(expression);
      if (match) report(errors, file, `public path contains ${label}: ${JSON.stringify(match[0])}`);
    }
  }

  await check404(absoluteRoot, availableSourceFiles, errors);
  await checkReleaseControl(absoluteRoot, errors);
  await compareArtifact(absoluteRoot, routeResult, errors);

  const uniqueErrors = [...new Set(errors)].sort(lexical);
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    counts: {
      canonicalRoutes: routeResult.counts.canonicalRoutes,
      legacyRedirects: routeResult.counts.legacyRedirects,
      homeDoors: home ? markedElements("index.html", home, "data-home-door", []).length : 0,
      hiveCells: hive ? markedElements("hive/index.html", hive, "data-hive-cell", []).length : 0,
      solutionAnchors: solutions ? markedElements("solutions/index.html", solutions, "data-solution-anchor", []).length : 0,
      artifactFiles: publicFileAllowlist.length,
    },
  };
}

export async function runSiteVnextCli(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/check-site-vnext.mjs --historical-inspection [site-root]");
    console.log("Retired inspector only; current release authority is npm test.");
    return 0;
  }
  if (!argv.includes("--historical-inspection")) {
    console.error(
      "check-site-vnext is retired and is not a current release gate. "
      + "Run npm test, or pass --historical-inspection to inspect the obsolete contract.",
    );
    return 2;
  }
  const positional = argv.filter((argument) => argument !== "--historical-inspection");
  if (positional.length > 1) {
    console.error("check-site-vnext: expected zero or one site-root argument");
    return 2;
  }
  try {
    const result = await validateSiteVnext(positional[0] ?? process.cwd());
    if (!result.ok) {
      console.error(`SiteSourcery vNext checks failed (${result.errors.length}):`);
      for (const error of result.errors) console.error(`- ${error}`);
      return 1;
    }
    console.log(
      `SiteSourcery vNext checks passed: ${result.counts.canonicalRoutes} canonical routes, `
      + `${result.counts.legacyRedirects} legacy redirects, ${result.counts.homeDoors} home doors, `
      + `${result.counts.hiveCells} Hive cells, ${result.counts.solutionAnchors} solution anchors; `
      + "reviewed local-storage/no-network boundaries, release holds, and built-artifact boundary verified.",
    );
    return 0;
  } catch (error) {
    console.error(`check-site-vnext: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSiteVnextCli();
}
