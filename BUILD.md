# Site Sourcery — build v2

Started 2026-07-30 on branch `build/sitesourcery-v2-20260730`, in a **persistent**
worktree at `~/sitesourcery-build`. The previous lane lived in
`/private/tmp/sitesourcery-finish-20260730`, one of ~50 worktrees under
`/private/tmp` that do not survive a reboot. Nothing was deleted to make this;
every earlier branch and worktree is untouched.

> Current implementation note (2026-08-02): this build diary predates the
> hosted integration. Exact commit
> `d7c33c7e4ec7623f63249e0dc5b3d2951e781212` now passes the real account,
> recovery, project, version, and held `$5` quote journey on isolated HTTPS
> staging. See `ops/HOSTED-STAGING-VERIFICATION-2026-08-01.md` and
> `ops/CONTINUITY.md` for current operational truth. Production
> `sitesourcery.com` remains unchanged. Staging PostgreSQL, its HQ-to-Zen
> tunnel, the API, and static artifact are now persistent enabled user services;
> a controlled database/tunnel restart retained the exact saved journey.
> The newest owner product contract is $5 once for Download, followed by
> Alakazam hosting at $25/$35/$50 per month. See the dated owner contract in
> `ops/CONTINUITY.md`; when older prose here conflicts, that newer ruling wins.
> The private 2026-08-02 implementation checkpoint now also proves the complete
> held-release $5 Checkout/Stripe-readback/entitlement/return/download path in
> the shipped browser against fresh PostgreSQL. It is not publicly activated.

## The product, as the owner settled it

| | |
|---|---|
| **Abracadabra** | **Free to see, $5 to download** (owner pivot 2026-07-31). Makes a one-page preview from the customer's business details; the $5 unlocks taking it with you. |
| **Alakazam** | Monthly hosted service at `label.sitesourcery.me`: $25 keeps the three base looks; $35 adds photo header, expanded fonts, section toggles, three-version history and modest care; $50 adds richer customization including Cash App/Venmo, a menu, further font/border controls and more care. **Paid value carries forward:** $5 -> $25 leaves $20, $25 -> $35 leaves $10, and $35 -> $50 leaves $15. |
| **Address, four ways** | buy from Zack (you run it) · buy + looked after · bring your own · rent `you.sitesourcery.me` monthly |
| **Custom** | Quoted builds. Card $400 · Card+ $650 · Site $1,200 · Site+ $1,800 · Signature $2,800 · Flagship $4,000 |
| **Hive** | **Custom AI automation apps and workflows**, priced to the workflow. The missed-call responder is one blueprint, starting $300 setup + $250/month. Not a menu. |
| **Assessment** | $200, credited toward a later build. **Sells today via Stripe.** |

Alakazam upgrades activate when the customer pays only the difference to the
next level. Downgrades wait until the current paid month ends: the customer
keeps the higher level until renewal, receives no mid-month downgrade refund,
and the next cycle charges the full lower monthly amount. Premium configuration
is retained, not deleted, but requires its matching active tier to use.

Prices are **public**. The previous build forbade printing any figure except `$5`
— a rule an agent introduced and no owner approved, and the reason the site
quoted no prices at all.

## Structure

```
/                    sort the arrival; sell nothing
├── /abracadabra/    $5 download  ─┐
│                                 ├─▶ /alacazam/ ─▶ /domains/   ← the money spine
├── /custom/         from $400   ─┘      (+scope, +process)
├── /services/       the discrete jobs, grouped
├── /hive/           custom AI automation
├── /work/           proof
└── /about/ /contact/ /faq/ /legal/
```

Cut: `/websites/` (a hub that re-asked the question the landing page had just
answered) and `/start/` (a chooser whose payoff was a link already in the nav).

## What carried over, and what did not

**Kept** — `vnext.css` (the aesthetic: `#08070c`, gold/violet, the atelier art),
`vnext.js`, `assets/`, `server/domain` (the 1,619-line Spaceship adapter),
`server/commerce` (the tenure model), `abracadabra/app` (the compiler), and
`data/public-catalog.json`.

**Unwired, not removed** — about 5,400 lines of validators
(`check-site-vnext.mjs`, `customer-section-ledger.mjs`, `check-routes.mjs`,
`build-hosted.mjs`, the hosted-truth manifest). They pinned exact marketing
sentences and section orderings for a product model nobody approved, so the spec
had to be edited before the site could be. Still on disk, still runnable via
`npm run check:legacy`.

