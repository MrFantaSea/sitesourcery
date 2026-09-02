import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { probeRuntime } from "../probe-runtime.mjs";
import {
  DEFAULT_HELD_OPERATIONS_STATE
} from "../operations-state.mjs";

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
  apiReady = true,
  operationsState = {
    ...DEFAULT_HELD_OPERATIONS_STATE,
    publication:
      publicationHeld ? "held" : "approved"
  }
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
      "/_sitesourcery/operations-state"
    ) {
      return json({
        schema:
          "sitesourcery.hosted-operations-state/v1",
        operationsState
      });
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
      expectedOperationsState:
        DEFAULT_HELD_OPERATIONS_STATE
    }),
    {
      ok: true,
      service:
        "sitesourcery-hosted-runtime",
      publicationHeld: true,
      operationsState:
        DEFAULT_HELD_OPERATIONS_STATE,
      tenantControlRevision: 4
    }
  );
  assert.equal(fake.calls.length, 5);
  assert.equal(
    new Set(
      fake.calls.map(
        (call) => call.options.signal
      )
    ).size,
    5
  );
  assert.equal(
    fake.calls.every(
      (call) =>
        call.options.signal instanceof
          AbortSignal &&
        call.options.signal.aborted === false
    ),
    true
  );
});

test("runtime probe bounds each sequential request instead of sharing one cumulative timeout", async () => {
  const fake = probeFetch();
  const fetchImpl = async (value, options) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 75);
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(options.signal.reason);
        },
        { once: true }
      );
    });
    return fake.fetchImpl(value, options);
  };
  const result = await probeRuntime({
    fetchImpl,
    expectedOperationsState:
      DEFAULT_HELD_OPERATIONS_STATE,
    timeoutMs: 250
  });
  assert.equal(result.ok, true);
  assert.equal(fake.calls.length, 5);
});

