import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const platformModule = require("../../abracadabra/platform/abracadabra-platform.js");
const platformSource = readFileSync(
  new URL("../../abracadabra/platform/abracadabra-platform.js", import.meta.url),
  "utf8",
);

function harness() {
  let clock = new Date("2026-07-27T12:00:00.000Z");
  let sequence = 0;
  const storage = platformModule.createMemoryStorage();
  const platform = platformModule.createPlatform({
    storage,
    clock: () => new Date(clock),
    safetyOperatorSecret: "local safety reviewer phrase",
    billingOperatorSecret: "local billing reviewer phrase",
    domainOperatorSecret: "local domain reviewer phrase",
    idFactory: (prefix) => `${prefix}_${++sequence}`,
    randomHex: (bytes) => {
      sequence += 1;
      return sequence.toString(16).padStart(bytes * 2, "0").slice(-bytes * 2);
    },
  });
  return {
    platform,
    storage,
    setClock(value) {
      clock = new Date(value);
    },
  };
}

function makeAccount(platform, suffix = "") {
  return platform.createAccount({
    name: `Avery Owner${suffix}`,
    organizationName: `Avery Studio${suffix}`,
    email: `owner${suffix}@example.com`,
    password: "correct horse battery staple",
  });
}

function artifact(label = "First") {
  const html = `<!DOCTYPE html><html lang="en"><head><title>${label}</title></head><body><main><h1>${label} website</h1><p>This is a complete deterministic local fixture.</p></main></body></html>`;
  return {
    html,
    digest: platformModule.sha256(html),
  };
}

function createModeAProject(platform, account, label = "avery-studio", visibility = "public") {
  return platform.createProject({
    accountId: account.id,
    name: "Avery Studio",
    address: { mode: "mode_a", label },
    visibility,
    accessPassword: visibility === "private" ? "private opening phrase" : undefined,
    acceptedTerms: true,
  });
}

function activatePlan(platform, account, project) {
  return platform.activatePlan({
    accountId: account.id,
    projectId: project.id,
    localRehearsalAcknowledged: true,
  });
}

function acceptedVersion(platform, account, project, label = "First") {
  const saved = platform.saveVersion({
    accountId: account.id,
    projectId: project.id,
    rawFacts: { businessName: "Avery Studio", summary: `${label} summary` },
    artifact: artifact(label),
    releaseAttestation: true,
  });
  platform.markVersionReady({
    accountId: account.id,
    projectId: project.id,
    versionId: saved.id,
  });
  return platform.acceptVersion({
    accountId: account.id,
    projectId: project.id,
    versionId: saved.id,
  });
}

test("accounts sign in, recover through the local mail sink, and never expose password records", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  assert.equal(account.email, "owner@example.com");
  assert.equal(Object.hasOwn(account, "password"), false);
  assert.equal(platform.signIn({
    email: "OWNER@example.com",
    password: "correct horse battery staple",
  }).id, account.id);
  assert.throws(
    () => platform.signIn({ email: account.email, password: "wrong password" }),
    { code: "SIGN_IN_FAILED" },
  );

  const request = platform.requestRecovery({ email: account.email });
  const mail = platform.listMail({ accountId: account.id });
  assert.equal(mail.length, 1);
  assert.equal(mail[0].recoveryRequestId, request.requestId);
  assert.match(mail[0].recoveryToken, /^[a-f0-9]{48}$/);
  const recoveryToken = mail[0].recoveryToken;
  platform.resetPassword({
    token: recoveryToken,
    password: "a completely new password",
  });
  assert.equal(platform.signIn({
    email: account.email,
    password: "a completely new password",
  }).id, account.id);
  const consumedMail = platform.listMail({ accountId: account.id })[0];
  assert.equal(consumedMail.recoveryToken, null);
  assert.ok(consumedMail.consumedAt);
  const unknownRequest = platform.requestRecovery({ email: "nobody@example.com" });
  assert.deepEqual(Object.keys(unknownRequest).sort(), Object.keys(request).sort());
  assert.equal(Object.hasOwn(request, "messageId"), false);
  assert.equal(Object.hasOwn(platform, "snapshot"), false);
});

