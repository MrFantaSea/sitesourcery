import assert from "node:assert/strict";
import { test } from "node:test";

import { HostedError } from "../errors.mjs";
import {
  createResponderNativeClientHttpBoundary,
  matchResponderNativeClientHttpRoute
} from "../responder-native-client-http.mjs";
import {
  createResponderNativeTokenAuthority
} from "../responder-native-token-authority.mjs";

const ORIGIN = "https://hosted.sitesourcery.test";
const PROJECT = "10000000-0000-4000-8000-000000000001";
const INSTALLATION = "10000000-0000-4000-8000-000000000002";
const ORGANIZATION = "10000000-0000-4000-8000-000000000003";
const USER = "10000000-0000-4000-8000-000000000004";
const TOKEN = "ab".repeat(32);
const IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003"
];

function repository(calls) {
  const installation = Object.freeze({
    id: INSTALLATION,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    customerUserId: USER,
    platform: "ios",
    bundleId: "com.sitesourcery.responder",
    appEnvironment: "sandbox",
    appVersion: "1.0.0",
    buildNumber: "1",
    installationKeyDigest: "1".repeat(64),
    state: "active",
    revision: 1,
    pushRegistrations: []
  });
  return {
    kind: "responder-native-client-postgres",
    mode: "held-local",
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false,
    async listInstallations(actor, input) {
      calls.push(["list", actor, input]);
      return { schema: "sitesourcery.responder-native-installation-list/v1" };
    },
    async createInstallation(actor, input) {
      calls.push(["create", actor, input]);
      return { schema: "sitesourcery.responder-native-command-receipt/v1" };
    },
    async getInstallation(actor, input) {
      calls.push(["get", actor, input]);
      return installation;
    },
    async registerToken(actor, input) {
      calls.push(["token", actor, input]);
      return { schema: "sitesourcery.responder-native-command-receipt/v1" };
    },
    async suspendInstallation(actor, input) {
      calls.push(["suspend", actor, input]);
      return { schema: "sitesourcery.responder-native-command-receipt/v1" };
    },
    async resumeInstallation(actor, input) {
      calls.push(["resume", actor, input]);
      return { schema: "sitesourcery.responder-native-command-receipt/v1" };
    },
    async revokeInstallation(actor, input) {
      calls.push(["revoke", actor, input]);
      return { schema: "sitesourcery.responder-native-command-receipt/v1" };
    },
    async requireHeldVoipSession(actor, input) {
      calls.push(["voip", actor, input]);
      throw new HostedError(
        "RESPONDER_NATIVE_VOIP_HELD",
        "Native VoIP access remains held.",
        { status: 409 }
      );
    }
  };
}

function boundary({ signedIn = true, writeAllowed = true } = {}) {
  const calls = [];
  let index = 0;
  const selected = createResponderNativeClientHttpBoundary({
    repository: repository(calls),
    tokenAuthority: createResponderNativeTokenAuthority({
      pepper: Buffer.alloc(32, 4),
      pepperVersion: "v1",
      randomBytes: () => Buffer.alloc(12, 8)
    }),
    authenticate: async () => signedIn
      ? { userId: USER, organizationId: ORGANIZATION }
      : null,
    requireWriteGuard: async () => writeAllowed,
    randomUUID: () => IDS[index++],
    clock: { now: () => "2026-08-14T20:00:00.000Z" }
  });
  return { selected, calls };
}

function request(method, path, bodyValue, command = "native-command-0001") {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: method === "POST"
      ? {
          "content-type": "application/json",
          "idempotency-key": command
        }
      : {},
    ...(bodyValue === undefined ? {} : { body: JSON.stringify(bodyValue) })
  });
}

test("native-client route matcher is exact", () => {
  assert.equal(
    matchResponderNativeClientHttpRoute(
      "GET", `/api/v1/responder/projects/${PROJECT}/native-installations`
    )?.operation,
    "list"
  );
  assert.equal(
    matchResponderNativeClientHttpRoute(
      "GET", `/api/v1/responder/projects/${PROJECT}/native-installations?x=1`
    ),
    null
  );
  assert.equal(
    matchResponderNativeClientHttpRoute(
      "POST", "/api/v1/responder/projects/not-a-uuid/native-installations"
    ),
    null
  );
});

