# The Responder — setup runbook

Reference. For setting up one customer, on site, start to finish.

**On the job, run the script instead of reading this:**

```
node ops/responder-walkthrough.mjs
```

It asks one question at a time, shows only the carrier code you need, and
refuses to let you finish an install that has not passed its tests. This
document is what you read the night before, and what you search when something
is on fire.

Before your first customer ever: **ops/RESPONDER-PREFLIGHT.md**.

Codes and prices verified 2026-07-31.

---

## The two tiers

| | Tier 1 | Tier 2 |
|---|---|---|
| Missed call | "Sorry we missed you" | "Sorry we missed you" |
| Answered call | nothing | a follow-up text |
| How the line is wired | **conditional** forwarding | Twilio **in front** of the line |
| Their phone if Twilio dies | rings normally | **stops ringing** (forwarding install only) |
| Runs you | ~$2.50/month | ~$10–25/month |
| Price | $300 + $250/month | **owner decision — not set** |

Tier 2 has two flavours of follow-up:

- **2a — generic auto.** "Thanks for calling {Business}. Anything you need,
  just reply here."
- **2b — reply-relay.** Twilio texts the owner "Call with {caller} ended. Reply
  with a message to send them." His reply is relayed to the caller as "Thanks
  for calling {Business} — {his words}." **2b needs a Twilio Function. It
  cannot be built from Studio widgets alone.** See RESPONDER-PREFLIGHT.md.

---

## The consent rule — hard, not a footnote

**This channel carries transactional replies only. Nothing promotional ever
rides it. No exceptions.**

- **Texting back someone who just rang you is solid ground.** Under the TCPA,
  prior express consent — oral, or implied by the person handing over their
  number in a context directly related to the message — covers transactional
  and informational texts. Someone who dialled the business and got a reply
  about that call is squarely inside it.
- **Promotional content is a different legal standard entirely**: prior express
  *written* consent, which a missed call is not. The Fifth Circuit's February
  2026 *Bradford v. Sovereign Pest Control* decision loosened this in Texas,
  Louisiana and Mississippi. **New Jersey is in the Third Circuit. It does not
  apply here.**
- **The carriers move faster than any court.** A campaign registered as Customer
  Care that starts carrying promotions gets suspended — and the suspension hits
  **every customer on your campaign at once**, not just the one who pushed it.

**Say this out loud while they are signing, every time:**

> "This texts people back who called you. That is legal and it is solid,
> because they rang you first. It never sends sales texts — not offers, not
> specials, not review requests. If you send one sales text through this, I
> have to shut it off, because it puts every other customer I have at risk."

Put it in the agreement too. No sales, no offers, no discounts, no newsletters,
no review requests, no re-engaging old callers, no links in the first message.
If they want promotional texting, that is a **separate product on a separate
campaign with real written opt-in**, and it is not this.

---

## Part 0 — once, ever

Everything in **ops/RESPONDER-PREFLIGHT.md** must be done and approved.

The short version: Standard brand **$44** one-time, campaign **$15** one-time
plus **$1.50–$10/month**, and the approval takes **3–6 weeks** end to end —
brand is minutes, campaign review is 10–15 days, and **AT&T's own manual review
is 2–4 weeks on top**.

**Do not sell until the campaign shows approved for every carrier.** Messages
part-work while AT&T is pending, which is worse than total failure, because you
will believe it works.

---

## Part 1 — before you drive out

- [ ] Confirm the business line is a **mobile**. Landlines cannot do this
- [ ] Ask which **carrier** — the code depends on it
- [ ] Bring a **second phone**, on a different network from yours. You cannot
      test this from theirs

---

## Part 2 — sitting with them (10 minutes, no computer needed)

| Ask | Why it matters |
|---|---|
| Business name, exactly as they say it | Goes in the text |
| The number customers actually ring | Not their personal cell if different |
| The mobile where replies should land | Often, but not always, the same |
| Carrier | Decides the forwarding code |
| When they are usually unreachable | Sets expectations for the message |
| **What should the text say?** | The actual deliverable |

**Draft the message with them, out loud.**

**Message rules — these are cost and compliance, not style:**

