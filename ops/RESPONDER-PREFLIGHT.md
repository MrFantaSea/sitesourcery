# The Responder — preflight

**Everything that must be done before the first customer pays you.**
In order. Do not reorder. Do not skip.

Verified 2026-07-31 against Twilio and carrier documentation. Sources at the
bottom. Prices are US, pay-as-you-go, no volume commitment.

---

## The one thing that ruins a sale

**Stage 4 (campaign approval) takes 3–6 weeks.** Not 1–4 weeks. That figure in
the old draft was optimistic and is corrected here.

Brand approval is fast — minutes, sometimes 24 hours. **Campaign approval is the
wait.** The Campaign Registry is running 10–15 days on review, and AT&T runs its
own manual review that takes 2–4 weeks on top, no matter how clean the
submission is. Nothing you send will reach an AT&T handset until AT&T signs off.

**Start Stage 4 six weeks before you intend to take a single dollar.**

Stages with a ⏳ have a wait attached. Everything else is same-day.

---

## Stage 0 — paperwork you must have in hand (same day)

A2P registration is an identity check. Every field is cross-checked against IRS
records. A mismatch is the single most common rejection, and a rejection puts
you back at the start of the 3–6 week clock.

- [ ] **EIN letter (IRS CP-575 or 147C) in front of you.** Cost $0.
      Type the legal name into Twilio **exactly** as the IRS letter spells it —
      `Desiderata Labs LLC`. Not `Desiderata Labs, LLC`. Not `Desiderata Labs
      L.L.C.` Punctuation counts.
- [ ] **NJ formation certificate** with the registered business address.
      Cost $0 (already held). The address on the A2P form must match this one.
- [ ] **A live website that describes the service.** Cost $0 (sitesourcery.com
      exists). Reviewers open it. A parked page or a 404 fails the campaign.
- [ ] **A privacy policy page, publicly reachable, containing this sentence:**
      "Mobile information will not be shared with third parties or affiliates
      for marketing or promotional purposes." Cost $0, 20 minutes of writing.
      Campaigns are rejected for the absence of this line specifically.
- [ ] **An SMS terms / opt-in description page.** Cost $0, 20 minutes.
      It must say who sends the messages, what they contain, that message and
      data rates apply, and how to stop them.
- [ ] **Business email on the business domain** (`@sitesourcery.com` or
      `@desideratalabs.com`). Cost $0 if the domain is already held.
      Gmail and Proton addresses raise the vetting score against you.

**Do not proceed to Stage 1 until all six are true.**

---

## Stage 1 — Twilio account (same day, 30 minutes)

- [ ] **Create the Twilio account under Desiderata Labs LLC.** Cost $0.
      Use the business email from Stage 0.
- [ ] **Upgrade out of trial.** Minimum first payment **$20**.
      Trial accounts cannot register a Standard brand.
- [ ] **Put $50 on the account.** This covers registration fees plus the first
      two or three customer numbers bought on the spot in the field.
- [ ] **Turn on auto-recharge** ($20 trigger, $50 top-up). A zero balance
      silently stops every customer's texts at once.
- [ ] **Enable two-factor auth on the Twilio login.** Cost $0, 5 minutes.
      This account is now a $250/month-per-customer dependency.

---

## Stage 2 — buy the first number (same day, 10 minutes)

- [ ] **Buy one local number in your own area code.** **$1.15/month.**
      This is your *test* number. It is not a customer's. You will keep it
      forever and every future test runs through it.
- [ ] **Create a Messaging Service** named `Responder`. Cost $0.
      Add the test number to its sender pool.
      Numbers get attached to campaigns through the Messaging Service, not
      individually. Building this now saves a step in the field later.

---

## Stage 3 — brand registration (submit today, approval usually same day)

- [ ] **Register a Standard Brand.** **$44 one-time.**
      Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC.
      Choose **Standard**, not Sole Proprietor. Desiderata Labs LLC has an EIN,
      which makes it ineligible for Sole Proprietor registration.
- [ ] **Budget an extra $40** in case secondary vetting is required.
      It is charged per brand, one time, and it is not always triggered.
      Worst case Stage 3 costs **$84**.

⏳ Approval is normally minutes. Allow 24 hours before you worry.

**If the brand is rejected:** it is almost always the legal name or the EIN.
Fix it and resubmit. Do not start Stage 4 with a pending brand.

