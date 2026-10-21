import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildHostedArtifact } from "../../scripts/build-hosted.mjs";
import { PUBLIC_HTML_CONTENT_SECURITY_POLICY } from "../public-html-security-policy.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

test("public policy rejects executable inline code and arbitrary network authorities", () => {
  const entries = PUBLIC_HTML_CONTENT_SECURITY_POLICY.split("; ").map((value) => value.split(" "));
  const policy = new Map(entries.map(([name, ...values]) => [name, values]));
  assert.equal(policy.size, entries.length, "no ambiguous repeated directives");
  for (const name of ["default-src", "base-uri", "object-src", "script-src-attr", "worker-src", "media-src"]) {
    assert.deepEqual(policy.get(name), ["'none'"]);
  }
  assert.deepEqual(policy.get("script-src"), ["'self'"]);
  assert.deepEqual(policy.get("connect-src"), ["'self'", "https://cloudflare-dns.com"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  assert.deepEqual(policy.get("frame-src"), ["'self'", "blob:"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:"]);
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.equal(PUBLIC_HTML_CONTENT_SECURITY_POLICY.includes("unsafe-eval"), false);
});

test("current shipped documents need no remote or executable inline scripts", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-csp-resources-"));
  try {
    const artifact = path.join(temporary, "hosted");
    await buildHostedArtifact({ root: ROOT, output: artifact });
    const files = await readdir(artifact, { recursive: true });
    const htmlFiles = files.filter((file) => file.endsWith(".html"));
    assert.ok(htmlFiles.length >= 50, "scan the whole shipped artifact");
    let jsonDataBlocks = 0;
    for (const file of htmlFiles) {
      const html = await readFile(path.join(artifact, file), "utf8");
      assert.doesNotMatch(html, /\son[a-z]+\s*=/iu, `${file}: inline handler needs review`);
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
        const src = match[1].match(/\bsrc=["']([^"']+)["']/iu)?.[1];
        if (src) {
          assert.equal(new URL(src, "https://sitesourcery.com/").origin,
            "https://sitesourcery.com", `${file}: remote script needs review`);
          assert.equal(match[2].trim(), "");
        } else {
          assert.match(match[1], /\btype=["']application\/ld\+json["']/iu,
            `${file}: executable inline script needs review`);
          JSON.parse(match[2]);
          jsonDataBlocks += 1;
        }
      }
      for (const tag of html.matchAll(/<link\b[^>]*>/giu)) {
        if (!/\brel=["']stylesheet["']/iu.test(tag[0])) continue;
        const href = tag[0].match(/\bhref=["']([^"']+)["']/iu)?.[1];
        assert.equal(new URL(href, "https://sitesourcery.com/").origin,
          "https://sitesourcery.com", `${file}: remote stylesheet needs review`);
      }
    }
    assert.equal(jsonDataBlocks, 2, "the two JSON-LD blocks are data, not executable code");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
