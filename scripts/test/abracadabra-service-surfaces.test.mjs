import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  configureHostedAbracadabraHtml,
  hostedStagingAssets
} from "../configure-abracadabra-hosted-staging.mjs";

const require = createRequire(import.meta.url);
const surfaces = require(
  "../../abracadabra/app/abracadabra-service-surfaces.js"
);
const ORG = "20000000-0000-4000-8000-000000000001";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const CONTACT = "40000000-0000-4000-8000-000000000001";
const INTERACTION = "50000000-0000-4000-8000-000000000001";
const TIME = "2026-08-13T18:00:00.000Z";
const A = "a".repeat(64);
const B = "b".repeat(64);

function form(values) {
  return {
    elements: {
      namedItem(name) {
        return Object.hasOwn(values, name) ? { value: values[name] } : null;
      }
    }
  };
}

test("customer Responder controller emits only exact held command routes", async () => {
  const calls = [];
  const client = {
    request(method, path, options) {
      calls.push({ method, path, options });
      return Promise.resolve({ providerEffects: false });
    }
  };
  await surfaces.commandRequest(client, ORG, form({
    consentBasis: "explicit_service_request",
    consentEvidenceDigest: A,
    occurredAt: TIME,
    projectId: PROJECT,
    routeDigest: B
  }), { action: "prepare-consent" });
  await surfaces.commandRequest(client, ORG, form({
    occurredAt: TIME,
    payloadDigest: A,
    providerEventIdDigest: B
  }), {
    action: "stop", contactAuthorityId: CONTACT,
    projectId: PROJECT, routeDigest: A
  });
  await surfaces.commandRequest(client, ORG, form({
    evidenceDigest: A, reason: "customer_request"
  }), {
    action: "handoff", interactionId: INTERACTION,
    projectId: PROJECT, expectedRevision: 3
  });
  await surfaces.commandRequest(client, ORG, form({
    contentDigest: B, messageKind: "missed_call_ack"
  }), {
    action: "held-message", interactionId: INTERACTION,
    projectId: PROJECT, contactAuthorityId: CONTACT
  });
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ["POST", "/responder/contacts"],
    ["POST", `/responder/contacts/${CONTACT}/stop`],
    ["POST", `/responder/interactions/${INTERACTION}/handoff`],
    ["POST", `/responder/interactions/${INTERACTION}/held-messages`]
  ]);
  for (const call of calls) {
    assert.deepEqual(call.options.headers, {
      "X-SiteSourcery-Organization-Id": ORG
    });
    assert.equal(Object.hasOwn(call.options.body, "phoneNumber"), false);
    assert.equal(Object.hasOwn(call.options.body, "messageBody"), false);
  }
});

test("service surfaces reject malformed evidence before a request", async () => {
  let calls = 0;
  const client = { request() { calls += 1; } };
  assert.throws(() => surfaces.commandRequest(client, ORG, form({
    evidenceDigest: "raw evidence", reason: "customer_request"
  }), {
    action: "handoff", interactionId: INTERACTION,
    projectId: PROJECT, expectedRevision: 1
  }), /exact lowercase SHA-256/u);
  assert.equal(calls, 0);
});

test("hosted artifact composes Care and Responder modules after the session", async () => {
  const source = await readFile(
    new URL("../../abracadabra/app/index.html", import.meta.url), "utf8"
  );
  const hosted = configureHostedAbracadabraHtml(source);
  const order = [
    "abracadabra-customer-control-dom.js",
    "abracadabra-care-surfaces.js",
    "abracadabra-responder-surfaces.js",
    "abracadabra-service-surfaces.js"
  ].map((name) => hosted.indexOf(name));
  assert.equal(order.every((value) => value >= 0), true);
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
  for (const asset of [
    "abracadabra/app/abracadabra-care-surfaces.css",
    "abracadabra/app/abracadabra-care-surfaces.js",
    "abracadabra/app/abracadabra-responder-surfaces.css",
    "abracadabra/app/abracadabra-responder-surfaces.js",
    "abracadabra/app/abracadabra-service-surfaces.css",
    "abracadabra/app/abracadabra-service-surfaces.js"
  ]) assert.equal(hostedStagingAssets.includes(asset), true);
  const controller = await readFile(new URL(
    "../../abracadabra/app/abracadabra-service-surfaces.js",
    import.meta.url
  ), "utf8");
  assert.doesNotMatch(controller, /innerHTML|insertAdjacentHTML|document\.write/u);
  assert.doesNotMatch(controller, /phoneNumber|messageBody|providerEffects\s*:\s*true/u);
  assert.match(controller, /X-SiteSourcery-Organization-Id/u);
});