---

## Stage 4 ⏳ — campaign registration (submit, then wait 3–6 WEEKS)

**This is the wait. Start it the day the brand is approved.**

- [ ] **Register one campaign.** **$15 one-time vetting fee.**
      Use case: **Customer Care** (or **Low Volume Mixed** if you want the
      cheapest monthly and can live with lower throughput).
- [ ] **Accept the monthly campaign fee: $1.50–$10/month depending on use case.**
      Low Volume Mixed is $1.50/month. Most Standard use cases are $2/month.
      Mixed/Marketing is $10/month.
      **This is one fee for the whole business, not per customer.**
- [ ] **Attach the `Responder` Messaging Service to the campaign.** Cost $0.
- [ ] **Write the campaign description as what it actually is:**
      "Business owner's phone forwards unanswered calls to a Twilio number.
      An automated SMS replies to the person who just called, inviting them to
      reply by text. Consent is the inbound call itself. No marketing."
- [ ] **Provide two sample messages** matching what you will really send.
      Every sample must contain the business name and `Reply STOP to opt out`.
      Samples that do not match live traffic get campaigns suspended later.

⏳ **Expected: 3–6 weeks to full approval across all carriers.**
- The Campaign Registry: 10–15 days at current volumes.
- T-Mobile and Verizon: 3–5 business days after TCR passes it on.
- **AT&T: 2–4 weeks of independent manual review.** This is the long pole.

**Messages will partially work before AT&T approves** — Verizon and T-Mobile
handsets may receive while AT&T handsets silently do not. That is worse than
total failure because you will believe it works. **Do not sell until every
carrier shows approved.**

---

## Stage 5 — build while you wait (do this during the ⏳, not after)

Everything here is free and can be done the same week you submit Stage 4.

- [ ] **Build the Tier 1 Studio flow once, as a template.** Cost $0, 1 hour.
      Trigger: Incoming Call
      → `Connect Call To` the customer's real mobile
      → `Split Based On` `widgets.connect_call.DialCallStatus`
      → on `busy,no-answer,failed,cancelled` → `Send Message`
      **No server. No code. Verified against Twilio's Studio documentation.**
- [ ] **Build the Tier 2 flow as a second template.** Cost $0, 1 hour.
      Same as above, plus a branch on `completed` → `Send Message`.
      See "Tier 2" below for the architecture warning before you build this.
- [ ] **Write the three message templates** (missed-call, follow-up, and the
      handover text you send the owner). Cost $0.
      Rules in "Message rules" below. They are not stylistic.
- [ ] **Set up Stripe: one $300 invoice product, one $250/month subscription.**
      Cost: Stripe takes 2.9% + $0.30. On $300 that is **$9.00**. On $250/month
      that is **$7.55/month**. Price with that already subtracted.
- [ ] **Write the one-page service agreement.** Cost $0.
      It must contain: month-to-month, cancel any time, you reverse the
      forwarding on cancellation, and their written consent for you to change
      forwarding settings on their phone. Get it signed on the spot.
- [ ] **Buy or dedicate a second phone with a real number.** Cost: whatever a
      prepaid SIM runs, roughly **$15–30**. You cannot test this from the
      customer's phone and you cannot test it from the phone you are showing
      them. **Put it on a different carrier from your own phone.**
- [ ] **Save the carrier codes offline** (RESPONDER-SETUP.md and the
      walkthrough script are on this laptop and work with no signal).

---

## Stage 6 — prove it on yourself before you sell it (1 day, after approval)

- [ ] **Run the whole thing on your own phone.** Cost $0 plus a few cents.
      Forward your own line to the test number. Miss a call from the second
      phone. Confirm the text. Answer a call. Confirm the correct behaviour.
      Cancel the forwarding. Confirm your phone rings normally again.
- [ ] **Send a test to an AT&T handset, a Verizon handset, and a T-Mobile
      handset.** Cost: pennies. Approval does not guarantee delivery.
      If one carrier silently drops, you need to know now, not on site.
- [ ] **Run `node ops/responder-walkthrough.mjs` end to end** with fake answers,
      so the first time you use it is not in front of a paying customer.

**Only now are you clear to sell.**

---

## What it costs to get to the first customer