- **Business name in it.** Required, and an unidentified text gets reported.
- **End with `Reply STOP to opt out.`** The old advice to stay under 160
  characters at all costs was wrong: a second segment costs **$0.011**, a CTIA
  complaint costs the campaign. Take the second segment.
- **Plain ASCII only.** SMS packs 160 characters per segment using GSM-7, which
  has **no em dash and no curly quotes**. One `—` or one `'` silently drops the
  message to **70 characters per segment** and triples the cost. macOS
  substitutes both automatically — turn off smart quotes and smart dashes
  before you type templates.
- **No links in the first message.** Top carrier-filtering trigger.

A compliant Tier 1 message, plain ASCII, two segments, $0.022 to send:

> Sorry we missed you - this is Mickleton Plumbing. We're on a job right now.
> Reply here and we'll get straight back to you. Reply STOP to opt out.

- [ ] Message agreed and written down
- [ ] Tier 2: the follow-up written too, and **read aloud next to the
      missed-call message**. If they sound alike, the product looks broken
- [ ] Told them replies come to **their** phone, not yours

---

## Part 3 — take the money before you build

- [ ] **$300 setup** — Stripe invoice or a payment link on your phone
- [ ] **$250/month** — starts today, not after a trial
- [ ] Say plainly: cancel any time, and you will turn forwarding back off
- [ ] Say the consent rule above, out loud

Do not build first and invoice later. The forwarding change is the deliverable
and it is trivially reversible by them.

Stripe takes 2.9% + $0.30: **$9.00** on the setup, **$7.55/month** after.

---

## Part 4 — build it (10 minutes)

- [ ] Buy a Twilio number **in their area code** — local numbers are trusted more
- [ ] Add it to the `Responder` Messaging Service (that is what attaches it to
      the approved campaign)
- [ ] Copy the Studio flow template for the tier you are installing
- [ ] Point the number at that flow **for incoming calls**
- [ ] Point the number at the SMS-forward flow **for incoming messages**, so
      caller replies reach the owner's mobile. Miss this and the caller replies
      into a void — the reply path is the actual product
- [ ] Paste in their message with the business name filled in

**Tier 1 flow:**

```
Incoming Call
  -> Connect Call To: their mobile
  -> Split Based On: widgets.connect_call.DialCallStatus
       matches busy, no-answer, failed, cancelled
         -> Send Message: the missed-call text
```

**Tier 2 flow:** the same, plus a second branch:

```
       matches completed
         -> Send Message: the follow-up text
```

⚠️ **The branches must not overlap.** `completed` must never appear in the
missed-call branch. This is the mistake that loses the customer.

No server and no code is needed for Tier 1 or Tier 2a. **Tier 2b (reply-relay)
needs a Twilio Function** — see RESPONDER-PREFLIGHT.md.

---

## Part 5 — the forwarding, on their phone

There are two families of code and they are not interchangeable.
**Verizon and US Cellular use star codes. Everyone else uses GSM codes.**

### Tier 1 — conditional forwarding (their phone rings first)

