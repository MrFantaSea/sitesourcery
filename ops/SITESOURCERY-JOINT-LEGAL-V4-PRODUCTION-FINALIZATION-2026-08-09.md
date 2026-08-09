# Site Sourcery joint Legal V4 production finalization — 2026-08-09

Status: owner-approved production tuple finalized and retained locally. This record does not itself push, deploy, publish DNS, enable a commercial purpose, or call a payment provider.

The Cloudflare configuration evidence that motivated the bounded disclosure is retained in `ops/releases/cloudflare-provider-configuration-2026-08-09T213344Z.md`.

## Production authority tuple

- Effective at: `2026-08-09T21:42:11.000Z`
- Privacy version: `SS-HOSTED-PRIVACY-2026-08-09-V4`
- Privacy SHA-256: `2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99`
- Privacy bytes: `31451`
- Website Terms version: `SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4`
- Website Terms SHA-256: `4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642`
- Website Terms bytes: `26215`
- Authority digest: `ba2871701541ca78e29a9fef313a3e335e7fed571590eb319667c763a7cd3968`
- Privacy document ID: `00000000-0000-4000-8000-000000000049`
- Product Terms document ID: `00000000-0000-4000-8000-000000000105`
- Website Terms document ID: `00000000-0000-4000-8000-000000000106`

## Approval and content seal

- Owner approval reference: `owner-delegated-chat-2026-08-09-cloudflare-joint-legal-v4-go-live`
- Owner approval receipt SHA-256: `3bd0925738a0c5cfad4567ed2b8cdaa4b1b6a656726182d72494ff722ddd6fda`
- Content seal SHA-256: `53f6d6cbbf26f2df59849fbeb8afaab8ca5377ad67a66d6aa506cb01a64706d3`
- Retained finalization receipt SHA-256: `e31102f1b4b5603b00f404b2b0e1ee1f57cc73cab94b2f0f5f163f1f43d255c9`
- Retained bundle: `ops/releases/joint-legal-v4-2026-08-09T214211Z/`

## Retained artifacts

| Artifact | SHA-256 | Bytes |
| --- | --- | ---: |
| Privacy review | `eeec62ecb84fe42c8a8e3c7fa207f8b35479fceab998db925d49de4bf64126db` | 31,481 |
| Privacy template | `43598d6f67a4a06c994663eda261862310b3d3b61f80b4ce70aa2beec6634239` | 31,478 |
| Website Terms review | `986e4f3cb73b522cea11557f5a5fa819ecf050d98daa93f875264c1a692e13e4` | 26,250 |
| Website Terms template | `8f75c6b94cb962638c40b88462c9e0ec515ca2b7726a73e1564e444aaf1a520c` | 26,242 |
| Released Privacy page | `2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99` | 31,451 |
| Released Website Terms page | `4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642` | 26,215 |
| Released legal center | `e9e3026d5e97b764b523f46e01ee5ce9b86e471cf427254f83e97f61457ab4d2` | 4,980 |

## Hosted build input

The release builder must consume only the retained finalization directory:

```sh
node scripts/build-hosted.mjs \
  --joint-legal-v4-finalization ops/releases/joint-legal-v4-2026-08-09T214211Z \
  --output /private/tmp/sitesourcery-hosted-joint-legal-v4
```

The V4 disclosure accurately records Cloudflare as the bounded DNS, proxy, TLS, and tunnel processor. Legal V2 evidence remains byte-identical and the released V3 receipt remains valid. Alakazam, Care, domain purchase, publication, Responder checkout, and billing stay governed by their independent release controls; this legal finalization does not silently enable them.

## Completed proof

- Joint Legal V4 focused suite: 74/74 passed.
- Held Cloudflare configuration suite: 3/3 passed.
- PostgreSQL 16: all 58 migrations applied; the exact V4 receipt with three acceptances committed; a rogue fourth acceptance was rejected; Legal V2 evidence stayed byte-identical; the disposable database was absent after cleanup.
- Browser audit: Privacy, Website Terms, and Legal Center passed at 320×720, 390×844, and 1440×1000.
- Retained browser proof: `ops/releases/joint-legal-v4-2026-08-09T214211Z/proof/browser-proof.json`
- Retained browser proof SHA-256: `4ca1111951d3fb31280ea63fc9b1dc8f944a7bdaabc2568a48517c8c2d1f49c4`

## Remaining activation boundary

Before public traffic changes, build and deploy the retained release, apply the V4 migration and exact environment tuple on the production origin, prove the origin through the held tunnel, then perform the separately verified DNSSEC/nameserver cutover. Cloudflare must reach Active and issue the production certificate before public journey checks or any payment-purpose switch is lifted.