test("a newer recovery request invalidates every older unused link", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const firstRequest = platform.requestRecovery({ email: account.email });
  const firstToken = platform.readLocalMail({
    email: account.email,
    requestId: firstRequest.requestId,
  }).recoveryToken;
  const secondRequest = platform.requestRecovery({ email: account.email });
  const secondToken = platform.readLocalMail({
    email: account.email,
    requestId: secondRequest.requestId,
  }).recoveryToken;

  assert.throws(
    () => platform.resetPassword({
      token: firstToken,
      password: "an invalidated recovery password",
    }),
    { code: "RECOVERY_FAILED" },
  );
  const firstMail = platform.readLocalMail({
    email: account.email,
    requestId: firstRequest.requestId,
  });
  assert.equal(firstMail.recoveryToken, null);
  assert.ok(firstMail.supersededAt);

  platform.resetPassword({
    token: secondToken,
    password: "the newest recovery password",
  });
  assert.equal(platform.signIn({
    email: account.email,
    password: "the newest recovery password",
  }).id, account.id);
});

test("each account owns an organization and project creation records exact accepted terms", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const organizations = platform.listOrganizations({ accountId: account.id });
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0].name, "Avery Studio");
  assert.deepEqual(account.organizationIds, [organizations[0].id]);

  assert.throws(
    () => platform.createProject({
      accountId: account.id,
      organizationId: organizations[0].id,
      name: "Terms missing",
      address: { mode: "mode_a", label: "terms-missing" },
      visibility: "public",
    }),
    { code: "TERMS_REQUIRED" },
  );

  const project = platform.createProject({
    accountId: account.id,
    organizationId: organizations[0].id,
    name: "Terms recorded",
    address: { mode: "mode_a", label: "terms-recorded" },
    visibility: "public",
    acceptedTerms: true,
  });
  assert.equal(project.organizationId, organizations[0].id);
  assert.deepEqual(project.terms, {
    ...platformModule.TERMS,
    acceptedAt: "2026-07-27T12:00:00.000Z",
  });
  assert.equal(project.safety.state, "clear");
  assert.equal(project.plan.id, "abracadabra-website");
  assert.equal(platformModule.PLAN_ID, "abracadabra-website");
});

test("the two monthly address modes preserve exact ownership and fail closed on collisions", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const modeA = createModeAProject(platform, account);
  assert.deepEqual(modeA.address, {
    mode: "mode_a",
    path: "licensed",
    label: "avery-studio",
    hostname: "avery-studio.sitesourcery.me",
    ownership: "licensed",
    state: "configured",
  });

  const purchase = platform.createProject({
    accountId: account.id,
    name: "Purchased domain",
    address: { mode: "mode_b", path: "purchase", domain: "example-shop.com" },
    visibility: "public",
    acceptedTerms: true,
  });
  assert.equal(purchase.address.ownership, "customer");
  assert.equal(purchase.address.state, "order_pending");
  const domainOperator = platform.openDomainOperatorSession({
    operatorId: "domain-reviewer",
    secret: "local domain reviewer phrase",
  });
  assert.equal(platform.completeAddress({
    accountId: account.id,
    projectId: purchase.id,
    operatorGrant: domainOperator.grant,
    proof: { method: "registrar_receipt", reference: "receipt-example-shop-001" },
  }).state, "configured");

  const byod = platform.createProject({
    accountId: account.id,
    name: "Connected domain",
    address: { mode: "mode_b", path: "byod", domain: "owned.example" },
    visibility: "private",
    accessPassword: "access controlled phrase",
    acceptedTerms: true,
  });
  assert.equal(byod.address.state, "connection_pending");
  assert.equal(byod.access.visibility, "private");
  assert.match(byod.access.credential.digest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(byod).includes("access controlled phrase"), false);

  assert.throws(
    () => platform.createProject({
      accountId: account.id,
      name: "Collision",
      address: { mode: "mode_a", label: "avery-studio" },
      visibility: "public",
      acceptedTerms: true,
    }),
    { code: "ADDRESS_TAKEN" },
  );
});

