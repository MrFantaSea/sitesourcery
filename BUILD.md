# Site Sourcery — build v2

Started 2026-07-30 on branch `build/sitesourcery-v2-20260730`, in a **persistent**
worktree at `~/sitesourcery-build`. The previous lane lived in
`/private/tmp/sitesourcery-finish-20260730`, one of ~50 worktrees under
`/private/tmp` that do not survive a reboot. Nothing was deleted to make this;
every earlier branch and worktree is untouched.

## The product, as the owner settled it

| | |
|---|---|
| **Abracadabra** | **Free to see, $5 to download** (owner pivot 2026-07-31). Makes a one-page preview from the customer's business details; the $5 unlocks taking it with you. |
| **Alacazam** | The paid service that follows: customise further, download, or go live. **The $5 is credited toward it.** |
| **Address, four ways** | buy from Zack (you run it) · buy + looked after · bring your own · rent `you.sitesourcery.me` monthly |
| **Custom** | Quoted builds. Card $400 · Card+ $650 · Site $1,200 · Site+ $1,800 · Signature $2,800 · Flagship $4,000 |
| **Hive** | **Custom AI automation apps and workflows**, priced to the workflow. The missed-call responder is one blueprint, starting $300 setup + $250/month. Not a menu. |
| **Assessment** | $200, credited toward a later build. **Sells today via Stripe.** |

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
| Abracadabra preview | $5 once | payment link | `…7kc00` | no — maker cannot charge yet |
| Alacazam hosting | $25/month | billing | `…7kc01` | no — cannot provision yet |
| Domain purchase | quoted per name | invoice | — | quoted by hand |
| Custom build | $400–$4,000 | invoice | — | quoted by hand |

**No server is required** for any of these. Stripe hosts checkout; the site only
ever contains a plain `https://buy.stripe.com/…` link.

**Only the assessment is wired on purpose.** All three links exist, but a link is
only put on a page once the thing behind it can actually be DELIVERED. The
assessment works end to end with nobody awake: the customer pays, Stripe collects
the address of their site as a custom field, and the report is written by hand.
The other two would take money for something that does not yet happen.
`scripts/check-site.mjs` enforces that any checkout link is on Stripe's own
origin — a nearly-right domain is the whole attack.

**Two promises are not yet real.** The site says the $5 comes off Alacazam and
the $200 comes off a build. Those exist only as page copy — they need Stripe
coupons, or someone has to remember on every sale. `readiness().creditsToHonour`
lists them so they cannot be quietly forgotten.

**Tax treatment is unreviewed on all five.** Marked `review_required` rather than
guessed; a monthly hosting service and a one-time design fee are not obviously
the same thing in New Jersey.

## What is actually left

**1. The maker cannot take money.** The commerce layer still sells a *download*
— `offerId "spark_download"` in `abracadabra-customer-control-dom.js`, and
`/projects/{id}/download-quotes` in the API. The paid object has to become the
preview, with download as one of Alacazam's features. This is why the $5 and $25
Payment Links exist but are not on any page.

**2. The two credits are only words.** The site promises the $5 comes off
Alacazam and the $200 comes off a build. Neither exists as a Stripe object.
Recommended: put a −$5.00 credit on the Stripe Customer at payment, so there is
no code to lose, nothing to type, and nothing to forge. Needs a small webhook.

**3. The domain price book needs real costs.** `server/domain/price-book.mjs`
computes retail from `cost × multiplier`, a floor, and a handling fee, and it
refuses to quote a premium name, an unknown ending, a stale cost, or anything at
or below cost. What it lacks is a live cost feed — Spaceship publishes a price
only for premium names, so costs must be synced and stamped until a feed exists.
The markup rule is also unset: multiplier, floor, and handling fee are the
owner's call.

**4. Deployment ② does not exist yet.** `server/hosted` holds 87 tables —
accounts, organizations, sessions, quotes, domain registrations, registrar
debits — behind `PUBLICATION_HOLD`. The public site is static; accounts need a
server and Postgres. Two deployments, and only the first is built.

**5. Tax treatment is unreviewed** on all five sellable things.

## Standing rules

- `npm run check` must pass before any part is called done.
- A checkout link goes on a page only once the thing behind it can be delivered.
- Every printed price must exist in `data/public-catalog.json`.
- Nothing here has been pushed. `sitesourcery.com` still serves the old atelier
  build, and replacing it is a founder decision.
