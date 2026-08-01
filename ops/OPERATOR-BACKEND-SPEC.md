> **SIMULATED DRAFT — NOT AUTHORITATIVE.** Every customer, call, invoice,
> failure, and policy in this document is FICTIONAL, produced by a
> six-call agent simulation on 2026-08-01. It exists to seed requirements
> thinking for task #21 and nothing else. No price, cancellation rule,
> domain policy, or product boundary here is decided unless Zack rules it
> separately. One decision IS already made and is not this document's:
> account creation happens immediately before first payment.
> The real platform to audit and integrate is server/hosted (held
> Node/Postgres: accounts, projects, billing, support, domains,
> publication) — do not invent a parallel backend.

# Site Sourcery — Operator Back-End Spec

**Status:** Draft v0.1, 2026-08-01. Built from six simulated support calls. Not audited, not final — needs the HQ/Zen audit pass and the founder's redline.

**The mandate, verbatim:** "Clients need accounts, and we need a client account back end created also because we are the site provider... we need a way to help people with their accounts via the back end, like, if they call me for help."

**Founder's confirmed wants, mapped:** their page and payments (§2, §3.2) · notes from the last call (§2.6, §3.2) · resend-download button, "maybe" (§3.5 — the calls upgraded it to must) · see-exactly-what-they-see, "maybe" (§4 Later — the calls agree with the maybe) · domain features and DNS for owned AND rented addresses (§5).

**House style:** every quoted UI string in this spec is written in Zack's first person, because that is the voice of the product. Every feature cites the call that proved it. Anything the current honor-gate/static build makes false is flagged.

## The call index

| # | Caller | Business | The call in one line |
|---|---|---|---|
| C1 | Marcy Gallo | Gallo Pet Sitting, Pitman | Paid $5 at 7:42, closed the tab, 40 minutes of writing gone; 25-minute lunch panic |
| C2 | Toni Ruggiero | Toni's Cannoli Cart | New $25/mo subscriber; page lived in one Safari tab; banner says .com, market at 8 AM |
| C3 | Gary Sabatini | Sabatini Home Inspections, Sewell | Bring-your-own GoDaddy domain, 2019 email-outage trauma, two emails, $5 credit never applied |
| C4 | Dawn Scaletti | Nail Envy, Pitman | Rent-tier price doesn't exist anywhere; draft in one unclosable iPad tab; rename question |
| C5 | Donna Marchetti | Donna's Hair Loft, Pitman | Dead phone number on her live hosted page; hours change; "smooshed" hero on her phone |
| C6 | Donna Marchetti | Marchetti Alterations, Pitman | First invoice billed full $25 despite the printed $5-off promise; cancel mechanics didn't exist |

## The reality register — promises currently running on nothing

Every row below is something the site prints or Zack said on a call that today has no machinery behind it. Features that fix a row cite it.

| Promise | Where it actually lives today | Proof |
|---|---|---|
| "Your account" (post-pay screen) | Browser-local storage on one device; there is no server | C1, C3, C4 |
| Paid unlock, one-time pricing | A per-tab honor flag; re-unlock = texting a plain `?paid=1` URL anyone can forward | C1, C3, C4 |
| "The $5 comes off your first month" | The operator's memory and a hand edit — already missed once on a real invoice | C3, C6 |
| "The files stay yours / leaving costs nothing" | A folder on one laptop that nothing backs up | C6 |
| "Cancel any time" | No written mechanics existed until improvised aloud on a Saturday call | C4, C6 |
| "You hear about renewals first" | A personal calendar entry for August 2027 | C2, C5 |
| "Registered to YOU, not me" | True in intent; no proof artifact exists to show or send | C4 |
| Rent tier "billed monthly" | No price exists anywhere — catalog or page | C4 |
| Texts from the business number | Impossible; Twilio A2P 10DLC registration not started (3–6 week clock) | C1, C2, C5 |
| "I'll fix your hosted page today" | Editable source is a July file on one laptop; the field machine's hosted folder is empty | C5 |

---

## 1. The call that proves it

Composite replay — Marcy's call (C1), with beats borrowed from all six, run against the v1 operator screen. The original ran 25 minutes on a Stripe login and memory. This one runs four.