test("candidate, acceptance, publish, successor, and rollback states stay separate", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account);
  const first = acceptedVersion(platform, account, project, "First");

  assert.throws(
    () => platform.publish({
      accountId: account.id,
      projectId: project.id,
      versionId: first.id,
    }),
    { code: "PUBLISH_REJECTED" },
  );

  activatePlan(platform, account, project);
  const firstPublish = platform.publish({
    accountId: account.id,
    projectId: project.id,
    versionId: first.id,
  });
  assert.equal(firstPublish.project.serving.currentVersionId, first.id);
  assert.equal(firstPublish.project.serving.state, "live");
  assert.equal(platform.resolveSite({
    hostname: "avery-studio.sitesourcery.me",
  }).artifactDigest, first.artifact.digest);

  const second = acceptedVersion(platform, account, project, "Second");
  platform.publish({
    accountId: account.id,
    projectId: project.id,
    versionId: second.id,
  });
  const successor = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(successor.serving.currentVersionId, second.id);
  assert.equal(successor.serving.previousVersionId, first.id);

  platform.unpublish({ accountId: account.id, projectId: project.id });
  platform.publish({
    accountId: account.id,
    projectId: project.id,
    versionId: second.id,
  });
  const republished = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(republished.serving.currentVersionId, second.id);
  assert.equal(republished.serving.previousVersionId, first.id);

  platform.publish({
    accountId: account.id,
    projectId: project.id,
    versionId: first.id,
  });
  const rollback = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(rollback.serving.currentVersionId, first.id);
  assert.equal(rollback.serving.previousVersionId, second.id);
  assert.equal(rollback.versions.length, 2);
});

test("access-controlled publishing requires the saved passphrase", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "private-studio", "private");
  const version = acceptedVersion(platform, account, project);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });

  assert.throws(
    () => platform.resolveSite({
      hostname: "private-studio.sitesourcery.me",
      accessPassword: "wrong opening phrase",
    }),
    { code: "ACCESS_DENIED" },
  );
  const resolved = platform.resolveSite({
    hostname: "private-studio.sitesourcery.me",
    accessPassword: "private opening phrase",
  });
  assert.equal(resolved.visibility, "private");
  assert.equal(Object.isFrozen(resolved), true);
});

test("a safety hold immediately darkens a site, accepts an appeal, and restores the same release", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "safety-studio");
  const version = acceptedVersion(platform, account, project);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });

  assert.throws(
    () => platform.placeSafetyHold({
      projectId: project.id,
      reason: "Reported impersonation requires a human review.",
    }),
    { code: "SAFETY_OPERATOR_REQUIRED" },
  );
  const operator = platform.openSafetyOperatorSession({
    operatorId: "reviewer-one",
    secret: "local safety reviewer phrase",
  });
  const hold = platform.placeSafetyHold({
    projectId: project.id,
    operatorGrant: operator.grant,
    reason: "Reported impersonation requires a human review.",
  });
  assert.equal(hold.state, "held");
  assert.equal(hold.previousServingState, "live");
  assert.throws(
    () => platform.resolveSite({ hostname: "safety-studio.sitesourcery.me" }),
    { code: "SITE_NOT_SERVING" },
  );
  assert.throws(
    () => platform.publish({
      accountId: account.id,
      projectId: project.id,
      versionId: version.id,
    }),
    { code: "PUBLISH_REJECTED" },
  );

  const appeal = platform.submitSafetyAppeal({
    accountId: account.id,
    projectId: project.id,
    message: "The site belongs to this organization. The supplied business details can be reviewed.",
  });
  assert.equal(appeal.state, "appeal_pending");
  const restored = platform.restoreSafetyHold({
    projectId: project.id,
    operatorGrant: operator.grant,
  });
  assert.equal(restored.state, "clear");
  assert.equal(platform.resolveSite({
    hostname: "safety-studio.sitesourcery.me",
  }).versionId, version.id);
  const firstHistory = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  }).safetyHistory;
  assert.deepEqual(firstHistory.map((entry) => entry.kind), ["hold", "appeal", "restore"]);
  assert.equal(firstHistory[0].reason, "Reported impersonation requires a human review.");
  assert.equal(firstHistory[1].message, appeal.appealMessage);
  assert.equal(firstHistory[2].operatorId, "reviewer-one");

  platform.placeSafetyHold({
    projectId: project.id,
    operatorGrant: operator.grant,
    reason: "A second separately observed concern requires review.",
  });
  const secondHistory = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  }).safetyHistory;
  assert.equal(secondHistory.length, 4);
  assert.deepEqual(secondHistory.slice(0, 3), firstHistory);
  assert.equal(secondHistory[3].kind, "hold");
});

