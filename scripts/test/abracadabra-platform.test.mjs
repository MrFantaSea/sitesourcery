import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const platformModule = require("../../abracadabra/platform/abracadabra-platform.js");
const platformSource = readFileSync(
  new URL("../../abracadabra/platform/abracadabra-platform.js", import.meta.url),
  "utf8",
);
const viewerSource = readFileSync(
  new URL("../../abracadabra/site/viewer.js", import.meta.url),
  "utf8",
);
const viewerHtmlSource = readFileSync(
  new URL("../../abracadabra/site/index.html", import.meta.url),
  "utf8",
);
const controlSource = readFileSync(
  new URL("../../abracadabra/app/abracadabra-control.js", import.meta.url),
  "utf8",
);

test("control room boots from the created platform before exposing local rehearsal account access", () => {
  assert.match(
    controlSource,
    /var platform;[\s\S]{0,500}?try \{[\s\S]{0,500}?platform = platformModule\.createPlatform\(\{ storage: window\.sessionStorage \}\)/u,
  );
  assert.match(controlSource, /openAccountButton\.disabled = !platform/u);
  assert.match(controlSource, /function resetProjectScopedTransients\(\)/u);
  assert.match(controlSource, /function requireProjectContext\(context\)/u);
  assert.match(controlSource, /data-abracadabra-control-ready", "true"/u);
  assert.doesNotMatch(controlSource, /\bPlatform\./u);
});

test("the published-site frame permits popups without weakening its inert sandbox", () => {
  const sandbox = viewerHtmlSource.match(/<iframe[\s\S]*?\bsandbox="([^"]*)"[\s\S]*?<\/iframe>/u);
  assert.ok(sandbox);
  assert.deepEqual(sandbox[1].trim().split(/\s+/u).filter(Boolean), ["allow-popups"]);
  for (const forbidden of [
    "allow-forms",
    "allow-modals",
    "allow-popups-to-escape-sandbox",
    "allow-same-origin",
    "allow-scripts",
    "allow-top-navigation",
    "allow-top-navigation-by-user-activation",
  ]) {
    assert.equal(sandbox[1].includes(forbidden), false);
  }
  assert.match(viewerSource, /elements\.publishedSite\.srcdoc = inertPublishedHtml\(resolved\.html\)/u);
  assert.match(viewerSource, /querySelectorAll\("script,iframe,frame,object,embed,base"\)/u);
});

test("the passphrase gate keeps the return action visible while exports stay locked", () => {
  const accessGate = viewerSource.match(
    /function showAccessGate\(normalized, message\) \{[\s\S]*?\n  \}/u,
  )?.[0] ?? "";
  assert.match(accessGate, /elements\.statusActions\.hidden = false/u);
  assert.match(accessGate, /setExportAvailable\(false\)/u);
  assert.doesNotMatch(accessGate, /elements\.statusActions\.hidden = true/u);
});

test("revealing exact published bytes moves focus into the newly visible site stage", () => {
  assert.match(
    viewerHtmlSource,
    /<section class="site-stage" id="site-stage"[^>]*tabindex="-1"[^>]*hidden>/u,
  );
  const reveal = viewerSource.match(
    /function showPublishedSite\(normalized, resolved\) \{[\s\S]*?\n  \}/u,
  )?.[0] ?? "";
  assert.match(
    reveal,
    /elements\.statusStage\.hidden = true;\s*elements\.siteStage\.hidden = false;\s*elements\.siteStage\.focus\(\{ preventScroll: true \}\);/u,
  );
});

function viewerCredentialHooks() {
  const context = vm.createContext({
    TextEncoder,
    crypto: webcrypto,
    module: { exports: {} },
  });
  new vm.Script(viewerSource, {
    filename: "abracadabra/site/viewer.js",
  }).runInContext(context);
  return context.module.exports;
}

function browserStorageHub(initialRaw = null) {
  const values = new Map();
  const contexts = [];
  let eventCount = 0;
  let eventDepth = 0;
  let maximumEventDepth = 0;
  let writeCount = 0;
  if (initialRaw !== null) values.set(platformModule.STORE_KEY, String(initialRaw));

  function deliver(source, key, oldValue, newValue, forced = false) {
    if (!forced && oldValue === newValue) return;
    eventDepth += 1;
    maximumEventDepth = Math.max(maximumEventDepth, eventDepth);
    if (eventDepth > 32) {
      throw new Error("storage event delivery exceeded the bounded test guard");
    }
    try {
      for (const context of contexts) {
        if (context === source || typeof context.storageHandler !== "function") continue;
        eventCount += 1;
        context.storageHandler({
          key,
          newValue,
          oldValue,
          storageArea: context.storage,
        });
      }
    } finally {
      eventDepth -= 1;
    }
  }

  return {
    createContext(name) {
      const context = {
        name,
        storageHandler: null,
        storage: null,
      };
      context.storage = {
        getItem(key) {
          return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
          const oldValue = values.has(key) ? values.get(key) : null;
          const newValue = String(value);
          writeCount += 1;
          values.set(key, newValue);
          deliver(context, key, oldValue, newValue);
        },
        removeItem(key) {
          const oldValue = values.has(key) ? values.get(key) : null;
          writeCount += 1;
          values.delete(key);
          deliver(context, key, oldValue, null);
        },
        clear() {
          if (values.size === 0) return;
          writeCount += 1;
          values.clear();
          deliver(context, null, null, null, true);
        },
      };
      contexts.push(context);
      return context;
    },
    metrics() {
      return { eventCount, maximumEventDepth, writeCount };
    },
    raw() {
      return values.get(platformModule.STORE_KEY) || null;
    },
    resetMetrics() {
      eventCount = 0;
      eventDepth = 0;
      maximumEventDepth = 0;
      writeCount = 0;
    },
  };
}

function memoryStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function viewerBrowserHarness({
  lifecycleModule,
  projectId,
  sessionStorage = memoryStorage(),
  storageContext,
  storageGetterBlocked = false,
}) {
  let pendingViewerDigests = 0;
  const viewerCrypto = {
    subtle: {
      async digest(...args) {
        pendingViewerDigests += 1;
        try {
          return await webcrypto.subtle.digest(...args);
        } finally {
          pendingViewerDigests -= 1;
        }
      },
    },
  };

  class FakeElement {
    constructor(id, { hidden = false } = {}) {
      this.attributes = new Map();
      this.children = [];
      this.dataset = {};
      this.disabled = false;
      this.hidden = hidden;
      this.id = id;
      this.listeners = new Map();
      this.textContent = "";
      this.title = "";
      this.value = "";
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    click() {
      return Promise.all((this.listeners.get("click") || []).map((listener) => (
        listener({ currentTarget: this, target: this })
      )));
    }

    focus() {}

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    remove() {}

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    select() {}

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    get srcdoc() {
      return this.getAttribute("srcdoc") || "";
    }

    set srcdoc(value) {
      this.setAttribute("srcdoc", value);
    }
  }

  class FakeDOMParser {
    parseFromString(source) {
      const documentElement = {
        outerHTML: String(source)
          .replace(/^<!doctype[^>]*>/iu, "")
          .trim(),
      };
      return {
        createElement() {
          return new FakeElement("parsed-meta");
        },
        documentElement,
        head: { prepend() {} },
        querySelectorAll() {
          return [];
        },
      };
    }
  }

  const elements = {
    "access-error": new FakeElement("access-error", { hidden: true }),
    "access-form": new FakeElement("access-form", { hidden: true }),
    "detail-project": new FakeElement("detail-project"),
    "detail-retention": new FakeElement("detail-retention"),
    "project-name": new FakeElement("project-name"),
    "published-site": new FakeElement("published-site"),
    "retention-detail": new FakeElement("retention-detail", { hidden: true }),
    "site-passphrase": new FakeElement("site-passphrase"),
    "site-stage": new FakeElement("site-stage", { hidden: true }),
    "site-stage-title": new FakeElement("site-stage-title"),
    "state-chip": new FakeElement("state-chip"),
    "status-actions": new FakeElement("status-actions", { hidden: true }),
    "status-copy": new FakeElement("status-copy"),
    "status-details": new FakeElement("status-details", { hidden: true }),
    "status-kicker": new FakeElement("status-kicker"),
    "status-stage": new FakeElement("status-stage"),
    "status-title": new FakeElement("status-title"),
  };
  const openAccess = new FakeElement("open-access");
  const exportButtons = [
    new FakeElement("header-export", { hidden: true }),
    new FakeElement("status-export", { hidden: true }),
  ];
  elements["access-form"].querySelector = (selector) => (
    selector === "[data-open-access]" ? openAccess : null
  );
  const body = new FakeElement("body");
  body.dataset.viewerState = "loading";
  const document = {
    body,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll(selector) {
      return selector === "[data-export]" ? exportButtons : [];
    },
    title: "Published website · Site Sourcery",
  };
  const windowObject = {
    SiteSourceryAbracadabraPlatform: lifecycleModule,
    crypto: viewerCrypto,
    location: { search: `?project=${encodeURIComponent(projectId)}` },
    requestAnimationFrame(callback) {
      callback();
    },
    sessionStorage,
    setTimeout(callback) {
      callback();
      return 1;
    },
  };
  Object.defineProperty(windowObject, "localStorage", storageGetterBlocked
    ? {
        configurable: true,
        get() {
          throw new Error("local storage is blocked");
        },
      }
    : {
        configurable: true,
        value: storageContext.storage,
      });
  windowObject.addEventListener = (type, listener) => {
    if (type === "storage") storageContext.storageHandler = listener;
  };

  const context = vm.createContext({
    Blob,
    DOMParser: FakeDOMParser,
    TextEncoder,
    URL,
    URLSearchParams,
    crypto: viewerCrypto,
    document,
    window: windowObject,
  });
  new vm.Script(viewerSource, {
    filename: "abracadabra/site/viewer.js",
  }).runInContext(context);

  function readOutput() {
    return {
      accessFormHidden: elements["access-form"].hidden,
      chip: elements["state-chip"].textContent,
      copy: elements["status-copy"].textContent,
      exportButtons: exportButtons.map((button) => ({
        disabled: button.disabled,
        hidden: button.hidden,
      })),
      frameHasSource: elements["published-site"].hasAttribute("srcdoc"),
      frameSource: elements["published-site"].getAttribute("srcdoc"),
      projectName: elements["project-name"].textContent,
      siteHidden: elements["site-stage"].hidden,
      siteTitle: elements["site-stage-title"].textContent,
      state: body.dataset.viewerState,
      statusHidden: elements["status-stage"].hidden,
      title: elements["status-title"].textContent,
    };
  }

  return {
    async settle() {
      const deadline = Date.now() + 5000;
      let previous = "";
      let quietTurns = 0;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const current = JSON.stringify(readOutput());
        if (
          pendingViewerDigests === 0
          && body.dataset.viewerState !== "loading"
          && current === previous
        ) {
          quietTurns += 1;
          if (quietTurns >= 2) return;
        } else {
          quietTurns = 0;
        }
        previous = current;
      }
      throw new Error("viewer did not settle within the bounded test deadline");
    },
    submitPassphrase(value) {
      elements["site-passphrase"].value = value;
      return openAccess.click();
    },
    output: readOutput,
  };
}

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

test("the private viewer verifies the exact v2 credential emitted by the platform", async () => {
  const { platform } = harness();
  const account = makeAccount(platform, "-viewer");
  const passphrase = "private cafe\u0301 opening phrase";
  const project = platform.createProject({
    accountId: account.id,
    name: "Private Viewer Studio",
    address: { mode: "mode_a", label: "private-viewer-studio" },
    visibility: "private",
    accessPassword: passphrase,
    acceptedTerms: true,
  });
  const hooks = viewerCredentialHooks();
  const emitted = project.access.credential;

  assert.equal(emitted.algorithm, "sha256-iterated-v2");
  assert.equal(emitted.rounds, platformModule.CREDENTIAL_ROUNDS);
  const normalized = hooks.normalizeCredential(emitted);
  assert.equal(normalized.algorithm, "sha256-iterated-v2");
  assert.equal(normalized.rounds, platformModule.CREDENTIAL_ROUNDS);
  assert.equal(
    await hooks.verifyCredential("private café opening phrase", normalized),
    true,
  );
  assert.equal(await hooks.verifyCredential("incorrect opening phrase", normalized), false);
});

test("the private viewer rejects coercible rounds and retains bounded legacy verification", async () => {
  const hooks = viewerCredentialHooks();
  const digest = "a".repeat(64);
  const salt = "0123456789abcdef";
  const v2 = {
    algorithm: "sha256-iterated-v2",
    digest,
    rounds: platformModule.CREDENTIAL_ROUNDS,
    salt,
  };
  for (const credential of [
    { algorithm: "unknown", digest, salt },
    { ...v2, rounds: 1 },
    { ...v2, rounds: 100001 },
    { ...v2, rounds: 12000.5 },
    { ...v2, rounds: "12000" },
    { ...v2, rounds: [12000] },
    { ...v2, salt: "short" },
    { ...v2, digest: "not-a-digest" },
  ]) {
    assert.equal(hooks.normalizeCredential(credential), null);
  }
  assert.equal(hooks.normalizeCredential({ ...v2, rounds: 2 }).rounds, 2);
  assert.equal(hooks.normalizeCredential({ ...v2, rounds: 100000 }).rounds, 100000);

  const legacyPhrase = "legacy opening phrase";
  const legacy = hooks.normalizeCredential({
    algorithm: "sha256-salted-v1",
    digest: platformModule.sha256(`${salt}:${legacyPhrase}`),
    salt,
  });
  assert.equal(await hooks.verifyCredential(legacyPhrase, legacy), true);
  assert.equal(await hooks.verifyCredential("wrong legacy phrase", legacy), false);

  const bareLegacy = hooks.normalizeCredential({
    algorithm: "sha256",
    digest: platformModule.sha256(legacyPhrase),
  });
  assert.equal(await hooks.verifyCredential(legacyPhrase, bareLegacy), true);
  assert.equal(await hooks.verifyCredential("wrong legacy phrase", bareLegacy), false);

  const fingerprint = hooks.credentialFingerprint(v2);
  assert.notEqual(fingerprint, hooks.credentialFingerprint({ ...v2, rounds: 12001 }));
  assert.notEqual(fingerprint, hooks.credentialFingerprint({ ...v2, salt: "fedcba9876543210" }));
  assert.notEqual(fingerprint, hooks.credentialFingerprint({ ...v2, digest: "b".repeat(64) }));
});

test("private lifecycle acknowledgment requires the current grant and exact expected tuple", () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-lifecycle");
  const project = createModeAProject(
    platform,
    account,
    "private-lifecycle",
    "private",
  );
  const version = acceptedVersion(platform, account, project, "Private lifecycle");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });

  const hooks = viewerCredentialHooks();
  const savedProject = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  });
  const expected = {
    artifactDigest: version.artifact.digest,
    hostname: "private-lifecycle.sitesourcery.me",
    projectId: project.id,
    versionId: version.id,
    visibility: "private",
  };
  const request = {
    expected,
    grantFingerprint: hooks.credentialFingerprint(
      hooks.normalizeCredential(savedProject.access.credential),
    ),
    hostname: project.address.hostname,
    lifecycleOnly: true,
  };
  const before = storage.getItem(platformModule.STORE_KEY);
  const acknowledgment = platform.resolveSite(request);
  assert.deepEqual(acknowledgment, { acknowledged: true });
  assert.deepEqual(Object.keys(acknowledgment), ["acknowledged"]);
  for (const forbidden of [
    "artifactDigest",
    "hostname",
    "html",
    "projectId",
    "versionId",
    "visibility",
  ]) {
    assert.equal(Object.hasOwn(acknowledgment, forbidden), false);
  }
  assert.equal(storage.getItem(platformModule.STORE_KEY), before);

  for (const incomplete of [
    { ...request, grantFingerprint: undefined },
    { ...request, grantFingerprint: "wrong-grant" },
    { ...request, expected: undefined },
  ]) {
    assert.throws(
      () => platform.resolveSite(incomplete),
      { code: "ACCESS_DENIED" },
    );
  }
  assert.throws(
    () => platform.resolveSite({
      ...request,
      hostname: "not-a-private-site.sitesourcery.me",
    }),
    { code: "ACCESS_DENIED" },
  );
  for (const [field, wrongValue] of [
    ["artifactDigest", "b".repeat(64)],
    ["hostname", "other.sitesourcery.me"],
    ["projectId", "project_other"],
    ["versionId", "version_other"],
    ["visibility", "public"],
  ]) {
    assert.throws(
      () => platform.resolveSite({
        ...request,
        expected: { ...expected, [field]: wrongValue },
      }),
      { code: "ACCESS_DENIED" },
      field,
    );
  }
  assert.throws(
    () => platform.resolveSite({
      ...request,
      expected: { ...expected, identifyingMetadata: "must-not-be-accepted" },
    }),
    { code: "ACCESS_DENIED" },
  );

  const ordinary = platform.resolveSite({
    accessPassword: "private opening phrase",
    hostname: project.address.hostname,
  });
  assert.equal(ordinary.html, version.artifact.html);
  assert.equal(ordinary.artifactDigest, version.artifact.digest);
  assert.equal(storage.getItem(platformModule.STORE_KEY), before);

  assert.throws(
    () => platform.resolveSite({
      accessPassword: "wrong opening phrase",
      hostname: project.address.hostname,
      lifecycleOnly: "true",
    }),
    { code: "ACCESS_DENIED" },
  );
  assert.throws(
    () => platform.resolveSite({
      accessPassword: "short",
      hostname: project.address.hostname,
    }),
    { code: "ACCESS_DENIED" },
  );

  platform.setVisibility({
    accessPassword: "replacement private phrase",
    accountId: account.id,
    projectId: project.id,
    visibility: "private",
  });
  assert.throws(
    () => platform.resolveSite(request),
    { code: "ACCESS_DENIED" },
  );
  const changedProject = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  });
  const currentRequest = {
    ...request,
    grantFingerprint: hooks.credentialFingerprint(
      hooks.normalizeCredential(changedProject.access.credential),
    ),
  };
  assert.deepEqual(platform.resolveSite(currentRequest), { acknowledged: true });
});

