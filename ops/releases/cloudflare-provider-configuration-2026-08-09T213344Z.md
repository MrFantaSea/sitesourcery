# Cloudflare production provider configuration evidence

Captured at: `2026-08-09T21:33:44.000Z`

State: configured and held. The Cloudflare zone is still pending, the public
registrar delegation still points to Spaceship, the Dell connector is stopped,
and no customer request is routed through this configuration yet. This record
contains no credential, tunnel token, account certificate, password, recovery
code, or API key.

## Account, zone, DNS, and cutover boundary

- Account ID: `c3bf397ce8dac3811f16427264bce4d6`.
- Zone: `sitesourcery.com`; zone ID
  `c58511cf133078327a5fe9036e14d33a`; Free plan; no payment method.
- Assigned authoritative nameservers: `jasmine.ns.cloudflare.com` and
  `nash.ns.cloudflare.com`.
- Public authoritative nameservers at capture remain
  `launch1.spaceship.net` and `launch2.spaceship.net`.
- The parent still publishes Spaceship DS
  `13442 13 2 280F8BE6E3C98F2F162335D2AB22D2B1CC4B7638D786C2F90AAEE9BC70D75A81`.
  Nameserver delegation must not change while that DS exists.
- The pending Cloudflare zone has exactly five records:
  - proxied CNAME `sitesourcery.com` to locally managed tunnel
    `sitesourcery-production-dell`;
  - proxied CNAME `www.sitesourcery.com` to the same tunnel;
  - DNS-only MX 10 `send.sitesourcery.com` to
    `feedback-smtp.us-east-1.amazonses.com`;
  - DNS-only TXT `send.sitesourcery.com` equal to
    `v=spf1 include:amazonses.com ~all`;
  - DNS-only TXT `resend._domainkey.sitesourcery.com` byte-equal to the
    pre-onboarding public DKIM value recorded in the cutover runbook.
- The dashboard identified each tunnel row as a CNAME and rendered the content
  as tunnel `sitesourcery-production-dell`. Direct query to the assigned
  Cloudflare nameserver returned `www.sitesourcery.com CNAME
  211ffa61-e170-444d-a945-04fead19c972.cfargotunnel.com` and both exact mail
  records. Apex proxy answers remain unavailable while the zone is pending.
- No `AAAA`, apex MX/TXT, DMARC, CAA, `email.info`, or other record was added.

## Tunnel and origin

- Locally managed tunnel name: `sitesourcery-production-dell`.
- Tunnel UUID: `211ffa61-e170-444d-a945-04fead19c972`.
- Dell keeps only the tunnel-scoped JSON credential, mode `0400`; the broader
  account `cert.pem` and legacy token file are absent.
- Ingress is exact and ordered:
  - `sitesourcery.com` -> `http://127.0.0.1:8081`;
  - `www.sitesourcery.com` -> `http://127.0.0.1:8081`;
  - final catch-all -> `http_status:404`.
- Cloudflared metrics bind only to `127.0.0.1:20241`; the hosted API remains on
  `127.0.0.1:8788`; Caddy binds only to `127.0.0.1:8081`.
- The Caddy origin rejects an unexpected Host with 421, rejects internal paths,
  redirects `www` canonically, preserves API raw bodies, and emits the sealed
  no-store/security headers. Cloudflare Tunnel carries an encrypted outbound
  connector session between Dell and Cloudflare; the final local hop is
  loopback HTTP and has no public listener.
- The connector and origin user services are disabled/inactive and require the
  separate private `CLOUDFLARE_TUNNEL_APPROVED` file before starting.

## TLS and certificates

- SSL/TLS encryption mode: `Full`.
- Minimum client TLS version: `TLS 1.2`.
- TLS 1.3: enabled.
- Always Use HTTPS: enabled.
- Automatic HTTPS Rewrites: enabled.
- Opportunistic Encryption: enabled.
- Universal SSL remains enabled as a product, but the pending zone has no edge
  certificate yet. No Advanced Certificate Manager, custom certificate, Total
  TLS, or custom cipher suite was purchased or configured.
- Origin authentication is the tunnel-scoped credential and exact tunnel UUID,
  not a public origin certificate or residential inbound firewall opening.

## Cache, responses, and query strings

- Active Cache Rule `Site Sourcery all-traffic cache bypass` matches all
  incoming requests and applies `Bypass cache`.
- No Cache Response Rule exists. The fallback Caching Level is `Standard`, but
  the all-traffic bypass rule is first and active.