test("native-client HTTP creates a tenant-derived held installation", async () => {
  const { selected, calls } = boundary();
  const response = await selected.dispatch(request(
    "POST",
    `/api/v1/responder/projects/${PROJECT}/native-installations`,
    {
      platform: "ios",
      bundleId: "com.sitesourcery.responder",
      appEnvironment: "sandbox",
      appVersion: "1.0.0",
      buildNumber: "1",
      installationKeyDigest: "1".repeat(64)
    }
  ));
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "create");
  assert.deepEqual(calls[0][1], {
    kind: "customer",
    organizationId: ORGANIZATION,
    userId: USER
  });
  assert.equal(calls[0][2].organizationId, ORGANIZATION);
  assert.equal(calls[0][2].projectId, PROJECT);
  assert.equal(calls[0][2].installationId, IDS[0]);
});

test("native-client HTTP seals APNs token before repository handoff", async () => {
  const { selected, calls } = boundary();
  const response = await selected.dispatch(request(
    "POST",
    `/api/v1/responder/projects/${PROJECT}/native-installations/` +
      `${INSTALLATION}/push-tokens`,
    { expectedRevision: 1, purpose: "voip", token: TOKEN },
    "native-token-0001"
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((entry) => entry[0]), ["get", "token"]);
  const handedOff = calls[1][2];
  assert.equal(handedOff.pushPurpose, "voip");
  assert.equal(handedOff.envelope.keyVersion, "v1");
  assert.ok(Buffer.isBuffer(handedOff.envelope.ciphertext));
  assert.equal(Object.hasOwn(handedOff, "token"), false);
  assert.doesNotMatch(JSON.stringify(handedOff), new RegExp(TOKEN, "u"));
});

test("native-client HTTP suspends logout, resumes safely, and holds VoIP", async () => {
  const first = boundary();
  const revoke = await first.selected.dispatch(request(
    "POST",
    `/api/v1/responder/projects/${PROJECT}/native-installations/` +
      `${INSTALLATION}/revoke`,
    {
      expectedRevision: 2,
      reason: "logout",
      evidenceDigest: "2".repeat(64)
    },
    "native-revoke-0001"
  ));
  assert.equal(revoke.status, 200);
  assert.equal(first.calls[0][0], "suspend");

  const resumed = await first.selected.dispatch(request(
    "POST",
    `/api/v1/responder/projects/${PROJECT}/native-installations/` +
      `${INSTALLATION}/resume`,
    {
      expectedRevision: 3,
      evidenceDigest: "3".repeat(64)
    },
    "native-resume-0001"
  ));
  assert.equal(resumed.status, 200);
  assert.equal(first.calls[1][0], "resume");
  assert.equal(first.calls[1][2].reason, "login");

  const second = boundary();
  await assert.rejects(
    second.selected.dispatch(request(
      "POST",
      `/api/v1/responder/projects/${PROJECT}/native-installations/` +
        `${INSTALLATION}/voip-session`,
      { expectedRevision: 2 },
      "native-voip-0001"
    )),
    { code: "RESPONDER_NATIVE_VOIP_HELD" }
  );
  assert.equal(second.calls[0][0], "voip");
});

test("native-client HTTP rejects unauthenticated, unguarded, and unknown fields", async () => {
  const signedOut = boundary({ signedIn: false });
  await assert.rejects(
    signedOut.selected.dispatch(request(
      "POST",
      `/api/v1/responder/projects/${PROJECT}/native-installations`,
      {}
    )),
    { code: "AUTHENTICATION_REQUIRED" }
  );

  const unguarded = boundary({ writeAllowed: false });
  await assert.rejects(
    unguarded.selected.dispatch(request(
      "POST",
      `/api/v1/responder/projects/${PROJECT}/native-installations`,
      {}
    )),
    { code: "RESPONDER_NATIVE_CLIENT_WRITE_GUARD_REQUIRED" }
  );

  const extra = boundary();
  await assert.rejects(
    extra.selected.dispatch(request(
      "POST",
      `/api/v1/responder/projects/${PROJECT}/native-installations`,
      {
        platform: "ios",
        bundleId: "com.sitesourcery.responder",
        appEnvironment: "sandbox",
        appVersion: "1",
        buildNumber: "1",
        installationKeyDigest: "1".repeat(64),
        providerSecret: "never"
      }
    )),
    { code: "RESPONDER_NATIVE_CLIENT_INVALID" }
  );
});
