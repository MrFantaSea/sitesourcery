# CONTINUITY — the session ledger (updated 2026-08-01, pre-compaction)

Written so no ruling, promise, or open thread is lost when the working
conversation is condensed. If you are an assistant reading this fresh:
these are OWNER RULINGS and open work, not suggestions.


## Owner test keys (no card needed)

The paid states are session flags set by Stripe's redirect - the same doors
can be opened by hand for testing (each applies to that TAB until closed):
- Simulate the $5 download tier:  /abracadabra/app/?paid=1
- Simulate Alakazam active:       /abracadabra/app/?alakazam=1
Honor-gates by design; the human provisioning step is the real enforcement.

## Standing rulings (never drift)

- **Spellings**: Abracadabra (C). **Alakazam with a K** — the early build's
  "Alacazam" is retired everywhere incl. Stripe. Routes/code hooks keep
  lowercase c-aliases; never "correct" the K back.
- **No account = no persistence.** The maker runs on sessionStorage only.
  Close the tab, everything is gone, and the copy says so. Never add silent
  cross-visit memory. WITHIN the tab, made versions now DO survive
  navigation (abracadabra.tabwork key) - required so paying at Stripe
  does not destroy the page being paid for. Same-tab restore is not
  cross-visit memory; a new tab always starts cold.
- **The gate ladder**: FREE = make + preview (Crystal/Hearth/Midnight).
  **$5 download** = the file (in-app unlock via Stripe redirect ?paid=1) +
  the style kit (6 accents, type pairing, edges) + it UNLOCKS the Go-live
  door and doubles as the $5 coupon (owner applies it by hand on invoice 1).
  **Alakazam $25/mo** (?alakazam=1 redirect) = payment links (Cash App,
  Venmo) + everything stays unlocked. Locked options may ONLY be shown as a
  teaser line — and only if paying makes them genuinely render.
- **Looks**: labels Crystal / Hearth / Midnight (values clear/warm/arcane
  stay internal). The sample loader must NEVER override the chosen look.
- **Nav (all pages)**: ABRACADABRA · ALAKAZAM / SORCERY / THE RESPONDER /
  SPELL BOOK / ABOUT + phone pill. Menu words are the brand system.
- **Voice**: first person always (no "Zack does X"), US spelling
  (customize), centered text, minimalist, nothing explained twice, every
  card demos itself where possible. House style = home-hero frost pools,
  gold coins/rings, glass panels, storm background.
- **Responder**: $300 + $250/mo, in person only, never a site checkout.
- **Push gate**: owner will push only a "real, working, comprehensible,
  logical" site. NOTHING pushed yet; live sitesourcery.com still runs the
  old build. A deploy allowlist MUST exclude /server/, /scripts/, /ops/,
  BUILD.md, node_modules before any push.

## Money rails (all live, count pinned at 5 by the checker)

- $5 Abracadabra download — buy.stripe.com/8x2cN7e9y0wu6OW4fO7kc00 →
  redirects to /abracadabra/app/?paid=1 (live domain).
- $25/mo Alakazam hosting — buy.stripe.com/9B65kF0iIgvseho9A87kc01 →
  redirects to /abracadabra/app/?alakazam=1.
- $200 assessment — bJe4gB8Pe5QOb5cdQo7kc02.
- $40/yr .com — dRm9AV0iIfroddk5jS7kc03. $45/yr .net/.org —
  cNi7sN8Pegvs7T07s07kc04 (price_1TzP2pPi1bfFonRcLOug1Xnb).
- Credits ($5 and $200) are applied BY HAND — site says so; webhook later.

## Open decisions (OWNER's — ask, don't assume)

1. **Deploy target**: which repo/host serves sitesourcery.com? Asked twice,
   never answered. Blocks the push.
2. **Homepage favicon**: every page has the gold-star favicon EXCEPT home
   (his design-lock); needs his one-line ok.
3. **$35 Alakazam tier**: "$25 keeps the three looks; $35 gets ____" — the
   blank is his. Candidates parked in task #20 (menu section, more fonts,
   photo header, section toggles). Menu-on-page extra NOT built yet.
