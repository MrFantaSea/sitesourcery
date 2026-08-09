# Cloudflare provider register and held launch runbook

Status: provider configuration evidenced; traffic and commercial release held.
The exact observed configuration is recorded in
`ops/releases/cloudflare-provider-configuration-2026-08-09T213344Z.md`.
That evidence does not by itself authorize nameserver delegation, start the
Dell connector, publish Legal V4, or lift a payment switch.

## Selected production architecture

Cloudflare is selected to provide authoritative DNS, TLS termination, HTTPS reverse-proxy delivery, security handling, and an outbound Cloudflare Tunnel from the Dell origin. A separate, user-triggered Domains preflight may use Cloudflare public DNS. The browser-to-Cloudflare HTTPS connection terminates at Cloudflare; Cloudflare Tunnel then encrypts edge-to-origin transport over origin-initiated outbound connections.

In those roles Cloudflare can handle the visitor IP address; requested hostname, path, and query; request headers and similar browser or device data; cookies and session data carried in requests; response data needed to proxy the exchange; and request, response, security, error, and timing records generated for delivery and protection. Tunnel encryption does not prevent Cloudflare from processing request and response contents at its edge.

The launch excludes Cloudflare advertising, Cloudflare Web Analytics, Workers, email routing, Turnstile, and any other optional Cloudflare product unless a later reviewed legal and operational change adds it. Site Sourcery application responses for authenticated account, payment, and evidence routes are expected to keep their enforced `no-store` or `private, no-store` directives. No claim is made that every static asset or Cloudflare security record is uncached or retained for a fixed period.

Primary provider references:

- Cloudflare Tunnel overview: https://developers.cloudflare.com/tunnel/
- Tunnel configuration: https://developers.cloudflare.com/tunnel/configuration/
- Origin parameters: https://developers.cloudflare.com/tunnel/advanced/origin-parameters/
- Tunnel routing: https://developers.cloudflare.com/tunnel/routing/
- Tunnel firewall guidance: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/

## Required configuration evidence before legal finalization

Record and review all of the following without storing credentials in the repository:

1. Exact Cloudflare account and zone references; authoritative nameservers; proxied hostnames; origin hostname; and public DNS cutover plan.
2. Exact tunnel identifier, ingress host-to-origin mapping, connector identity, outbound firewall boundary, origin listener, TLS mode, certificate behavior, and origin-authentication controls.
3. Exact cache rules and Browser/Edge TTL behavior for HTML, static assets, authenticated paths, payment paths, evidence paths, error responses, redirects, and query strings. Prove application `Cache-Control` directives survive the edge where required.
4. Exact security products and settings enabled at launch, including managed rules, rate limits, bot controls, challenge behavior, IP lists, access policies, and any request-body inspection limits.
5. Exact Cloudflare log products, fields, destinations, access roles, sampling, and retention. If no customer-accessible logging product is enabled, record what Cloudflare still retains under the contracted service and plan.
6. Exact cookie behavior, header additions/removals, client-IP forwarding, TLS version/cipher policy, HTTP protocol behavior, WebSocket behavior, upload limits, and timeout limits.
7. Evidence that advertising, Web Analytics, Workers, email routing, Turnstile, and every other optional product remain disabled or absent.
8. Three-viewport browser and network proof for public, account, payment, assessment evidence/report, Custom build, and held-service routes, including origin-unreachable and tunnel-disconnected failure behavior.

## Release gates

Privacy V4 and Website Terms V4 remain a paired held candidate. All V4 production versions, artifact digests, byte counts, artifact URIs, shared `effectiveAt`, and authority digest stay null until the configuration evidence above is complete and the finalizer is run once with a new current UTC tuple. The finalizer must produce new immutable document IDs `00000000-0000-4000-8000-000000000049`, `00000000-0000-4000-8000-000000000105`, and `00000000-0000-4000-8000-000000000106`; it must not replace or mutate V2 or V3 evidence.

New project creation must remain bound to the currently deployed exact authority until the complete V4 release receipt, matching runtime environment, matching database document/artifact rows, hosted build, and deployment manifest are atomically cut over. Any partial V4 environment must hold writes and must never fall back to V3.

Alakazam billing, lifecycle, Care, domain purchase, Site Sourcery-managed publication, and Responder remain held. This runbook does not authorize Stripe, DNS, tunnel, Dell, deployment, or provider effects.

## Rollback boundary

Before cutover, rollback means discard the V4 candidate output and leave the exact V3 authority and evidence in place. After a future cutover, do not delete or rewrite V4 receipts or legal evidence. Restore traffic using the separately approved provider rollback plan, keep existing reads and evidence available, and hold new writes if runtime, database, hosted artifacts, or provider configuration no longer match the exact active authority.
