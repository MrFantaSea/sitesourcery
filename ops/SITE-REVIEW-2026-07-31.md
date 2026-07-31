<!-- Adversarial review of 2026-07-31: 5 fresh-eyes lenses, 9 findings
     skeptic-verified (9 confirmed, 0 refuted), 79 unverified. 15 agents.
     Method: read-only walk of the live local build + source tree.
     Status notes added 2026-07-31 evening are marked [STATUS]. -->

# The verdict

**Not yet.** The skeptic re-checked nine top findings and confirmed all nine — nothing was refuted — which nets out to five distinct critical problems: a live checkout that can take money for a service you can't deliver, a headline product nobody can buy, no navigation on phones, a dead flagship widget, and a ghost brand all over your copy. The one mercy is PUBLICATION_HOLD — none of this is public yet, so fix it before the hold lifts, not after. The honest one-liner from a fresh customer: "Looks like a real craftsman and every price is printed right there — but when I went to pay my five bucks there was no way to pay, and on my phone there's no menu."

## What holds up

- **The homepage fork genuinely sells.** Two doors sorted by situation ("No website yet?" / "Already have a site?" / "Losing calls?"), every price on the ladder printed where you can see it, and all 28 printed prices reconcile to the penny with the catalog file. Almost no small shop does this.
- **Honesty is your weapon and it's used consistently** — Work labels real vs. fictional vs. founder-owned instead of faking a portfolio, the domain checker says "looks available" and explains why, About splits public record from studio claims, and the legal terms match the sales copy dollar-for-dollar.
- **The art direction is ownable and the demos do real selling.** The sorcerer-atelier look carries hero to footer, and the missed-call/text-back phone demo explains The Responder better than any paragraph could.
- **The Abracadabra builder actually works end to end** — sample loader, per-step validation, review gate, version history, honest state copy — a real achievement for a static site with no server.
- **The accessibility craft under the hood is excellent**: reduced-motion with hand-curated end states, textbook menu code (focus trap, inert, Escape), disciplined "looks available" language. The menu code just deserves a layout that keeps its button on-screen.
- **The best copy is genuinely good**: "A missed call is a customer who rings someone else," the graceful "This one is not a button" in-person positioning, "Abracadabra makes it. Alacazam keeps it." — and the $200 assessment is the one purchase wired correctly (Stripe collects the email and the site to assess).

## Confirmed problems (ranked)

**1. The $25/mo Alacazam checkout is live with nothing behind it** — Critical (raised by two lenses, skeptic held both at critical).
- Evidence: alacazam/index.html:142 links an active live-mode Stripe subscription collecting only email and card — no field ties the charge to any page or address, no promo field can honor the promised $5 credit, and BUILD.md from the same day says "cannot provision yet... only the assessment is wired on purpose"; the page wired it 46 minutes later anyway.
- Why a customer feels it: a subscriber hands you a recurring $25 charge attached to no deliverable, and the advertised credit silently never happens — the refund-dispute-one-star pipeline, on a days-old Stripe account.
- Smallest fix: delete the Stripe link (leave the call/contact CTA) until provisioning exists.

**2. The $5 download — your headline product — cannot be bought; the funnel is a closed circle** — Critical (held on the customer pass; its technical twin trimmed to major only because it fails safe — nobody gets charged).
- Evidence: after "Make my preview" the only path is app → /abracadabra/#plans → /alacazam/ → back to /abracadabra/; exactly three buy.stripe.com links exist sitewide ($25/mo, $200, $40), none for the $5 — while the FAQ says "Can I use Abracadabra right now? Yes," the homepage says "Yours tonight," and the legal terms say "$5 unlocks downloading."
- Why a customer feels it: he does everything right, likes his page, reaches for his card — no door, and his work dies with the tab.
- Smallest fix: either wire the held $5 link or rewrite every "right now / yours tonight" line (hero, FAQ, terms) to say what's true today — copy and checkout must agree.