4. **Rent-tier price** (your-name.sitesourcery.me) — no number exists.
5. **/custom/scope/ + /custom/process/ fold into /custom/** — proposed,
   approved in spirit, executes during the Sorcery walk.
6. **Accounts: DECIDED, not open** (2026-08-01). Founder order, his words:
   "Clients need accounts, and we need a client account back end created
   also because we are the site provider... if they call me for help...
   Accounts are needed." And: "The point is to make the account part
   real. We're trying to be in business here." => task #21: customer
   accounts (created at the $5; account gates persistence, exactly his
   original ruling) + an OPERATOR back end (search by email/phone, see
   pages/versions/paid state, fix things on a support call) + Stripe
   webhook flipping entitlements server-side. Bridge first: browser-
   local account v1 so "$5 download and account creation" (his dictated
   teaser copy, now live in the kit) is true tonight. Only open piece:
   WHERE production runs - the same deploy-target question. Lesson
   recorded: when he dictates copy naming something unbuilt, that is a
   BUILD ORDER for the thing, not a wording problem - build the closest
   true version immediately and say what remains, never water down his
   words with disclaimers.
7. Homepage nits he may or may not want: lede spacing ("$5-Custom"),
   no name/face/proof on page (review nits; homepage is HIS locked design).

## Owner's own errands (remind, don't nag)

- Verify Spaceship wholesale costs (price book keeps costsConfirmed:false).
- Start Twilio A2P 10DLC registration (3–6 week clock; Responder blocked
  on it).
- After push: make one real $5 self-purchase as the first production test
  (self-refund; Stripe keeps ~fixed fee only).

## Walk state (task #17)

DONE and owner-approved: homepage (locked), /abracadabra/ lane page
(incantation home-hero certified zero-diff by computed-style tool; altar
vessel; medallion CLICK TO CONJURE; whole box clickable), the maker
(4 steps Look-first, gate ladder, blob previews so in-page links work,
sessions only, Crystal/Hearth/Midnight, includes-modal, versions panel
hidden — engine kept for tier era).
NEXT: Sorcery (/custom/) with the same knife, then Responder, Spell book
(/work/), About, Contact, FAQ, Legal, Domains-page polish. CLOSED since
first writing: /abracadabra/how/ stubbed; maker phone-swept clean at
320/390/480 (rail folds 2x2); Open-working-preview verified post-blob;
Midnight recolored navy; post-pay round done (owner: extras were
pick-blind on Look, post-pay looked identical to free): style kit moved
to the Preview room with an Apply-the-style press, attestation digest
covers claims only (accent/type/edges stripped; payment handles stay),
makePreview compiles the attested facts DRESSED with current garments
(was compiling frozen reviewedRaw - style could never change post-review),
paid/live state chips under the title (frosted), gate intro swaps per
state, ss-paid/ss-live root classes. THEN the KEEP ROOM (owner: "the
Alakazam should not look like the abracadabra... why would we go back
through steps 1-4"): made versions persist per-tab and survive the
Stripe round-trip (they previously did NOT - a payer returned to an
empty step 1); with work + paid the room drops the wizard rail and
lands on "Your page." (live: "Your page — Alakazam keeps it."),
restore re-arms the attestation so the style kit works post-return,
boot toast yields to the welcome-back status, edit doors bring the
rail back only inside the ritual, and THE ADDRESS hunt (the /domains/
checker script + markup, one truth, absolute paths) sits in the gate
between Go-live and the includes modal, paid-gated with a teaser.
Entitlement script announces abracadabra:entitlements; the app
re-dresses on it (script-order race otherwise). Still open by design: the three base looks'
DEPTH pass ("samples are basic and lame") — coupled to the \$35 tier
co-design, task #20.

## Tooling (all in scratchpad, session-portable patterns)

- snap.mjs URL W H scrollY — CDP frames (port 9223).
- hero-diff.mjs — computed-style diff between two pages' heroes; zero
  output = certified match.
- sweep-widths.mjs — every route × 320/390/480, overflow + menu button.
- reseal-v2.mjs — truth-slot manifest reseal; the checker VERIFIES seals,
  so run it after editing sealed regions (app hero/save-gate, legal).
- scripts/check-site.mjs — routes, nav, links, anchors, prices vs catalog,
  canonicals, resource resolution, og assets, rails===5, seals, sitemap.
- Headless gotchas learned: window.confirm freezes headless (stub it);
  /json/new?URL + heavy multi-tab probes flake — single tab + race guards;
  srcdoc iframes mispaint on reassignment and mishandle anchors (hence
  blob previews).

## Incident ledger (so mistakes stay learned)

- Fabricated Stripe ID (caught, replaced) — never invent identifiers.
- K-sweep missed metas and .js strings first pass — sweeps must include
  meta content and scripts.
- "Cache" blamed twice for real bugs (boot setStep, validation trap) —
  verify server-side truth before blaming the owner's browser.
- text-wrap is half of white-space shorthand; !important archaeology bit
  three times — prune, don't stack.
- A probe hex must be unique to the claim: #275bd6 is BOTH the ocean
  accent AND Clear's baseline --accent, so the first Apply test passed
  vacuously. Plum #7a4fc0 exists only in the kit - probe with that.
- sessionStorage.clear() + navigate is NOT a cold-tab test once
  beforeunload resaves - only a genuinely new tab is cold.
- drive-keeproom.mjs (scratchpad) drives the whole pay journey:
  build, pay-return, refine, edit door, alakazam, cold tab.