1. **Client:** "Zack? My page is GONE, I paid you this morning, and I've got ten minutes of lunch left."
   *(Screen pops before hello ends — caller (856) 371-0294 → MARCY GALLO · Gallo Pet Sitting · $5 paid 7:42 AM, unused · last autosave 7:41 AM, v2, 412 words · no open promises.)*
2. **Zack:** "Morning, Marcy — I'm already looking at you. Five dollars, 7:42, Visa ending 0446, and your page saved to me at 7:41. Version 2, the one with the retrievers. Nothing is lost."
3. **Client:** "You can SEE it? Then skip the detective work — send me the file."
4. **Zack:** *(presses "Send her file again" → marcygallo72@gmail.com, logged to her record)* "It's in your Gmail as of this sentence. Same button works every time you need it."
5. **Client:** "And the five dollars — I'm not paying it twice. Swear it."
6. **Zack:** *(entitlement line: DOWNLOAD — PAID, NEVER EXPIRES)* "I don't have to swear, I can read: paid, never expires. Sign in tonight and your screen says the same words mine does."
7. **Client:** "What did we decide last week about the kazam thing? I lost my napkin."
8. **Zack:** *(last call note, Jul 29: wants Alakazam · $5 credit rides invoice one · callback 5:30)* "July twenty-ninth: you want Alakazam, your five is already sitting on invoice one as a credit line, and I owe you a 5:30 call — my screen was going to nag me at 5:25 anyway."
9. **Client:** "Fine. And my address, if we do it?"
10. **Zack:** *(domain panel: gallopetsitting.com AVAILABLE · $40/yr, cost verified · gallopetsitting.sitesourcery.me free to create, one press)* "The dot-com's open, forty a year, registered to you — my screen checked while you were asking. The spare address can be live tonight with one press on my end. Anything else while I've got you? You've still got eight minutes of lunch."

Every bracket in that call is a v1 feature in §3.

---

## 2. The account record

One person at the top; everything hangs off that one identity. Both C3 and C6 proved customers exist today as two unlinked Stripe records joined only by a Visa number and luck.

### 2.1 Identity and contact

