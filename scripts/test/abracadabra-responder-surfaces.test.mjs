import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SOURCE_PATH = path.join(
  ROOT,
  "abracadabra/app/abracadabra-responder-surfaces.js"
);
const CSS_PATH = path.join(
  ROOT,
  "abracadabra/app/abracadabra-responder-surfaces.css"
);
const SOURCE = await readFile(SOURCE_PATH, "utf8");
const CSS = await readFile(CSS_PATH, "utf8");

const IDS = Object.freeze({
  authority: "10000000-0000-4000-8000-000000000001",
  command: "20000000-0000-4000-8000-000000000001",
  customer: "30000000-0000-4000-8000-000000000001",
  event: "40000000-0000-4000-8000-000000000001",
  interaction: "50000000-0000-4000-8000-000000000001",
  organization: "60000000-0000-4000-8000-000000000001",
  project: "70000000-0000-4000-8000-000000000001"
});
const TIME = "2026-08-11T18:00:00.000Z";

function load() {
  const context = vm.createContext({});
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  return context.SiteSourceryResponderSurfaces;
}

function snapshot(audience = "customer") {
  return {
    schema: "sitesourcery.responder-surface-dashboard/v1",
    audience,
    organizationId: IDS.organization,
    observedAt: TIME,
    mode: "held",
    globalKillEngaged: true,
    sellable: false,
    billingEffects: false,
    providerEffects: false,
    contacts: [{
      id: IDS.authority,
      projectId: IDS.project,
      customerUserId: IDS.customer,
      routeKind: "sms",
      routeDigest: "a".repeat(64),
      purpose: "missed_call_response",
      consentBasis: "explicit_service_request",
      state: "active",
      consentedAt: TIME,
      optedOutAt: null,
      revision: 1
    }],
    interactions: [{
      id: IDS.interaction,
      projectId: IDS.project,
      contactAuthorityId: IDS.authority,
      routeDigest: "a".repeat(64),
      sourceKind: "missed_call",
      state: "open",
      handoffReason: null,
      openedAt: TIME,
      lastEventAt: TIME,
      revision: 1,
      events: [{
        id: IDS.event,
        interactionId: IDS.interaction,
        eventKind: "missed_call",
        messageIntent: "not_applicable",
        state: "applied",
        occurredAt: TIME,
        recordedAt: TIME,
        providerEffects: false
      }],
      heldCommands: [{
        id: IDS.command,
        interactionId: IDS.interaction,
        contactAuthorityId: IDS.authority,
        messageKind: "missed_call_ack",
        state: "held",
        heldReason: "global_kill",
        requestedAt: TIME,
        providerEffects: false,
        deliveryClaimed: false
      }]
    }]
  };
}

class FakeElement {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.textContent = "";
    this.disabled = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(type, listener) {
    const selected = this.listeners.get(type) ?? [];
    selected.push(listener);
    this.listeners.set(type, selected);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  click() {
    for (const listener of this.listeners.get("click") ?? []) listener({});
  }
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

test("customer and operator presentations expose only held digest-safe facts", () => {
  const ui = load();
  const customer = ui.customerPresentation(snapshot());
  assert.equal(customer.heading, "Your held Responder");
  assert.match(customer.summary, /1 consent route, 1 conversation, and 1 event/u);
  assert.match(customer.holdNotice, /Global kill is engaged/u);
  assert.equal(customer.heldCommands, 1);
  const operator = ui.operatorPresentation(snapshot("operator"));
  assert.equal(operator.heading, "Responder operations");
  assert.equal(
    JSON.stringify(operator).match(/phone|messageBody|payload|signature|providerEventId/gu),
    null
  );
});

test("presentation rejects effect drift, arbitrary fields, and raw contact content", () => {
  const ui = load();
  for (const changed of [
    { ...snapshot(), providerEffects: true },
    { ...snapshot(), phoneNumber: "+15555550100" },
    {
      ...snapshot(),
      interactions: [{
        ...snapshot().interactions[0],
        events: [{
          ...snapshot().interactions[0].events[0],
          messageBody: "raw content"
        }]
      }]
    }
  ]) {
    assert.throws(
      () => ui.customerPresentation(changed),
      /held Responder projection is invalid/u
    );
  }
});

test("DOM mount is semantic, text-only, and emits bounded command intents", () => {
  const ui = load();
  const container = new FakeElement("main");
  const commands = [];
  const mounted = ui.mount({
    audience: "customer",
    snapshot: snapshot(),
    container,
    documentRef: { createElement: (name) => new FakeElement(name) },
    onCommand: (command) => commands.push(command)
  });
  const elements = descendants(mounted.element);
  assert.equal(elements.find((element) => element.name === "h2").textContent,
    "Your held Responder");
  assert.equal(elements.some((element) =>
    element.attributes.get("role") === "status"
  ), true);
  const buttons = elements.filter((element) => element.name === "button");
  assert.equal(buttons.length, 4);
  buttons.find((button) => button.textContent === "Record STOP").click();
  assert.deepEqual(JSON.parse(JSON.stringify(commands[0])), {
    action: "stop",
    contactAuthorityId: IDS.authority,
    projectId: IDS.project,
    routeDigest: "a".repeat(64)
  });
  assert.equal("innerHTML" in mounted.element, false);
});

test("hosted-only UI source is network-free and has responsive accessible CSS", () => {
  assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/u
    .test(SOURCE), false);
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/u.test(SOURCE), false);
  assert.match(CSS, /grid-template-columns:repeat\(auto-fit/u);
  assert.match(CSS, /min-height:44px/u);
  assert.match(CSS, /@media\(max-width:36rem\)/u);
  assert.match(CSS, /overflow-wrap:anywhere/u);
  assert.match(CSS, /prefers-reduced-motion:reduce/u);
});