| Item | Cost | When |
|---|---|---|
| Twilio account funding | $50 | Stage 1 |
| Test number | $1.15/month | Stage 2 |
| Standard brand registration | $44 one-time | Stage 3 |
| Secondary vetting, if triggered | $40 one-time | Stage 3 |
| Campaign vetting | $15 one-time | Stage 4 |
| Campaign monthly | $1.50–$10/month | Stage 4 onward |
| Second test phone | $15–30 | Stage 5 |
| **Cash out before customer one** | **$125–$190** | |
| **Ongoing before customer one** | **$2.65–$11.15/month** | |

---

## What each customer costs you, per month

| Item | Cost |
|---|---|
| Their Twilio number | **$1.15/month** |
| SMS, per message sent | **$0.0083 base + $0.003–$0.005 carrier = $0.011–$0.013** |
| SMS received (their replies come to their phone, not through you) | $0 |
| Campaign fee | $0 — already paid at the business level |
| **Tier 1 total, 100 missed calls a month** | **~$2.50/month against $250** |

**Tier 2 adds voice minutes**, because every call runs through Twilio:

| Item | Cost |
|---|---|
| Inbound leg to your Twilio number | **$0.0085/minute** |
| Outbound leg to the owner's real phone | **$0.0140/minute** |
| Combined | **~$0.0225/minute of talk time** |
| 200 calls a month averaging 4 minutes | **~$18/month** |

**Carrier surcharges rose in January 2026** (T-Mobile's changes took effect
19 January 2026) and are pure pass-through — Twilio adds no markup to them and
does not control them. Re-check before quoting anyone high volume.

---

## Tier 2 — the answered-call follow-up

The Responder now has two tiers.

**Tier 1 — missed calls only.** "Sorry we missed you." Conditional forwarding.
Twilio only ever sees calls the owner did not pick up.

**Tier 2 — missed calls *and* a follow-up on answered calls.** Two flavours:

- **(a) Generic auto.** "Thanks for calling {Business}. Anything you need, just
  reply here."
- **(b) Reply-relay.** When a call ends, Twilio texts *the owner*: "Call with
  {caller} ended. Reply with a message to send them." He types "Tuesday 9am,
  see you then" and it lands on the caller's phone as
  "Thanks for calling {Business} — Tuesday 9am, see you then."
  No calendar, no app, no re-typing the number.

### ⚠️ The architecture warning — read before you sell Tier 2

**Conditional forwarding cannot deliver Tier 2.** With `**61*` / `*71`, the
carrier only hands Twilio the calls the owner *didn't* answer. Twilio never
learns that an answered call happened, who it was with, or when it ended. There
is no setting that changes this. It is how the carrier network works.

**Tier 2 requires Twilio to sit in front of the line.** Two ways:

1. **Publish the Twilio number.** The business puts the Twilio number on Google
   Business Profile, cards, van, website. Twilio answers and immediately dials
   their real mobile. Their personal number stays private. **This is the clean
   install** — no forwarding codes at all, nothing to accidentally strand.
   The cost is that they must change their published number, and old customers
   still ring the old one.
2. **Unconditional-forward the business line into Twilio** (`**21*` / `*72`).
   Every call goes to Twilio, which dials them straight back. Works with their
   existing published number.
   **The risk is real and must be said out loud to the customer:** if Twilio,
   their balance, or your flow breaks, their phone stops ringing entirely. Tier
   1 fails quiet; Tier 2 option 2 fails loud and costs them business.

**Sell option 1 where the customer will accept a new number. Option 2 only
where they will not, and only after they have heard the failure mode.**

### What Tier 2 needs to be built — verified

| Piece | Server needed? | Status |
|---|---|---|
| Branch on answered vs no-answer vs busy | **No** | **Verified.** Studio's `Connect Call To` widget exposes `DialCallStatus` (`completed`, `busy`, `no-answer`, `failed`, `cancelled`) and `DialCallDuration`. A `Split Based On` widget on `widgets.connect_call.DialCallStatus` routes each outcome. Documented Twilio behaviour. |
| Tier 2(a) generic follow-up | **No** | **Verified.** The `Send Message` widget's "Send Message To" field defaults to the contact but accepts any number, so the flow can text the caller or the owner. |
| Text the owner "call with {caller} ended" | **No** | **Verified.** Same `Send Message` widget with "Send Message To" overridden to the owner's mobile. |
| **Tier 2(b) reply-relay — routing the owner's reply back to the caller** | **Yes, code — but not a server you host** | **See below.** |