test("nonpayment stays live for 14 days, suspends on day 15, retains 90 days, then deletes", () => {
  const { platform, setClock } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account);
  const version = acceptedVersion(platform, account, project);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });

  setClock("2026-08-10T11:59:59.000Z");
  platform.advanceBilling({
    accountId: account.id,
    projectId: project.id,
    at: "2026-08-10T11:59:59.000Z",
  });
  assert.equal(platform.getProject({
    accountId: account.id,
    projectId: project.id,
  }).billing.state, "grace");
  assert.equal(platform.resolveSite({
    hostname: "avery-studio.sitesourcery.me",
  }).projectId, project.id);

  setClock("2026-08-10T12:00:00.000Z");
  platform.advanceBilling({
    accountId: account.id,
    projectId: project.id,
    at: "2026-08-10T12:00:00.000Z",
  });
  let suspended = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(suspended.billing.state, "suspended");
  assert.equal(suspended.serving.state, "dark");
  assert.equal(suspended.billing.retentionEndsAt, "2026-11-08T12:00:00.000Z");
  assert.equal(platform.exportProject({
    accountId: account.id,
    projectId: project.id,
  }).version.id, version.id);

  setClock("2026-11-08T12:00:00.000Z");
  platform.advanceBilling({
    accountId: account.id,
    projectId: project.id,
    at: "2026-11-08T12:00:00.000Z",
  });
  const deleted = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(deleted.lifecycle, "deleted");
  assert.equal(deleted.versions.length, 0);
  assert.throws(
    () => platform.exportProject({ accountId: account.id, projectId: project.id }),
    { code: "EXPORT_NOT_AVAILABLE" },
  );
});

test("cancellation retains export, customer domain ownership, support history, and terminal deletion", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = platform.createProject({
    accountId: account.id,
    name: "Customer domain",
    address: { mode: "mode_b", path: "byod", domain: "kept-by-customer.example" },
    visibility: "public",
    acceptedTerms: true,
  });
  const domainOperator = platform.openDomainOperatorSession({
    operatorId: "domain-reviewer",
    secret: "local domain reviewer phrase",
  });
  platform.completeAddress({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: domainOperator.grant,
    proof: { method: "dns_challenge", reference: "dns-proof-kept-customer-001" },
  });
  const version = acceptedVersion(platform, account, project);
  const ticket = platform.createSupportTicket({
    accountId: account.id,
    projectId: project.id,
    subject: "Address connection question",
    message: "Please confirm which local connection state this project is using.",
  });
  assert.equal(platform.listSupportTickets({
    accountId: account.id,
    projectId: project.id,
  })[0].id, ticket.id);

  const cancelled = platform.cancelProject({
    accountId: account.id,
    projectId: project.id,
  });
  assert.equal(cancelled.lifecycle, "cancelled");
  assert.equal(cancelled.address.ownership, "customer");
  const detached = platform.detachDomain({
    accountId: account.id,
    projectId: project.id,
  });
  assert.equal(detached.state, "detached");
  assert.equal(detached.hostname, null);
  assert.equal(detached.domain, "kept-by-customer.example");
  assert.equal(platform.exportProject({
    accountId: account.id,
    projectId: project.id,
  }).version.id, version.id);

  platform.deleteProject({ accountId: account.id, projectId: project.id });
  const deleted = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(deleted.address.hostname, null);
  assert.equal(deleted.address.domain, "kept-by-customer.example");
  assert.equal(deleted.address.ownership, "customer");
  assert.equal(deleted.versions.length, 0);
});