test("private lifecycle acknowledgment fails closed across a clock transition", () => {
  const { platform, setClock } = harness();
  const account = makeAccount(platform, "-lifecycle-clock");
  const project = createModeAProject(
    platform,
    account,
    "private-lifecycle-clock",
    "private",
  );
  const version = acceptedVersion(platform, account, project, "Private lifecycle clock");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.recordPaymentFailure({
    accountId: account.id,
    at: "2026-07-27T12:00:00.000Z",
    projectId: project.id,
  });
  const hooks = viewerCredentialHooks();
  const current = platform.getProject({
    accountId: account.id,
    projectId: project.id,
  });
  const request = {
    expected: {
      artifactDigest: version.artifact.digest,
      hostname: project.address.hostname,
      projectId: project.id,
      versionId: version.id,
      visibility: "private",
    },
    grantFingerprint: hooks.credentialFingerprint(
      hooks.normalizeCredential(current.access.credential),
    ),
    hostname: project.address.hostname,
    lifecycleOnly: true,
  };
  assert.deepEqual(platform.resolveSite(request), { acknowledged: true });

  setClock("2026-08-11T12:00:00.000Z");
  assert.throws(
    () => platform.resolveSite(request),
    { code: "ACCESS_DENIED" },
  );
  assert.equal(platform.getProject({
    accountId: account.id,
    projectId: project.id,
  }).billing.state, "suspended");
});

