/**
 * Small, risk-focused truth contract for the public Work page.
 *
 * This deliberately does not freeze layout, prose, project order, or styling.
 * It protects only the distinction a visitor could otherwise misunderstand:
 * two founder-owned ventures, two fictional studies, and no client-result
 * claim.
 */

export const WORK_PUBLIC_TRUTH = Object.freeze({
  founderOwnedProjectIds: Object.freeze(["scone-sourcery", "daarx"]),
  fictionalStudyIds: Object.freeze(["trattoria", "bright-spark"]),
});

const PORTFOLIO_ARTICLE = /<article\b([^>]*)>([\s\S]*?)<\/article>/giu;
const OPENING_TAG = /<([a-z][a-z0-9:-]*)\b([^>]*)>/giu;
const ATTRIBUTE = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
const INVENTED_CLIENT_RESULT =
  /\b(?:our clients?|client success|clients? (?:doubled|increased|grew)|helped (?:a |the )?client)\b/iu;

function attributes(raw) {
  const parsed = new Map();
  for (const match of raw.matchAll(ATTRIBUTE)) {
    parsed.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return parsed;
}

function classNames(rawAttributes) {
  return new Set((attributes(rawAttributes).get("class") ?? "").split(/\s+/u).filter(Boolean));
}

function textFromHtml(source) {
  return source
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(?:nbsp|#160);/giu, " ")
    .replace(/&(?:middot|#183);/giu, " · ")
    .replace(/\s+/gu, " ")
    .trim();
}

function textForClass(source, className) {
  const found = [];
  for (const match of source.matchAll(OPENING_TAG)) {
    if (!classNames(match[2]).has(className)) continue;
    const close = new RegExp(`</${match[1]}\\s*>`, "giu");
    const contentStart = (match.index ?? 0) + match[0].length;
    close.lastIndex = contentStart;
    const closing = close.exec(source);
    if (closing) {
      found.push(textFromHtml(source.slice(contentStart, closing.index)));
    }
  }
  return found;
}

function projectArticles(source) {
  const projects = [];
  for (const match of source.matchAll(PORTFOLIO_ARTICLE)) {
    const opening = attributes(match[1]);
    if (!classNames(match[1]).has("portfolio-project")) continue;
    const liveLabels = textForClass(match[2], "project-label-live");
    const studyLabels = textForClass(match[2], "project-label-study");
    projects.push(Object.freeze({
      id: opening.get("id") ?? "",
      evidenceKind: opening.get("data-evidence-kind") ?? "",
      text: textFromHtml(match[2]),
      hasFounderOwnedLabel: liveLabels.some((label) => /\bfounder-owned venture\b/iu.test(label)),
      hasFictionalStudyLabel: studyLabels.some((label) => /\bfictional design study\b/iu.test(label)),
    }));
  }
  return projects;
}

export function analyzeWorkPublicTruth(source) {
  const projects = projectArticles(source);
  const founderOwned = projects.filter(({ hasFounderOwnedLabel }) => hasFounderOwnedLabel);
  const fictional = projects.filter(({ hasFictionalStudyLabel }) => hasFictionalStudyLabel);
  return Object.freeze({
    projects: Object.freeze(projects),
    founderOwnedProjectIds: Object.freeze(founderOwned.map(({ id }) => id)),
    fictionalStudyIds: Object.freeze(fictional.map(({ id }) => id)),
    inventedClientResult: source.match(INVENTED_CLIENT_RESULT)?.[0] ?? null,
  });
}

function exactValues(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value));
}

export function validateWorkPublicTruth(source) {
  const analysis = analyzeWorkPublicTruth(source);
  const errors = [];

  if (!exactValues(
    analysis.founderOwnedProjectIds,
    WORK_PUBLIC_TRUTH.founderOwnedProjectIds,
  )) {
    errors.push(
      "founder-owned projects must be exactly scone-sourcery and daarx; "
      + `received ${analysis.founderOwnedProjectIds.join(", ") || "none"}`,
    );
  }
  if (!exactValues(analysis.fictionalStudyIds, WORK_PUBLIC_TRUTH.fictionalStudyIds)) {
    errors.push(
      "fictional studies must be exactly trattoria and bright-spark; "
      + `received ${analysis.fictionalStudyIds.join(", ") || "none"}`,
    );
  }

  const founderIds = new Set(analysis.founderOwnedProjectIds);
  const fictionalIds = new Set(analysis.fictionalStudyIds);
  for (const project of analysis.projects) {
    if (founderIds.has(project.id) && fictionalIds.has(project.id)) {
      errors.push(`project ${project.id} cannot be both founder-owned and fictional`);
    }
    if (
      founderIds.has(project.id)
      && !/\bnot\s+(?:a\s+)?client\s+(?:engagement|work)\b/iu.test(project.text)
    ) {
      errors.push(`founder-owned project ${project.id} must explicitly say it is not client work`);
    }
    if (
      fictionalIds.has(project.id)
      && project.evidenceKind !== "fictional-design-study"
    ) {
      errors.push(
        `fictional study ${project.id} must retain data-evidence-kind="fictional-design-study"`,
      );
    }
  }

  if (analysis.inventedClientResult) {
    errors.push(`contains invented client-result claim ${JSON.stringify(analysis.inventedClientResult)}`);
  }
  if (/data-proof-state=["']client-work["']/iu.test(source)) {
    errors.push("founder-owned work cannot be relabeled as client work");
  }
  if (/data-evidence-kind=["']client-result["']/iu.test(source)) {
    errors.push("fictional or founder-owned work cannot be relabeled as a client result");
  }

  return errors;
}
