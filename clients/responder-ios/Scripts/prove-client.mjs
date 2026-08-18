import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedGates = Object.freeze([
  "exact-source-inventory",
  "xcode-target-source-membership",
  "pinned-official-twilio-sdk",
  "plist-entitlement-privacy-contract",
  "swift-syntax-parse",
  "platform-neutral-app-typecheck",
  "compiled-core-proof",
  "cookie-csrf-no-bearer-authority",
  "ordinary-push-and-voip-separation",
  "official-twilio-voice-lifecycle",
  "no-carrier-command-or-silent-sms-source",
  "iphone-sdk-status-truth"
]);
const passed = [];
const pass = (gate) => passed.push(gate);

function filesUnder(path) {
  const result = [];
  for (const name of readdirSync(path).sort()) {
    const selected = join(path, name);
    if (statSync(selected).isDirectory()) result.push(...filesUnder(selected));
    else result.push(selected);
  }
  return result;
}

function text(path) {
  return readFileSync(join(root, path), "utf8");
}

function run(command, args, environment = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DEVELOPER_DIR: "/Library/Developer/CommandLineTools",
      ...environment
    }
  });
}

const expectedTargetSwift = Object.freeze([
  "App/AppDelegate.swift",
  "App/AppModel.swift",
  "App/Calls/CallKitCoordinator.swift",
  "App/Calls/TwilioVoiceCoordinator.swift",
  "App/Configuration.swift",
  "App/Push/PushKitCoordinator.swift",
  "App/Push/PushRegistrationCoordinator.swift",
  "App/ResponderApp.swift",
  "App/RootView.swift",
  "App/Security/KeychainStore.swift",
  "App/Views/AuthView.swift",
  "App/Views/DashboardView.swift",
  "App/Views/DeviceView.swift",
  "App/Views/ForwardingView.swift",
  "App/Views/WorkspacePickerView.swift",
  "App/Views/WorkspaceView.swift",
  "Sources/ResponderCore/APIClient.swift",
  "Sources/ResponderCore/ClientAuthority.swift",
  "Sources/ResponderCore/Models.swift"
]);
const expectedSwift = Object.freeze([
  ...expectedTargetSwift,
  "Package.swift",
  "Proofs/ResponderCoreProof/main.swift"
]);
const swiftFiles = filesUnder(root)
  .filter((path) => path.endsWith(".swift"))
  .filter((path) => !path.includes("/.build/"))
  .map((path) => relative(root, path))
  .sort();
assert.deepEqual(swiftFiles, [...expectedSwift].sort());
pass("exact-source-inventory");

const project = text("Responder.xcodeproj/project.pbxproj");
for (const path of expectedTargetSwift) {
  const name = path.split("/").at(-1);
  assert.equal(
    project.match(new RegExp(`${name.replaceAll(".", "\\.")} in Sources`, "gu"))
      ?.length,
    2,
    `${name} must have one build-file declaration and one source-phase member`
  );
}
assert.match(project, /productType = "com\.apple\.product-type\.application";/u);
assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.sitesourcery\.responder;/u);
pass("xcode-target-source-membership");

const sdkPin = JSON.parse(text("TWILIO-SDK-PIN.json"));
const packageResolved = JSON.parse(text(
  "Responder.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
));
assert.deepEqual(sdkPin, {
  schema: "sitesourcery.responder-ios-twilio-sdk-pin/v1",
  packageURL: "https://github.com/twilio/twilio-voice-ios",
  version: "6.13.6",
  revision: "62912513388001394d093b85a6269bf3206cac13",
  product: "TwilioVoice",
  artifactChecksum:
    "4e04fa2698e33a47d15293f4437b1416fccad29c6e168695295c090c661d8acb"
});
assert.deepEqual(packageResolved, {
  pins: [{
    identity: "twilio-voice-ios",
    kind: "remoteSourceControl",
    location: sdkPin.packageURL,
    state: { revision: sdkPin.revision, version: sdkPin.version }
  }],
  version: 3
});
assert.match(project, /repositoryURL = "https:\/\/github\.com\/twilio\/twilio-voice-ios";/u);
assert.match(project, /kind = exactVersion;\s+version = 6\.13\.6;/u);
assert.match(project, /productName = TwilioVoice;/u);
pass("pinned-official-twilio-sdk");

for (const path of [
  "App/Info.plist", "App/Responder.entitlements", "App/PrivacyInfo.xcprivacy",
  "Responder.xcodeproj/project.pbxproj"
]) {
  run("/usr/bin/plutil", ["-lint", path]);
}
const info = text("App/Info.plist");
const entitlements = text("App/Responder.entitlements");
const privacy = text("App/PrivacyInfo.xcprivacy");
assert.match(info, /https:\/\/sitesourcery\.com\/api\/v1/u);
assert.match(info, /<string>remote-notification<\/string>/u);
assert.match(info, /<string>voip<\/string>/u);
assert.match(entitlements, /<key>aps-environment<\/key>/u);
assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/u);
assert.doesNotMatch(privacy, /NSPrivacyCollectedDataTypePreciseLocation/u);
pass("plist-entitlement-privacy-contract");