test("the viewer fails closed when lifecycle authority or readable storage is unavailable", async () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-fail-closed");
  const project = createModeAProject(platform, account, "viewer-fail-closed");
  const version = acceptedVersion(platform, account, project, "Fail closed");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  const validRaw = storage.getItem(platformModule.STORE_KEY);
  const corruptPlatformSnapshot = JSON.parse(validRaw);
  corruptPlatformSnapshot.accounts = null;

  const closedCases = [
    {
      label: "missing platform",
      lifecycleModule: undefined,
      raw: validRaw,
    },
    {
      label: "platform construction failure",
      lifecycleModule: {
        createPlatform() {
          throw new Error("platform unavailable");
        },
      },
      raw: validRaw,
    },
    {
      label: "platform without a lifecycle resolver",
      lifecycleModule: {
        createPlatform() {
          return {};
        },
      },
      raw: validRaw,
    },
    {
      label: "platform cannot establish current state",
      lifecycleModule: {
        createPlatform() {
          return {
            resolveSite() {
              throw new Error("current state unavailable");
            },
          };
        },
      },
      raw: validRaw,
    },
    {
      label: "adapter-readable but platform-corrupt storage",
      lifecycleModule: platformModule,
      raw: JSON.stringify(corruptPlatformSnapshot),
    },
  ];
  const expectedClosed = {
    accessFormHidden: true,
    chip: "Closed",
    copy: "The saved publication record did not pass the local serving checks. No website bytes were exposed.",
    exportButtons: [
      { disabled: true, hidden: true },
      { disabled: true, hidden: true },
    ],
    frameHasSource: false,
    frameSource: null,
    projectName: "Avery Studio",
    siteHidden: true,
    siteTitle: "",
    state: "missing",
    statusHidden: false,
    title: "This published website could not be opened.",
  };
  for (const scenario of closedCases) {
    const hub = browserStorageHub(scenario.raw);
    const viewer = viewerBrowserHarness({
      lifecycleModule: scenario.lifecycleModule,
      projectId: project.id,
      storageContext: hub.createContext(scenario.label),
    });
    await viewer.settle();
    assert.deepEqual(viewer.output(), expectedClosed, scenario.label);
    assert.equal(hub.metrics().writeCount, 0, scenario.label);
  }

  const expectedUnreadable = {
    accessFormHidden: true,
    chip: "Not found",
    copy: "This device does not contain a readable Abracadabra project store.",
    exportButtons: [
      { disabled: true, hidden: true },
      { disabled: true, hidden: true },
    ],
    frameHasSource: false,
    frameSource: null,
    projectName: "Abracadabra",
    siteHidden: true,
    siteTitle: "",
    state: "missing",
    statusHidden: false,
    title: "The published project was not found.",
  };
  for (const scenario of [
    { label: "missing store", raw: null, storageGetterBlocked: false },
    { label: "corrupt JSON", raw: "{not-json", storageGetterBlocked: false },
    { label: "blocked storage getter", raw: validRaw, storageGetterBlocked: true },
  ]) {
    const hub = browserStorageHub(scenario.raw);
    const viewer = viewerBrowserHarness({
      lifecycleModule: platformModule,
      projectId: project.id,
      storageContext: hub.createContext(scenario.label),
      storageGetterBlocked: scenario.storageGetterBlocked,
    });
    await viewer.settle();
    assert.deepEqual(viewer.output(), expectedUnreadable, scenario.label);
    assert.equal(hub.metrics().writeCount, 0, scenario.label);
  }
});

