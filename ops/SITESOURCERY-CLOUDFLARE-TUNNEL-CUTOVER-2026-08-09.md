# Site Sourcery Cloudflare Tunnel cutover — held

This is the bounded replacement for residential-router port forwarding. It
keeps Spaceship as registrar and uses Cloudflare only for authoritative DNS,
public HTTPS/security proxying, and an outbound tunnel to the Dell origin.
It does not authorize Cloudflare Workers, Pages, D1, R2, email routing,
Turnstile, Web Analytics, advertising, or customer tracking.

## Current fail-closed state

- Production release: `e4b203916791a8136a3bc750910155faa50de54a`.
- Dell hosted API remains on `127.0.0.1:8788`; static and tenant services
  remain loopback-only.
- Stripe mode and every customer payment/effect switch remain held.
- The root-owned public Caddy service remains inactive behind
  `/etc/sitesourcery/PUBLICATION_HOLD`.
- Checksum-pinned `cloudflared` 2026.7.3 is installed only at
  `/home/simtech/.local/bin/cloudflared`. Its Linux AMD64 SHA-256 is
  `9d71c677db00134c1bd4144b7783486b654ad281b1ea62b4972098d19f770f17`.
- The user origin and tunnel services are installed but disabled/inactive.
- Neither `CLOUDFLARE_TUNNEL_APPROVED` nor `cloudflare-tunnel.token` exists.
- No process listens on `127.0.0.1:8081` or `127.0.0.1:20241`.

## Account record for the owner's offline book

Record these fields after the account is created. Never paste the password,
authenticator seed, recovery codes, API tokens, or tunnel token into Git, chat,
email, screenshots, shell history, or this runbook.

- Provider: Cloudflare
- Purpose: Site Sourcery authoritative DNS and production outbound tunnel
- Dashboard: `https://dash.cloudflare.com/`
- Email: `sitesourcery@proton.me`
- Plan: Free; no payment method
- Domain: `sitesourcery.com`
- Registrar: Spaceship (unchanged)
- Tunnel name: `sitesourcery-production-dell`
- Password: copy directly from the password manager to the offline book
- Two-factor method: authenticator app
- Recovery codes: copy directly from Cloudflare to the offline book
- Cloudflare account ID: fill after verification
- Cloudflare zone ID: fill after onboarding
- Assigned nameservers: fill after onboarding

## Authoritative DNS snapshot before onboarding

Observed directly from `launch1.spaceship.net` on 2026-08-09. Record TTL is
1,800 seconds unless otherwise noted.