test("account-wide billing advancement cannot mutate another account", () => {
  const { platform } = harness();
  const firstAccount = makeAccount(platform, "-first");
  const secondAccount = makeAccount(platform, "-second");
  const firstProject = createModeAProject(platform, firstAccount, "first-studio");
  const secondProject = createModeAProject(platform, secondAccount, "second-studio");
  activatePlan(platform, firstAccount, firstProject);
  activatePlan(platform, secondAccount, secondProject);
  platform.recordPaymentFailure({
    accountId: firstAccount.id,
    projectId: firstProject.id,
    at: "2026-07-27T12:00:00.000Z",
  });
  platform.recordPaymentFailure({
    accountId: secondAccount.id,
    projectId: secondProject.id,
    at: "2026-07-27T12:00:00.000Z",
  });

  const advanced = platform.advanceBilling({
    accountId: firstAccount.id,
    at: "2026-08-11T12:00:00.000Z",
  });
  assert.deepEqual(advanced.map((project) => project.id), [firstProject.id]);
  assert.equal(platform.getProject({
    accountId: firstAccount.id,
    projectId: firstProject.id,
  }).billing.state, "suspended");
  assert.equal(platform.getProject({
    accountId: secondAccount.id,
    projectId: secondProject.id,
  }).billing.state, "grace");
});

test("ordinary site resolution advances suspension and terminal deletion clocks", () => {
  const { platform, setClock } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "clock-studio");
  const version = acceptedVersion(platform, account, project);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });

  setClock("2026-08-11T12:00:00.000Z");
  assert.throws(
    () => platform.resolveSite({ hostname: "clock-studio.sitesourcery.me" }),
    { code: "SITE_NOT_SERVING" },
  );
  assert.equal(platform.getProject({
    accountId: account.id,
    projectId: project.id,
  }).billing.state, "suspended");

  setClock("2026-11-09T12:00:00.000Z");
  assert.throws(
    () => platform.resolveSite({ hostname: "clock-studio.sitesourcery.me" }),
    { code: "SITE_NOT_SERVING" },
  );
  const deleted = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(deleted.lifecycle, "deleted");
  assert.equal(deleted.versions.length, 0);
});

test("an expired restore persists terminal deletion instead of rolling it back", () => {
  const { platform, setClock } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "expired-restore");
  const version = acceptedVersion(platform, account, project);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.cancelProject({ accountId: account.id, projectId: project.id });

  setClock("2026-10-26T12:00:00.000Z");
  const billingOperator = platform.openBillingOperatorSession({
    operatorId: "billing-reviewer",
    secret: "local billing reviewer phrase",
  });
  assert.throws(
    () => platform.restoreService({
      accountId: account.id,
      projectId: project.id,
      operatorGrant: billingOperator.grant,
      reference: "billing-event-expired-001",
    }),
    { code: "RESTORE_NOT_AVAILABLE" },
  );
  const deleted = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(deleted.lifecycle, "deleted");
  assert.equal(deleted.billing.state, "deleted");
  assert.equal(deleted.versions.length, 0);
});

test("service restoration preserves a deliberate unpublished state and rejected publishes remain recorded", () => {
  const { platform, setClock } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "unpublished-restore");
  const version = acceptedVersion(platform, account, project);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.unpublish({ accountId: account.id, projectId: project.id });
  platform.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });
  setClock("2026-08-11T12:00:00.000Z");
  platform.advanceBilling({ accountId: account.id, projectId: project.id });
  const billingOperator = platform.openBillingOperatorSession({
    operatorId: "billing-reviewer",
    secret: "local billing reviewer phrase",
  });
  const restored = platform.restoreService({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: billingOperator.grant,
    reference: "billing-event-restored-001",
  });
  assert.equal(restored.serving.state, "unpublished");

  platform.cancelProject({ accountId: account.id, projectId: project.id });
  assert.throws(
    () => platform.publish({
      accountId: account.id,
      projectId: project.id,
      versionId: version.id,
    }),
    { code: "PUBLISH_REJECTED" },
  );
  const afterRejectedPublish = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  });
  assert.equal(afterRejectedPublish.publicationAttempts.at(-1).outcome, "rejected");
  assert.equal(afterRejectedPublish.publicationAttempts.at(-1).reason, "project_closed");
  assert.throws(
    () => platform.markVersionReady({
      accountId: account.id,
      projectId: project.id,
      versionId: version.id,
    }),
    { code: "PROJECT_CLOSED" },
  );
});

