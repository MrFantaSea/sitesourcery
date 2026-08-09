import { createHash } from "node:crypto";

import {
  clone,
  deepFreeze,
  digest,
  invariant
} from "../commerce-v2/canonical.mjs";
import {
  verifyAlakazam50Configuration
} from "../commerce-v2/alakazam-50.mjs";

export const ALAKAZAM_50_COMPILER_SCHEMA =
  "abracadabra.alakazam-50/v1";
export const ALAKAZAM_50_ARTIFACT_SET_SCHEMA =
  "sitesourcery.alakazam-50-artifact/v1";

const FONT_CSS = Object.freeze({
  inherit: "",
  editorial: [
    'body{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}',
    '.eyebrow,.action,.facts,.sitebar{font-family:Inter,ui-sans-serif,system-ui,sans-serif}'
  ].join(""),
  studio: [
    'body{font-family:"Avenir Next",Avenir,"Segoe UI",ui-sans-serif,system-ui,sans-serif}',
    'h1,h2{font-family:"Avenir Next Condensed","Arial Narrow","Segoe UI",sans-serif;font-weight:700;letter-spacing:-.035em}'
  ].join("")
});
const BORDER_CSS = Object.freeze({
  soft: "",
  sharp: [
    ":root{--radius:0}",
    ".action{border-radius:0}",
    ".offers li,.facts>div,.section .wrap{border-radius:0}",
    ".offers li,.facts>div{border-width:2px}"
  ].join(""),
  ornate: [
    ":root{--radius:12px}",
    "body{outline:3px double var(--line);outline-offset:-10px}",
    ".offers li,.facts>div{border-width:3px;border-style:double;border-color:var(--accent)}",
    ".action{box-shadow:0 0 0 3px var(--paper),0 0 0 5px var(--accent)}"
  ].join("")
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function exactAuthority(authority, configuration) {
  invariant(
    authority?.policy?.tierId === "alakazam_50" &&
      [
        "border_controls",
        "cash_app_link",
        "extended_font_controls",
        "site_menu",
        "venmo_link"
      ].every((capability) =>
        authority.policy.capabilities?.includes(capability)
      ) &&
      authority.policy.limits?.careClass === "more" &&
      authority.policy.limits?.fontControls === "extended" &&
      authority.policy.limits?.borderControls === "extended" &&
      authority.subscriptionId === configuration.subscriptionId &&
      authority.subscriptionRevision ===
        configuration.subscriptionRevision,
    "ALAKAZAM_50_AUTHORITY_INVALID",
    "The exact current Alakazam $50 authority is required.",
    { status: 409 }
  );
}

function injectStyle(html, configuration) {
  const marker = "</style>";
  invariant(
    html.includes(marker),
    "ALAKAZAM_50_COMPILER_OUTPUT_INVALID",
    "The reviewed Alakazam output has no style boundary.",
    { status: 500 }
  );
  const css =
    FONT_CSS[configuration.fontChoiceId] +
    BORDER_CSS[configuration.borderChoiceId];
  return css.length === 0 ? html : html.replace(marker, `${css}${marker}`);
}

function injectPaymentLinks(html, configuration) {
  const actions = [];
  if (configuration.cashAppHandle !== null) {
    const handle = escapeHtml(configuration.cashAppHandle);
    actions.push(
      `<a class="action" href="https://cash.app/$${handle}" ` +
      `target="_blank" rel="noopener noreferrer">Cash App $${handle}</a>`
    );
  }
  if (configuration.venmoHandle !== null) {
    const handle = escapeHtml(configuration.venmoHandle);
    actions.push(
      `<a class="action" href="https://venmo.com/u/${handle}" ` +
      `target="_blank" rel="noopener noreferrer">Venmo @${handle}</a>`
    );
  }
  if (actions.length === 0) return html;
  const start = html.indexOf(
    '<section class="section contact" id="contact">'
  );
  const end = start < 0 ? -1 : html.indexOf("</section>", start);
  const insertion = end < 0 ? -1 : html.lastIndexOf("</div>", end);
  invariant(
    start >= 0 && end > start && insertion > start,
    "ALAKAZAM_50_CONTACT_REQUIRED",
    "Enable the Contact section before adding payment links.",
    { status: 409 }
  );
  return (
    html.slice(0, insertion) +
    `<div class="actions alakazam-50-payments">${actions.join("")}</div>` +
    html.slice(insertion)
  );
}

function applyMenu(html, menu) {
  for (const item of menu) {
    invariant(
      html.includes(`id="${item.target}"`),
      "ALAKAZAM_50_MENU_TARGET_UNAVAILABLE",
      "The configured Alakazam $50 menu targets a hidden section.",
      { status: 409 }
    );
  }
  const markup =
    '<nav aria-label="Page">' +
    menu.map((item) =>
      `<a href="#${item.target}">${escapeHtml(item.label)}</a>`
    ).join("") +
    "</nav>";
  const navigation = /<nav aria-label="Page">[\s\S]*?<\/nav>/u;
  invariant(
    navigation.test(html),
    "ALAKAZAM_50_MENU_TARGET_UNAVAILABLE",
    "The reviewed Alakazam output has no configurable menu boundary.",
    { status: 409 }
  );
  return html.replace(navigation, markup);
}

function injectProvenance(html, configuration, artifactSetDigest) {
  const marker = "</head>";
  invariant(
    html.includes(marker),
    "ALAKAZAM_50_COMPILER_OUTPUT_INVALID",
    "The reviewed Alakazam output has no provenance boundary.",
    { status: 500 }
  );
  return html.replace(
    marker,
    `<meta name="sitesourcery-alakazam-50-configuration" content="${configuration.configurationDigest}">` +
      `<meta name="sitesourcery-alakazam-50-artifact-set" content="${artifactSetDigest}">` +
      marker
  );
}

export function createAlakazam50Compiler({ baseCompiler } = {}) {
  invariant(
    baseCompiler && typeof baseCompiler.compileAlakazam === "function",
    "ALAKAZAM_50_COMPILER_UNAVAILABLE",
    "The Alakazam $35 fulfillment compiler is required for $50.",
    { status: 503 }
  );
  return Object.freeze({
    schema: ALAKAZAM_50_COMPILER_SCHEMA,
    compile(input) {
      invariant(
        input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          JSON.stringify(Object.keys(input).sort()) ===
            JSON.stringify([
              "authority",
              "configuration",
              "configuredFacts"
            ]),
        "ALAKAZAM_50_COMPILER_INPUT_INVALID",
        "The Alakazam $50 compiler input is invalid.",
        { status: 400 }
      );
      const configuration = verifyAlakazam50Configuration(
        input.configuration
      );
      exactAuthority(input.authority, configuration);
      const base = baseCompiler.compileAlakazam({
        authority: input.authority,
        configuredFacts: input.configuredFacts
      });
      invariant(
        typeof base?.html === "string" &&
          (Buffer.isBuffer(base.htmlBytes) ||
            base.htmlBytes instanceof Uint8Array) &&
          typeof base.schema === "string" &&
          typeof base.compilerRevision === "string" &&
          Array.isArray(base.assets),
        "ALAKAZAM_50_COMPILER_OUTPUT_INVALID",
        "The Alakazam $35 compiler output is invalid.",
        { status: 500 }
      );
      const artifactSet = {
        schema: ALAKAZAM_50_ARTIFACT_SET_SCHEMA,
        compilerSchema: ALAKAZAM_50_COMPILER_SCHEMA,
        compilerRevision: base.compilerRevision,
        policyDigest: base.policyDigest,
        configurationDigest: configuration.configurationDigest,
        baseArtifactDigest: base.artifactDigest,
        baseArtifactSetDigest: base.artifactSetDigest ?? null,
        assets: base.assets.map((asset) => ({
          path: asset.path,
          mediaType: asset.mediaType,
          byteCount: asset.byteCount,
          assetDigest: asset.assetDigest
        }))
      };
      const artifactSetDigest = digest(artifactSet);
      const html = injectProvenance(
        applyMenu(
          injectPaymentLinks(
            injectStyle(base.html, configuration),
            configuration
          ),
          configuration.menu
        ),
        configuration,
        artifactSetDigest
      );
      const htmlBytes = Buffer.from(html, "utf8");
      return deepFreeze({
        ...base,
        fulfillmentSchema: ALAKAZAM_50_COMPILER_SCHEMA,
        configurationDigest: configuration.configurationDigest,
        baseArtifactDigest: base.artifactDigest,
        artifactDigest: sha256(htmlBytes),
        artifactSetDigest,
        html,
        htmlBytes,
        assets: base.assets.map((asset) => ({
          ...clone(asset),
          ...(asset.bytes ? { bytes: Buffer.from(asset.bytes) } : {})
        })),
        effectiveFacts: {
          ...clone(base.effectiveFacts ?? {}),
          alakazam50: {
            cashAppHandle: configuration.cashAppHandle,
            venmoHandle: configuration.venmoHandle,
            fontChoiceId: configuration.fontChoiceId,
            borderChoiceId: configuration.borderChoiceId,
            menu: clone(configuration.menu)
          }
        }
      });
    }
  });
}