**Plainly: the reply-relay cannot be built with Studio widgets alone.**

The reason: the owner's reply arrives as a brand-new inbound SMS, which starts a
*fresh* Studio execution with no memory of the call that just ended. Studio has
no state that survives between executions. The `Send & Wait For Reply` widget
does not solve it either — it exposes a "Send Message From" field but **no**
"Send Message To", so it can only ever wait on the caller, never on the owner.
(Twilio also publishes a known issue titled *"Why Does the Send & Wait for Reply
Widget Stop Collecting the User's Response and Creates a New Execution for US
A2P Registered 10DLC Numbers"* — **I could not retrieve the body of that article
and cannot tell you the workaround. Read it before relying on that widget.**)

**What actually works: a Twilio Function.** Twilio-hosted serverless. First
**10,000 invocations per month are free**, then **$0.0001 each** — effectively
$0 at your volume. It is roughly fifteen lines: on the owner's inbound SMS, ask
the Twilio Calls API for the most recent inbound call to that number, take its
`From`, and send the relay. No storage, no database, nothing to keep online, no
machine of yours involved. It is code, and you will maintain it — that is the
honest cost of Tier 2(b).

**One unverified shortcut, flagged as unverified:** Studio's `Make HTTP Request`
widget has an "Authenticate With Twilio" option, which in principle lets a flow
query the Calls API directly and skip the Function. **But the same widget's
documentation states it cannot parse JSON arrays**, and the Calls API returns
its results in an array. This may be a dead end. **Prototype it on your own
number before you promise Tier 2(b) to anyone. Do not sell it untested.**

### Tier 2 pricing

**Not decided. Owner decision.**

Tier 2 costs you more to run (voice minutes, roughly $10–25/month on a busy
line, versus about $2.50 for Tier 1) and materially more to build and support.
It is worth more than $250/month. **No number is set here on purpose** — Zack
sets it. What this document guarantees is that the cost side is known when he
does.

---

## Consent — a hard rule, not a footnote

**This channel carries transactional replies only. Nothing promotional ever
rides it. No exceptions, not once, not for a customer who asks.**

The legal position, stated accurately:

- **Texting someone who just called you is solid ground.** Under the TCPA,
  prior express consent — which can be oral or implied by the consumer handing
  over the number in a context directly related to the message — is sufficient
  for transactional and informational messages. A person dialling a business's
  published number and being replied to about that call is squarely inside it.
- **Anything promotional is a different legal standard.** Marketing content
  requires prior express *written* consent, which a missed call is not.
  (The Fifth Circuit's February 2026 *Bradford v. Sovereign Pest Control*
  decision loosened this in Texas, Louisiana and Mississippi only. **New Jersey
  is in the Third Circuit. It does not apply to you or your customers.** Do not
  let anyone quote that case at you.)
- **The carriers will act long before a court does.** A campaign registered as
  Customer Care that starts carrying promotions gets suspended, and the
  suspension hits *every* customer on your campaign at once — not just the one
  who pushed it.

**Therefore, in the contract and out loud at handover:**

1. The Responder replies to inbound callers. It never initiates.
2. No sales, no offers, no discounts, no "we're running a special", no
   newsletters, no review requests, no re-engagement of old callers.
3. No links in the first message. Links are the top filtering trigger.
4. If they want promotional texting, that is a separate product on a separate
   campaign with real written opt-in, and it is not this.
5. **Say the sentence: "If you send one sales text through this, I have to shut
   it off, because it puts every other customer I have at risk."** Say it while
   they are signing, not after.

---

## Message rules (these are cost and compliance, not style)

- [ ] **Include `Reply STOP to opt out` in the missed-call message.**
      The old draft's advice to stay under 160 characters at all costs was
      wrong. A second segment costs **$0.011**. A CTIA complaint costs the
      campaign. Take the second segment.
- [ ] **Type only plain ASCII.** No em dashes, no curly quotes, no emoji.
      SMS packs 160 characters per segment using the GSM-7 alphabet, which has
      no `—` and no `'`. **A single em dash silently drops the whole message to
      70 characters per segment and triples the cost.** macOS substitutes both
      automatically — turn off smart quotes and smart dashes before typing
      message templates, or type them somewhere that does not autocorrect.
      *(The example message in the old runbook contained an em dash.)*
