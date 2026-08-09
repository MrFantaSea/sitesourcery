# Site Sourcery Cloudflare safe staging evidence

- Observed at: `2026-08-09T23:48:36Z`
- Domain: `sitesourcery.com`
- Cloudflare account: `c3bf397ce8dac3811f16427264bce4d6`
- Cloudflare zone: `c58511cf133078327a5fe9036e14d33a`
- State: provider staging complete; public delegation intentionally unchanged

## Cloudflare pending-zone fallback

The pending Cloudflare zone contains exactly seven DNS-only records:

1. `A @ 185.199.108.153`
2. `A @ 185.199.109.153`
3. `A @ 185.199.110.153`
4. `A @ 185.199.111.153`
5. The pre-existing `send` MX record, unchanged
6. The pre-existing `send` SPF TXT record, unchanged
7. The pre-existing `resend._domainkey` DKIM TXT record, unchanged

Both assigned Cloudflare authorities, `jasmine.ns.cloudflare.com` and
`nash.ns.cloudflare.com`, returned the exact four A records. The apex and
`www` tunnel CNAMEs were absent. The four A rows were visually read back as
DNS-only in the authenticated provider console.

## Old DNSSEC removal

Spaceship DNSSEC was disabled only after its public DS was verified as:

- Key tag: `13442`
- Algorithm: `13`
- Digest type: `2`
- Digest: `280F8BE6E3C98F2F162335D2AB22D2B1CC4B7638D786C2F90AAEE9BC70D75A81`

At the observation timestamp, every `.com` authority from
`a.gtld-servers.net` through `m.gtld-servers.net` returned no DS. Public
resolvers `1.1.1.1`, `8.8.8.8`, and `9.9.9.9` also returned no DS.

The parent delegation remained unchanged with TTL `172800`:

- `launch1.spaceship.net`
- `launch2.spaceship.net`

Both Spaceship authorities continued returning that same delegation.

## Mandatory next gate

Do not change nameservers before `2026-08-10T23:48:36Z`. That is one full
old-DS TTL (`86400` seconds) after confirmed parent removal.

At or after that time, re-prove DS absence and the exact seven-record
Cloudflare fallback, then change only the registrar nameservers to:

- `jasmine.ns.cloudflare.com`
- `nash.ns.cloudflare.com`

Keep the fallback records unchanged while the old `172800`-second
nameserver TTL converges. Enable Cloudflare DNSSEC and install the newly
issued Cloudflare DS only after Cloudflare reports the zone Active and the
delegation is independently verified. Never reuse the old Spaceship DS.

No commercial switch, Stripe purpose, tunnel hostname, public proxy, or
customer/provider effect was enabled by this staging operation.
