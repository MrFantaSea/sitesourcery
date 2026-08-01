import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { probeRuntime } from "../probe-runtime.mjs";

const opsRoot = new URL("../", import.meta.url);

function json(body, status = 200) {
  return new Response(
    `${JSON.stringify(body)}\n`,
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}

function probeFetch({
  publicationHeld = true,
  apiReady = true
} = {}) {
  const calls = [];
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    calls.push({
      url: url.href,
      options
    });
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    if (url.pathname === "/api/v1/health") {
      return json({
        ok: true,
        service:
          "sitesourcery-hosted-runtime"
      });
    }
    if (url.pathname === "/api/v1/ready") {
      return json(
        {
          ready: apiReady,
          service:
            "sitesourcery-hosted-runtime"
        },
        apiReady ? 200 : 503
      );
    }
    if (
      url.pathname ===
      "/_sitesourcery/health"
    ) {
      return json({
        ok: true,
        service:
          "sitesourcery-selfhost-foundation",
        publicationHeld
      });
    }
    if (
      url.pathname ===
      "/_sitesourcery/ready"
    ) {
      return json(
        {
          ready: !publicationHeld,
          controlRevision: 4
        },
        publicationHeld ? 503 : 200
      );
    }
    throw new Error(`Unexpected probe ${url.href}`);
  };
  return { calls, fetchImpl };
}

test("runtime probe treats an intentional publication hold as healthy", async () => {
  const fake = probeFetch();
  assert.deepEqual(
    await probeRuntime({
      fetchImpl: fake.fetchImpl,
      expectedPublication: "held"
    }),
    {
      ok: true,
      service:
        "sitesourcery-hosted-runtime",
      publicationHeld: true,
      tenantControlRevision: 4
    }
  );
  assert.equal(fake.calls.length, 4);
});

test("runtime probe requires a ready tenant after publication approval", async () => {
  const fake = probeFetch({
    publicationHeld: false
  });
  const result = await probeRuntime({
    fetchImpl: fake.fetchImpl,
    expectedPublication: "approved"
  });
  assert.equal(result.publicationHeld, false);
  assert.equal(
    result.tenantControlRevision,
    4
  );
});

test("runtime probe fails closed on readiness drift and invalid configuration", async () => {
  const notReady = probeFetch({
    apiReady: false
  });
  await assert.rejects(
    probeRuntime({
      fetchImpl: notReady.fetchImpl
    }),
    /returned HTTP 503/u
  );
  await assert.rejects(
    probeRuntime({
      fetchImpl: probeFetch().fetchImpl,
      expectedPublication: "maybe"
    }),
    /must be held or approved/u
  );
  await assert.rejects(
    probeRuntime({
      fetchImpl: probeFetch().fetchImpl,
      apiPort: 8080,
      tenantPort: 8080
    }),
    /must use different ports/u
  );
});