test("private v1 and v2 session grants expose bytes only after opaque lifecycle acknowledgment", async () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-private-session");
  const project = createModeAProject(
    platform,
    account,
    "private-session",
    "private",
  );
  const version = acceptedVersion(platform, account, project, "Private session proof");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  const originalSnapshot = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  const hooks = viewerCredentialHooks();

  function sessionFor(savedProject) {
    const credential = hooks.normalizeCredential(savedProject.access.credential);
    return memoryStorage({
      "sitesourcery.abracadabra.viewer-session.v1": JSON.stringify({
        schema: "sitesourcery.abracadabra.viewer-session/v1",
        projects: {
          [project.id]: {
            credentialFingerprint: hooks.credentialFingerprint(credential),
            verifiedAt: "2026-07-27T12:00:00.000Z",
          },
        },
      }),
    });
  }

  for (const algorithm of ["sha256-iterated-v2", "sha256-salted-v1"]) {
    const snapshot = structuredClone(originalSnapshot);
    const savedProject = snapshot.projects.find((item) => item.id === project.id);
    if (algorithm === "sha256-salted-v1") {
      const salt = "0123456789abcdef";
      savedProject.access.credential = {
        algorithm,
        digest: platformModule.sha256(`${salt}:private opening phrase`),
        salt,
      };
    }
    const calls = [];
    const lifecycleModule = {
      createPlatform(options) {
        const currentPlatform = platformModule.createPlatform(options);
        return {
          resolveSite(input) {
            calls.push(structuredClone(input));
            return currentPlatform.resolveSite(input);
          },
        };
      },
    };
    const hub = browserStorageHub(JSON.stringify(snapshot));
    const viewer = viewerBrowserHarness({
      lifecycleModule,
      projectId: project.id,
      sessionStorage: sessionFor(savedProject),
      storageContext: hub.createContext(`private-${algorithm}`),
    });
    await viewer.settle();
    const output = viewer.output();
    const credential = hooks.normalizeCredential(savedProject.access.credential);
    assert.deepEqual(calls, [{
      accessPassword: undefined,
      expected: {
        artifactDigest: version.artifact.digest,
        hostname: "private-session.sitesourcery.me",
        projectId: project.id,
        versionId: version.id,
        visibility: "private",
      },
      grantFingerprint: hooks.credentialFingerprint(credential),
      hostname: "private-session.sitesourcery.me",
      lifecycleOnly: true,
    }]);
    assert.deepEqual({
      accessFormHidden: output.accessFormHidden,
      chip: output.chip,
      exportButtons: output.exportButtons,
      frameHasSource: output.frameHasSource,
      projectName: output.projectName,
      siteHidden: output.siteHidden,
      siteTitle: output.siteTitle,
      state: output.state,
      statusHidden: output.statusHidden,
    }, {
      accessFormHidden: true,
      chip: "Published",
      exportButtons: [
        { disabled: false, hidden: false },
        { disabled: false, hidden: false },
      ],
      frameHasSource: true,
      projectName: "Avery Studio",
      siteHidden: false,
      siteTitle: "Avery Studio published website",
      state: "live",
      statusHidden: true,
    }, algorithm);
    assert.match(output.frameSource, /Private session proof website/u);
    assert.equal(hub.metrics().writeCount, 0, algorithm);
  }

  const savedProject = originalSnapshot.projects.find((item) => item.id === project.id);
  const invalidAcknowledgments = [
    ["false acknowledgment", { acknowledged: false }],
    ["identifying project metadata", { acknowledged: true, projectId: project.id }],
    ["website bytes", { acknowledged: true, html: version.artifact.html }],
    ["ordinary publication result", {
      acknowledged: true,
      artifactDigest: version.artifact.digest,
      hostname: project.address.hostname,
      projectId: project.id,
      versionId: version.id,
      visibility: "private",
    }],
  ];
  for (const [label, invalidAcknowledgment] of invalidAcknowledgments) {
    const hub = browserStorageHub(JSON.stringify(originalSnapshot));
    const viewer = viewerBrowserHarness({
      lifecycleModule: {
        createPlatform() {
          return {
            resolveSite() {
              return invalidAcknowledgment;
            },
          };
        },
      },
      projectId: project.id,
      sessionStorage: sessionFor(savedProject),
      storageContext: hub.createContext(`mismatch-${label}`),
    });
    await viewer.settle();
    assert.equal(viewer.output().chip, "Closed", label);
    assert.equal(viewer.output().frameHasSource, false, label);
    assert.equal(viewer.output().siteHidden, true, label);
    assert.equal(hub.metrics().writeCount, 0, label);
  }

  const missingHub = browserStorageHub(JSON.stringify(originalSnapshot));
  const missingViewer = viewerBrowserHarness({
    lifecycleModule: undefined,
    projectId: project.id,
    sessionStorage: sessionFor(savedProject),
    storageContext: missingHub.createContext("private-missing-platform"),
  });
  await missingViewer.settle();
  assert.equal(missingViewer.output().chip, "Closed");
  assert.equal(missingViewer.output().frameHasSource, false);
  assert.equal(missingViewer.output().siteHidden, true);

  const clearSession = sessionFor(savedProject);
  const clearHub = browserStorageHub(JSON.stringify(originalSnapshot));
  const clearWriter = clearHub.createContext("private-clear-writer");
  const clearViewer = viewerBrowserHarness({
    lifecycleModule: platformModule,
    projectId: project.id,
    sessionStorage: clearSession,
    storageContext: clearHub.createContext("private-clear-viewer"),
  });
  await clearViewer.settle();
  assert.equal(clearViewer.output().frameHasSource, true);
  clearWriter.storage.clear();
  await clearViewer.settle();
  assert.equal(clearViewer.output().chip, "Not found");
  assert.equal(clearViewer.output().frameHasSource, false);
  assert.equal(clearViewer.output().siteHidden, true);

  const sessionCleared = sessionFor(savedProject);
  sessionCleared.removeItem("sitesourcery.abracadabra.viewer-session.v1");
  const sessionClearedHub = browserStorageHub(JSON.stringify(originalSnapshot));
  const sessionClearedViewer = viewerBrowserHarness({
    lifecycleModule: platformModule,
    projectId: project.id,
    sessionStorage: sessionCleared,
    storageContext: sessionClearedHub.createContext("private-session-cleared"),
  });
  await sessionClearedViewer.settle();
  assert.equal(sessionClearedViewer.output().chip, "Locked");
  assert.equal(sessionClearedViewer.output().frameHasSource, false);
  assert.equal(sessionClearedViewer.output().siteHidden, true);

  platform.setVisibility({
    accessPassword: "replacement private phrase",
    accountId: account.id,
    projectId: project.id,
    visibility: "private",
  });
  const changedSnapshot = storage.getItem(platformModule.STORE_KEY);
  const replayCalls = [];
  const replayHub = browserStorageHub(changedSnapshot);
  const replayViewer = viewerBrowserHarness({
    lifecycleModule: {
      createPlatform() {
        return {
          resolveSite(input) {
            replayCalls.push(input);
            throw new Error("A replayed grant must not reach lifecycle resolution.");
          },
        };
      },
    },
    projectId: project.id,
    sessionStorage: sessionFor(savedProject),
    storageContext: replayHub.createContext("private-replayed-grant"),
  });
  await replayViewer.settle();
  assert.equal(replayViewer.output().chip, "Locked");
  assert.equal(replayViewer.output().frameHasSource, false);
  assert.deepEqual(replayCalls, []);

  const freshCalls = [];
  const freshSession = memoryStorage();
  const freshHub = browserStorageHub(changedSnapshot);
  const freshViewer = viewerBrowserHarness({
    lifecycleModule: {
      createPlatform(options) {
        const currentPlatform = platformModule.createPlatform(options);
        return {
          resolveSite(input) {
            freshCalls.push(structuredClone(input));
            return currentPlatform.resolveSite(input);
          },
        };
      },
    },
    projectId: project.id,
    sessionStorage: freshSession,
    storageContext: freshHub.createContext("private-fresh-passphrase"),
  });
  await freshViewer.settle();
  assert.equal(freshViewer.output().chip, "Locked");
  await freshViewer.submitPassphrase("wrong replacement phrase");
  await freshViewer.settle();
  assert.equal(freshViewer.output().chip, "Locked");
  assert.equal(freshViewer.output().frameHasSource, false);
  assert.deepEqual(freshCalls, []);

  await freshViewer.submitPassphrase("replacement private phrase");
  await freshViewer.settle();
  assert.deepEqual(freshCalls, [{
    accessPassword: "replacement private phrase",
    hostname: "private-session.sitesourcery.me",
    lifecycleOnly: false,
  }]);
  assert.equal(freshViewer.output().chip, "Published");
  assert.equal(freshViewer.output().frameHasSource, true);
  assert.match(freshViewer.output().frameSource, /Private session proof website/u);
});

