import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../security.mjs";
import {
  createHeldTwilioResponderReadback,
  createTwilioResponderReadback,
  configuredTwilioResponderReadback
} from "../twilio-responder-readback.mjs";

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const MESSAGING_SERVICE_SID = `MG${"d".repeat(32)}`;
const API_KEY_SID = `SK${"b".repeat(32)}`;
const API_KEY_SECRET = "c".repeat(32);
const NOW = "2026-08-12T18:00:00.000Z";
const KNOWN_SID = `SM${"1".repeat(32)}`;
const OTHER_SID = `SM${"2".repeat(32)}`;

function environment(overrides = {}) {
  return {
    SITESOURCERY_TWILIO_ACCOUNT_SID: ACCOUNT_SID,
    SITESOURCERY_TWILIO_MESSAGING_SERVICE_SID: MESSAGING_SERVICE_SID,
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

function message({
  sid = OTHER_SID,
  status = "delivered",
  errorCode = null,
  to = "+18565550100",
  body = "private",
  createdAt = "2026-08-12T17:30:00.000Z"
} = {}) {
  return {
    sid,
    account_sid: ACCOUNT_SID,
    messaging_service_sid: MESSAGING_SERVICE_SID,
    status,
    error_code: errorCode,
    to,
    body,
    date_created: createdAt
  };
}

function sidTarget(sid = KNOWN_SID) {
  return {
    kind: "provider_message_id",
    providerMessageIdDigest: digest(sid)
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
        message({ body: "unrelated" }),
        message({
          sid: KNOWN_SID,
          status: "undelivered",
          errorCode: 30006,
          to: "+18565550101"
        })
      ]);
    }
  });
  const result = await readback.findMessages({
    targets: [sidTarget()],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW
  });
  assert.equal(result.results.length, 1);
  const match = result.results[0];
  assert.equal(match.state, "matched");
  assert.equal(match.matchCount, 1);
  assert.equal(match.providerMessageIdDigest, digest(KNOWN_SID));
  assert.equal(match.status, "undelivered");
  assert.equal(match.errorCodeDigest, digest({
    provider: "twilio",
    errorCode: "30006"
  }));
  assert.match(match.readbackEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.equal(result.exhausted, true);
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
      message()
    ])
  });
  const result = await readback.findMessages({
    targets: [sidTarget()],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW
  });
  assert.equal(result.results[0].state, "not_found");
  assert.equal(result.results[0].matchCount, 0);
  assert.equal(result.exhausted, true);
});

test("an ambiguous create is matched by exact route and content digests", async () => {
  const to = "+18565550122";
  const body = "Sorry we missed you. Reply STOP to opt out.";
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse([
      message({ sid: KNOWN_SID, to, body })
    ])
  });
  const result = await readback.findMessages({
    targets: [{
      kind: "responder_message_shape",
      routeDigest: digest({ routeKind: "sms", address: to }),
      contentDigest: digest({ contentKind: "sms", body })
    }],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW
  });
  assert.equal(result.results[0].state, "single_candidate");
  assert.equal(result.results[0].providerMessageIdDigest, digest(KNOWN_SID));
  assert.equal(JSON.stringify(result).includes(to), false);
  assert.equal(JSON.stringify(result).includes(body), false);
});

test("more than one exact shape match remains terminally ambiguous", async () => {
  const to = "+18565550122";
  const body = "Sorry we missed you. Reply STOP to opt out.";
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse([
      message({ sid: KNOWN_SID, to, body }),
      message({ sid: OTHER_SID, to, body })
    ])
  });
  const result = await readback.findMessages({
    targets: [{
      kind: "responder_message_shape",
      routeDigest: digest({ routeKind: "sms", address: to }),
      contentDigest: digest({ contentKind: "sms", body })
    }],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW
  });
  assert.equal(result.results[0].state, "multiple_matches");
  assert.equal(result.results[0].matchCount, 2);
  assert.equal(result.results[0].providerMessageIdDigest, null);
});

test("pagination remains bounded and proves a target is unique", async () => {
  let pages = 0;
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => {
      pages += 1;
      return pageResponse(
        pages === 1 ? [message({ sid: KNOWN_SID, status: "sent" })] : [],
        pages === 1
          ? `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?Page=1`
          : null
      );
    }
  });
  const result = await readback.findMessages({
    targets: [sidTarget()],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW,
    maximumPages: 3
  });
  assert.equal(result.results[0].state, "matched");
  assert.equal(pages, 2, "the following page proves no duplicate match");
});

test("page count is capped even when targets remain unmatched", async () => {
  let pages = 0;
  const readback = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => {
      pages += 1;
      return pageResponse(
        [message({ status: "sent" })],
        `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?Page=${pages}`
      );
    }
  });
  const result = await readback.findMessages({
    targets: [sidTarget()],
    windowFromIso: "2026-08-12T17:00:00.000Z",
    windowToIso: NOW,
    maximumPages: 2
  });
  assert.equal(pages, 2);
  assert.equal(result.exhausted, false);
  assert.equal(result.results[0].state, "incomplete");
});

test("malformed rows, oversized pages, and non-200 responses fail closed", async () => {
  const badRow = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse([message({ sid: "not-a-sid" })])
  });
  await assert.rejects(
    badRow.findMessages({
      targets: [sidTarget()],
      windowFromIso: "2026-08-12T17:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_UNAVAILABLE"
  );
  const oversized = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => ({
      status: 200,
      async text() { return "x".repeat(1024 * 1024 + 1); }
    })
  });
  await assert.rejects(
    oversized.findMessages({
      targets: [sidTarget()],
      windowFromIso: "2026-08-12T17:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_UNAVAILABLE"
  );
  const hostilePagination = createTwilioResponderReadback({
    environment: environment(),
    clock: { now: () => NOW },
    fetchImpl: async () => pageResponse(
      [message()],
      "https://example.test/private"
    )
  });
  await assert.rejects(
    hostilePagination.findMessages({
      targets: [sidTarget()],
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
      targets: [sidTarget()],
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
      targets: [],
      windowFromIso: "2026-08-12T17:00:00.000Z",
      windowToIso: NOW
    }),
    (error) => error?.code === "TWILIO_RESPONDER_READBACK_INVALID"
  );
  await assert.rejects(
    readback.findMessages({
      targets: [sidTarget()],
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