test("runtime probe requires a ready tenant after publication approval", async () => {
  const fake = probeFetch({
    publicationHeld: false
  });
  const result = await probeRuntime({
    fetchImpl: fake.fetchImpl,
    expectedOperationsState: {
      ...DEFAULT_HELD_OPERATIONS_STATE,
      publication: "approved"
    }
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
      expectedOperationsState: {
        ...DEFAULT_HELD_OPERATIONS_STATE,
        publication: "maybe"
      }
    }),
    /publication is invalid/u
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
    /Live-state operations contract/u
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
  assert.match(controlBlock, /request_body \{\s+max_size 1MB/u);
  assert.match(controlBlock, /dial_timeout 3s/u);
  assert.match(controlBlock, /response_header_timeout 20s/u);
  assert.match(controlBlock, /header_up X-Real-IP \{remote_host\}/u);
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
    tenantService,
    workerService,
    caddyGate,
    probeGate,
    hostedEnvironment,
    tenantEnvironment
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
        "sitesourcery-tenant.service.held",
        opsRoot
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "sitesourcery-workers.service.held",
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
        "sitesourcery-probe.service.held",
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
    ),
    readFile(
      new URL(
        "tenant.env.example",
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
  assert.match(runtimeService, /sole publication writer/u);
  assert.match(runtimeService, /^ReadWritePaths=\/var\/lib\/sitesourcery$/mu);
  assert.match(
    tenantService,
    /^Requires=sitesourcery-hosted\.service$/mu
  );
  assert.match(
    tenantService,
    /^EnvironmentFile=\/etc\/sitesourcery\/tenant\.env$/mu
  );
  assert.match(
    tenantService,
    /server\/selfhost\/bin\/server\.mjs/u
  );
  assert.match(
    tenantService,
    /^ReadOnlyPaths=.*\/var\/lib\/sitesourcery\/tenant-runtime$/mu
  );
  assert.doesNotMatch(tenantService, /^ReadWritePaths=/mu);
  assert.match(
    workerService,
    /^ReadOnlyPaths=.*\/var\/lib\/sitesourcery\/tenant-runtime$/mu
  );
  assert.match(
    workerService,
    /^ReadWritePaths=\/var\/lib\/sitesourcery\/private-exports$/mu
  );
  assert.doesNotMatch(
    workerService,
    /^ReadWritePaths=\/var\/lib\/sitesourcery$/mu
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
    /^Requires=sitesourcery-hosted\.service sitesourcery-tenant\.service$/mu
  );
  assert.match(
    probeGate,
    /^Requires=sitesourcery-hosted\.service sitesourcery-tenant\.service$/mu
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
  assert.match(tenantEnvironment, /^SITESOURCERY_TENANT_PORT=8080$/mu);
  assert.match(
    tenantEnvironment,
    /^SITESOURCERY_DATA_ROOT=\/var\/lib\/sitesourcery\/tenant-runtime$/mu
  );
  assert.doesNotMatch(
    tenantEnvironment,
    /SITESOURCERY_PUBLICATION_COMMAND_/u
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

test("held production rehearsal is separate, persistent, and loopback-only", async () => {
  const rehearsalRoot = new URL(
    "../production-rehearsal/",
    import.meta.url
  );
  const [
    postgres,
    tunnel,
    runtime,
    staticServer,
    backupMount,
    backupService,
    backupTimer,
    backupRecovery,
    monitorService,
    monitorTimer,
    monitorEnvironment,
    backupEnvironment,
    readme
  ] =
    await Promise.all([
      readFile(
        new URL(
          "sitesourcery-production-postgresql.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-db-tunnel.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-static.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-backup-mount.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-backup.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-backup.timer",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-backup-recovery.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-monitor.service",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "sitesourcery-production-monitor.timer",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "monitor.env.example",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "backup.env.example",
          rehearsalRoot
        ),
        "utf8"
      ),
      readFile(new URL("README.md", rehearsalRoot), "utf8")
    ]);

  for (const unit of [
    postgres,
    tunnel,
    runtime,
    staticServer
  ]) {
    assert.doesNotMatch(unit, /\/tmp\//u);
    assert.doesNotMatch(unit, /0\.0\.0\.0|\[::\]/u);
    assert.match(unit, /^UMask=0077$/mu);
    assert.match(unit, /^WantedBy=default\.target$/mu);
    assert.doesNotMatch(
      unit,
      /sk_(?:live|test)_|whsec_|SITESOURCERY_RESEND_API_KEY=/u
    );
  }

  assert.match(
    postgres,
    /^Environment=PGDATA=\/home\/mrfantasea\/\.local\/share\/sitesourcery-production-postgresql-16\.14\/data$/mu
  );
  assert.match(
    postgres,
    /-k %t\/sitesourcery-production-postgresql -p 55433 -c listen_addresses=/u
  );
  assert.match(
    postgres,
    /^RuntimeDirectory=sitesourcery-production-postgresql$/mu
  );

  assert.match(tunnel, /-o ExitOnForwardFailure=yes/u);
  assert.match(
    tunnel,
    /-L 127\.0\.0\.1:55439:\/run\/user\/1000\/sitesourcery-production-postgresql\/\.s\.PGSQL\.55433 hq/u
  );
  assert.match(
    tunnel,
    /UserKnownHostsFile=\/home\/simtech\/sitesourcery-production\/run\/hq-known-hosts/u
  );
  assert.match(tunnel, /^Restart=always$/mu);

  assert.match(
    runtime,
    /^Requires=sitesourcery-production-db-tunnel\.service$/mu
  );
  assert.match(
    runtime,
    /^ConditionPathExists=!%t\/sitesourcery-production\/BACKUP_QUIESCE$/mu
  );
  assert.match(
    runtime,
    /releases\/15cab8f4d220f9a5116b89c732daa6dc9fb19a17/u
  );
  assert.match(
    runtime,
    /node-v24\.18\.0-linux-x64\/bin\/node/u
  );
  assert.match(
    staticServer,
    /http\.server 8899 --bind 127\.0\.0\.1/u
  );
  assert.match(
    backupMount,
    /^ExecStart=.*sshfs-3\.7\.3\/usr\/bin\/sshfs -f zen:.* -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\/home\/simtech\/\.ssh\/known_hosts/mu
  );
  assert.match(
    backupMount,
    / -o noexec -o nodev -o nosuid$/mu
  );
  assert.match(
    backupMount,
    /^ExecStartPost=\/usr\/bin\/mountpoint -q \/home\/simtech\/sitesourcery-production\/off-machine$/mu
  );
  assert.match(
    backupMount,
    /^ExecStartPost=\/usr\/bin\/test -f .*\.sitesourcery-off-machine\.json$/mu
  );
  assert.match(
    backupMount,
    /^ExecStop=-\/usr\/bin\/fusermount3 -u /mu
  );
  assert.match(
    backupMount,
    /^WantedBy=default\.target$/mu
  );
  assert.doesNotMatch(
    backupMount,
    /accept-new|allow_other|-o umask=|\/bin\/(?:ba)?sh|PrivateTmp|ProtectSystem|ProtectHome|RestrictAddressFamilies/u
  );
  assert.match(
    backupService,
    /^ConditionPathIsMountPoint=\/home\/simtech\/sitesourcery-production\/off-machine$/mu
  );
  assert.match(
    backupService,
    /^Requires=sitesourcery-production-backup-mount\.service$/mu
  );
  assert.match(
    backupService,
    /^After=sitesourcery-production\.service sitesourcery-production-backup-mount\.service$/mu
  );
  assert.doesNotMatch(
    backupService,
    /^ConditionPathExists=%t\/sitesourcery-production\/BACKUP_QUIESCE$/mu
  );
  assert.match(
    backupService,
    /^EnvironmentFile=\/home\/simtech\/sitesourcery-production\/run\/hosted\.env$/mu
  );
  assert.match(
    backupService,
    /^ExecStart=\/usr\/bin\/flock --exclusive --wait 120 --conflict-exit-code 75 --no-fork %t\/sitesourcery-production-operations\.lock .*releases\/70d270fd8ffb242fe80db265d61a74dd4bbdfad2\/ops\/run-production-rehearsal-backup-cycle\.mjs run$/mu
  );
  assert.match(
    backupService,
    /^ExecStopPost=\/usr\/bin\/flock --exclusive --wait 120 --conflict-exit-code 75 --no-fork %t\/sitesourcery-production-operations\.lock .*releases\/70d270fd8ffb242fe80db265d61a74dd4bbdfad2\/ops\/run-production-rehearsal-backup-cycle\.mjs recover$/mu
  );
  assert.match(
    backupService,
    /^TimeoutStartSec=30m$/mu
  );
  assert.doesNotMatch(
    backupService,
    /^\[Install\]$/mu
  );
  assert.match(
    backupTimer,
    /^OnCalendar=\*-\*-\* 04:17:00$/mu
  );
  assert.match(
    backupTimer,
    /^Persistent=true$/mu
  );
  assert.match(
    backupTimer,
    /^Unit=sitesourcery-production-backup\.service$/mu
  );
  assert.match(
    backupTimer,
    /^WantedBy=timers\.target$/mu
  );
  assert.match(
    backupRecovery,
    /^After=sitesourcery-production\.service$/mu
  );
  assert.match(
    backupRecovery,
    /^ExecStart=\/usr\/bin\/flock --exclusive --wait 120 --conflict-exit-code 75 --no-fork %t\/sitesourcery-production-operations\.lock .*releases\/70d270fd8ffb242fe80db265d61a74dd4bbdfad2\/ops\/run-production-rehearsal-backup-cycle\.mjs recover$/mu
  );
  assert.match(
    backupRecovery,
    /^WantedBy=default\.target$/mu
  );
  assert.match(
    backupEnvironment,
    /^SITESOURCERY_OPERATIONS_PROVIDER_EGRESS=held$/mu
  );
  assert.match(
    backupEnvironment,
    /^SITESOURCERY_REGISTRATION_MAIL_MODE=production$/mu
  );
  assert.doesNotMatch(
    backupEnvironment,
    /SITESOURCERY_DATABASE_URL|sk_(?:live|test)_|whsec_|re_[A-Za-z0-9]/u
  );

  assert.match(
    monitorService,
    /^After=network-online\.target sitesourcery-production\.service$/mu
  );
  assert.doesNotMatch(
    monitorService,
    /^Requires=|sitesourcery-production-backup-mount\.service|ConditionPathIsMountPoint=|off-machine\/\.sitesourcery-off-machine\.json/mu
  );
  assert.match(
    monitorService,
    /releases\/62e0b9ba70301ce7e79bf8e55e2a78e626fa13c9\/ops\/monitor-held\.mjs/u
  );
  assert.match(
    monitorService,
    /^TimeoutStartSec=2m$/mu
  );
  assert.match(
    monitorService,
    /^ConditionPathExists=!%t\/sitesourcery-production\/BACKUP_QUIESCE$/mu
  );
  assert.match(
    monitorService,
    /^ExecStart=\/usr\/bin\/flock --exclusive --nonblock --conflict-exit-code 0 --no-fork %t\/sitesourcery-production-operations\.lock .*\/ops\/monitor-held\.mjs$/mu
  );
  assert.match(
    monitorService,
    /^ReadWritePaths=\/home\/simtech\/sitesourcery-production\/state\/operations-monitor$/mu
  );
  assert.doesNotMatch(
    monitorService,
    /^\[Install\]$/mu
  );
  assert.match(
    monitorTimer,
    /^OnUnitActiveSec=5m$/mu
  );
  assert.match(
    monitorTimer,
    /^Persistent=true$/mu
  );
  assert.match(
    monitorTimer,
    /^WantedBy=timers\.target$/mu
  );
  assert.match(
    monitorEnvironment,
    /^SITESOURCERY_ALERT_MODE=held$/mu
  );
  assert.match(
    monitorEnvironment,
    /^SITESOURCERY_ALERT_REPEAT_INTERVAL_MS=21600000$/mu
  );
  assert.match(
    monitorEnvironment,
    /^SITESOURCERY_MONITOR_BACKUP_HASH_MODE=remote_ssh$/mu
  );
  assert.match(
    monitorEnvironment,
    /^SITESOURCERY_MONITOR_BACKUP_HASH_TIMEOUT_MS=30000$/mu
  );
  assert.doesNotMatch(
    monitorEnvironment,
    /^SITESOURCERY_ALERT_RECIPIENT=|^SITESOURCERY_MONITOR_CERTIFICATE_|SITESOURCERY_DATABASE_URL|sk_(?:live|test)_|whsec_|re_[A-Za-z0-9]/mu
  );
  for (const candidate of [
    backupMount,
    backupService,
    backupTimer,
    backupRecovery,
    monitorService,
    monitorTimer,
    monitorEnvironment
  ]) {
    assert.doesNotMatch(
      candidate,
      /misterfantasea|@[a-z0-9.-]+\.[a-z]{2,}|SITESOURCERY_RESEND_API_KEY=/iu
    );
  }

  assert.match(readme, /No Caddy service was installed or started\./u);
  assert.match(
    readme,
    /"accountRegistration":true[\s\S]*"accountRecoveryEmail":true[\s\S]*"downloadQuote":true[\s\S]*"publishing":false/u
  );
  assert.match(
    readme,
    /No staging customer row was copied into production\./u
  );
  assert.match(
    readme,
    /Before DNS can change, one reviewed root\/network pass/u
  );
});
