import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../.."
);
const SOURCE_PATH = path.join(
  ROOT,
  "abracadabra/app/abracadabra-care-surfaces.js"
);
const CSS_PATH = path.join(
  ROOT,
  "abracadabra/app/abracadabra-care-surfaces.css"
);
const SOURCE = await readFile(SOURCE_PATH, "utf8");
const CSS = await readFile(CSS_PATH, "utf8");

const IDS = Object.freeze({
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001",
  ticket: "70000000-0000-4000-8000-000000000001"
});

function load() {
  const context = vm.createContext({});
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  return context.SiteSourceryCareSurfaces;
}

function snapshot(audience = "customer") {
  const contract = {
    id: IDS.contract,
    projectId: IDS.project,
    contractKind: "custom_care",
    catalog: {
      serviceKey: "custom_care",
      catalogVersion: "SS-CARE-CORE-2026.1",
      billingCadence: "month",
      capacityUnitKind: "care_request",
      commercialAuthorityState: "owner_redline_required"
    },
    authorityState: "held",
    effects: { customer: false, payment: false, provider: false },
    periods: [{
      id: IDS.period,
      projectId: IDS.project,
      startsOn: "2026-08-11",
      endsOn: "2026-09-11",
      state: "open",
      revision: 1,
      authorityState: "held",
      capacity: {
        carried: 1,
        included: 4,
        usedCarried: 1,
        usedIncluded: 1,
        remaining: 3
      },
      providerEffects: false
    }],
    tickets: [{
      id: IDS.ticket,
      projectId: IDS.project,
      periodId: IDS.period,
      basis: {
        kind: "assessment_finding",
        referenceDigest: "a".repeat(64)
      },
      workScopeDigest: "b".repeat(64),
      state: "in_progress",
      revision: 2,
      allocatedUnits: 2,
      effects: { mail: false, provider: false },
      openedAt: "2026-08-11T16:00:00.000Z",
      resolvedAt: null,
      closedAt: null
    }]
  };
  if (audience === "operator") contract.customerId = IDS.customer;
  return {
    schema: "sitesourcery.care-surface-dashboard/v1",
    audience,
    organizationId: IDS.organization,
    observedAt: "2026-08-11T16:00:00.000Z",
    held: {
      commercialRelease: true,
      customerEffects: true,
      mailDelivery: true,
      paymentEffects: true,
      providerEffects: true
    },
    contracts: [contract]
  };
}

class FakeElement {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.className = "";
    this.disabled = false;
    this.id = "";
    this.textContent = "";
    this.type = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  click() {
    if (!this.disabled) this.listeners.get("click")?.();
  }

  all() {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

function documentFixture() {
  return {
    createElement(name) {
      return new FakeElement(name);
    }
  };
}

test("customer and operator projections retain only held, digest-safe UI facts", () => {
  const ui = load();
  const customer = ui.customerPresentation(snapshot());
  assert.equal(customer.heading, "Your Care work");
  assert.equal(customer.remainingCapacity, 3);
  assert.match(customer.summary, /1 held Care contract, 1 period, and 1 ticket/u);
  assert.equal(
    customer.contracts[0].tickets[0].basisReferenceDigest,
    "a".repeat(64)
  );
  assert.equal(JSON.stringify(customer).includes(IDS.customer), false);
  assert.match(customer.holdNotice, /payment.*mail delivery.*held/iu);

  const operator = ui.operatorPresentation(snapshot("operator"));
  assert.equal(operator.heading, "Care operations");
  assert.equal(operator.contracts[0].tickets[0].allocatedUnits, 2);
});

test("UI validation rejects released effects and raw assessment identifiers", () => {
  const ui = load();
  const released = snapshot();
  released.contracts[0].effects.provider = true;
  assert.throws(
    () => ui.customerPresentation(released),
    /held Care projection is invalid/iu
  );
  const raw = snapshot();
  raw.contracts[0].tickets[0].basis.referenceId =
    "80000000-0000-4000-8000-000000000001";
  assert.throws(
    () => ui.customerPresentation(raw),
    /held Care projection is invalid/iu
  );
});

test("mounted panels expose semantic headings, status, and held customer controls", () => {
  const ui = load();
  const customerContainer = new FakeElement("main");
  const mounted = ui.mount({
    audience: "customer",
    container: customerContainer,
    documentRef: documentFixture(),
    snapshot: snapshot()
  });
  assert.equal(mounted.element.name, "section");
  assert.equal(mounted.element.getAttribute("data-care-surface"), "customer");
  assert.equal(
    mounted.element.getAttribute("aria-labelledby"),
    "care-surface-customer"
  );
  const nodes = mounted.element.all();
  assert.equal(nodes.some((node) => node.name === "h2"), true);
  assert.equal(
    nodes.some((node) => node.getAttribute("role") === "status"),
    true
  );
  const heldButton = nodes.find((node) =>
    node.name === "button" && node.disabled
  );
  assert.ok(heldButton);
  assert.equal(heldButton.getAttribute("aria-disabled"), "true");

  const actions = [];
  const operatorContainer = new FakeElement("main");
  const operator = ui.mount({
    audience: "operator",
    container: operatorContainer,
    documentRef: documentFixture(),
    snapshot: snapshot("operator"),
    onCommand(value) { actions.push(value); }
  });
  operator.element.all().find((node) => node.name === "button").click();
  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [{
    action: "prepare",
    contractId: IDS.contract,
    projectId: IDS.project
  }]);
});

test("hosted Care assets are CSP-safe, overflow-safe, touch-safe, and responsive", () => {
  assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML/iu);
  assert.doesNotMatch(
    SOURCE,
    /\bfetch\s*\(|sendBeacon|WebSocket|localStorage|sessionStorage/iu
  );
  assert.match(CSS, /min-width:0/u);
  assert.match(CSS, /overflow-wrap:anywhere/u);
  assert.match(CSS, /min-height:44px/u);
  assert.match(CSS, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,18rem\),1fr\)\)/u);
  assert.match(CSS, /@media\(max-width:36rem\)/u);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/u);
  assert.doesNotMatch(CSS, /width:\d{3,}px/u);
});