- [ ] **Business name in the first message, always.** Required by the campaign,
      and an unidentified text from an unknown number gets reported as spam.
- [ ] **Leave Twilio's Advanced Opt-Out on** so STOP, HELP, UNSTOP are answered
      automatically. Cost $0. It is on by default. Do not turn it off.

A compliant Tier 1 message, plain ASCII, two segments, $0.022 to send:

> Sorry we missed you - this is Mickleton Plumbing. We're on a job right now.
> Reply here and we'll get straight back to you. Reply STOP to opt out.

---

## What could not be verified

Stated here rather than guessed at:

- **The exact monthly campaign fee for the Customer Care use case.** Sources
  agree the range is $1.50–$10/month and that Low Volume Mixed is $1.50, but
  Twilio's own fee schedule sits behind a 403 and third-party resellers quote
  their own marked-up numbers. **Read the figure off the Twilio console at
  registration time.** It is at most $10/month against $250/month of revenue,
  so it changes nothing about the business — only about this table.
- **Whether secondary vetting ($40) will be triggered** for Desiderata Labs LLC.
  It is not applied to every Standard brand. Budget it; expect not to spend it.
- **The body of Twilio's Send & Wait For Reply / A2P known-issue article.**
  Retrieval failed. Read it before building anything on that widget.
- **Whether the `Make HTTP Request` + Calls API shortcut works.** The array
  parsing limitation suggests not. Untested.
- **Whether Twilio will permit passing the original caller's number as caller ID
  on the Tier 2 outbound leg** so the owner sees who is ringing. Twilio
  documents caller-ID-for-call-forwarding as supported, but multiple reports
  describe calls being blocked with error 32204 (CallerID Unverified/Not Owned)
  until Twilio approves the account for it case by case. **Open a support
  ticket asking for it during the Stage 4 wait — it costs nothing and takes
  time.** Fallback if refused: the Twilio number shows as caller ID and the
  owner learns to recognise it, which is worse but works.

---

## Sources

- [Twilio SMS pricing, US](https://www.twilio.com/en-us/sms/pricing/us) — $0.0083/segment, $1.15/month per local number
- [Twilio Voice pricing, US](https://www.twilio.com/en-us/voice/pricing/us) — $0.0085/min inbound, $0.0140/min outbound
- [Twilio A2P 10DLC overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Direct Standard and Low-Volume Standard Registration Guide](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-standard-onboarding)
- [A2P 10DLC Campaign Vetting FAQ](https://support.twilio.com/hc/en-us/articles/11587910480155-A2P-10DLC-Campaign-Vetting-FAQ) — $15 campaign vetting
- [Twilio 10DLC registration and pricing explained](https://www.sociocs.com/post/twilio-10dlc-explained/) — $44 standard brand
- [A2P registration timeline](https://www.telphiconsulting.com/blog/twilio-a2p-registration-timeline) — AT&T 2–4 weeks, 3–6 weeks total
- [T-Mobile messaging carrier fee changes, January 2026](https://help.twilio.com/articles/44609260499995)
- [T-Mobile 2026 A2P pass-through fees](https://www.telgorithm.com/news/t-mobile-announces-new-2026-a2p-sms-pass-through-fees)
- [Studio: Connect Call To widget](https://www.twilio.com/docs/studio/widget-library/connect-call) — DialCallStatus, DialCallDuration
- [Studio: Send Message widget](https://www.twilio.com/docs/studio/widget-library/send-message) — overridable "Send Message To"
- [Studio: Send and Wait For Reply widget](https://www.twilio.com/docs/studio/widget-library/send-wait-reply) — no "To" field
- [Studio: Make HTTP Request widget](https://www.twilio.com/docs/studio/widget-library/http-request) — no custom headers, no array parsing
- [Twilio Serverless pricing](https://www.twilio.com/en-us/serverless/pricing) — 10,000 free invocations/month
- [Twilio: handling no-answer scenarios](https://www.twilio.com/en-us/blog/handle-no-answer-scenarios-voicemail-callback) — the Split Based On pattern
- [TCPA consent guide](https://activeprospect.com/blog/tcpa-consent/) — express vs express written consent
- [Bradford v. Sovereign Pest Control, 5th Cir.](https://www.hklaw.com/en/insights/publications/2026/03/tcpa-reset-fifth-circuit-rejects-prior-express-written-consent-rule) — Fifth Circuit only
