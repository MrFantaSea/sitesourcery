# Successor route manifest

State: proved at FIN-007 implementation commit
`b69ff5f8930c86d17a1c0dc0e7070ed76f738bf9` (tree
`ee16b3953b18b7ff9d2342eb7dedc4f271dac94d`).

## Exact canonical public routes

| # | Route | Reviewed file |
|---:|---|---|
| 1 | `/` | `index.html` |
| 2 | `/websites/` | `websites/index.html` |
| 3 | `/websites/made-for-you/` | `websites/made-for-you/index.html` |
| 4 | `/custom/` | `custom/index.html` |
| 5 | `/custom/scope/` | `custom/scope/index.html` |
| 6 | `/custom/process/` | `custom/process/index.html` |
| 7 | `/abracadabra/` | `abracadabra/index.html` |
| 8 | `/abracadabra/how/` | `abracadabra/how/index.html` |
| 9 | `/abracadabra/app/` | `abracadabra/app/index.html` |
| 10 | `/hive/` | `hive/index.html` |
| 11 | `/solutions/` | `solutions/index.html` |
| 12 | `/domains/` | `domains/index.html` |
| 13 | `/work/` | `work/index.html` |
| 14 | `/about/` | `about/index.html` |
| 15 | `/faq/` | `faq/index.html` |
| 16 | `/contact/` | `contact/index.html` |
| 17 | `/start/` | `start/index.html` |
| 18 | `/legal/` | `legal/index.html` |
| 19 | `/legal/privacy/` | `legal/privacy/index.html` |
| 20 | `/legal/website-terms/` | `legal/website-terms/index.html` |
| 21 | `/alakazam/` | `alakazam/index.html` |
| 22 | `/care/` | `care/index.html` |
| 23 | `/responder/` | `responder/index.html` |
| 24 | `/services/` | `services/index.html` |

The exact primary navigation on all canonical pages is Abracadabra, Alakazam,
Sorcery, Care, The Responder, Spell book, and About.

## Exact compatibility redirects

| Reviewed file | Exact destination |
|---|---|
| `about.html` | `/about/` |
| `alacazam/index.html` | `/alakazam/` |
| `automation.html` | `/hive/` |
| `contact.html` | `/contact/` |
| `faq.html` | `/faq/` |
| `how-it-works.html` | `/custom/process/` |
| `pricing.html` | `/custom/scope/` |
| `privacy.html` | `/legal/privacy/` |
| `terms.html` | `/legal/website-terms/` |
| `thanks.html` | `/contact/` |
| `the-difference.html` | `/about/#the-difference` |
| `the-meter.html` | `/custom/process/#scope` |
| `the-moat.html` | `/about/#the-difference` |
| `the-responder.html` | `/responder/` |

## Proof

The clean real-Chrome audit passed every canonical route at 320, 360, 390,
720-at-200%-reflow, 768, and 1440 pixels: 144 exact canonical views. The same
contract proves exact-width layout, canonical/query/fragment behavior, all 14
redirect destinations without loops, no-script and reduced-motion behavior,
DOM/AX accessibility, link-graph closure, bounded CSS/image failure, keyboard
activation, and 44-pixel controls. The deterministic Pages artifact contains
exactly 93 reviewed files.

This manifest describes candidate bytes only. It grants no deployment, Pages,
DNS, provider, publication, or cutover authority.