- Browser Cache TTL is `Respect Existing Headers`, so the origin's `no-store`,
  `private, no-store`, redirects, and other explicit Cache-Control directives
  remain authoritative. No cache-everything rule exists.
- Query String Sort is unavailable on this plan and not enabled. Crawler Hints,
  Always Online, and Development Mode are off. No cache purge was issued.
- Cloudflare-generated network errors retain provider-default formatting; no
  custom error rule or cached offline copy is configured.

## Network, headers, cookies, and limits

- IPv6 Compatibility: on. Pseudo IPv4: off.
- gRPC: off. WebSockets: off.
- IP Geolocation: off; no `CF-IPCountry` country header is requested.
- Network Error Logging: off.
- Onion Routing: on. This changes routing for legitimate Tor users but does not
  add an application feature or customer-accessible Cloudflare log product.
- Maximum Upload Size: 100 MB. Application request-size limits remain lower
  where defined and are still enforced at the origin.
- The uncustomized proxy header behavior passes request headers, overwrites
  `Accept-Encoding` to `br, gzip`, adds `CF-Connecting-IP`,
  `X-Forwarded-For`, `X-Forwarded-Proto`, and `Cf-Ray`, may remove invalid
  request header names, removes Cloudflare's documented `X-Accel-*` and
  `Alt-Svc` response headers, and adds `Cf-Ray`/`Cf-Cache-Status` responses.
  No custom request or response header transform exists.
- Caddy consumes `CF-Connecting-IP` only on the outbound tunnel boundary and
  forwards that value as `X-Forwarded-For`/`X-Real-IP`; no public origin can
  spoof the header because no public origin listener exists.
- No Cloudflare cookie-dependent product is intentionally enabled. There is no
  Waiting Room, load balancer affinity, Access application, Turnstile widget,
  Bot Fight Mode, or configured challenge rule. Cloudflare may still use a
  strictly necessary provider cookie if its baseline security service must
  deliver a challenge; the release makes no zero-cookie claim.
- Current provider limits recorded for the Free proxy are 16 KB URL, 128 KB
  total request headers, 128 KB total response headers, 19-second complete TCP
  connection, 90-second TCP ACK, 900-second proxy idle, 125-second proxy read,
  and 30-second proxy write. Tunnel-specific origin settings remain the sealed
  cloudflared defaults unless the committed configuration explicitly overrides
  them.

Provider references:

- https://developers.cloudflare.com/fundamentals/reference/http-headers/
- https://developers.cloudflare.com/fundamentals/reference/connection-limits/
- https://developers.cloudflare.com/network/websockets/
- https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/

## Security and logging

- The dashboard contains no managed-rule deployment, custom WAF rule, or rate
  limiting rule for this zone. Bot challenge controls were not enabled.
- Cloudflare's plan-level baseline network/DDoS protections still apply; this
  record does not claim those provider systems inspect or retain nothing.
- AI Labyrinth is off. The site contains no advertising, and no ad-scoped AI
  crawler rule is treated as release authority.
- No Logpush job, log destination, third-party integration, or
  customer-accessible raw request log was configured. Cloudflare can still
  retain operational, security, abuse, billing, and diagnostic records under
  its service and legal terms; Site Sourcery promises no fixed Cloudflare
  retention period.

## Explicitly disabled or absent products

- Cloudflare Web Analytics / browser RUM: disabled.
- Speed Brain, Cloudflare Fonts, Early Hints, Rocket Loader, and Smart Hints:
  off or not enrolled.
- Workers routes: none. Workers, Pages, D1, R2, Snippets, and Transform Rules:
  not configured for the zone.
- Email Routing: DNS records not configured and zero routing rules.
- Turnstile: no widget. Advertising: none. Zero Trust subscription: not
  activated. No payment method was added.

## Activation and proof gates

This evidence approves the disclosure-bound provider shape but does not itself
activate traffic. Before delegation, finalize and deploy joint Legal V4, create
the private Dell approval file, start the loopback origin and connector, and
prove the local held boundary. Then disable Spaceship DNSSEC, prove the old DS
absent, change only the registrar nameservers, wait for Cloudflare Active and a
Universal SSL certificate, install the new Cloudflare DS, and run the public
three-viewport, no-store, mail, webhook raw-body, Portal return, tax, monitoring,
backup, origin-down, tunnel-down, and rollback proofs. Stripe effects remain
held until those proofs are green.
