import { createHash } from "node:crypto";

import {
  ALAKAZAM_35_PHOTO_SCHEMA,
  applyAlakazam35EffectiveFacts
} from "../commerce-v2/alakazam-35.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant
} from "../commerce-v2/canonical.mjs";
import { SPARK_COMPILER_SCHEMA } from "./spark-compiler-port.mjs";

export const ALAKAZAM_35_COMPILER_SCHEMA =
  "abracadabra.alakazam-35/v1";
export const ALAKAZAM_35_ARTIFACT_SET_SCHEMA =
  "sitesourcery.alakazam-multi-file-artifact/v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function maskSections(facts) {
  const effective = clone(facts);
  const sections = effective.sectionVisibility;
  if (!sections.contact) effective.primaryAction = "none";
  delete effective.sectionVisibility;
  delete effective.photoHeader;
  return effective;
}

const SECTION_LABELS = Object.freeze({
  about: "About",
  offerings: "Offerings",
  practical: "Details",
  contact: "Contact"
});

function applySectionVisibility(html, sections) {
  let selected = html;
  for (const [sectionId, label] of Object.entries(SECTION_LABELS)) {
    if (sections[sectionId]) continue;
    selected = selected
      .replace(`<a href="#${sectionId}">${label}</a>`, "")
      .replace(
        new RegExp(
          `<section class="section ${sectionId}" id="${sectionId}">[\\s\\S]*?</section>`,
          "u"
        ),
        ""
      );
  }
  return selected.replace('<nav aria-label="Page"></nav>', "");
}

function verifyPhotoAsset(photo, mediaAsset) {
  if (photo === null) {
    invariant(
      mediaAsset === null,
      "ALAKAZAM_35_MEDIA_INVALID",
      "The Alakazam header photo bytes are unexpected.",
      { status: 409 }
    );
    return null;
  }
  invariant(
    mediaAsset &&
      mediaAsset.schema === ALAKAZAM_35_PHOTO_SCHEMA &&
      Buffer.isBuffer(mediaAsset.mediaBytes) &&
      mediaAsset.assetId === photo.assetId &&
      mediaAsset.assetDigest === photo.assetDigest &&
      mediaAsset.assetPath === photo.assetPath &&
      mediaAsset.mediaType === photo.mediaType &&
      mediaAsset.byteCount === photo.byteCount &&
      mediaAsset.width === photo.width &&
      mediaAsset.height === photo.height &&
      mediaAsset.mediaBytes.length === photo.byteCount &&
      sha256(mediaAsset.mediaBytes) === photo.assetDigest,
    "ALAKAZAM_35_MEDIA_INVALID",
    "The Alakazam header photo bytes do not match the immutable asset.",
    { status: 409 }
  );
  return mediaAsset;
}

function injectPhoto(html, photo) {
  if (photo === null) return html;
  const styleMarker = "</style>";
  const heroMarker = '<header class="hero"><div class="wrap">';
  invariant(
    html.includes(styleMarker) && html.includes(heroMarker),
    "ALAKAZAM_35_COMPILER_OUTPUT_INVALID",
    "The reviewed Spark output cannot accept a header photo.",
    { status: 500 }
  );
  const photoCss = [
    ".alakazam-photo{margin:0 0 clamp(1.4rem,4vw,3rem)}",
    ".alakazam-photo img{display:block;width:100%;max-height:min(46svh,28rem);object-fit:cover;border:1px solid var(--line);border-radius:var(--radius)}"
  ].join("");
  const markup =
    `<figure class="alakazam-photo"><img src="/${photo.assetPath}" ` +
    `width="${photo.width}" height="${photo.height}" ` +
    'alt="" decoding="async"></figure>';
  return html
    .replace(styleMarker, `${photoCss}${styleMarker}`)
    .replace(heroMarker, `${heroMarker}${markup}`);
}