| Type | Name | Value | Proxy after import |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | DNS only until tunnel cutover |
| A | `@` | `185.199.109.153` | DNS only until tunnel cutover |
| A | `@` | `185.199.110.153` | DNS only until tunnel cutover |
| A | `@` | `185.199.111.153` | DNS only until tunnel cutover |
| MX 10 | `send` | `feedback-smtp.us-east-1.amazonses.com` | DNS only |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | DNS only |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDTZRgU9DB7TuFzqRtHQj+Cx1DgQbG/cClNQ/aDzymuqA0JEsKtATrZHeIBqFBXtpaK6fRCW3LMrwlOx/19oIWb9NhqLbU56MrDb5LNB+KGPEZRWi8EJfHj32DgxhYDoRSdtP0f8s4yrc5ewRzDTmPQTOwpCFW1opqQnjCBL75hUwIDAQAB` | DNS only |

The zone currently has no apex MX/TXT, DMARC, CAA, AAAA, `www`, or active
`email.info` record. Certificate Transparency history mentions `www` and
`email.info`; history is not authority and those names must not be recreated
without a current requirement.

Current nameservers are `launch1.spaceship.net` and
`launch2.spaceship.net`. DNSSEC is active at the parent with DS:

```text
13442 13 2 280F8BE6E3C98F2F162335D2AB22D2B1CC4B7638D786C2F90AAEE9BC70D75A81
```

Do not change nameservers while that DS is present.

## Ordered cutover

1. Create the Cloudflare account with the owner-controlled Proton address.
   Verify the email, enable authenticator-app 2FA, store recovery codes
   offline, and do not add a payment method.
2. Onboard `sitesourcery.com` on the Free plan. Import records, then compare
   every record with the table above. Keep all four GitHub Pages A records
   DNS-only. Keep every mail record DNS-only.
3. Disable optional Cloudflare features that would alter or add browser data:
   Web Analytics/Browser Insights, Email Address Obfuscation, Rocket Loader,
   Auto Minify, Workers routes, Turnstile, email routing, and HTML transforms.
   Do not enable Bot Fight Mode before the three-viewport/customer-journey
   proof. Do not create Logpush or third-party integrations.
4. Set minimum TLS 1.2 and Always Use HTTPS. Use the origin's `no-store`
   headers and a zone cache-bypass rule for `sitesourcery.com/*` and
   `www.sitesourcery.com/*`; do not create a cache-everything rule.
5. Create remotely managed tunnel `sitesourcery-production-dell`. Configure
   public hostname `sitesourcery.com` to `http://127.0.0.1:8081` and `www` to
   the same origin. The loopback Caddy gateway performs the canonical `www`
   redirect and path routing.
6. Transfer the one-time tunnel token directly to
   `~/sitesourcery-production/run/cloudflare-tunnel.token` on Dell, mode 0600.
   Use a token file; never place the token in argv, shell history, clipboard,
   Keychain, logs, screenshots, or Git.
7. Finalize the additive joint Legal V4 authority. Privacy V4 must disclose
   Cloudflare as authoritative DNS, HTTPS reverse proxy/security edge, and
   tunnel provider. Preserve V3 evidence byte-for-byte. Deploy the V4 artifact
   before Cloudflare begins proxying production requests.
8. Create the private approval file, enable/start the two user services, and
   prove: one healthy tunnel replica, loopback-only origin/metrics listeners,
   exact Host rejection, internal-path rejection, `no-store`, security
   headers, API raw-body preservation, and zero provider/customer effects.
9. In Spaceship, disable DNSSEC and confirm the parent DS is absent from at
   least two public resolvers. Only then replace the two Spaceship nameservers
   with Cloudflare's exact assigned pair.
10. Wait until Cloudflare reports the zone Active. Verify NS through 1.1.1.1,
    8.8.8.8, and a full trace. Verify all Resend records before any account
    email proof.
11. Re-enable DNSSEC in Cloudflare, install the new Cloudflare DS at
    Spaceship, and prove a validating answer. Never reuse the old DS by
    assumption.
12. Run the unchanged three-viewport site journey plus registration/recovery,
    Checkout raw-body webhook, Portal return, tax, backup, monitoring, and
    rollback proofs. Keep Stripe live mode and effect switches held until every
    public proof is green.
13. Lift only the reviewed first-release offers, monitor, and then push the
    exact sealed repository commit. Alakazam, domain purchase, Responder, and
    any other explicitly held offer remain held.

## Fast rollback

- If the tunnel or origin fails after Cloudflare is authoritative, replace the
  apex tunnel route with the four recorded GitHub Pages A records as DNS-only.
  This avoids another nameserver change while preserving mail.
- If Cloudflare authoritative DNS itself must be abandoned, first restore the
  complete Spaceship record set, then restore `launch1.spaceship.net` and
  `launch2.spaceship.net`. Re-enable Spaceship DNSSEC only after it is again
  authoritative and publish the DS it currently issues; do not reuse either
  provider's prior DS blindly.
- At every rollback point, leave Stripe and all provider effects held until the
  public origin, legal notice, mail, and webhook paths are re-proven.

## Dell proof already completed

The held Caddy configuration validates under Caddy 2.11.4. A one-time process
owned by the operator proved, then exited:

- `sitesourcery.com /` -> 200
- unexpected Host -> 421
- `/_sitesourcery` -> 404
- `/api/v1/ready` -> 200
- listener bound only to `127.0.0.1:8081`
- `Cache-Control: no-store`, HSTS, frame/content-type/referrer/permissions
  headers present

No Cloudflare account, DNS record, tunnel, token, public listener, provider
effect, customer effect, or commercial release was created by that rehearsal.