test("project export contains the draft, every version, history, source bundle, and verifiable receipt", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "complete-export");
  const first = acceptedVersion(platform, account, project, "First");
  const second = acceptedVersion(platform, account, project, "Second");
  platform.saveDraft({
    accountId: account.id,
    projectId: project.id,
    rawFacts: { businessName: "Avery Studio", summary: "Newer unsaved branch" },
  });
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: second.id });

  const exported = platform.exportProject({ accountId: account.id, projectId: project.id });
  assert.equal(exported.schema, "sitesourcery.abracadabra.export/v2");
  assert.equal(exported.versions.length, 2);
  assert.deepEqual(exported.versions.map((version) => version.id), [first.id, second.id]);
  assert.equal(exported.draft.rawFacts.summary, "Newer unsaved branch");
  assert.equal(exported.version.id, second.id);
  assert.equal(exported.publicationAttempts.length, 1);
  assert.deepEqual(exported.source, { selfContainedArtifacts: true, assets: [] });
  assert.equal(exported.receipt.versionCount, 2);
  assert.equal(exported.receipt.draftIncluded, true);
  assert.match(exported.receipt.manifestDigest, /^[a-f0-9]{64}$/);
});

test("owner plan activation is explicit local rehearsal state, never provider or payment evidence", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "local-plan-boundary");
  assert.equal(project.plan.activationScope, platformModule.STORAGE_MODE);
  assert.equal(project.billing.authority, platformModule.STORAGE_MODE);
  assert.throws(
    () => platform.activatePlan({ accountId: account.id, projectId: project.id }),
    { code: "LOCAL_REHEARSAL_ACKNOWLEDGEMENT_REQUIRED" },
  );
  assert.throws(
    () => platform.activatePlan({
      accountId: account.id,
      projectId: project.id,
      localRehearsalAcknowledged: true,
      providerReference: "provider-subscription-001",
    }),
    { code: "PROVIDER_AUTHORITY_FORBIDDEN" },
  );
  const activated = activatePlan(platform, account, project);
  assert.equal(activated.plan.status, "active");
  assert.equal(activated.plan.activationScope, platformModule.STORAGE_MODE);
  assert.equal(activated.plan.providerReference, null);
  assert.equal(activated.plan.paymentReceipt, null);
  assert.equal(activated.plan.subscriptionId, null);
  assert.equal(activated.billing.authority, platformModule.STORAGE_MODE);
  assert.equal(activated.billing.providerReference, null);
  assert.equal(activated.billing.paymentReceipt, null);
  assert.equal(activated.billing.subscriptionId, null);
  const exported = platform.exportProject({ accountId: account.id, projectId: project.id });
  assert.equal(exported.receipt.authorityScope, platformModule.STORAGE_MODE);
  assert.equal(exported.receipt.hostedReady, false);
  assert.equal(exported.receipt.providerEvent, false);
});

test("plan activation cannot erase a billing failure and restoration requires separate proof", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "billing-authority");
  activatePlan(platform, account, project);
  platform.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });
  platform.advanceBilling({
    accountId: account.id,
    projectId: project.id,
    at: "2026-08-11T12:00:00.000Z",
  });
  assert.throws(
    () => activatePlan(platform, account, project),
    { code: "BILLING_RESTORE_REQUIRED" },
  );
  assert.throws(
    () => platform.restoreService({
      accountId: account.id,
      projectId: project.id,
      reference: "billing-event-001",
    }),
    { code: "BILLING_OPERATOR_REQUIRED" },
  );
  assert.equal(platform.getProject({
    accountId: account.id,
    projectId: project.id,
  }).billing.state, "suspended");
});

test("repeated cancellation cannot extend the original retained-exit deadline", () => {
  const { platform, setClock } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "fixed-exit-clock");
  const firstCancellation = platform.cancelProject({
    accountId: account.id,
    projectId: project.id,
  });
  setClock("2026-10-24T12:00:00.000Z");
  const repeatedCancellation = platform.cancelProject({
    accountId: account.id,
    projectId: project.id,
  });
  assert.equal(
    repeatedCancellation.billing.retentionEndsAt,
    firstCancellation.billing.retentionEndsAt,
  );
  assert.equal(repeatedCancellation.exit.cancelledAt, firstCancellation.exit.cancelledAt);
});