function injectProvenance(html, selected, artifactSetDigest) {
  const marker = "</head>";
  invariant(
    html.includes(marker),
    "ALAKAZAM_35_COMPILER_OUTPUT_INVALID",
    "The reviewed Spark output has no provenance boundary.",
    { status: 500 }
  );
  const metadata = [
    `<meta name="sitesourcery-alakazam-policy" content="${selected.policyDigest}">`,
    `<meta name="sitesourcery-alakazam-configuration" content="${selected.configurationDigest}">`,
    `<meta name="sitesourcery-alakazam-artifact-set" content="${artifactSetDigest}">`
  ].join("");
  return html.replace(marker, `${metadata}${marker}`);
}

export function createAlakazam35Compiler({ baseCompiler } = {}) {
  invariant(
    baseCompiler &&
      typeof baseCompiler.compile === "function" &&
      typeof baseCompiler.revision === "string",
    "ALAKAZAM_35_COMPILER_UNAVAILABLE",
    "The reviewed Spark compiler is required for Alakazam $35.",
    { status: 503 }
  );

  return Object.freeze({
    schema: ALAKAZAM_35_COMPILER_SCHEMA,
    revision: baseCompiler.revision,
    compile(input) {
      invariant(
        input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          JSON.stringify(Object.keys(input).sort()) ===
            JSON.stringify([
              "authority",
              "configuration",
              "configuredFacts",
              "mediaAsset"
            ]),
        "ALAKAZAM_35_COMPILER_INPUT_INVALID",
        "The Alakazam $35 compiler input is invalid.",
        { status: 400 }
      );
      const selected = applyAlakazam35EffectiveFacts(input);
      const photo = selected.effectiveFacts.photoHeader;
      const mediaAsset = verifyPhotoAsset(photo, input.mediaAsset);
      const compiled = baseCompiler.compile(
        maskSections(selected.effectiveFacts)
      );
      const assetManifest = mediaAsset === null
        ? []
        : [{
            path: mediaAsset.assetPath,
            mediaType: mediaAsset.mediaType,
            byteCount: mediaAsset.byteCount,
            assetDigest: mediaAsset.assetDigest
          }];
      const artifactSet = {
        schema: ALAKAZAM_35_ARTIFACT_SET_SCHEMA,
        compilerSchema: ALAKAZAM_35_COMPILER_SCHEMA,
        compilerRevision: baseCompiler.revision,
        policyDigest: selected.policyDigest,
        configurationDigest: selected.configurationDigest,
        baseArtifactDigest: compiled.artifactDigest,
        assets: assetManifest
      };
      const artifactSetDigest = digest(artifactSet);
      const html = injectProvenance(
        injectPhoto(
          applySectionVisibility(
            compiled.html,
            selected.effectiveFacts.sectionVisibility
          ),
          photo
        ),
        selected,
        artifactSetDigest
      );
      const htmlBytes = Buffer.from(html, "utf8");
      invariant(
        htmlBytes.length >= 64 && htmlBytes.length <= 250_000,
        "ALAKAZAM_35_COMPILER_OUTPUT_INVALID",
        "The Alakazam $35 HTML is outside the safe artifact bounds.",
        { status: 500 }
      );
      return deepFreeze({
        schema: SPARK_COMPILER_SCHEMA,
        fulfillmentSchema: ALAKAZAM_35_COMPILER_SCHEMA,
        compilerRevision: artifactSet.compilerRevision,
        policy: clone(selected.policy),
        policyDigest: selected.policyDigest,
        configurationDigest: selected.configurationDigest,
        effectiveFacts: clone(selected.effectiveFacts),
        baseArtifactDigest: compiled.artifactDigest,
        artifactDigest: sha256(htmlBytes),
        artifactSetDigest,
        html,
        htmlBytes,
        assets: mediaAsset === null
          ? []
          : [{
              ...assetManifest[0],
              bytes: Buffer.from(mediaAsset.mediaBytes)
            }]
      });
    }
  });
}
