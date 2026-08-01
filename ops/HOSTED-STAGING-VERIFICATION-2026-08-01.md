# Hosted staging verification — 2026-08-01

This is the non-secret operational checkpoint for the Site Sourcery website and
its existing hosted backend. DAARX, System Sourcery, HQ app integration, and
field-Mac integration remained outside this work.

## Exact release

- Commit: `d7c33c7e4ec7623f63249e0dc5b3d2951e781212`.
- Branch: `build/sitesourcery-v2-20260730`.
- Commit subject: `Install reviewed hosted legal authority`.
- Source path on Zen:
  `/home/zentech/sitesourcery-staging/releases/d7c33c7e4ec7623f63249e0dc5b3d2951e781212`.
- Node: exact `24.18.0` toolchain under the staging directory.
- Public staging origin: `https://simbiotechzen.tail85d878.ts.net`.
- Both the runtime and immutable static-artifact user services are enabled and
  active. Root, `/abracadabra/app/`, `/api/v1/health`, and `/api/v1/ready`
  returned HTTP `200` after deployment.

The static service serves only the verified `_hosted` artifact. The API and
tenant listeners bind to loopback. Tailscale Funnel terminates public HTTPS and
routes `/api` to the same-origin API. Production DNS was not changed.

## Legal and database authority

Migration `202608010021_hosted_legal_authority.sql` installs and readiness
requires these exact active records:

- `product` and `website`:
  `SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2`, digest
  `bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196`.
- `privacy`: `SS-HOSTED-PRIVACY-2026-07-30-V2`, digest
  `b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b`.

The migration also installs `ss.hosted_runtime_contract_v21()`. Migrations 000
through 021 executed on a fresh disposable PostgreSQL database, the contract
and all three records verified, and the disposable database was removed.
Migration 021 then applied once to staging and verified before the new runtime
started.

The customer checkbox now names and links the website terms, their
self-service product terms, and the privacy notice. An artifact regression test
pins that exact consent copy.

## Release evidence

- Current Node tests: 263 passed.
- Self-host tests: 19 passed.
- Hosted-service tests: 106 passed; two PostgreSQL-environment tests skipped in
  the ordinary local run as expected.
- Operations tests: 21 passed.
- Targeted legal/artifact tests: 49 passed.
- Public and hosted artifacts built and verified from their explicit
  allowlists.
- Browser audit: 15 hosted routes at 320, 390, and 1440 pixel widths, including
  the four-stage customer room and complete maker preview.
- The first browser-audit invocation was denied a loopback listener by the local
  sandbox; the identical audit passed when rerun with the approved loopback
  capability. This was an environment denial, not an application failure.

## Real customer and backend proof

The owner-controlled Proton plus-alias received real delivered Resend mail.
Registration and activation completed on the immediately preceding immutable
staging release. After the exact release above was deployed, a reviewed browser
completed password recovery and sign-in for that activated account, then
performed the persisted customer journey:

1. Make and review a free preview.
2. Recover the account through the delivered email action and sign in.
3. Create one named project while accepting the three reviewed legal kinds.
4. Save the initial accepted version.
5. Edit and persist the draft, then make and accept a second version.
6. Request and review the exact `$5.00 USD` Download quote.
7. Confirm payment remains unavailable, sign out, sign back in, and reopen the
   persisted project and edited draft.

The browser reported zero errors and made zero payment, billing, domain,
webhook, release, publication, or rollback requests. The secure session cookie
was `Secure`, `HttpOnly`, `SameSite=Strict`, and scoped to `/api/v1`; browser
storage contained no auth/session/token key.

The canonical staging database independently reported:

- registration state `activated`;
- one user and one organization;
- one active project with the edited draft at revision 2;
- two versions, both in `accepted_release` state;
- three required-term rows bound to the exact legal versions and digests above;
- one persisted held Download quote; and
- one active session.

No action token, password, session value, or Resend key was printed or written
to this evidence.

## Durable staging authority

The initially proven database and HQ-to-Zen tunnel were then found to be
manually started from `/tmp`; a reboot would have removed or disconnected
them. That omission is closed for staging:

- HQ now runs enabled user unit
  `sitesourcery-staging-postgresql.service` from persistent PostgreSQL 16.14
  toolchain and data paths under `/home/mrfantasea/.local/`.
- PostgreSQL has data-page checksums enabled, listens only on the mode-`0700`
  Unix-socket directory `/run/user/1000/sitesourcery-postgresql`, and contains
  only the clean staging database plus standard templates.
- Zen now runs enabled user unit
  `sitesourcery-staging-db-tunnel.service`; its pinned known-hosts file is
  persistent and mode `0600`, and only the service-owned SSH process listens on
  `127.0.0.1:55439`.
- `sitesourcery-staging.service` now requires and starts after that tunnel.
- User lingering is enabled on both hosts. The PostgreSQL, tunnel, API, and
  static staging units were all enabled and active after cutover.

A private mode-`0600` custom-format dump was captured before the cutover. Its
SHA-256 is
`bdd80f22e57778aa9673c4f8ccc4338bcb55685e8349cd99a24ad1d6a86a1461`.
Source and target independently matched the v21 contract, exact legal rows and
digests, core row counts, and `pgcrypto` availability. A controlled PostgreSQL
service restart and separate tunnel restart changed both process IDs; the API
then returned local and public health/readiness `200`, and the complete saved
customer/project state above matched again. The obsolete processes were
stopped, while the old database files were retained without deletion for
rollback. No whole-host reboot was performed.

The exact non-secret installed units are recorded under `ops/staging/`.

## Deliberate holds and remaining production work

- `$5` quote creation works, but Stripe payment and entitlement effects remain
  held.
- Publication and customer-domain purchasing remain held.
- The Resend key is present only in Zen's private staging environment file,
  mode `0600`. Production needs its own private environment and exact production
  action bases.
- `sitesourcery.com` still resolves to GitHub Pages. Production needs a durable
  hosted runtime and PostgreSQL path, reverse proxy/TLS, backup and restore
  evidence, monitoring, generated-artifact deployment, DNS cutover, and a
  post-cutover browser/database proof.
- HQ and Zen currently share the same observed public site/edge, so Zen is not
  yet the distinct off-site failure domain required by the production backup
  design. The staging rollback dump is local and does not close that production
  requirement.

Staging proves that the current website, account, recovery, project, and held
quote path is usable. It does not label payment, publication, domains, the
operator/HQ view, or production cutover complete.
