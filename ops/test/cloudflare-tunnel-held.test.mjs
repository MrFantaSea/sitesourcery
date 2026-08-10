import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const opsRoot = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, opsRoot), "utf8");
}

test("Cloudflare origin is loopback-only, no-store, and exact-host routed", async () => {
  const caddy = await read(
    "Caddyfile.cloudflare-tunnel.candidate.held"
  );

  assert.match(caddy, /admin off/u);
  assert.match(caddy, /auto_https off/u);
  assert.match(caddy, /:8081 \{\s+bind 127\.0\.0\.1/u);
  assert.match(
    caddy,
    /@wrong_host not host sitesourcery\.com www\.sitesourcery\.com/u
  );
  assert.match(
    caddy,
    /redir https:\/\/sitesourcery\.com\{uri\} 308/u
  );
  assert.match(
    caddy,
    /@sitesourcery_internal path \/_sitesourcery \/_sitesourcery\/\*/u
  );
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8788/u);
  assert.match(caddy, /request_body \{\s+max_size 1MB/u);
  assert.match(caddy, /dial_timeout 3s/u);
  assert.match(caddy, /response_header_timeout 20s/u);
  assert.match(
    caddy,
    /root \* \/opt\/sitesourcery\/current\/_hosted/u
  );
  assert.equal(
    [...caddy.matchAll(/Cache-Control "no-store"/gu)].length,
    2
  );
  assert.doesNotMatch(caddy, /tls\s*\{/u);
  assert.doesNotMatch(caddy, /:80\b|:443\b/u);
  assert.doesNotMatch(caddy, /cloudflare.*token/iu);
});

test("Cloudflare connector uses a tunnel-scoped credential and double hold", async () => {
  const [origin, tunnel, config] = await Promise.all([
    read(
      "production-rehearsal/sitesourcery-origin-cloudflare.user.service"
    ),
    read(
      "production-rehearsal/sitesourcery-cloudflared.user.service"
    ),
    read("cloudflared-sitesourcery-production-dell.yml")
  ]);

  for (const unit of [origin, tunnel]) {
    assert.match(
      unit,
      /ConditionPathExists=%h\/sitesourcery-production\/run\/CLOUDFLARE_TUNNEL_APPROVED/u
    );
    assert.match(unit, /NoNewPrivileges=true/u);
    assert.match(unit, /ProtectSystem=strict/u);
    assert.match(unit, /ProtectHome=read-only/u);
    assert.match(unit, /CapabilityBoundingSet=\n/u);
  }

  assert.match(
    tunnel,
    /ConditionPathExists=%h\/\.cloudflared\/211ffa61-e170-444d-a945-04fead19c972\.json/u
  );
  assert.match(
    tunnel,
    /--config %h\/\.config\/sitesourcery-cloudflare\/cloudflared\.yml/u
  );
  assert.match(
    tunnel,
    /run 211ffa61-e170-444d-a945-04fead19c972/u
  );
  assert.doesNotMatch(tunnel, /--token(?:-file)?\s/u);
  assert.match(tunnel, /--metrics 127\.0\.0\.1:20241/u);
  assert.match(tunnel, /--loglevel info/u);
  assert.match(tunnel, /--transport-loglevel warn/u);
  assert.doesNotMatch(tunnel, /--loglevel debug/u);

  assert.match(
    config,
    /^tunnel: 211ffa61-e170-444d-a945-04fead19c972$/mu
  );
  assert.match(
    config,
    /^credentials-file: \/home\/simtech\/\.cloudflared\/211ffa61-e170-444d-a945-04fead19c972\.json$/mu
  );
  assert.match(
    config,
    /hostname: sitesourcery\.com\s+service: http:\/\/127\.0\.0\.1:8081/u
  );
  assert.match(
    config,
    /hostname: www\.sitesourcery\.com\s+service: http:\/\/127\.0\.0\.1:8081/u
  );
  assert.match(config, /- service: http_status:404/u);
  assert.doesNotMatch(config, /token|cert\.pem/iu);
});

test("Cloudflare cutover preserves DNSSEC, mail, legal, and commercial gates", async () => {
  const runbook = await read(
    "SITESOURCERY-CLOUDFLARE-TUNNEL-CUTOVER-2026-08-09.md"
  );

  for (const address of [108, 109, 110, 111]) {
    assert.ok(runbook.includes(`185.199.${address}.153`));
  }
  assert.match(
    runbook,
    /feedback-smtp\.us-east-1\.amazonses\.com/u
  );
  assert.match(runbook, /v=spf1 include:amazonses\.com ~all/u);
  assert.match(runbook, /resend\._domainkey/u);
  assert.match(
    runbook,
    /Do not change nameservers while that DS is present\./u
  );
  assert.match(
    runbook,
    /Finalize the additive joint Legal V4 authority/u
  );
  assert.match(
    runbook,
    /Keep Stripe live mode and effect switches held/u
  );
  assert.match(
    runbook,
    /does not authorize Cloudflare Workers, Pages, D1, R2, email routing/u
  );
  assert.doesNotMatch(
    runbook,
    /(?:eyJhIjo|CLOUDFLARE_API_TOKEN=|TUNNEL_TOKEN=)[A-Za-z0-9._-]+/u
  );
});
