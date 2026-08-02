import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLATFORM_BASE_DOMAIN,
  isPlatformHostname,
  normalizeHostname,
  requestFilePath,
  requestHostname
} from "../src/index.mjs";

test("hostname normalization accepts canonical DNS and rejects authority attacks", () => {
  assert.equal(normalizeHostname("CUSTOMER.Example:443"), "customer.example");
  assert.equal(normalizeHostname("bücher.example"), "xn--bcher-kva.example");
  for (const value of [
    "",
    "localhost",
    "127.0.0.1",
    "[::1]",
    " customer.example",
    "https://customer.example",
    "user@customer.example",
    "customer.example/path",
    "customer.example,evil.example",
    "bad_label.example",
    "-bad.example",
    "bad-.example",
    "bad..example",
    "customer.example\nx"
  ]) {
    assert.equal(normalizeHostname(value), null, value);
  }
});

test("request URL authority and Host must agree", () => {
  assert.equal(
    requestHostname(
      new Request("https://customer.example/", {
        headers: { host: "CUSTOMER.EXAMPLE:443" }
      })
    ),
    "customer.example"
  );
  assert.equal(
    requestHostname(
      new Request("https://customer.example/", {
        headers: { host: "evil.example" }
      })
    ),
    null
  );
});

test("platform hostnames allow one unreserved label only", () => {
  assert.equal(DEFAULT_PLATFORM_BASE_DOMAIN, "sitesourcery.me");
  assert.equal(
    isPlatformHostname("alpha.sitesourcery.me", DEFAULT_PLATFORM_BASE_DOMAIN, [
      "app"
    ]),
    true
  );
  assert.equal(
    isPlatformHostname(
      "nested.alpha.sitesourcery.me",
      DEFAULT_PLATFORM_BASE_DOMAIN
    ),
    false
  );
  assert.equal(
    isPlatformHostname("app.sitesourcery.me", DEFAULT_PLATFORM_BASE_DOMAIN, [
      "app"
    ]),
    false
  );
});

test("request paths cannot become absolute, traversal, backslash, control, or internal manifest reads", () => {
  assert.equal(requestFilePath("/"), "index.html");
  assert.equal(requestFilePath("/assets/app.js"), "assets/app.js");
  for (const value of [
    "/",
    "/../secret",
    "/%2e%2e/secret",
    "/assets%2f..%2fsecret",
    "/assets\\secret",
    "/assets/",
    "/release-manifest.json",
    "/%00secret"
  ]) {
    if (value === "/") continue;
    assert.equal(requestFilePath(value), null, value);
  }
});