run("/usr/bin/swiftc", ["-frontend", "-parse", ...expectedSwift]);
pass("swift-syntax-parse");

run("/usr/bin/swiftc", [
  "-typecheck", "-parse-as-library",
  "Sources/ResponderCore/APIClient.swift",
  "Sources/ResponderCore/ClientAuthority.swift",
  "Sources/ResponderCore/Models.swift",
  "App/Configuration.swift",
  "App/Security/KeychainStore.swift",
  "App/Push/PushRegistrationCoordinator.swift"
]);
pass("platform-neutral-app-typecheck");

const coreProof = run("/usr/bin/swift", [
  "run", "--disable-sandbox", "ResponderCoreProof"
]);
assert.match(coreProof, /responder-ios-core-proof 9\/9 effects=held/u);
pass("compiled-core-proof");

const api = text("Sources/ResponderCore/APIClient.swift");
assert.match(api, /X-CSRF-Token/u);
assert.match(api, /X-SiteSourcery-Organization-Id/u);
assert.match(api, /Idempotency-Key/u);
assert.doesNotMatch(api, /setValue\([^\n]*Authorization/u);
assert.match(api, /baseURL\.scheme == "https"/u);
pass("cookie-csrf-no-bearer-authority");

const appDelegate = text("App/AppDelegate.swift");
const pushKit = text("App/Push/PushKitCoordinator.swift");
const twilioVoice = text("App/Calls/TwilioVoiceCoordinator.swift");
assert.match(appDelegate, /purpose: \.notification/u);
assert.match(
  appDelegate,
  /didFinishLaunchingWithOptions[\s\S]*pushKit\.start\(\)[\s\S]*return true/iu
);
assert.match(pushKit, /desiredPushTypes = \[\.voIP\]/u);
assert.match(pushKit, /voice\.handleNotification/u);
assert.doesNotMatch(pushKit, /VoIPInvitation|responder-voip-invitation/iu);
assert.doesNotMatch(pushKit, /alert|badge|messageBody|callerName/iu);
pass("ordinary-push-and-voip-separation");

const callKit = text("App/Calls/CallKitCoordinator.swift");
const model = text("App/AppModel.swift");
assert.match(callKit, /CXProvider/u);
assert.match(callKit, /CXCallEndedReason/u);
for (const pattern of [
  /@preconcurrency import TwilioVoice/u,
  /TwilioVoiceSDK\.register/u,
  /TwilioVoiceSDK\.unregister/u,
  /TwilioVoiceSDK\.handleNotification/u,
  /NotificationDelegate/u,
  /CallDelegate/u,
  /AcceptOptions\(callInvite:/u,
  /invitation\.accept\(options:/u,
  /invitation\.reject\(\)/u,
  /call\.disconnect\(\)/u,
  /TwilioVoiceSDK\.audioDevice = audioDevice/u,
  /audioDevice\.isEnabled = true/u,
  /audioDevice\.isEnabled = false/u
]) assert.match(twilioVoice, pattern);
assert.match(twilioVoice, /cancelledCallInvite\.callSid/iu);
assert.match(twilioVoice, /guard let callId = call\.uuid/iu);
assert.match(twilioVoice, /deviceToken\.count <= 512/iu);
assert.match(
  twilioVoice,
  /currentCredential\.authorityId != credential\.authorityId[\s\S]*setPendingUnregister\(true\)/iu
);
assert.match(
  twilioVoice,
  /unregisterAuthorization \?\? desiredCredential/iu
);
assert.match(
  twilioVoice,
  /candidate\?\.authorityId == expected\.authorityId[\s\S]*candidate\?\.deviceToken == expected\.deviceToken/iu
);
assert.match(twilioVoice, /operation == nil[\s\S]*pendingUnregister/iu);
assert.match(twilioVoice, /explicitlyDisabledKey[\s\S]*pendingUnregisterKey/iu);
assert.match(twilioVoice, /claimPendingPush\(\)[\s\S]*finishPush\(id:/iu);
assert.doesNotMatch(twilioVoice, /pendingPushOrder/iu);
assert.match(
  twilioVoice,
  /maximumRetryAttempts = 3[\s\S]*scheduleRetry\(\.registration\)[\s\S]*scheduleRetry\(\.unregistration\)/iu
);
assert.match(twilioVoice, /recordPermission == \.granted/iu);
assert.match(model, /requestVoIPSession/u);
assert.match(model, /providerAuthorizationEffects/u);
assert.match(
  model,
  /responderNativeClient\.mounted == true[\s\S]*disableVoiceTransport/iu
);
assert.match(model, /requestRecordPermission/iu);
assert.match(
  model,
  /let voiceDisabled = await self\.disableVoiceTransport[\s\S]*guard voiceDisabled[\s\S]*suspendForLogout/iu
);
assert.match(
  model,
  /currentVoIPToken != data[\s\S]*voiceAuthorizationGeneration \+= 1/iu
);
assert.match(
  model,
  /nativeInstallation\?\.revision == installation\.revision[\s\S]*currentVoIPToken == token/iu
);
assert.match(
  model,
  /let priorRevision = nativeInstallation\?\.revision[\s\S]*purpose == \.voip \|\| \([\s\S]*currentVoIPToken != nil[\s\S]*updated\.state == \.active[\s\S]*updated\.revision != priorRevision[\s\S]*prepareVoiceTransportIfAuthorized/iu
);
assert.match(
  model,
  /releaseCurrentWorkspaceAuthorityIfNeeded[\s\S]*api\.selectOrganization\(selected\.organizationId\)[\s\S]*disableVoiceTransport[\s\S]*suspendForLogout[\s\S]*resetSession/iu
);
const pushRegistration = text("App/Push/PushRegistrationCoordinator.swift");
assert.match(
  pushRegistration,
  /installation = selected[\s\S]*commandLedger\.complete/iu
);
assert.match(
  pushRegistration,
  /native-token-retirement-intent[\s\S]*reconcilePendingRetirements/iu
);
assert.match(
  pushRegistration,
  /let created = try validated[\s\S]*installation = created[\s\S]*commandLedger\.complete/iu
);
assert.match(
  pushRegistration,
  /receipt\.commandId == expectedCommandId/iu
);
assert.match(pushRegistration, /NATIVE_WORKSPACE_RELEASE_REQUIRED/iu);
assert.match(
  pushRegistration,
  /private var mutationInProgress = false[\s\S]*private var mutationWaiters: \[CheckedContinuation<Void, Never>\][\s\S]*acquireMutationLane[\s\S]*releaseMutationLane/iu
);
assert.match(
  pushRegistration,
  /while let purpose = orderedPurposes\.first[\s\S]*if pendingTokens\[purpose\] == token[\s\S]*pendingTokens\.removeValue/iu
);
assert.match(
  pushRegistration,
  /func invalidate\(purpose: NativePushPurpose\) async throws[\s\S]*acquireMutationLane[\s\S]*guard let projectId = installation\?\.projectId else \{[\s\S]*return nil[\s\S]*retireTokenWithinMutationLane/iu
);
const xcodeProject = text("Responder.xcodeproj/project.pbxproj");
assert.match(
  xcodeProject,
  /TwilioVoice in Frameworks[\s\S]*productRef = [^;]+[\s\S]*productName = TwilioVoice/iu
);
assert.match(xcodeProject, /@executable_path\/Frameworks/iu);
assert.match(xcodeProject, /ENABLE_DEBUG_DYLIB = NO/iu);
assert.doesNotMatch(twilioVoice, /CXStartCallAction|outgoingAllowed:\s*true/iu);
pass("official-twilio-voice-lifecycle");

const applicationSource = expectedSwift
  .map((path) => text(path))
  .join("\n");
assert.doesNotMatch(
  applicationSource,
  /MFMessageComposeViewController|sms:\/\/|sms:|CTCallCenter|CXStartCallAction/u
);
assert.doesNotMatch(applicationSource, /\*72|\*92|##21#|carrierCodeValue/u);
assert.doesNotMatch(applicationSource, /print\([^\n]*(token|password|cookie)/iu);
pass("no-carrier-command-or-silent-sms-source");

const xcodeDeveloper = "/Applications/Xcode.app/Contents/Developer";
const xcodePresent = existsSync(xcodeDeveloper);
let iphoneSDKStatus = "unavailable";
if (xcodePresent) {
  try {
    const sdkListing = run("/usr/bin/xcodebuild", ["-showsdks"], {
      DEVELOPER_DIR: xcodeDeveloper
    });
    assert.match(sdkListing, /iphoneos/iu);
    iphoneSDKStatus = "available";
  } catch (error) {
    const detail = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
    assert.match(detail, /license agreement/iu);
    iphoneSDKStatus = "license-unaccepted";
  }
} else {
  assert.equal(existsSync("/Library/Developer/CommandLineTools/SDKs/iPhoneOS.sdk"), false);
}
pass("iphone-sdk-status-truth");

assert.deepEqual(passed, expectedGates);
process.stdout.write(
  `responder-ios-client-proof ${passed.length}/${expectedGates.length} ` +
  `iphoneSDK=${iphoneSDKStatus} ` +
  "providerEffects=false carrierEffects=false messageEffects=false\n"
);