| Field | Holds | Proved by |
|---|---|---|
| `person_id` | One human, however many emails/cards/Stripe customers | C3 ("found you — both of you, actually"); C6 (AOL guest checkout + gmail subscriber, same Visa 4417) |
| Legal name / goes-by name | Registrant name vs what she answers to | C2 ("use Antonia, same as the card"); public-name discipline |
| Business name(s) + rename notes | Current name, promised future names | C4 ("The Polish Room, maybe, don't hold me to it") |
| `emails[]` — address, role, confirmed-good flag | Which address gets receipts vs invoices vs login; which one she never reads | C2 ("bills go to that gmail you never read"); C3 (two receipts, two emails); C6 ("Gia made that one") |
| `phones[]` — number, label, primary, dead flag + date | Cell vs shop line; dead lines marked so no one publishes or dials them | C5 (Verizon killed the shop line Tuesday); C1 ("this number, the one I'm calling from") |
| Contact preference | "Text, never email" as a rule the system obeys | C2; C5 |
| Authorized helpers | Name, phone, powers: support-only, no billing | C2 (Bella); C5 (Bella's screenshot); C6 (Gia) |
| Physical address | Registrant data; house-call destination | C2 (registry requires it); C3, C4 (kitchen table, salon counter) |
| Referral edges | Who sent whom | C6 ("Theresa from the bakery already asked who did it") |
| Device profile | e.g. "iPad, cracked, Safari" / iOS text size near max | C4; C5 (fault real on her phone, invisible on mine) |

### 2.2 Money — Stripe linkage

| Field | Holds | Proved by |
|---|---|---|
| `stripe_customer_ids[]` | Plural until merged; the record is mine, Stripe is the card reader | C3, C6 |
| Card fingerprints / last4 | The search key that saved two calls | C3 ("same Visa ending 0441 on both"); C6 (4417) |
| `payments[]` — product, amount, time, card last4, **receipt number**, checkout email captured | Receipt number must be a real search key; captured email decides where invoices rot | C1 (#2417-8843 "not a key my dashboard searches by"); C2 (gmail vs AOL autofill); C6 ("I can read you the whole thing") |
| Subscription — state, start, next bill date and post-credit amount | "Next bill Aug 29, $25.00" readable aloud | C3, C6 |
| Invoices with discount lines visible | The missed credit was invisible until the detail page | C6 ("No credit line on it anywhere") |
| Refunds — amount, pushed date, landing window | "On your statement by Friday August fourteenth at the outside" | C3, C6 |
| Credit ledger entries | Source ($5 download, $200 build), applies-to, status: open / pending / applied / settled, due date | C1, C2, C3, C4, C6 |

### 2.3 Entitlements

| Field | Holds | Proved by |
|---|---|---|
| Download unlock | PAID / unused / used, purchased-at, never-expires | C1 ("download — PAID, never used — so 'still yours' is a fact I'm reading") |
| Alakazam state | Active, canceled, cancel-at-period-end, policy stamps (what she was told, when) | C4 (STOP rule); C6 (Saturday policy) |
| Grants and comps | Operator-flipped entitlements with audit note | C2 ("comp it or charge separately"); C4 ("mark paid" no matter where the money entered) |

*False today: all of this is a per-tab honor flag the operator can neither see nor set.*

### 2.4 Pages, versions, files

| Field | Holds | Proved by |
|---|---|---|
| `versions[]` — number, timestamp, word count, look/template + template version, source (autosave / download / emailed in) | The retriever paragraph's existence as data | C1 ("draft existed at 7:41, 412 words"); C3 (v1–v3 vs the stale $5 file); C4 (v1 eaten by an iPad update); C5 (Hearth, for fleet patching) |
| Canonical go-live file + content hash + locked flag | "This exact file is the go-live source of truth," provable later | C3 |
| Config as data | Accent color, payment handles (validated), structured hours + note badges, phone, address | C2 (rose, Venmo dash-THREE); C4 (Venmo/Cash App for Monday); C5 (Thursday 9–7, "Walk-ins welcome Saturdays") |
| Publish log + rendered snapshot per publish | What deployed where, when; proof nothing changed | C5 ("zero publishes since Jul 8" would end the argument in one glance); C6 (7/23 download vs 7/29 deploy may not be the same file) |
| Delivery/download events | Generated, clicked, emailed-to, arrived-intact | C1 (zero telemetry); C2 (zero-byte iPad mail misfire risk); C4 |

### 2.5 Addresses and DNS

Summary fields here; full panel in §5. Rented name(s) with state and forwards; owned/bought domains with registrant of record, expiry, reminder armed; DNS snapshots; "what actually serves this domain." Proved by C2, C3, C4, C5, C6.

### 2.6 Support memory

| Field | Holds | Proved by |
|---|---|---|
| Call log — date, reason, outcome, who answered | The record for whoever answers next time | C1 ("I will not be this nice"); C5; C6 |
| **Notes from the last call** (founder's explicit ask) | Free text pinned to the record, newest first | C1 (5:30 promise lived in a phone alarm); founder order verbatim |
| Promises — text, due, kept/outstanding | "Two emails owed to Marchetti by noon" clearable before end of day | C6; C1 |
| Tasks and bookings | House calls with address and confirmation state | C3 (Sunday 9:00, kitchen table); C4 (Monday 10:00, "I open the drawer at ten sharp") |
| Provisioning checklists | Milestone texts with done flags | C2 (six promised texts tracked on a napkin) |
| Incidents and goodwill work | No-charge edits logged: what, when, why | C5 (what $25/mo includes stays vibes otherwise) |
| Cancel/park stamps | Policy as told, dates, retention clock | C6 |

---

## 3. Operator screen v1 (MUST)

Ranked by how many calls died without it and how badly. Tiering rule: where calls disagreed, the failure that already happened to a paying customer wins (that is why the credit ledger is v1, not Soon). Items 1–5 are one build in practice — the account back end itself; 6–12 ride on it.

**1. One customer, one record.** Merge emails, phones, card fingerprints, Stripe customer objects, and subdomains into a single person. UI line on the record header: "This is one person to me."
Proof — C3: Gary is two unlinked Stripe customers ($5 under the business email, $25/mo under gmail) and genuinely doesn't remember which he typed where. C6: Donna's $5 went to AOL, her subscription to gmail, joined live on the call only by "my Visa, ends 4-4-1-7."
*False today: the linkage from C6 went into a text note on a laptop.*

**2. The lookup console.** Search by phone, name, business, either email, card last4, receipt number, or subdomain. One screen: payments and subscription, entitlement state, credits owed, versions with timestamps, live address, notes from the last call (read and write), open promises. Works from a phone in the field.
Proof — C1: verifying a panicked customer took a laptop and a Stripe login while she offered to read "the card numbers, the little star ones"; her receipt #2417-8843 was useless as a key; "check again" had nothing behind it. C2: found by scanning the morning's payments by amount and time. C3: "You got me in your system over there?" answered by spelling S-A-B-A-T-I-N-I into a dashboard. C4: mid-funnel customer, complete unknown. C5: recognition was pure memory of one July afternoon. C6: Stripe 2FA login while a customer holds.

**3. Real accounts with server-side drafts and versions.** Autosave off the customer's device, timestamped, account created no later than the $5 purchase (founder task #21; exact moment = OQ4). Status line the operator reads, not infers: "Saved with me — 7:41 AM."
Proof — C1: forty minutes of retriever writing died with a closed office tab. C2: a $25/mo product living in one Safari tab — "I close my tabs every night... I almost closed it at breakfast!" C3: version 3 guarded by a sticky note against a grandson. C4: version 1 eaten by an iPad auto-update, "I typed everything twice."
*False today: sessionStorage is tab-only by design, and the post-pay "account" screen saves browser-local — the site writes a check the operator cannot cash (C1, C3).*

**4. Server-side entitlements + operator grant/re-arm.** Stripe webhook flips paid state on the account, honored in any signed-in browser. Operator buttons: "Mark her paid," "Re-arm her unlock," "Comp it," each audit-noted.
Proof — C1: the only re-unlock is texting a plain `?paid=1` URL — "anyone she forwards it to gets a free unlock." C3: the fix would be whispering the honor-gate URL aloud. C4: money entered anywhere but her own tab leaves the product locked, no fix short of the owner's test URL. C2: a tech-shy 64-year-old ran a second live checkout on the one irreplaceable tab because the operator couldn't press anything.
*False today: paid state is the honor gate; one-time pricing is enforced by honor and Zack personally.*

**5. File vault + auto-delivery + resend.** Every purchased download and every deployed version stored server-side against the account. The $5 file emails itself to the checkout address at purchase. Operator button: "Send her file again" — logged.
Proof — C1: "just send me the file" was the completely reasonable ask with nothing behind it; the file in her Gmail at 7:42 deletes the entire call. C2: the delivery rail was an iMessage share out of a Files app. C6: she paid for a file she can't find on her iPad, and the only other copy on earth is a laptop folder nothing backs up — "the files stay yours" is currently a promise about a Downloads folder surviving.

**6. Credit ledger with a first-invoice guard.** Every credits-forward sale opens a visible obligation; creating a first invoice without the discount flags loudly; auto-apply as a Stripe coupon/customer-balance. Includes the audit query: "first invoices that billed full price while a credit was open" — run once as a backfill.
Proof — C6: the miss already happened, to the one customer who reconciles to the penny — invoice D4E7A9C2-0001, $25 even, "no credit line on it anywhere" — and there is no way to know who else was missed. C3: Stripe charged the full $25 against the site's written promise, and Gary named it "the same five dollars that tells me whether to believe the rest of it." C1, C2, C4: three more $5 promises parked in memory and phone alarms.
*False today: hand policy; the payment link charges flat with zero awareness a credit exists.*

**7. New-signup alert with an onboarding SLA.** Webhook on Alakazam start → operator notification + task, default same business day; loud flag when a subscription starts with no page or account attached.
Proof — C2: Toni's subscription floated unattached under an email she never reads — "if she hadn't called, I'd be billing someone I cannot deliver to and would never know." C3: Gary paid Friday and heard nothing until he dialed Saturday, against a site that promises "I set your address up with you personally."

**8. Hosted-page ops: canonical store, operator edit-and-publish, live verify.** Server-side source of truth for every hosted page; operator edits a field (phone, hours, photo), stages during the call, publishes in one action from the field — no customer password involved, audit-logged. Post-publish check fetches the live domain and asserts the new number present and the old one absent in visible text AND `tel:` hrefs.
Proof — C5, three ways: her editable source was a July 8 file not on the field machine ("just checked the hosted folder, it's empty"), fallback view-source-and-reconstruct; "can you change it right now, while we're on the phone" — the honest answer was no; and a stale tap-to-call link would pass an eyeball check and keep ringing the dead Verizon line — the silent version of the exact failure she called about. Her lost password must not matter: it unlocks nothing server-side anyway.

**9. Domain order integrity.** Checkout shows the exact string to be registered, validates charset and format (no apostrophes, no free-text surprises), requires explicit read-back confirmation before the charge.
Proof — C2: an 8 AM banner deadline hanging on a free-text field typed on an iPhone by a customer who had already misspelled "canolli" once; the only defense was spelling T-O-N-I-S... aloud. Plus "can you do the apostrophe?" — the maker should answer that before the phone call (§4 Later).

**10. Standing hosting target + pointing plan generator.** Documented Site Sourcery A/CNAME values that exist before a customer asks; one-step staging URL per customer; a plain-words plan per registrar: "rows I change, rows I never open," emailable.
Proof — C3: Zack could not read Gary the actual A-record value because the server gets hand-built tonight; the whole call ran on the memory of a 2019 nameserver switch that killed his email for two days.
*False today: hosting is a hand ritual re-derived from July notes.*

**11. Rent-tier price rendered from one catalog.** The your-name.sitesourcery.me price lives in the single price book and renders on the domains rent card, the maker gate, and the FAQ; site-checker rule: any card that says "billed" without a dollar figure fails the build. The number itself is OQ1.
Proof — C4: "your domains page says 'billed monthly' for the rent one and then never says a number — I looked twice, I had my glasses on." The tier got priced live, on a sales call, by improvisation. C1: "the rent-an-address price — it does not exist, and I just promised to have it by 5:30."

**12. Written cancellation mechanics, published and encoded.** The policy as a page and an operator runbook: same-day stop on call or email, paid month runs to its end, just-billed month refunded, page goes dark at period end, name parked. Ratification is OQ6; automation is Soon.
Proof — C6: "there's no cancel button anywhere I looked" answered with "there's no button because I'm the button" — actual policy set out loud on a Saturday; two customers on two days could hear two different rules. C4: "text me STOP" works only because Zack personally reads every text.

---

## 4. Soon and Later

### Soon

- **S1. Business SMS rail** — templated, logged texts from (856) 244-1220; per-customer "text, never email." *Start the Twilio A2P 10DLC registration in week one regardless: the 3–6 week clock gates this AND The Responder.* (C1: the contract of record thumb-typed from a personal cell in her last four minutes; C2: receipts "say STRIPE," six milestone texts promised; C5: "DONE" from a personal cell.)
- **S2. Support log + promise tracker + follow-up tasks** — call outcomes spawn dated tasks that nag until cleared. (C1: "I will not be this nice" requires the promises on a screen; C3: five commitments living in one head; C5: the CRM is a sticky note; C6: "she keeps better books than her vendor.")
- **S3. Remedy console** — one press: refund $X / credit next invoice → Stripe action + obligation marked settled + one-line confirmation with receipt + log, with amount guardrails. (C6: the refund worked; the email, the settling, and the audit trail were three more manual steps, and nothing would catch $50 fat-fingered for $5.)
- **S4. Subdomain lifecycle tooling** — registry, availability check, one-press create/deploy/cert, rename with automatic forwarding, park-on-cancel, auto go-dark and guaranteed stay-up through the paid month. (C4: the spring rename to thepolishroom and "forwarding forever" have no home but memory; C2: the spare tire was hand-carved DNS; C6: "nobody takes your name" is one man's word.)
- **S5. Domain purchase pipeline** — availability + verified wholesale + premium flag in one pane, registrant prefilled from the record, short hold at payment, registrant proof card, one-press transfer-code handover. (C2: a snipe window sits between her charge and the manual Spaceship registration; C4: "registered to ME" needs an artifact; C1: "forty a year flat, if it's free" said with no way to check either fact.)
- **S6. Go-live/DNS monitor + milestone auto-texts** — registrar order → nameservers → resolving per probe → cert → answering; each step optionally texts the customer. (C3: "green by six Monday" is manual digging from three networks, and a hung cert is discovered by browsing into a warning; C2: "I'll be checking it all evening — and that's not a figure of speech.")
- **S7. DNS snapshot + before/after diff pinned to the record** — the undo path. (C3: the backup plan was photographing his monitor.)
- **S8. Checkout/download telemetry + mismatch flags + never-downloaded nudge** — see the paid-return land, the entitlement flip, the download generate; flag checkout-email typos; auto-nudge "paid but never downloaded" with the file. (C2: the scariest 90 seconds of the call were blind; C4: confirmation by refreshing Stripe while she read frosted chips aloud; C1: a 7:50 AM nudge deletes the lunch panic.)
- **S9. Written recap/quote generator** — one press emails the numbers just quoted (month one/month two, credit, cancel terms, booking) and pins them to the record. (C4: two promised proton emails nothing will remind me to send; C3: the plan of record is his legal pad; C6: the noon email.)
- **S10. Money napkin view** — paid today / monthly / yearly / next charge / credits outstanding, readable at register speed. (C2: "add it up for me like I'm at the register" took three sources and live arithmetic.)
- **S11. Structured business-info editor** — per-day hours, closed days, note badges, with read-back preview and "confirmed by customer" timestamp. (C5: hours dictated out of order → paper → keyboard → markup, two typo hops, no proof of what she approved.)
- **S12. Page config layer + handle validation** — accent and payment handles as fields with one-press redeploy; validate the handle format. (C2: dash-THREE vs the Hammonton Toni's dash-one is real money to a stranger, defended only by ears; C4: Venmo/Cash App wiring promised for Monday.)
- **S13. Renewal reminder automation** — 30-day advance text, logged. (C2: August 2027 lives in a personal calendar; C5: "you hear about renewals first" runs on a human.)
- **S14. One-tap draft rescue (interim)** — "send me your page" posts the current draft to the record until real persistence ships. (C4: the rescue was a Safari-Downloads-Files-Mail ritual on a cracked iPad, one mis-tap from gone; C1.)
- **S15. Render-as-customer + screenshot intake** — emulate OS text scale and viewport; inbound photos file against the record. (C5: her fault was real on her phone and unreproducible on mine; the evidence arrived as a granddaughter's text to a personal Messages thread.)
- **S16. Visual version history** — rendered snapshot and source archive per publish. (C5: "it did NOT look like that when you set it up" is currently word against memory.)
- **S17. Cancel-now automation** — STOP by text or call → same-day cancel + confirmation + files remain downloadable after. (C4: the closing promise; C6: the mechanics — automation of v1 item 12.)
- **S18. Rent-tier terms sheet** — price, bundling, park retention, upgrade path, quotable by any operator. (C6: the address-lifecycle questions were answered from instinct; depends on OQ1–3.)
- **S19. Booking wired to the record** — house-call slots with automatic confirmations. (C3: Sunday 9:00 lives in a phone calendar unlinked to anything; C4 ranked any-calendar as workable, so this rides behind S1.)

### Later

- **L1. Caller-ID screen pop** — the record open before hello ends; rides the Responder telephony stack, and graduates the moment that stack exists — C5 folded it into its must. (C2: "which email did the phone use"; C6: a customer holding sixty seconds while the books open.)
- **L2. Read-only co-view / state code the customer reads aloud** — founder's "maybe," and the calls agree: talk-out-loud worked. (C1: two screens she sincerely believed were one website; C4: frosted chips read slightly wrong off a cracked iPad.)
- **L3. Self-serve "Where's my page?" recovery page** — tab-restore steps, what saves where per tier, when to call me. (C1: a Chrome history rescue coached blind from a parking lot.)
- **L4. Customer-facing go-live status page** — file received → staging → DNS → cert → live. (C3: four tabs kept open for reassurance.)
- **L5. Authorized helper role** — the "Bella": may call, gets handoffs, no billing power. (C2; C5; C6: "Gia made that one.")
- **L6. In-maker address guidance** — apostrophe and spelling rules with the exact registerable string previewed. (C2: "can you do the apostrophe? It's Toni's.")
- **L7. Published "I never take your password" page** — the standing rule to cite and text. (C3: "it's Gracie2019, the dog" — said over a cell call.)
- **L8. Fleet-wide template patching** — track look/template version per page; fix the Hearth big-text hero once, republish to all. (C5: every grandma-sized-text customer makes this call one at a time otherwise.)
- **L9. Before/after preview links for cosmetic changes** — apply on her yes. (C5: "make my picture bigger" judged by squinting at the live page.)
- **L10. Auto "your page was updated" text on publish** — closes the loop on the day I forget. (C5: "call me when it's done" between a color at two and Mrs. Esposito under the dryer.)
- **L11. Customer-visible billing page** — receipts regardless of paying email, next bill, credits as printed line items. (C6: "-$5.00 download credit" on the invoice prevents the whole call even under manual process.)
- **L12. Version diff + go-live lock** — field-level diff (2029 → 2209, accent → Ocean), content hash, locked flag. (C3: verification was reading digits off an email attachment; the stakes were 200 flyers.)

---

## 5. Domains & DNS panel

Per-address card shared by all three classes: class (owned / bought-through / rented), what actually serves it right now, certificate state, next renewal, last verified. One button on every card: **"Fetch it like a customer would"** — loads the live page, checks https, and (after any edit) asserts new values present and old values absent, `tel:` links included (C5).

### Owned — the customer's domain at their registrar (Gary, C3)

**Operator sees:** registrar; nameservers with a "still registrar defaults?" check; live public snapshot of NS / A / CNAME / MX / TXT with TTLs; the mail lane called out in Zack's words — "rows I never open: your MX points at Microsoft"; before/after snapshots pinned to the record; resolution status per probe; TTL arithmetic behind any "showing within the hour" promise.
**Operator does:** "Write the pointing plan" (exact rows changed, exact rows never opened, plain words, emailable); "Photograph the zone" (snapshot pinned as the undo path); "Watch this domain" (alert on resolve-to-us and on cert issue); live verify.
*False today: there is no standing hosting target, so the A-record value literally does not exist until hand-built; the snapshot tool is dig and a phone camera.*

### Bought-through — we register at Spaceship, registrant is the customer (Toni C2; Dawn's someday .com C4)

**Operator sees:** availability + premium flag + verified wholesale cost beside the retail price (price book still `costsConfirmed:false` — flagged until fixed); the exact string to be registered with its read-back confirmation state; the registrant proof card — "Registered to: Antonia Ruggiero. Not me, not Site Sourcery."; order milestones (accepted → NS live → resolving from N probes → cert → answering); expiry, auto-renew, 30-day reminder armed.
**Operator does:** hold the name when payment lands; purchase with registrant prefilled from the record; point at the customer's page; queue milestone texts (NAME'S BOUGHT → YOUR DOT-COM ANSWERS → 7 AM WE'RE GOOD); "Begin handover" — transfer code + unlock, timestamped, no fee, no foot-dragging (C4's Groupon-guy test).
*False today: availability is a hand lookup on a second screen; a snipe window sits between the customer's charge and the manual registration; $40 flat is quoted against an unverified margin; renewal warnings live in a personal calendar.*

### Rented — your-name.sitesourcery.me (Toni's spare C2; Dawn C4; Marchetti C6)

**Operator sees:** the registry — name → customer → state (live / parked-for-returning-customer / reserved / released); what each name points at; cert; forwards with targets and status; rename history; price and terms from the catalog (today: blank — OQ1).
**Operator does:** check a rent name (its own checker — C4's scare came from the buy-only box trying to sell her nail-envy.com with dollar signs); one press create + deploy + cert; rename with automatic old-to-new forward; park on cancel with a retention clock; flip back on same-day for the returning customer; release, guarded.
**The rent-name change policy question, stated:** Dawn was promised renames free forever with the old name forwarding "forever" (C4); Marchetti was promised her name parked, not released (C6). Neither promise has a number or a term behind it — that is OQ1–OQ3, and the panel cannot ship its park/forward logic until the founder rules.
*False today: no registry exists — "is that name taken" is remembering; forwards are hand-built stubs that must never be accidentally deleted; go-dark at period end is a remembered date; the tier has no price.*

---

## 6. What the customer sees — so the call is short

Every line a client can read herself is five minutes off a call, or the whole call. All copy in Zack's voice.

1. **The unlock line.** "Your $5 download: paid July 29 — good forever. You will never pay it twice." (C1: "so my word isn't the only proof"; the exact fear on three calls.)
2. **Your files.** Every version plus the paid download, re-downloadable any time, and the file emailed at purchase. (C1: "just send me the file"; C6: the iPad ate it and my laptop was the only other copy on earth.)
3. **The save light.** "Saved with me — 8:41 PM Tuesday." Replaces the current footer, "lives in this tab only, close it and it's gone" — the sentence that cost C1 her retrievers and kept C4's iPad on a charger as a shrine. (C1, C3, C4.)
4. **The money page.** Paid today / every month / every year / next bill with the credit printed: "-$5.00 — your download credit, like I promised." (C2: the napkin; C6: she reconciles every Thursday; C3: the $5 is the test of "whether the website says true things.")
5. **Receipts that say who I am.** "I got your $25 — Zack, Site Sourcery." (C2: "it don't say Site Sourcery on top, it says STRIPE. S-T-R-I-P-E.")
6. **The address page.** Registered-to-you proof with her name on it; go-live steps; renewal countdown — "You hear about renewals from me first — 30 days ahead, every time." (C4; C3; C2.)
7. **The cancel page.** The STOP rule in writing: same-day stop, paid month runs out, just-billed month refunded, files stay downloadable, name parked. (C6: "there's no cancel button anywhere I looked"; C4: "no thirty-days-notice, no 'per our agreement.'")
8. **Where's my page?** Self-serve recovery: tab-restore steps, what saves where at each tier, when to call me. (C1: keyboard shortcuts dictated to a woman in a parking lot.)
9. **A price on the rent card.** A dollar sign wherever "billed monthly" appears. (C4: "I looked twice, I had my glasses on.")
10. **A real account at the $5.** Server-side, any device, simple password — because the current post-pay screen teaches customers to expect an account that saves onto their own machine, "not what 'account' means to any normal human being." (C1, C3, C4.)
11. **Pinned recaps.** Every written quote and call recap visible on the account — "so if I ever drift, you've got me in my own words." (C4; C3; C6.)

---

## 7. Open questions — founder decisions, one line each

1. **Rent price:** is the rented address included in the $25 Alakazam, as I told Dawn live, or its own monthly line — and what number prints on the card? (C4)
2. **Park retention:** how long does a canceled customer's rented name stay parked before I may release it? (C6)
3. **Renames and forwards:** are rent-name renames free forever, and do old-name forwards live as long as the hosting does? (C4)
4. **Account moment:** account required at the $5 purchase, or offered at first draft and required at Alakazam? (C1, C3, C4; task #21)
5. **Included edits:** what edit work rides inside the $25/mo, and is anything ever billable — so goodwill stops being vibes? (C5)
6. **Cancel policy:** ratify the Saturday version as printed policy — same-day stop, paid month runs out, just-billed refunded, files downloadable after, name parked? (C4, C6)
7. **Twilio A2P:** start the 10DLC registration now and eat the 3–6 week clock — it also gates The Responder? (C1, C2, C5)
8. **Credit mechanics:** standardize the $5 as an automatic first-invoice discount, with refund only as the fallback? (C3, C6)
9. **Domain quoting:** freeze "$40 a year flat" until Spaceship wholesale is verified (`costsConfirmed:false`), or keep quoting and eat the variance? (C1, C2, C4)
10. **Helper role:** give the Bellas and Gias a named support-only standing on the account, or keep it informal? (C2, C5, C6)