test("Caddy routes the exact control API and hosted artifact before tenant domains", async () => {
  const [caddy, readme, acceptance] =
    await Promise.all([
      readFile(
        new URL(
          "Caddyfile.candidate.held",
          opsRoot
        ),
        "utf8"
      ),
      readFile(
        new URL("README.md", opsRoot),
        "utf8"
      ),
      readFile(
        new URL("ACCEPTANCE.md", opsRoot),
        "utf8"
      )
    ]);
  const caddyVersion =
    "v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=";
  const caddyArchiveSha512 =
    "8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9";
  assert.doesNotMatch(
    caddy,
    /dedicated service gate\.\n\n\{/u
  );
  for (const document of [readme, acceptance]) {
    assert.ok(document.includes(caddyVersion));
    assert.ok(
      document.includes(caddyArchiveSha512)
    );
  }
  assert.match(
    readme,
    /Release blocker: live-state operations/u
  );
  assert.match(
    acceptance,
    /Release blocker closed:/u
  );
  const control = caddy.indexOf(
    "{$SITESOURCERY_CONTROL_HOST} {"
  );
  const tenants = caddy.indexOf("https:// {");
  assert.ok(control >= 0 && tenants > control);
  const controlBlock = caddy.slice(
    control,
    tenants
  );
  assert.match(
    controlBlock,
    /@hosted_api path \/api \/api\/\*/u
  );
  assert.match(
    controlBlock,
    /reverse_proxy 127\.0\.0\.1:8788/u
  );
  assert.match(
    controlBlock,
    /root \* \{\$SITESOURCERY_HOSTED_PUBLIC_ROOT\}/u
  );
  assert.match(
    controlBlock,
    /@sitesourcery_internal path \/_sitesourcery \/_sitesourcery\/\*\s+handle @sitesourcery_internal \{\s+respond 404\s+\}/u
  );
  assert.ok(
    controlBlock.indexOf(
      "handle @sitesourcery_internal"
    ) <
      controlBlock.indexOf(
        "handle @hosted_api"
      )
  );
  assert.doesNotMatch(
    controlBlock,
    /127\.0\.0\.1:8080/u
  );
  const tenantBlock = caddy.slice(tenants);
  assert.match(
    tenantBlock,
    /tls\s*\{\s*on_demand\s*\}/u
  );
  assert.match(
    tenantBlock,
    /reverse_proxy 127\.0\.0\.1:8080/u
  );
  assert.match(
    tenantBlock,
    /@sitesourcery_internal path \/_sitesourcery \/_sitesourcery\/\*\s+handle @sitesourcery_internal \{\s+respond 404\s+\}/u
  );
  assert.ok(
    tenantBlock.indexOf(
      "handle @sitesourcery_internal"
    ) <
      tenantBlock.indexOf(
        "handle {\n\t\treverse_proxy"
      )
  );
  assert.match(
    caddy,
    /ask http:\/\/127\.0\.0\.1:8080\/_sitesourcery\/tls\/allow/u
  );
  assert.doesNotMatch(caddy, /\btask http:/u);
});

test("runtime can rehearse while held but public Caddy activation cannot", async () => {
  const [
    runtimeService,
    caddyGate,
    hostedEnvironment
  ] = await Promise.all([
    readFile(
      new URL(
        "sitesourcery-hosted.service.held",
        opsRoot
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "sitesourcery-caddy.service.held",
        opsRoot
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "hosted.env.example",
        opsRoot
      ),
      "utf8"
    )
  ]);
  assert.match(
    runtimeService,
    /ConditionPathExists=\/etc\/sitesourcery\/RUNTIME_APPROVED/u
  );
  assert.doesNotMatch(
    runtimeService,
    /ConditionPathExists=!\/etc\/sitesourcery\/PUBLICATION_HOLD/u
  );
  assert.match(
    runtimeService,
    /server\/hosted\/bin\/server\.mjs/u
  );
  assert.match(
    caddyGate,
    /ConditionPathExists=\/etc\/sitesourcery\/PUBLICATION_APPROVED/u
  );
  assert.match(
    caddyGate,
    /ConditionPathExists=!\/etc\/sitesourcery\/PUBLICATION_HOLD/u
  );
  assert.match(
    caddyGate,
    /^User=sitesourcery-caddy$/mu
  );
  assert.match(
    caddyGate,
    /^ExecStartPre=\/opt\/sitesourcery\/caddy-2\.11\.4\/caddy validate --config \/opt\/sitesourcery\/current\/ops\/Caddyfile\.candidate\.held --adapter caddyfile$/mu
  );
  assert.match(
    caddyGate,
    /^ExecStart=\/opt\/sitesourcery\/caddy-2\.11\.4\/caddy run --environ --config \/opt\/sitesourcery\/current\/ops\/Caddyfile\.candidate\.held --adapter caddyfile$/mu
  );
  assert.match(
    caddyGate,
    /^ExecReload=\/opt\/sitesourcery\/caddy-2\.11\.4\/caddy reload --config \/opt\/sitesourcery\/current\/ops\/Caddyfile\.candidate\.held --adapter caddyfile --force$/mu
  );
  assert.doesNotMatch(
    caddyGate,
    /\/etc\/caddy\/Caddyfile/u
  );
  assert.match(
    hostedEnvironment,
    /^SITESOURCERY_STRIPE_MODE=held$/mu
  );
  assert.doesNotMatch(
    hostedEnvironment,
    /^SITESOURCERY_OFFER_CATALOG_PATH=/mu
  );
  assert.match(
    hostedEnvironment,
    /Leave SITESOURCERY_OFFER_CATALOG_PATH unset while commerce is held/u
  );
  assert.doesNotMatch(
    hostedEnvironment,
    /SITESOURCERY_PAYMENT_MODE/u
  );
  assert.match(
    hostedEnvironment,
    /^SITESOURCERY_RECOVERY_MAIL_MODE=held$/mu
  );
  assert.match(
    hostedEnvironment,
    /^SITESOURCERY_REGISTRATION_TRANSPORT_MODULE=\/opt\/sitesourcery\/current\/server\/hosted\/resend-mail-transport\.mjs$/mu
  );
  assert.match(
    hostedEnvironment,
    /^SITESOURCERY_RECOVERY_TRANSPORT_MODULE=\/opt\/sitesourcery\/current\/server\/hosted\/resend-mail-transport\.mjs$/mu
  );
  assert.match(
    hostedEnvironment,
    /^SITESOURCERY_RESEND_API_KEY=replace-with-secret-reference$/mu
  );
  assert.match(
    hostedEnvironment,
    /^SITESOURCERY_RESEND_DOMAIN_ID=replace-with-resend-domain-uuid$/mu
  );
  assert.doesNotMatch(
    hostedEnvironment,
    /sk_(?:live|test)_|whsec_[A-Za-z0-9]|\bre_[A-Za-z0-9_-]{16,}/u
  );
});

test("isolated staging units use persistent reboot-safe dependencies", async () => {
  const stagingRoot = new URL("../staging/", import.meta.url);
  const [postgres, tunnel, runtime, readme] =
    await Promise.all([
      readFile(
        new URL(
          "sitesourcery-staging-postgresql.service",
          stagingRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-staging-db-tunnel.service",
          stagingRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-staging.service",
          stagingRoot
        ),
        "utf8"
      ),
      readFile(new URL("README.md", stagingRoot), "utf8")
    ]);

  for (const unit of [postgres, tunnel, runtime]) {
    assert.doesNotMatch(unit, /\/tmp\//u);
    assert.match(unit, /^UMask=0077$/mu);
    assert.match(unit, /^WantedBy=default\.target$/mu);
    assert.doesNotMatch(
      unit,
      /sk_(?:live|test)_|whsec_|SITESOURCERY_RESEND_API_KEY=/u
    );
  }

  assert.match(
    postgres,
    /^Environment=PGDATA=\/home\/mrfantasea\/\.local\/share\/sitesourcery-postgresql-16\.14\/data$/mu
  );
  assert.match(
    postgres,
    /-k %t\/sitesourcery-postgresql -p 55432 -c listen_addresses=/u
  );
  assert.match(
    postgres,
    /^RuntimeDirectory=sitesourcery-postgresql$/mu
  );
  assert.match(
    postgres,
    /^RuntimeDirectoryMode=0700$/mu
  );

  assert.match(tunnel, /-o BatchMode=yes/u);
  assert.match(tunnel, /-o ExitOnForwardFailure=yes/u);
  assert.match(tunnel, /-o ServerAliveInterval=15/u);
  assert.match(
    tunnel,
    /UserKnownHostsFile=\/home\/zentech\/sitesourcery-staging\/run\/hq-known-hosts/u
  );
  assert.match(
    tunnel,
    /-L 127\.0\.0\.1:55439:\/run\/user\/1000\/sitesourcery-postgresql\/\.s\.PGSQL\.55432 hq/u
  );
  assert.doesNotMatch(tunnel, /ClearAllForwardings/u);
  assert.match(tunnel, /^Restart=always$/mu);

  assert.match(
    runtime,
    /^Requires=sitesourcery-staging-db-tunnel\.service$/mu
  );
  assert.match(
    runtime,
    /^After=network-online\.target sitesourcery-staging-db-tunnel\.service$/mu
  );
  assert.match(
    runtime,
    /releases\/d7c33c7e4ec7623f63249e0dc5b3d2951e781212/u
  );
  assert.match(readme, /No whole-host reboot was performed\./u);
  assert.match(
    readme,
    /not an encrypted\s+off-machine production backup/u
  );
});