test("same artifact bytes with changed source facts create a separate immutable version", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "source-preservation");
  const first = platform.saveVersion({
    accountId: account.id,
    projectId: project.id,
    rawFacts: { businessName: "Avery Studio", summary: "First source record" },
    artifact: artifact("Shared bytes"),
    releaseAttestation: true,
  });
  const second = platform.saveVersion({
    accountId: account.id,
    projectId: project.id,
    rawFacts: { businessName: "Avery Studio", summary: "Changed source record" },
    artifact: artifact("Shared bytes"),
    releaseAttestation: true,
  });
  assert.notEqual(first.id, second.id);
  const saved = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(saved.versions.length, 2);
  assert.equal(saved.draft.rawFacts.summary, "Changed source record");
  assert.deepEqual(
    saved.versions.map((version) => version.rawFacts.summary),
    ["First source record", "Changed source record"],
  );
});

test("customer-owned domain configuration requires separate proof authority", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = platform.createProject({
    accountId: account.id,
    name: "Verified domain",
    address: { mode: "mode_b", path: "byod", domain: "verified.example" },
    visibility: "public",
    acceptedTerms: true,
  });
  assert.throws(
    () => platform.completeAddress({
      accountId: account.id,
      projectId: project.id,
      proof: { method: "dns_challenge", reference: "dns-proof-001" },
    }),
    { code: "DOMAIN_OPERATOR_REQUIRED" },
  );
  const operator = platform.openDomainOperatorSession({
    operatorId: "domain-reviewer",
    secret: "local domain reviewer phrase",
  });
  const configured = platform.completeAddress({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: operator.grant,
    proof: { method: "dns_challenge", reference: "dns-proof-001" },
  });
  assert.equal(configured.state, "configured");
  assert.deepEqual(configured.verification, {
    method: "dns_challenge",
    reference: "dns-proof-001",
    verifiedAt: "2026-07-27T12:00:00.000Z",
    operatorId: "domain-reviewer",
    requestId: null,
  });
});

test("a customer-owned domain proof handoff has a visible receipt and remains pending for a separate reviewer", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = platform.createProject({
    accountId: account.id,
    name: "Proof handoff",
    address: { mode: "mode_b", path: "byod", domain: "proof-handoff.example" },
    visibility: "public",
    acceptedTerms: true,
  });
  const first = platform.requestAddressVerification({
    accountId: account.id,
    projectId: project.id,
    method: "dns_challenge",
    reference: "dns-proof-handoff-001",
  });
  assert.equal(first.state, "pending_review");
  const pending = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(pending.address.state, "connection_pending");
  assert.equal(pending.address.verification, null);
  assert.equal(pending.address.verificationRequests.length, 1);
  assert.equal(pending.address.verificationRequests[0].id, first.id);

  const second = platform.requestAddressVerification({
    accountId: account.id,
    projectId: project.id,
    method: "dns_challenge",
    reference: "dns-proof-handoff-002",
  });
  const superseded = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(superseded.address.verificationRequests[0].state, "superseded");
  assert.equal(superseded.address.verificationRequests[1].id, second.id);
  assert.equal(superseded.address.verificationRequests[1].state, "pending_review");

  const domainOperator = platform.openDomainOperatorSession({
    operatorId: "domain-reviewer",
    secret: "local domain reviewer phrase",
  });
  const configured = platform.completeAddress({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: domainOperator.grant,
    proofRequestId: second.id,
  });
  assert.equal(configured.state, "configured");
  assert.equal(configured.verification.requestId, second.id);
  assert.equal(configured.verification.reference, "dns-proof-handoff-002");
  assert.equal(configured.verificationRequests[1].state, "approved");
  assert.equal(configured.verificationRequests[1].operatorId, "domain-reviewer");
});

