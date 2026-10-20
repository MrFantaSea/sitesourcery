import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import redirects from "follow-redirects";

async function redirectedHeaders(headers, sensitiveHeaders = []) {
  let original;
  let forwarded;
  const destination = http.createServer((req, res) => {
    forwarded = req.headers;
    res.end("local fixture");
  });
  const source = http.createServer((req, res) => {
    original = req.headers;
    res.writeHead(302, { Location: `http://127.0.0.1:${destination.address().port}/target` });
    res.end();
  });
  try {
    destination.listen(0, "127.0.0.1");
    await once(destination, "listening");
    source.listen(0, "127.0.0.1");
    await once(source, "listening");
    // Distinct hostnames exercise cross-host stripping; both sockets are local.
    await new Promise((resolve, reject) => {
      const req = redirects.http.get({
        hostname: "localhost", port: source.address().port, path: "/start",
        headers, sensitiveHeaders, maxRedirects: 1, timeout: 2000,
        lookup(_host, options, done) {
          if (options.all) done(null, [{ address: "127.0.0.1", family: 4 }]);
          else done(null, "127.0.0.1", 4);
        }
      }, res => {
        res.resume();
        res.once("end", resolve);
        res.once("error", reject);
      });
      req.once("error", reject);
      req.once("timeout", () => req.destroy(new Error("Local redirect fixture timed out.")));
    });
    return { original, forwarded };
  } finally {
    await Promise.all([source, destination].map(server => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    })));
  }
}

test("array headers lose credentials across a host redirect", async () => {
  const { original, forwarded } = await redirectedHeaders([
    "Authorization", "fixture-auth", "Cookie", "fixture-cookie",
    "Proxy-Authorization", "fixture-proxy", "X-Public", "public-value"
  ]);
  for (const name of ["authorization", "cookie", "proxy-authorization"]) {
    assert.ok(original[name], `${name} must exist at the original local endpoint`);
    assert.equal(forwarded[name], undefined, `${name} must not cross hosts`);
  }
  assert.equal(forwarded["x-public"], "public-value");
});

test("declared sensitive header names with regex metacharacters remain private", async () => {
  const sensitiveHeaders = ["X-Credential^Name", "X-Credential|Name"];
  const { original, forwarded } = await redirectedHeaders({
    "X-Credential^Name": "fixture-caret", "X-Credential|Name": "fixture-pipe",
    "X-Public": "public-value"
  }, sensitiveHeaders);
  for (const name of sensitiveHeaders.map(value => value.toLowerCase())) {
    assert.ok(original[name]);
    assert.equal(forwarded[name], undefined);
  }
  assert.equal(forwarded["x-public"], "public-value");
});
