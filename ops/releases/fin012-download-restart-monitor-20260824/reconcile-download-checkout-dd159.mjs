import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import Stripe from "/home/simtech/sitesourcery-production/releases/dd159061ce94c62c10b635f21732a0be326f643b/node_modules/stripe/esm/stripe.esm.node.js";

const environmentPath =
  "/etc/sitesourcery/hosted.env.dd159061ce94c62c10b635f21732a0be326f643b";
const lowerBoundIso = "2026-08-24T14:50:00.000Z";
const outputPath = process.argv[2];
if (!outputPath || !outputPath.startsWith(
  "/home/simtech/sitesourcery-production/run/fin012-download-restart-dd159-20260824T145019Z/"
)) {
  throw new Error("an exact release evidence output path is required");
}

function parseEnvironment(text) {
  const environment = {};
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match || Object.hasOwn(environment, match[1])) {
      throw new Error("environment assignment is invalid");
    }
    let value = match[2];
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    environment[match[1]] = value;
  }
  return environment;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

const environment = parseEnvironment(await readFile(environmentPath, "utf8"));
const stripe = new Stripe(environment.SITESOURCERY_STRIPE_SECRET_KEY, {
  apiVersion: "2026-06-24.dahlia",
  maxNetworkRetries: 0,
  timeout: 10_000
});
const lowerBound = Math.floor(Date.parse(lowerBoundIso) / 1000);
const page = await stripe.checkout.sessions.list({
  created: { gte: lowerBound },
  limit: 100
});
if (page.has_more) {
  throw new Error("reconciliation result exceeds one exact provider page");
}

const downloads = page.data.filter((session) =>
  session.metadata?.offer_id === "spark_download" ||
  session.metadata?.entitlement_kind === "spark_download"
);
const paymentEffects = downloads.filter((session) =>
  session.payment_status !== "unpaid" ||
  typeof session.payment_intent === "string"
);

const evidence = {
  schema: "sitesourcery.fin012-download-checkout-provider-reconciliation/v2",
  observedAt: new Date().toISOString(),
  lowerBound: new Date(lowerBound * 1000).toISOString(),
  fetchedSessionCount: page.data.length,
  downloadSessionCount: downloads.length,
  hasMore: page.has_more,
  sessions: downloads.map((session) => ({
    sessionIdSha256: digest(session.id),
    createdAt: new Date(session.created * 1000).toISOString(),
    expiresAt: new Date(session.expires_at * 1000).toISOString(),
    status: session.status,
    paymentStatus: session.payment_status,
    amountSubtotal: session.amount_subtotal,
    amountTotal: session.amount_total,
    currency: session.currency,
    livemode: session.livemode,
    mode: session.mode,
    paymentIntentPresent: typeof session.payment_intent === "string",
    paymentIntentSha256:
      typeof session.payment_intent === "string"
        ? digest(session.payment_intent)
        : null,
    customerPresent: typeof session.customer === "string",
    projectIdSha256: session.metadata?.project_id
      ? digest(session.metadata.project_id)
      : null,
    quoteIdSha256: session.metadata?.quote_id
      ? digest(session.metadata.quote_id)
      : null,
    purposeDigest: session.metadata?.purpose_digest ?? null
  })),
  providerReadPerformed: true,
  providerEffect: downloads.length > 0,
  providerMutation: false,
  paymentEffect: paymentEffects.length > 0,
  secretDisclosed: false,
  dashboardMutation: false
};
const encoded = `${JSON.stringify(evidence, null, 2)}\n`;
await writeFile(outputPath, encoded, { flag: "wx", mode: 0o440 });
process.stdout.write(`${JSON.stringify({
  ok: true,
  outputPath,
  sha256: digest(encoded),
  downloadSessionCount: downloads.length,
  providerEffect: evidence.providerEffect,
  paymentEffect: evidence.paymentEffect
})}\n`);
