import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderVoiceDialTargetVault
} from "../responder-voice-dial-target-vault.mjs";
import {
  createHeldTwilioResponderVoiceDialPlan,
  createTwilioResponderVoiceDialPlan,
  isExactTwilioResponderVoiceTwiML,
  TWILIO_RESPONDER_HELD_VOICE_TWIML,
  voiceDialModeFromEnvironment
} from "../twilio-responder-voice-dial-plan.mjs";

const IDS = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  binding: "10000000-0000-4000-8000-000000000004"
});
const ACTION =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result";

test("Voice target material is tenant-bound ciphertext and opens exactly", async () => {
  const vault = createResponderVoiceDialTargetVault({
    currentKeyVersion: "voice-2026-08",
    currentKey: Buffer.alloc(32, 8),
    randomBytes: () => Buffer.alloc(12, 7)
  });
  const authority = {
    id: IDS.id,
    organizationId: IDS.organization,
    projectId: IDS.project,
    numberBindingId: IDS.binding
  };
  const envelope = await vault.sealTarget(authority, "+18565550123");
  assert.equal(
    envelope.ciphertext.includes(Buffer.from("+18565550123")),
    false
  );
  assert.equal(await vault.openTarget(authority, envelope), "+18565550123");
  await assert.rejects(
    vault.openTarget({ ...authority, projectId: IDS.organization }, envelope),
    (error) => error?.code === "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE"
  );
});

test("held Voice rejects while verified Voice renders only the exact private Dial action", async () => {
  const held = createHeldTwilioResponderVoiceDialPlan();
  assert.equal(await held.twiml(), TWILIO_RESPONDER_HELD_VOICE_TWIML);
  assert.equal((await held.readiness()).voiceOperational, false);
  const targets = {
    kind: "responder-voice-dial-targets-postgres",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async resolveTarget({ numberBindingId }) {
      assert.equal(numberBindingId, IDS.binding);
      return "+18565550123";
    }
  };
  const plan = createTwilioResponderVoiceDialPlan({
    targets,
    dialResultUrl: ACTION
  });
  const twiml = await plan.twiml({
    channel: "voice",
    eventKind: "call_received",
    eventState: "recorded",
    numberBindingId: IDS.binding
  });
  assert.equal(
    twiml,
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
      `<Response><Dial action="${ACTION}" method="POST" ` +
      "answerOnBridge=\"true\" timeout=\"20\">" +
      "<Number>+18565550123</Number></Dial></Response>"
  );
  assert.equal(isExactTwilioResponderVoiceTwiML(twiml), true);
  assert.equal(isExactTwilioResponderVoiceTwiML(
    twiml.replace("timeout=\"20\"", "timeout=\"60\"")
  ), false);
  assert.equal((await plan.readiness()).voiceOperational, true);
});

test("Voice dial mode and action URL fail closed", () => {
  assert.equal(voiceDialModeFromEnvironment({}), "held");
  assert.equal(voiceDialModeFromEnvironment({
    SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "verified"
  }), "verified");
  assert.throws(
    () => voiceDialModeFromEnvironment({
      SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "live"
    }),
    (error) => error?.code ===
      "RESPONDER_VOICE_DIAL_PLAN_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createTwilioResponderVoiceDialPlan({
      targets: {
        kind: "responder-voice-dial-targets-postgres",
        providerEffects: false,
        readiness() {},
        resolveTarget() {}
      },
      dialResultUrl: "https://example.com/not-the-action"
    }),
    (error) => error?.code ===
      "RESPONDER_VOICE_DIAL_PLAN_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createTwilioResponderVoiceDialPlan({
      targets: {
        kind: "responder-voice-dial-targets-postgres",
        providerEffects: false,
        readiness() {},
        resolveTarget() {}
      },
      dialResultUrl:
        "https://example.com/api/v1/provider-events/twilio/voice/dial-result"
    }),
    (error) => error?.code ===
      "RESPONDER_VOICE_DIAL_PLAN_CONFIGURATION_REQUIRED"
  );
});