test("a detached customer domain cannot be reverified or published without reconnection", () => {
  const { platform } = harness();
  const account = makeAccount(platform);
  const project = platform.createProject({
    accountId: account.id,
    name: "Detached domain",
    address: { mode: "mode_b", path: "byod", domain: "detached.example" },
    visibility: "public",
    acceptedTerms: true,
  });
  const domainOperator = platform.openDomainOperatorSession({
    operatorId: "domain-reviewer",
    secret: "local domain reviewer phrase",
  });
  platform.completeAddress({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: domainOperator.grant,
    proof: { method: "dns_challenge", reference: "dns-proof-detached-001" },
  });
  const version = acceptedVersion(platform, account, project, "Detached release");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.cancelProject({ accountId: account.id, projectId: project.id });
  platform.detachDomain({ accountId: account.id, projectId: project.id });
  const billingOperator = platform.openBillingOperatorSession({
    operatorId: "billing-reviewer",
    secret: "local billing reviewer phrase",
  });
  platform.restoreService({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: billingOperator.grant,
    reference: "billing-event-detached-001",
  });

  assert.throws(
    () => platform.completeAddress({
      accountId: account.id,
      projectId: project.id,
      operatorGrant: domainOperator.grant,
      proof: { method: "dns_challenge", reference: "dns-proof-detached-002" },
    }),
    { code: "DOMAIN_DETACHED" },
  );
  assert.throws(
    () => platform.publish({
      accountId: account.id,
      projectId: project.id,
      versionId: version.id,
    }),
    { code: "PUBLISH_REJECTED" },
  );
  const retained = platform.getProject({ accountId: account.id, projectId: project.id });
  assert.equal(retained.address.state, "detached");
  assert.equal(retained.address.hostname, null);
  assert.equal(retained.serving.state, "unpublished");
  assert.throws(
    () => platform.resolveSite({ hostname: "detached.example" }),
    { code: "SITE_NOT_FOUND" },
  );
});

test("the local platform makes no cross-tab lock or atomic-CAS claim", () => {
  const storage = platformModule.createMemoryStorage();
  const first = platformModule.createPlatform({ storage });
  const second = platformModule.createPlatform({ storage });
  assert.equal(platformModule.STORAGE_MODE, "local_rehearsal_nontransactional");
  assert.equal(platformModule.CONCURRENCY_POLICY, "multi_tab_unsupported_not_prevented");
  assert.equal(first.storageMode, platformModule.STORAGE_MODE);
  assert.equal(second.storageMode, platformModule.STORAGE_MODE);
  assert.equal(first.concurrencyPolicy, platformModule.CONCURRENCY_POLICY);
  assert.equal(second.concurrencyPolicy, platformModule.CONCURRENCY_POLICY);
  assert.doesNotMatch(platformSource, /single-writer project store/iu);
  assert.match(
    platformSource,
    /The local project store changed since this operation began\. Reload the current project before continuing\. Multi-tab writes are unsupported\./u,
  );
});

test("release screening gates both acceptance and publication and keeps rejection evidence", () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform);
  const project = createModeAProject(platform, account, "screened-release");

  assert.throws(
    () => platform.saveVersion({
      accountId: account.id,
      projectId: project.id,
      rawFacts: { businessName: "Avery Studio" },
      artifact: artifact("Missing attestation"),
    }),
    { code: "RELEASE_SCREENING_REJECTED" },
  );

  const activeHtml = "<!DOCTYPE html><html><head><title>Bad</title></head><body><script>alert(1)</script><h1>Bad release</h1></body></html>";
  assert.throws(
    () => platform.saveVersion({
      accountId: account.id,
      projectId: project.id,
      rawFacts: { businessName: "Avery Studio" },
      artifact: { html: activeHtml, digest: platformModule.sha256(activeHtml) },
      releaseAttestation: true,
    }),
    { code: "RELEASE_SCREENING_REJECTED" },
  );

  const version = acceptedVersion(platform, account, project, "Safe release");
  assert.equal(version.releaseScreening.state, "passed");
  activatePlan(platform, account, project);

  const stored = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  const storedVersion = stored.projects[0].versions.find((item) => item.id === version.id);
  storedVersion.artifact.html = activeHtml;
  storedVersion.artifact.digest = platformModule.sha256(activeHtml);
  storage.setItem(platformModule.STORE_KEY, JSON.stringify(stored));

  assert.throws(
    () => platform.publish({
      accountId: account.id,
      projectId: project.id,
      versionId: version.id,
    }),
    { code: "PUBLISH_REJECTED" },
  );
  const afterRejection = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  });
  assert.equal(afterRejection.publicationAttempts.at(-1).reason, "release_screening");
  assert.equal(afterRejection.screeningAttempts.at(-1).stage, "pre_publication");
  assert.equal(afterRejection.screeningAttempts.at(-1).state, "rejected");
});
