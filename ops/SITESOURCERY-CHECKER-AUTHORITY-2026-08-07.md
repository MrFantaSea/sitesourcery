# SiteSourcery checker authority — 2026-08-07

Baseline: sealed commit `f9950ae0dada716414c1108d4f1214a7660f6a56`.

## Decision

`npm test` is the release authority. Its current site phase runs HTML
validation, the machine parity proof, the current catalog gate, the current
legal-copy gate, and `scripts/check-site.mjs`. The Node phase includes focused
checker-authority and Work public-truth tests.

The vNext checker is an archived inspector, not a release gate. On this
baseline its retired contract reports 295 errors because it requires the old
Websites / Domains / Services / Hive / Start architecture, old exact marketing
sentences, a 74-file artifact, and CSS budgets that the accepted current site
does not use. Updating 295 expectations to mirror current bytes would create a
second, fragile source of truth.

The separate Spark V1 source inspector is also archived. It reports five stale
assumptions on this baseline. Current held and $5 Download truth remains in the
normal commerce and hosted-control mutation suites; none of those protections
was removed.

## vNext rule-family inventory

The machine ledger in `scripts/checker-authority.mjs` inventories all 34 direct
rule entry points called by `validateSiteVnext`, exactly once.

| Rule family | Disposition | Current authority / decision |
| --- | --- | --- |
| Route and artifact integrity | Current | Positive public-file ledger, current link/redirect/canonical/sitemap checks, and exact artifact build |
| Public contact identity | Current | `check-site.mjs` rejects alternate phone and email values |
| Main and 404 semantics | Ported | Current site gate now requires one `h1`, focusable `#main`, and 404 `noindex` |
| Public source and transaction boundaries | Current | Current site, domain-truth, commerce, and hosted-artifact gates allow reviewed app behavior but reject unapproved forms, external destinations, rails, and held semantics |
| CSS/SVG/resource closure | Current | Public ledger, current resource checks, artifact build, and browser traversal; retired parser details are not copied |
| Work evidence and invented claims | Ported | Focused shared Work validator plus seven mutation failures |
| Legal and public truth | Current | Current legal-copy gate, stable legal IDs, hosted truth seals, and domain truth tests |
| Custom-service commercial truth | Current | Catalog, quote, payment-boundary, and owner-projection tests |
| Abracadabra product truth | Current | Current V1 behavior, commercial-control, and hosted-control tests |
| Release-hold truth | Current | Exact offer availability, domain public truth, and hosted controls |
| Exact old IA, route labels, section order, and Start/Hive model | Retired | Obsolete owner-replaced architecture; current nav/link/browser gates retain navigability |
| Regex-only type floor and exact CSS strings | Retired | Rejected accepted current styling and did not compute rendered CSS; current width sweep owns actual layout usability |

## Spark V1 stale-assumption inventory

| Old assumption | Disposition and preserved authority |
| --- | --- |
| Every app page contains one exact long seller-legend sentence | Legacy-only; exact seller identity remains protected on legal pages and canonical contact identity remains site-wide |
| Any `checkout`, `buy now`, `order now`, or `live in minutes` wording is forbidden | Legacy-only lexical ban; current account-aware copy is allowed while offer classification and hosted mutations keep public checkout/publication held |
| The whole page contains exactly one dollar amount and it is `$5` | Legacy-only amount-count heuristic; catalog/rail checks and server quote tests bind the Download to exactly 500 USD minor units |
| All `sessionStorage` use is forbidden | Legacy-only blanket ban; reviewed session-scoped evidence is mutation-tested and grants no deployment or payment authority |
| Preview rendering must contain the literal `preview.srcdoc` source marker | Legacy-only implementation detail; current behavior tests and browser traversal own sandboxed preview behavior |

## Work public-truth contract

The current Work gate deliberately avoids copy, layout, order, and CSS locks.
It proves only the customer-facing evidence boundary:

- founder-owned projects are exactly `scone-sourcery` and `daarx`;
- fictional studies are exactly `trattoria` and `bright-spark`;
- both founder-owned entries explicitly say they are not client work;
- both studies retain visible `Fictional design study` labels and
  `data-evidence-kind="fictional-design-study"`;
- no project may be relabeled `client-work` or `client-result`; and
- an invented client-result phrase such as “Our clients doubled their sales”
  fails.

The test mutates every boundary above, including adding a third founder-owned
entry. All mutations must fail.

## Enforced parity proof

`npm run check:authority` fails unless:

1. the 34 direct vNext validation calls exactly equal the inventory, with no
   duplicate, missing, or extra call;
2. all five known Spark V1 stale assumptions remain explicitly inventoried;
3. every named current authority file exists;
4. current site and legal gates import current modules rather than the archived
   vNext checker;
5. `npm test` includes the authority and Work tests; and
6. no package script presents the archived vNext, Spark V1, exact-route,
   exact-section, or broad-copy inspectors as a current checker.

Both archived CLIs refuse an ordinary invocation and explain how to run the
current authority. Their obsolete diagnostics require
`--historical-inspection`.
