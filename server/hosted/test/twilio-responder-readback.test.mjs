import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../security.mjs";
import {
  createHeldTwilioResponderReadback,
  createTwilioResponderReadback,
  configuredTwilioResponderReadback
} from "../twilio-responder-readback.mjs";

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const API_KEY_SID = `SK${"b".repeat(32)}`;
const API_KEY_SECRET = "c".repeat(32);
const NOW = "2026-08-12T18:00:00.000Z";
const KNOWN_SID = `SM${"1".repeat(32)}`;
const OTHER_SID = `SM${"2".repeat(32)}`;

function environment(overrides = {}) {
  return {
    SITESOURCERY_TWILIO_ACCOUNT_SID: ACCOUNT_SID,
    SITESOURCERY_TWILIO_API_KEY_SID: API_KEY_SID,
    SITESOURCERY_TWILIO_API_KEY_SECRET: API_KEY_SECRET,
    ...overrides
  };
}

function pageResponse(messages, nextPageUri = null) {
  return {
    status: 200,
    async text() {
      return JSON.stringify({ messages, next_page_uri: nextPageUri });
    }
  };
}

test("readback matches a stored SID digest without persisting or returning the raw SID", async () => {
  const calls = [];
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return pageResponse([
        { sid: OTHER_SID, status: "delivered", error_code: null,
          to: "+18565550100", from: "+18562441220", body: "unrelated" },
        { sid: KNOWN_SID, status: "undelivered", error_code: 30006,
          to: "+18565550101", from: "+18562441220", body: "private" }
      ]);
    }
  });
  const result = await readback.findMessages({
    targetDigests: [digest(KNOWN_SID)],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW
  });
  assert.equal(result.matches.length, 1);
  const match = result.matches[0];
  assert.equal(match.providerMessageIdDigest, digest(KNOWN_SID));
  assert.equal(match.status, "undelivered");
  assert.equal(match.errorCodeDigest, digest({
    provider: "twilio",
    errorCode: "30006"
  }));
  assert.match(match.readbackEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(result.unmatchedDigests, []);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(KNOWN_SID), false);
  assert.equal(serialized.includes("+18565550101"), false);
  assert.equal(serialized.includes("private"), false);
  // Authorization is API-key Basic; the Account Auth Token is never used.
  assert.match(
    calls[0].options.headers.Authorization,
    /^Basic /u
  );
  assert.match(calls[0].url, /Messages\.json\?/u);
});

test("an unmatched target is reported, not invented", async () => {
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse([
      { sid: OTHER_SID, status: "delivered", error_code: null }
    ])
  });
  const result = await readback.findMessages({
    targetDigests: [digest(KNOWN_SID)],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW
  });
  assert.equal(result.matches.length, 0);
  assert.deepEqual(result.unmatchedDigests, [digest(KNOWN_SID)]);
  assert.equal(result.exhausted, true);
});

test("pagination is bounded and stops once every target is matched", async () => {
  let pages = 0;
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => {
      pages += 1;
      return pageResponse(
        [{ sid: KNOWN_SID, status: "sent", error_code: null }],
        "/2010-04-01/Accounts/next"
      );
    }
  });
  const result = await readback.findMessages({
    targetDigests: [digest(KNOWN_SID)],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW,
    maximumPages: 3
  });
  assert.equal(result.matches.length, 1);
  assert.equal(pages, 1, "matching every target ends pagination early");
});

test("page count is capped even when targets remain unmatched", async () => {
  let pages = 0;
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => {
      pages += 1;
      return pageResponse(
        [{ sid: OTHER_SID, status: "sent", error_code: null }],
        "/2010-04-01/Accounts/next"
      );
    }
  });
  const result = await readback.findMessages({
    targetDigests: [digest(KNOWN_SID)],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW,
    maximumPages: 2
  });
  assert.equal(pages, 2);
  assert.equal(result.exhausted, false);
  assert.deepEqual(result.unmatchedDigests, [digest(KNOWN_SID)]);
});

test("malformed rows, oversized pages, and non-200 responses fail closed", async () => {
  const badRow = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse([{ sid: "not-a-sid", status: "x" }])
  });
  await assert.rejects(
    badRow.findMessages({
      targetDigests: [digest(KNOWN_SID)],
      windowFromIso: "2026-08-12T17:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_UNAVAILABLE"
  );
  const notOk = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => ({ status: 500, async text() { return ""; } })
  });
  await assert.rejects(
    notOk.findMessages({
      targetDigests: [digest(KNOWN_SID)],
      windowFromIso: "2026-08-12T17:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_UNAVAILABLE"
  );
});

test("target and window bounds are validated", async () => {
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse([])
  });
  await assert.rejects(
    readback.findMessages({
      targetDigests: [],
      windowFromIso: "2026-08-12T17:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_INVALID"
  );
  await assert.rejects(
    readback.findMessages({
      targetDigests: [digest(KNOWN_SID)],
      windowFromIso: "2026-06-01T00:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_INVALID"
  );
});

test("held readback performs no request and configuration selects mode", async () => {
  const held = createHeldTwilioResponderReadback();
  assert.equal(held.mode, "held");
  assert.equal((await held.readiness()).ready, false);
  await assert.rejects(
    held.findMessages({}),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_HELD"
  );
  assert.equal(
    configuredTwilioResponderReadback({ environment: {} }).mode,
    "held"
  );
  assert.equal(
    configuredTwilioResponderReadback({
      environment: environment({
        SITESOURCERY_TWILIO_READBACK_MODE: "verified"
      }),
      fetchImpl: async () => pageResponse([])
    }).mode,
    "verified-read-only"
  );
  assert.throws(
    () => createTwilioResponderReadback({
      environment: environment({ SITESOURCERY_TWILIO_API_KEY_SID: "bad" })
    }),
    (error) =>
      error?.code === "TWILIO_RESPONDER_READBACK_CONFIGURATION_REQUIRED"
  );
});
