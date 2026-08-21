# FIN-010 production cutover provenance

Date: 2026-08-21  
State: complete at honest 100/100; stabilization active  
Runtime: `e8862278eb66e87d3536b4e084dc9647c996d993`  
Runtime tree: `ac53f6a59feb9ab7b6e05cb8e03d9c8bcc810eb2`  
Final cutover control: `597011edebf9c960075118b4c0986d12bd4f9ac3`  
Control tree: `61231469c0987f64482bd168d1deff79aacaa246`

Machine-readable receipt: `fin010-production-cutover-receipt.json`, SHA-256
`7812b78086ef65d406fdae1557ff5be668ee578d9568a4a7c294cce79dd29561`.
The receipt contains no credential, token, readable inbox address, provider
message identifier, or private mailbox content.

## Protected source and deployment identity

The accepted runtime remains the exact immutable FIN-010 candidate above at 95
migrations. Protected held-proof control `b05fcfb...` passed run `32496652189`
and issued receipt digest `72be365a...`. The final gateway hardening passed
focused proof 6/6 and the complete operations matrix 221/221. PR #20 contained
only the gateway source and test, passed protected Site quality, and rebase-
merged as exact main `597011e...`, tree `6123146...`. Exact-main Site quality
run `32523531704` and controlled-Pages validation run `32523531386` passed;
Pages packaging, upload, and deployment remained skipped under its hold.

Dell cloned the exact main commit into a detached, clean control directory and
re-passed focused proof 6/6. Pinned Caddy 2.11.4 validated the generated
gateway. The installed mode-0600 config is SHA-256
`c625963bd1365efbd213211842e7beac0659149d1e3c88056009f5d5fb70ae8e`.
Its predecessor, SHA-256
`073a246cd808e61a6a14de0676b0699860524506e5dfce4c30862b785f768764`,
is retained at the exact rollback path recorded in the receipt. Only the
origin gateway was restarted; the runtime itself has zero restarts.

## Public Cloudflare and registrar cutover

Cloudflare is authoritative through exactly `jasmine.ns.cloudflare.com` and
`nash.ns.cloudflare.com`. Apex and `www` are proxied only to tunnel
`211ffa61-e170-444d-a945-04fead19c972`; the four former GitHub Pages A values
remain recorded for fast rollback. Resend MX, SPF, and DKIM were unchanged.
DNSSEC remains off and the parent has no DS. Spaceship contacts, renewal,
transfer, and registrant state were not changed.

Cloudflare automatic RUM injection initially changed approved HTML at the
edge. Web Analytics/RUM was explicitly declined and its dashboard reads
Disabled. The gateway now also sends `Cache-Control: no-store, no-transform`
for static HTML, preventing future edge transformation of the approved bytes.
The final direct-edge proof at `2026-08-21T21:27:42.259Z` passed:

- 24/24 canonical routes at exact accepted bytes;
- 14/14 legacy routes at exact permanent-redirect targets;
- the already accepted 24-route × 6-width, 144-view browser artifact by exact
  public-byte equivalence;
- live, ready, and capabilities at runtime `e886227...` and 95 migrations;
- current and immutable Privacy and Website Terms V5 exact hashes;
- trusted apex/wildcard TLS, internal-path 404, public wrong-host rejection,
  and exact origin wrong-host 421.

Runtime, static, origin, Cloudflared, backup timer, and monitor timer are
active. Listeners `8080`, `8081`, and `8788` are loopback-only. The fresh Zen
backup attempt `2026-08-21T171334466Z-0dcb2b83-5af3-4dd3-acb7-c05074e03481`
retains two ciphertext artifacts and zero plaintext, with manifest SHA-256
`a1591c5cf46f8851410662b494ef8b9d765745d557a765bf88ed2e417a8542e4`.

## Controlled registration and recovery

The exact owner-controlled Desiderata Labs mailbox was verified in the signed-
in Proton session before any account write. Its normalized destination is
recorded only by SHA-256 `ed51630...`. The public Create account journey sent
one activation through the approved Resend registration purpose. The real
message arrived, its private token was consumed, and the application reported
`Account activated` and `Signed in`.

The account was then signed out. The public recovery journey sent one message
through the approved Resend recovery purpose. The real message arrived, its
private token was consumed, the password was replaced, and a final sign-in
with the recovered credential succeeded. Durable readback shows:

- registration `activated`, provider-accepted lineage, immutable delivery
  receipt and possession evidence, plus created user and organization;
- recovery `delivered`, provider-accepted lineage, retained provider/mail
  receipts, and token-possession evidence; and
- exactly one activation plus one recovery mail ledger entry for the same
  destination digest, each with provider message and acceptance evidence.

The final credential is stored in the Mac login Keychain as `Site Sourcery
owner account`. It is absent from this repository, receipt, terminal output,
and continuity files. The temporary clipboard copy was cleared and verified at
zero bytes.

## Stabilization and held exit states

Stabilization began at `2026-08-21T21:06:21.054Z`. The immediate monitor
checkpoint finished 6/6 green with no alert and no delivery attempt. A brief
runtime-probe alert during the controlled origin restart window was delivered
and automatically recovered; the runtime service never restarted, and the
next two checks were green. A later stabilization sweep observed one public
`/ready` 503 after all static and redirect checks passed. Runtime, DB tunnel,
backup, and quiesce-fence readback were healthy; 20/20 direct and then 20/20
public readiness follow-ups returned 200 with the exact release. The transient
did not reproduce, and its exact cause remains unassigned rather than guessed.
The 15-minute checkpoint then completed with the full 24/24 and 14/14 public
proof plus a fresh 6/6 monitor cycle. The existing five-minute timer remains
active. The one-hour, 24-hour, and seven-day checkpoints remain scheduled and
are not required to pretend the deployment is unfinished.

FIN-010 is honestly complete because every released purpose is public and
reconciled, rollback is retained, stabilization has begun, and each unavailable
provider purpose exits fully built/installed/held behind its named gate:

- Stripe awaits interactive reauthentication and exact live-account evidence;
- Domains awaits Spaceship commercial-use consent;
- Responder awaits Twilio credentials and A2P/Voice proof;
- iOS and Android distribution await their signing/store evidence; and
- publication and tenant-domain effects await an independent owner release.

Download payment, Domain purchase, publication, worker, Twilio, Care,
Responder, and native-distribution effects remain off. No retained predecessor,
fallback, staging artifact, backup, receipt, Git ref, or rollback pair was
retired. Retention is at least 30 days and no automatic deletion is authorized.