test("a stale async viewer completion cannot reopen bytes after a newer storage state", async () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-stale-viewer");
  const project = createModeAProject(platform, account, "stale-viewer");
  const version = acceptedVersion(platform, account, project, "Stale viewer");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  const initialRaw = storage.getItem(platformModule.STORE_KEY);
  const validResolution = platform.resolveSite({ hostname: project.address.hostname });
  let releaseResolution;
  const resolutionStarted = new Promise((resolve) => {
    releaseResolution = { announce: resolve, complete: null };
  });
  const pendingResolution = new Promise((resolve) => {
    releaseResolution.complete = resolve;
  });
  const lifecycleModule = {
    createPlatform() {
      return {
        resolveSite() {
          releaseResolution.announce();
          return pendingResolution;
        },
      };
    },
  };
  const hub = browserStorageHub(initialRaw);
  const writer = hub.createContext("writer");
  const viewer = viewerBrowserHarness({
    lifecycleModule,
    projectId: project.id,
    storageContext: hub.createContext("viewer"),
  });
  await resolutionStarted;

  const newer = JSON.parse(hub.raw());
  newer.revision += 1;
  newer.updatedAt = "2026-07-27T12:01:00.000Z";
  const storedProject = newer.projects.find((item) => item.id === project.id);
  storedProject.billing.state = "suspended";
  storedProject.billing.suspendedAt = "2026-07-27T12:01:00.000Z";
  storedProject.billing.retentionEndsAt = "2026-10-25T12:01:00.000Z";
  storedProject.serving.state = "dark";
  writer.storage.setItem(platformModule.STORE_KEY, JSON.stringify(newer));
  await viewer.settle();

  releaseResolution.complete(validResolution);
  await viewer.settle();
  const output = viewer.output();
  assert.equal(output.chip, "Paused");
  assert.equal(output.frameHasSource, false);
  assert.equal(output.siteHidden, true);
  assert.equal(output.statusHidden, false);
});

test("a cross-tab localStorage clear immediately removes previously exposed website bytes", async () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-storage-clear");
  const project = createModeAProject(platform, account, "storage-clear");
  const version = acceptedVersion(platform, account, project, "Storage clear");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });

  const hub = browserStorageHub(storage.getItem(platformModule.STORE_KEY));
  const writer = hub.createContext("writer");
  const viewer = viewerBrowserHarness({
    lifecycleModule: platformModule,
    projectId: project.id,
    storageContext: hub.createContext("viewer"),
  });
  await viewer.settle();
  assert.equal(viewer.output().frameHasSource, true);
  assert.equal(viewer.output().siteHidden, false);

  hub.resetMetrics();
  writer.storage.clear();
  await viewer.settle();
  assert.equal(viewer.output().chip, "Not found");
  assert.equal(viewer.output().frameHasSource, false);
  assert.equal(viewer.output().siteHidden, true);
  assert.deepEqual(hub.metrics(), {
    eventCount: 1,
    maximumEventDepth: 1,
    writeCount: 1,
  });
});

