// Omitted deploymentProfile retains historical Dell evidence byte-for-byte.
// New placement must use an explicit version; this module is in the HQ ingress manifest.
export const HQ_DEPLOYMENT_PROFILE = "hq-local-v1";
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const listeners = {
  hostedApi: "127.0.0.1:8788",
  tenantRuntime: "127.0.0.1:8080",
  originGateway: "127.0.0.1:8081",
  tunnelMetrics: "127.0.0.1:20241",
  publicTcpListeners: [],
  cloudflareIngressCatchAll: "http_status:404",
  tunnelTransport: "outbound_only"
};
const workerPaths = {
  apiEntrypoint: "server/hosted/bin/server.mjs",
  tenantEntrypoint: "server/selfhost/bin/server.mjs",
  workerEntrypoint: "server/hosted/bin/worker.mjs",
  publicationCommandTransport:
    "server/hosted/publication-command-transport.mjs",
  notificationMailPrivateRenderer:
    "ops/notification-mail-private-renderer.mjs",
  hostedUnit: "ops/sitesourcery-hosted.service.held",
  tenantUnit: "ops/sitesourcery-tenant.service.held",
  unit: "ops/sitesourcery-workers.service.held",
  hostedEnvironmentSchema: "ops/hosted.env.example",
  tenantEnvironmentSchema: "ops/tenant.env.example",
  environmentSchema: "ops/workers.env.example"
};
const legacy = freeze({
  hostRole: "dell_origin_hq_database", listeners, workerPaths,
  currentRoot: "/opt/sitesourcery/current",
  dataRoot: "/var/lib/sitesourcery", databaseSsl: "require",
  apiUnitName: "sitesourcery-hosted.service",
  caddyPath: "ops/Caddyfile.cloudflare-tunnel.candidate.held",
  tunnelPath: "ops/cloudflared-sitesourcery-production-dell.yml",
  gatewayUnit: "ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service",
  tunnelUnit: "ops/production-rehearsal/sitesourcery-cloudflared.user.service",
  environmentPaths: ["ops/caddy.env.example", "ops/hosted.env.example", "ops/tenant.env.example", "ops/workers.env.example"],
  unitPaths: ["ops/production-rehearsal/sitesourcery-cloudflared.user.service", "ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service", "ops/sitesourcery-hosted.service.held", "ops/sitesourcery-tenant.service.held", "ops/sitesourcery-workers.service.held"],
  ingressPaths: ["ops/Caddyfile.cloudflare-tunnel.candidate.held", "ops/cloudflared-sitesourcery-production-dell.yml", "ops/production-rehearsal/sitesourcery-cloudflared.user.service", "ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service"]
});
const root = "ops/deploy/hq";
const hq = freeze({
  hostRole: "hq_origin_local_database",
  listeners: { ...listeners, hostedApi: "127.0.0.1:18988" },
  currentRoot: "/home/mrfantasea/.local/share/sitesourcery-production/current",
  releaseBase: "/home/mrfantasea/.local/share/sitesourcery-production/releases",
  nodePath: "/home/mrfantasea/.local/opt/sitesourcery/node-v24.18.0/bin/node",
  dataRoot: "/srv/sitesourcery-storage/production/app", databaseSsl: "disable",
  apiUnitName: "sitesourcery-hq-api.service",
  workerPaths: { ...workerPaths,
    hostedUnit: `${root}/sitesourcery-hq-api.service.held`,
    tenantUnit: `${root}/sitesourcery-hq-tenant.service.held`,
    unit: `${root}/sitesourcery-hq-workers.service.held`,
    hostedEnvironmentSchema: `${root}/hosted.env.example`,
    tenantEnvironmentSchema: `${root}/tenant.env.example`,
    environmentSchema: `${root}/workers.env.example`
  },
  caddyPath: `${root}/Caddyfile.held`, tunnelPath: `${root}/cloudflared.yml`,
  gatewayUnit: `${root}/sitesourcery-hq-gateway.service.held`,
  tunnelUnit: `${root}/sitesourcery-hq-cloudflared.service.held`,
  environmentPaths: ["caddy.env.example", "hosted.env.example", "tenant.env.example", "workers.env.example"].map(name => `${root}/${name}`),
  unitPaths: ["api", "tenant", "workers", "gateway", "cloudflared"].map(name => `${root}/sitesourcery-hq-${name}.service.held`),
  ingressPaths: [`${root}/Caddyfile.held`, `${root}/cloudflared.yml`, `${root}/sitesourcery-hq-gateway.service.held`, `${root}/sitesourcery-hq-cloudflared.service.held`, "ops/origin-deployment-profiles.mjs"]
});
export function originDeploymentProfile(id) {
  if (id === undefined) return legacy;
  if (id === HQ_DEPLOYMENT_PROFILE) return hq;
  throw new Error("Origin deployment profile is unknown or invalid.");
}
export function deploymentProfileFields(record) {
  if (!Object.hasOwn(record, "deploymentProfile")) return {};
  if (record.deploymentProfile !== HQ_DEPLOYMENT_PROFILE) {
    throw new Error("Origin deployment profile must be an explicit supported version.");
  }
  return { deploymentProfile: record.deploymentProfile };
}