**Replaced by** `scripts/check-site.mjs` — 202 lines checking only what breaks a
customer or costs money: routes resolve, one shared nav, no dead links or
anchors, every printed price is in the catalog, canonical phone and email, no
forms and no third-party network.

## Payment rails

Site Sourcery bills through `acct_1Tx2eoPi1bfFonRc` (Desiderata Labs LLC). Three
live Products and Prices were created 2026-07-30; see `server/commerce/rails.mjs`.

| Product | Price | Rail | Live checkout | Wired to a page? |
|---|---|---|---|---|
| Website assessment | $200 once | payment link | `…7kc02` | **YES — sells today** |
| Abracadabra Download | $5 once | account-bound Checkout | legacy link `…7kc00` is not used by the new rail | private implementation proven; public release held |
| Alakazam hosting | $25/month | billing | `…7kc01` | no — cannot provision yet |
| Alakazam expanded | $35/month | billing | not created | no — contract/backend held |
| Alakazam richer | $50/month | billing | not created | no — contract/backend held |
| Domain purchase | quoted per name | invoice | — | quoted by hand |
| Custom build | $400–$4,000 | invoice | — | quoted by hand |

The assessment still uses a direct Stripe Payment Link. The new $5 rail uses the
hosted server because the exact account, project, accepted version, receipt,
Stripe Customer, and durable Download entitlement must agree before delivery.

**Only the assessment is public on purpose.** The assessment works end to end:
the customer pays, Stripe collects the address of their site as a custom field,
and the report is written by hand. The private $5 implementation can now
deliver, but its release stays held until tax review, a real Stripe staging
payment, the owner walkthrough, and public cutover. Alakazam remains held until
subscription provisioning works.
`scripts/check-site.mjs` enforces that any checkout link is on Stripe's own
origin — a nearly-right domain is the whole attack.

**The credit promises are not yet real.** The product contract requires the
$5/$25/$35 paid ladder to carry forward by charging only the $20/$10/$15
difference on an upgrade, and the $200 assessment to come off a build. Those
still require a durable credit ledger and exact provider invoices; nobody
should have to remember them manually. `readiness().creditsToHonour` lists the
existing promises so they cannot be quietly forgotten.

**Tax treatment is unreviewed on all five.** Marked `review_required` rather than
guessed; a monthly hosting service and a one-time design fee are not obviously
the same thing in New Jersey.

## What is actually left

**1. Alakazam is not yet a finished subscription product.** The $5 Download
rail is implemented and proven privately. Next is the exact $25/$35/$50
subscription, difference-only upgrade credit, renewal-boundary downgrade,
feature entitlement, provisioning, and customer billing-control contract.

**2. The credits are only words.** The site promises the paid ladder carries
forward and the $200 assessment comes off a build. Neither has a complete
durable credit ledger/provider-invoice implementation. The Alakazam rail must
compute the exact server-authorized difference and bind it to the customer's
existing Stripe Customer; a generic reusable coupon is not sufficient evidence
of which rung the customer already paid for.

**3. The domain price book needs real costs.** `server/domain/price-book.mjs`
computes retail from `cost × multiplier`, a floor, and a handling fee, and it
refuses to quote a premium name, an unknown ending, a stale cost, or anything at
or below cost. What it lacks is a live cost feed — Spaceship publishes a price
only for premium names, so costs must be synced and stamped until a feed exists.
The markup rule is also unset: multiplier, floor, and handling fee are the
owner's call.

**4. Production is rehearsed but not publicly routed.** `server/hosted` runs
with canonical PostgreSQL on isolated HTTPS staging and its account/project
journey is proven. Dell/HQ now also run a held, restart-proven, loopback-only
production rehearsal from the exact release against a separate clean database;
the pinned Caddy binary and held config validate but are not active. Production
mail adapters are ready, and an encrypted off-machine backup plus clean-room
restore are now proven on Zen. Production still needs root/network ingress,
monitoring and its reviewed alert path, same-origin DNS cutover, a delivered
production mail/action proof, and a public production verification; GitHub
Pages cannot provide that backend.

**5. Tax treatment is unreviewed** on all five sellable things.

## Standing rules

- `npm run check` must pass before any part is called done.
- A checkout link goes on a page only once the thing behind it can be delivered.
- Every printed price must exist in `data/public-catalog.json`.
- The exact candidate branch is pushed and deployed to isolated staging.
  `sitesourcery.com` still serves the old GitHub Pages build; production
  replacement has not occurred.