test("two viewer contexts settle lifecycle storage events without ping-pong revisions", async () => {
  let clock = new Date("2026-07-27T12:00:00.000Z");
  let sequence = 0;
  const hub = browserStorageHub();
  const ownerContext = hub.createContext("owner");
  const owner = platformModule.createPlatform({
    storage: ownerContext.storage,
    clock: () => new Date(clock),
    idFactory: (prefix) => `${prefix}_${++sequence}`,
    randomHex: (bytes) => {
      sequence += 1;
      return sequence.toString(16).padStart(bytes * 2, "0").slice(-bytes * 2);
    },
  });
  const account = makeAccount(owner, "-viewer-tabs");
  const project = createModeAProject(owner, account, "viewer-tabs");
  const version = acceptedVersion(owner, account, project, "Viewer tabs");
  activatePlan(owner, account, project);
  owner.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  owner.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });
  const lifecycleModule = {
    createPlatform(options) {
      return platformModule.createPlatform({
        ...options,
        clock: () => new Date(clock),
      });
    },
  };

  clock = new Date("2026-08-10T11:59:59.999Z");
  const beforeViewerReads = hub.raw();
  const beforeRevision = JSON.parse(beforeViewerReads).revision;
  hub.resetMetrics();
  const firstViewer = viewerBrowserHarness({
    lifecycleModule,
    projectId: project.id,
    storageContext: hub.createContext("viewer-one"),
  });
  await firstViewer.settle();
  const secondViewer = viewerBrowserHarness({
    lifecycleModule,
    projectId: project.id,
    storageContext: hub.createContext("viewer-two"),
  });
  await secondViewer.settle();
  assert.equal(hub.raw(), beforeViewerReads);
  assert.deepEqual(hub.metrics(), {
    eventCount: 0,
    maximumEventDepth: 0,
    writeCount: 0,
  });
  for (const output of [firstViewer.output(), secondViewer.output()]) {
    assert.equal(output.chip, "Published · grace");
    assert.equal(output.frameHasSource, true);
    assert.equal(output.siteHidden, false);
  }

  clock = new Date("2026-08-10T12:00:00.000Z");
  hub.resetMetrics();
  owner.createSupportTicket({
    accountId: account.id,
    projectId: project.id,
    subject: "Boundary event",
    message: "Trigger both viewer contexts at the exact grace boundary.",
  });
  await firstViewer.settle();
  await secondViewer.settle();
  const transitioned = JSON.parse(hub.raw());
  assert.equal(transitioned.revision, beforeRevision + 2);
  assert.equal(transitioned.projects[0].billing.state, "suspended");
  assert.deepEqual(hub.metrics(), {
    eventCount: 3,
    maximumEventDepth: 2,
    writeCount: 2,
  });
  for (const output of [firstViewer.output(), secondViewer.output()]) {
    assert.equal(output.chip, "Paused");
    assert.equal(output.frameHasSource, false);
    assert.equal(output.siteHidden, true);
  }

  hub.resetMetrics();
  const revisionAfterTransition = transitioned.revision;
  owner.createSupportTicket({
    accountId: account.id,
    projectId: project.id,
    subject: "Settled event",
    message: "Confirm ordinary storage events remain bounded after suspension.",
  });
  await firstViewer.settle();
  await secondViewer.settle();
  assert.equal(JSON.parse(hub.raw()).revision, revisionAfterTransition + 1);
  assert.deepEqual(hub.metrics(), {
    eventCount: 2,
    maximumEventDepth: 1,
    writeCount: 1,
  });
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

test("two platform contexts cannot create a read-only revision or storage-event storm", () => {
  let clock = new Date("2026-07-27T12:00:00.000Z");
  let writes = 0;
  let sequence = 0;
  const backing = platformModule.createMemoryStorage();
  const storage = {
    getItem: (key) => backing.getItem(key),
    removeItem: (key) => backing.removeItem(key),
    setItem(key, value) {
      writes += 1;
      backing.setItem(key, value);
    },
  };
  const options = () => ({
    storage,
    clock: () => new Date(clock),
    idFactory: (prefix) => `${prefix}_${++sequence}`,
    randomHex: (bytes) => {
      sequence += 1;
      return sequence.toString(16).padStart(bytes * 2, "0").slice(-bytes * 2);
    },
  });
  const firstContext = platformModule.createPlatform(options());
  const secondContext = platformModule.createPlatform(options());
  const account = makeAccount(firstContext, "-two-viewers");
  const project = createModeAProject(
    firstContext,
    account,
    "two-viewers",
  );
  const version = acceptedVersion(firstContext, account, project, "Two viewers");
  activatePlan(firstContext, account, project);
  firstContext.publish({
    accountId: account.id,
    projectId: project.id,
    versionId: version.id,
  });
  firstContext.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });

  const beforeReads = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  const writesBeforeReads = writes;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal(firstContext.resolveSite({
      hostname: "two-viewers.sitesourcery.me",
    }).projectId, project.id);
    assert.equal(secondContext.resolveSite({
      hostname: "two-viewers.sitesourcery.me",
    }).projectId, project.id);
    assert.equal(firstContext.getProject({
      accountId: account.id,
      projectId: project.id,
    }).id, project.id);
    assert.equal(secondContext.listProjects({
      accountId: account.id,
    })[0].id, project.id);
  }
  const afterReads = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  assert.equal(afterReads.revision, beforeReads.revision);
  assert.equal(writes, writesBeforeReads);

  clock = new Date("2026-08-10T12:00:00.000Z");
  assert.throws(
    () => firstContext.resolveSite({ hostname: "two-viewers.sitesourcery.me" }),
    { code: "SITE_NOT_SERVING" },
  );
  const afterTransition = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  assert.equal(afterTransition.revision, beforeReads.revision + 1);
  assert.equal(writes, writesBeforeReads + 1);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.throws(
      () => secondContext.resolveSite({ hostname: "two-viewers.sitesourcery.me" }),
      { code: "SITE_NOT_SERVING" },
    );
  }
  const afterDarkReads = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  assert.equal(afterDarkReads.revision, afterTransition.revision);
  assert.equal(writes, writesBeforeReads + 1);
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