| Carrier | Forward on no answer | Turn off | Check what is set |
|---|---|---|---|
| **Verizon**, US Cellular, Visible, Total | `*71` + 10-digit number | `*73` | *(no code — use the phone's settings)* |
| **AT&T**, **T-Mobile**, Mint, Ultra, Metro, Cricket, Google Fi | `**61*` + number + `#` | `##61#` | `*#61#` |

On GSM, if `**61*number#` is refused, try `*61*number#`.
To give them longer to pick up (25 seconds): `**61*number**25#`.

**Verizon caution:** No Answer / Busy Transfer is not on every Verizon plan and
is usually absent on prepaid. If `*71` is refused, the feature is not on the
line and only Verizon can add it.

**Google Fi caution:** Fi does not officially support conditional forwarding.
The GSM codes sometimes work. Test before promising anything.

### Tier 2 — Twilio has to sit in front of the line

**Conditional forwarding cannot deliver Tier 2.** The carrier only hands Twilio
the calls that were *not* answered, so Twilio never learns an answered call
happened. No setting changes this. Two ways round it:

1. **Publish the Twilio number.** It goes on Google Business Profile, cards,
   the van. Twilio answers and immediately dials their real mobile. **No
   forwarding codes at all.** This is the clean install — and it is also the
   answer for a landline business. The cost is that they must change their
   published number.
2. **Unconditional-forward their existing number into Twilio.**

| Carrier | Forward ALL calls | Turn off | Check |
|---|---|---|---|
| Verizon, US Cellular | `*72` + number | `*73` | *(none)* |
| AT&T, T-Mobile, MVNOs | `**21*` + number + `#` | `##21#` | `*#21#` |

⚠️ **Say this out loud before dialling an unconditional code:** every call now
goes to Twilio, which rings them straight back. If Twilio goes down, the flow
breaks, or the balance runs out, **their phone stops ringing altogether**.
Tier 1 fails quietly. This fails loudly. Get their agreement first.

- [ ] Dial the code on **their** phone
- [ ] Confirm the carrier's success message
- [ ] **Check it with the status code**, GSM only. Do not trust the success
      message. On a Tier 1 install, `*#21#` must come back **disabled** — if it
      shows a number, unconditional forwarding is on by mistake, dial `##21#`
      immediately
- [ ] Write the **cancel code on the invoice**. They will ask for it

---

## Part 6 — test it in front of them (this is the sale)

Both tests are mandatory. Every install. No exceptions.

**Test A — the missed call**

- [ ] Call their number from your second phone
- [ ] **Let it ring out.** Do not answer
- [ ] The missed-call text arrives within seconds
- [ ] Reply to it, and confirm the reply lands on **their** phone

**Test B — the answered call**

- [ ] Call again and **have them answer.** Talk a few seconds, hang up
- [ ] **Tier 1:** confirm **nothing** is sent
- [ ] **Tier 2:** confirm the **follow-up** arrives — and that the
      **missed-call message does not.** Both halves matter

**Test C — the relay (Tier 2b only)**

- [ ] They get "Call with … ended"
- [ ] They reply with a sentence
- [ ] That sentence appears on your second phone, correctly worded

If the branches have crossed — someone who spoke to them gets "sorry we missed
you" — **do not hand over.** Fix the Split, retest both call types.

---

## Part 7 — hand over

- [ ] Show them the actual text on your phone, so they know what customers see
- [ ] Tell them how to change the wording: ring you, no charge for small edits
- [ ] Give them the **cancel code**, written down
- [ ] Note the renewal date
- [ ] Repeat the consent rule

---

## When it goes wrong

| Symptom | Usually |
|---|---|
| No text arrives at all | Brand or campaign not approved; or the number is not in the Messaging Service attached to the campaign; or the balance is zero |
| Arrives on some phones, not others | AT&T still pending. Do not hand over |
| Answered call got "we missed you" | The Split branched wrong — `completed` is in the missed-call branch. Fix before anyone else calls |
| Their phone stopped ringing at all | Unconditional forwarding. `##21#` (GSM) or `*73` (Verizon) |
| Forwarding code refused | Wrong family of code, or the carrier has the feature off for that plan — that is a call to the carrier, not a fix on site |
| Texts late, or one carrier drops them | Carrier filtering. Remove links, remove ALL CAPS, make sure the business name and `Reply STOP to opt out.` are present |
| Landline | Not installable as forwarding. Sell them a **new published Twilio number** instead — it does the whole job and their landline keeps working |
| VoIP / Google Voice | No star codes. Forwarding is set in the provider's web console |
| Everything is broken, customer watching | Cancel the forwarding first so their phone works, say plainly you will finish it remotely today, and do it |

---

## What each customer actually costs you

| | Tier 1 | Tier 2 |
|---|---|---|
| Twilio number | $1.15/month | $1.15/month |
| SMS sent | $0.0083 + $0.003–$0.005 carrier = **$0.011–$0.013** each | same |
| Voice, inbound leg | — | $0.0085/minute |
| Voice, outbound leg to their phone | — | $0.0140/minute |
| Campaign fee | $0 — paid once at the business level | $0 |
| **Typical total** | **~$2.50/month against $250** | **~$10–25/month** |

Carrier surcharges rose in January 2026 and are pure pass-through — Twilio adds
no markup and does not control them. Re-check before quoting high volume.