**3. No visible navigation on any phone, and every page scrolls sideways** — Critical (held on the customer pass; the design twin trimmed to major because Android's auto-zoom partially rescues it — iOS gets nothing).
- Evidence: probes at 320–480px put the menu button at x≈363–435 on a 390px viewport on every page, scrollWidth 435–570 forcing the sideways wobble; cause is the late !important brand clamps (vnext.css ~6203/7432) inside a nowrap header row.
- Why a customer feels it: the lunch-break phone visitor can never open the menu — Work and About are effectively unreachable — and a wobbling header reads "broken website" from a shop that sells websites.
- Smallest fix: remove or scope the late !important clamps so the header can shrink or wrap, then re-probe at 320–480.

**4. The Responder page is wired to the dead /hive/ path — planner inert, canonical points at a 404** — Critical (held on the copy pass; the technical twin trimmed to major because the widget takes no orders and the phone CTA still works).
- Evidence: responder/index.html:9 declares canonical sitesourcery.com/hive/ (404) and line 13 loads /hive/hive-planner.js (404 — the file lives at /responder/), so all six planner buttons ship permanently disabled; /work/ advertises it as a "Working planner."
- Why a customer feels it: he taps "Missed calls" on the flagship $300+$250/mo page and nothing responds — on a product whose whole pitch is responding — while the canonical tells Google the page's real home is a 404.
- Smallest fix: a two-line edit — point the script at /responder/hive-planner.js and the canonical at /responder/ (then retarget the two legacy stubs).

**5. The half-finished Hive→Responder rename leaks the ghost brand across five pages** — Critical (held).
- Evidence: "Hive" survives in visible copy on /responder/ (first screen), in the first FAQ answer (which never says "The Responder" at all), on /about/ ("Open Hive"), /work/, /contact/, and throughout both legal pages — while /hive/ 404s and no nav mentions Hive.
- Why a customer feels it: the FAQ's opening answer sells a product name that exists nowhere on the site, and jargon about "Hive builds" and "cells" lands at exactly the moments someone goes to resolve doubt.
- Smallest fix: find-and-replace Hive → The Responder across customer copy and legal, then reread those five pages once.

## Worth a look (could not be fully reproduced)

Nothing here. Every finding the skeptic re-checked reproduced fully — none came back half-proven.

## Raised and refuted

Nothing was refuted. Nine of nine re-checked findings confirmed; the only movement was three duplicate filings trimmed from critical to major (fails-safe $5 dead end, Android's partial menu rescue, the planner being conversation-only) — every merged problem above still carries at least one confirmed critical. The team swung and did not miss.

## Unverified nits

The skeptic never got to these — the first few are not nits at all and deserve the next verification pass.

- Domains widget prints "Availability is confirmed with the registrar before you are charged" directly above a Buy button that charges immediately off a DNS guess — a money-path honesty bug if it reproduces.
- The 404 page still wears last generation's nav — two of its doors lead to more 404s (/websites/, /hive/), and old flyer URLs bounce straight into the loop.
- Contact's "Find the right next step" goes to /start/, which redirects back to /contact/ — the promised chooser is dead code pointing at dead routes.
- `npm run check` passes green while all of the above ships — it never reads non-index HTML, script srcs, JS-generated links, or canonicals.
- Three route truths disagree — check-routes.mjs (fails with 91 errors), sitemap.xml, and the actual tree — the old IA is still half-encoded everywhere.
- /abracadabra/ promises a step-1 registry name check the app doesn't have and lists the wrong step order; /abracadabra/how/ is a linkless orphan.
- The $40 domain checkout's client_reference_id carries a dotted domain name, which Stripe silently discards — the order's subject rides on the customer retyping it.
- "Could not tell — Zack will check by hand" transmits nothing to you; the visitor waits for a check that never happens.
- "Your $5 comes off your first payment the moment you continue" has no mechanism — it's copy, not plumbing.
- "The domain is registered in your name" is false for the rent option — your own domains page says rented addresses stay Site Sourcery's.
- "Start with the $5 preview" buttons re-price the free look, and the meta descriptions tell Google the preview costs $5 — contradicting your own headline deal.
- The FAQ hedges the $200 credit, denies public prices exist, and never states an assessment turnaround — softer than the ads it should confirm.
- The Responder page runs flat "$300 + $250/mo" beside leftover "what moves the price" variable-pricing copy, and teases a fourth brand ("System Sourcery").
- Homepage: no button above the fold, the hero lede garbles into "$5-Custom" and "MAGIC-ONE," and there's no name, face, place, or proof anywhere on the page.
- Alacazam — the recurring-revenue product — has exactly one inbound link on the whole site; /domains/ is a cul-de-sac and "Rent monthly" has no price or CTA anywhere.
- Homepage says "Buy a domain"; the domains page sells nothing and never states a single price.
- Design drift: mint-and-pink one-offs on the $5 purchase screen, four chip-and-button dialects across the homepage cards, hard brightness seams in the backdrop, gray body text washing out on bright art, the price badge eating "WEBSITE SORCERY" at phone width.
- Contact promises topic highlighting no shipped code performs, and the domain widget's "Ask about" link targets an anchor that doesn't exist.
- Smaller: no favicon; a domain-and-email shop writing from @proton.me; British "Customise" register drift; a Scale tier in payment terms but not the ladder; stale /flyer.html quoting dead prices; 174KB of layered CSS with superseded blocks; three 12–14s looping animations with no pause control; one FAQ line still selling the pre-pivot "$5 for one preview" model; the 404 page's legal footer wording disagrees with every other page.

## If you fix only three things

1. **Make the money story true** — pull the live $25/mo Stripe link and every "buy it right now / yours tonight" $5 promise until checkout and provisioning actually exist; nothing on the site should promise a transaction it can't complete.
2. **Fix the phone header** — one CSS repair (the late !important clamps) puts the menu back for the majority device class on every page.
3. **Repoint the two /hive/ lines on /responder/** — script src and canonical; two lines revive the flagship page's planner and stop telling Google the page lives at a 404.

---

## [STATUS] What was done about it — same day

Confirmed #2 ($5 door): FIXED — live Stripe link at the app save gate with by-email fulfillment stated.
Confirmed #3 (phone header): FIXED — phone-width masthead override; /,/responder/,/faq/,/custom/ probe scrollWidth 390, zero offenders.
Confirmed #4 (/hive/ wiring): FIXED — canonical + script src repointed; /hive/ and /websites/ redirect stubs added.
Confirmed #5 (Hive ghost): FIXED — every customer-visible Hive renamed; ids/anchors/classes deliberately kept.
Confirmed #1 (Alacazam live link): OWNER RULED "wire everything to take money correctly" — link stays; honest provisioning + manual-credit copy added beside it. Real credit automation still needs the webhook.
Nits fixed same day: 404 chrome, contact→/start/ loop, domains charge-order line, Stripe reference sanitizer, contact anchor, unclear-row first person, flyer ladder, work-page third person, rent-vs-own chip, favicons (home pending ok).
Still open (biggest first): checker blind spots (canonicals, script srcs, non-index HTML), sitemap vs check-routes vs tree disagreement, /abracadabra/how/ orphan, root strays (automation.html, the-responder.html, abracadabra/site/, scripts/private-preview/), design-drift list, credits automation, Stripe product rename + .net/.org price (in progress via dashboard).