test("terminal deletion rebuilds the raw project from a minimal allowlist and is idempotent", () => {
  const { platform, storage, setClock } = harness();
  const account = makeAccount(platform, "-delete-contract");
  const markers = {
    projectName: "DELETE-ME project name",
    proof: "DELETE-ME-domain-proof-reference",
    artifact: "DELETE-ME-release-bytes",
    draft: "DELETE-ME-working-draft",
    ticket: "DELETE-ME-support-narrative",
    hold: "DELETE-ME-safety-reason",
    appeal: "DELETE-ME-safety-appeal narrative",
    restoration: "DELETE-ME-billing-restoration",
  };
  const retainedDomain = "customer-keeps-this.example";
  const project = platform.createProject({
    accountId: account.id,
    name: markers.projectName,
    address: { mode: "mode_b", path: "byod", domain: retainedDomain },
    visibility: "private",
    accessPassword: "private deletion fixture phrase",
    acceptedTerms: true,
  });
  const domainOperator = platform.openDomainOperatorSession({
    operatorId: "domain-delete-reviewer",
    secret: "local domain reviewer phrase",
  });
  const proof = platform.requestAddressVerification({
    accountId: account.id,
    projectId: project.id,
    method: "dns_challenge",
    reference: markers.proof,
  });
  platform.completeAddress({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: domainOperator.grant,
    proofRequestId: proof.id,
  });
  const version = acceptedVersion(platform, account, project, markers.artifact);
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  platform.saveDraft({
    accountId: account.id,
    projectId: project.id,
    rawFacts: { businessName: markers.draft, summary: markers.draft },
  });
  const deletedTicket = platform.createSupportTicket({
    accountId: account.id,
    projectId: project.id,
    subject: "Deletion fixture",
    message: markers.ticket,
  });
  const neighbour = createModeAProject(platform, account, "delete-neighbour");
  const neighbourTicket = platform.createSupportTicket({
    accountId: account.id,
    projectId: neighbour.id,
    subject: "Neighbour survives",
    message: "This other project's local note must remain available.",
  });
  platform.recordPaymentFailure({
    accountId: account.id,
    projectId: project.id,
    at: "2026-07-27T12:00:00.000Z",
  });
  setClock("2026-08-11T12:00:00.000Z");
  platform.advanceBilling({ accountId: account.id, projectId: project.id });
  const billingOperator = platform.openBillingOperatorSession({
    operatorId: "billing-delete-reviewer",
    secret: "local billing reviewer phrase",
  });
  platform.restoreService({
    accountId: account.id,
    projectId: project.id,
    operatorGrant: billingOperator.grant,
    reference: markers.restoration,
  });
  const safetyOperator = platform.openSafetyOperatorSession({
    operatorId: "safety-delete-reviewer",
    secret: "local safety reviewer phrase",
  });
  platform.placeSafetyHold({
    projectId: project.id,
    operatorGrant: safetyOperator.grant,
    reason: markers.hold,
  });
  platform.submitSafetyAppeal({
    accountId: account.id,
    projectId: project.id,
    message: markers.appeal,
  });

  const before = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  const beforeProject = before.projects.find((item) => item.id === project.id);
  const removedValues = [
    ...Object.values(markers),
    beforeProject.access.credential.digest,
    deletedTicket.id,
    proof.id,
    version.id,
    ...beforeProject.publicationAttempts.map((item) => item.id),
    ...beforeProject.screeningAttempts.map((item) => item.id),
  ];
  removedValues.forEach((value) => {
    assert.ok(storage.getItem(platformModule.STORE_KEY).includes(value), `fixture missing ${value}`);
  });

  const deleted = platform.deleteProject({ accountId: account.id, projectId: project.id });
  const raw = storage.getItem(platformModule.STORE_KEY);
  const after = JSON.parse(raw);
  const record = after.projects.find((item) => item.id === project.id);
  assert.deepEqual(Object.keys(record).sort(), [
    "access", "accountId", "address", "billing", "billingRestoration", "createdAt",
    "deletion", "draft", "exit", "id", "lifecycle", "name", "organizationId",
    "plan", "publicationAttempts", "safety", "safetyHistory", "screeningAttempts",
    "serving", "supportTicketIds", "terms", "updatedAt", "versions",
  ].sort());
  assert.equal(record.name, null);
  assert.equal(record.lifecycle, "deleted");
  assert.deepEqual(record.access, { visibility: "closed", credential: null });
  assert.equal(record.draft, null);
  assert.deepEqual(record.versions, []);
  assert.deepEqual(record.publicationAttempts, []);
  assert.deepEqual(record.screeningAttempts, []);
  assert.deepEqual(record.supportTicketIds, []);
  assert.equal(record.serving.currentVersionId, null);
  assert.equal(record.serving.previousVersionId, null);
  assert.equal(record.address.domain, retainedDomain);
  assert.equal(record.address.ownership, "customer");
  assert.equal(record.address.state, "detached");
  assert.equal(record.address.hostname, null);
  assert.equal(record.address.verification, null);
  assert.deepEqual(record.address.verificationRequests, []);
  assert.equal(Object.hasOwn(record.billingRestoration, "reference"), false);
  assert.equal(record.billingRestoration.operatorId, "billing-delete-reviewer");
  assert.equal(record.safety.state, "closed");
  assert.equal(record.safety.reason, null);
  assert.equal(record.safety.appealMessage, null);
  assert.deepEqual(
    record.safetyHistory.map((event) => event.kind),
    ["hold", "appeal", "closed_by_deletion"],
  );
  record.safetyHistory.forEach((event) => {
    assert.deepEqual(
      Object.keys(event).filter((key) => ![
        "accountId", "at", "id", "kind", "operatorId", "previousServingState", "servingState",
      ].includes(key)),
      [],
    );
  });
  assert.deepEqual(record.deletion.removed, {
    accessCredential: true,
    billingRestorationReference: true,
    domainProofRecords: 2,
    draft: true,
    projectName: true,
    publicationAttempts: 1,
    safetyNarratives: 4,
    screeningAttempts: 2,
    supportTickets: 1,
    versions: 1,
  });
  assert.equal(record.deletion.policy, platformModule.DELETION_POLICY.id);
  assert.equal(platform.deletionPolicy, platformModule.DELETION_POLICY);
  assert.equal(after.supportTickets.some((ticket) => ticket.projectId === project.id), false);
  assert.deepEqual(after.supportTickets.map((ticket) => ticket.id), [neighbourTicket.id]);
  assert.ok(after.accounts.some((item) => item.id === account.id));
  assert.ok(after.projects.some((item) => item.id === neighbour.id));
  removedValues.forEach((value) => {
    assert.equal(raw.includes(value), false, `${value} survived terminal deletion`);
  });
  assert.ok(raw.includes(retainedDomain));

  const sealed = storage.getItem(platformModule.STORE_KEY);
  assert.deepEqual(platform.deleteProject({ accountId: account.id, projectId: project.id }), deleted);
  assert.equal(storage.getItem(platformModule.STORE_KEY), sealed);
});

test("every post-delete project action fails closed without appending or reviving state", () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-deleted-mutators");
  const project = createModeAProject(platform, account, "released-after-delete", "private");
  const version = acceptedVersion(platform, account, project, "Deleted mutator fixture");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  const safetyOperator = platform.openSafetyOperatorSession({
    operatorId: "safety-post-delete",
    secret: "local safety reviewer phrase",
  });
  const billingOperator = platform.openBillingOperatorSession({
    operatorId: "billing-post-delete",
    secret: "local billing reviewer phrase",
  });
  const domainOperator = platform.openDomainOperatorSession({
    operatorId: "domain-post-delete",
    secret: "local domain reviewer phrase",
  });
  platform.deleteProject({ accountId: account.id, projectId: project.id });
  const scope = { accountId: account.id, projectId: project.id };
  const sealed = storage.getItem(platformModule.STORE_KEY);
  const actions = [
    ["saveDraft", () => platform.saveDraft({ ...scope, rawFacts: { businessName: "After" } })],
    ["saveVersion", () => platform.saveVersion({
      ...scope,
      rawFacts: { businessName: "After" },
      artifact: artifact("After deletion"),
      releaseAttestation: true,
    })],
    ["markVersionReady", () => platform.markVersionReady({ ...scope, versionId: version.id })],
    ["acceptVersion", () => platform.acceptVersion({ ...scope, versionId: version.id })],
    ["activatePlan", () => platform.activatePlan({ ...scope, localRehearsalAcknowledged: true })],
    ["completeAddress", () => platform.completeAddress({
      ...scope,
      operatorGrant: domainOperator.grant,
      proof: { method: "dns_challenge", reference: "proof-after-delete" },
    })],
    ["requestAddressVerification", () => platform.requestAddressVerification({
      ...scope,
      method: "dns_challenge",
      reference: "proof-after-delete",
    })],
    ["setAddress", () => platform.setAddress({
      ...scope,
      address: { mode: "mode_a", label: "replacement-after-delete" },
    })],
    ["setVisibility", () => platform.setVisibility({ ...scope, visibility: "public" })],
    ["placeSafetyHold", () => platform.placeSafetyHold({
      projectId: project.id,
      operatorGrant: safetyOperator.grant,
      reason: "A late hold must not append.",
    })],
    ["submitSafetyAppeal", () => platform.submitSafetyAppeal({
      ...scope,
      message: "A late appeal must not attach to a deleted project.",
    })],
    ["restoreSafetyHold", () => platform.restoreSafetyHold({
      projectId: project.id,
      operatorGrant: safetyOperator.grant,
    })],
    ["publish", () => platform.publish({ ...scope, versionId: version.id })],
    ["unpublish", () => platform.unpublish(scope)],
    ["recordPaymentFailure", () => platform.recordPaymentFailure(scope)],
    ["restoreService", () => platform.restoreService({
      ...scope,
      operatorGrant: billingOperator.grant,
      reference: "billing-after-delete",
    })],
    ["cancelProject", () => platform.cancelProject(scope)],
    ["detachDomain", () => platform.detachDomain(scope)],
    ["createSupportTicket", () => platform.createSupportTicket({
      ...scope,
      subject: "Late note",
      message: "This support note must never be appended.",
    })],
  ];
  actions.forEach(([name, action]) => {
    assert.throws(action, { code: "PROJECT_DELETED" }, name);
    assert.equal(storage.getItem(platformModule.STORE_KEY), sealed, name);
  });
  assert.throws(() => platform.exportProject(scope), { code: "EXPORT_NOT_AVAILABLE" });
  assert.throws(
    () => platform.resolveSite({ hostname: "released-after-delete.sitesourcery.me" }),
    { code: "SITE_NOT_FOUND" },
  );
  assert.deepEqual(platform.listSupportTickets(scope), []);
  assert.equal(platform.getProject(scope).lifecycle, "deleted");
  assert.equal(platform.listProjects({ accountId: account.id })[0].lifecycle, "deleted");
  assert.equal(platform.advanceBilling(scope)[0].lifecycle, "deleted");
  assert.equal(storage.getItem(platformModule.STORE_KEY), sealed);
});

test("a deleted licensed label cannot shadow a later live project using that label", () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-label-release");
  const first = createModeAProject(platform, account, "reusable-label");
  const firstVersion = acceptedVersion(platform, account, first, "First label owner");
  activatePlan(platform, account, first);
  platform.publish({ accountId: account.id, projectId: first.id, versionId: firstVersion.id });
  platform.deleteProject({ accountId: account.id, projectId: first.id });
  const rawFirst = JSON.parse(storage.getItem(platformModule.STORE_KEY))
    .projects.find((project) => project.id === first.id);
  assert.equal(rawFirst.address.state, "released");
  assert.equal(rawFirst.address.label, null);
  assert.equal(rawFirst.address.hostname, null);

  const second = createModeAProject(platform, account, "reusable-label");
  const secondVersion = acceptedVersion(platform, account, second, "Second label owner");
  activatePlan(platform, account, second);
  platform.publish({ accountId: account.id, projectId: second.id, versionId: secondVersion.id });
  const resolved = platform.resolveSite({ hostname: "reusable-label.sitesourcery.me" });
  assert.equal(resolved.projectId, second.id);
  assert.ok(resolved.html.includes("Second label owner"));
});

test("a legacy deleted record is purged before a viewer can resolve stale bytes", () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-legacy-delete");
  const project = createModeAProject(platform, account, "legacy-deleted-label");
  const version = acceptedVersion(platform, account, project, "LEGACY-DELETE-BYTES");
  activatePlan(platform, account, project);
  platform.publish({ accountId: account.id, projectId: project.id, versionId: version.id });
  const legacy = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  const legacyProject = legacy.projects.find((item) => item.id === project.id);
  legacyProject.lifecycle = "deleted";
  legacyProject.plan.status = "cancelled";
  legacyProject.billing.state = "deleted";
  legacyProject.billing.deletedAt = "2026-07-27T12:00:00.000Z";
  legacyProject.deletion = null;
  storage.setItem(platformModule.STORE_KEY, JSON.stringify(legacy));
  const stale = storage.getItem(platformModule.STORE_KEY);
  assert.ok(stale.includes("LEGACY-DELETE-BYTES"));
  assert.ok(stale.includes("legacy-deleted-label.sitesourcery.me"));

  assert.throws(
    () => platform.resolveSite({ hostname: "legacy-deleted-label.sitesourcery.me" }),
    { code: "SITE_NOT_FOUND" },
  );
  const purged = storage.getItem(platformModule.STORE_KEY);
  assert.equal(purged.includes("LEGACY-DELETE-BYTES"), false);
  assert.equal(purged.includes("legacy-deleted-label.sitesourcery.me"), false);
  const record = JSON.parse(purged).projects.find((item) => item.id === project.id);
  assert.equal(record.deletion.policy, platformModule.DELETION_POLICY.id);
  assert.deepEqual(record.versions, []);
});

test("a spoofed current deletion policy cannot preserve reattached bytes or tickets", () => {
  const { platform, storage } = harness();
  const account = makeAccount(platform, "-spoofed-delete");
  const project = createModeAProject(platform, account, "spoofed-delete-label");
  platform.deleteProject({ accountId: account.id, projectId: project.id });
  const tampered = JSON.parse(storage.getItem(platformModule.STORE_KEY));
  const record = tampered.projects.find((item) => item.id === project.id);
  const originalDeletionAt = record.deletion.at;
  record.name = "SPOOFED-CURRENT-POLICY-CONTENT";
  record.draft = { rawFacts: { secret: "SPOOFED-CURRENT-POLICY-CONTENT" } };
  record.versions = [{ id: "stale-version", artifact: { html: "SPOOFED-CURRENT-POLICY-CONTENT" } }];
  record.address.label = "spoofed-delete-label";
  record.address.hostname = "spoofed-delete-label.sitesourcery.me";
  record.address.state = "configured";
  record.safetyHistory[0].message = "SPOOFED-CURRENT-POLICY-CONTENT";
  tampered.supportTickets.push({
    id: "stale-ticket",
    accountId: account.id,
    projectId: project.id,
    subject: "SPOOFED-CURRENT-POLICY-CONTENT",
    message: "SPOOFED-CURRENT-POLICY-CONTENT",
  });
  storage.setItem(platformModule.STORE_KEY, JSON.stringify(tampered));
  assert.equal(record.deletion.policy, platformModule.DELETION_POLICY.id);

  const repaired = platform.getProject({ accountId: account.id, projectId: project.id });
  const raw = storage.getItem(platformModule.STORE_KEY);
  assert.equal(raw.includes("SPOOFED-CURRENT-POLICY-CONTENT"), false);
  assert.equal(raw.includes("spoofed-delete-label.sitesourcery.me"), false);
  assert.equal(raw.includes("stale-ticket"), false);
  assert.equal(repaired.deletion.at, originalDeletionAt);
  assert.equal(
    repaired.safetyHistory.filter((event) => event.kind === "closed_by_deletion").length,
    1,
  );
  assert.equal(repaired.deletion.removed.versions, 1);
  assert.equal(repaired.deletion.removed.supportTickets, 1);
});

test("local platform deletion stays internal while hosted project deletion is explicit", () => {
  const appMarkup = readFileSync(new URL("../../abracadabra/app/index.html", import.meta.url), "utf8");
  const hostedControlMarkup = readFileSync(
    new URL("../../scripts/hosted-truth/fragments/abracadabra-app-control.html", import.meta.url),
    "utf8",
  );
  assert.match(controlSource, /workroom\.hidden = deleted/u);
  assert.match(controlSource, /maker\.loadProject\(\{ draft: null, versions: \[\], serving:/u);
  assert.match(controlSource, /\[data-create-ticket\]"\)\.hidden = deleted/u);
  assert.match(controlSource, /Proof reference removed/u);
  assert.doesNotMatch(
    appMarkup,
    /data-delete-project|Delete website project|Project deletion is terminal/iu,
  );
  assert.match(hostedControlMarkup, /data-delete-project/u);
  assert.match(hostedControlMarkup, /Delete website project/u);
  assert.match(hostedControlMarkup, /does not delete the separate Site Sourcery account/u);
});
