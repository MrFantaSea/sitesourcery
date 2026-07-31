# The Responder — setup runbook

For setting up one customer, on site, start to finish. Follow it in order.

**The whole job is about 30 minutes** once the account groundwork is done, and
most of that is waiting for a test call.

---

## Part 0 — once, ever (before any customer)

Do this **weeks before** you sell the first one. A2P approval takes 1–4 weeks and
you cannot rush it, so a customer who pays before this is done sits waiting.

- [ ] Twilio account under **Desiderata Labs LLC**
- [ ] **A2P brand registration** — standard brand, LLC, EIN. ~$48, 1–4 weeks
- [ ] **Campaign registration** — use case: customer care / conversational. ~$15–17
- [ ] Build the Studio flow once, keep it as the template to copy
- [ ] Put ~$20 on the account so numbers can be bought on the spot

Until the brand shows **approved**, nothing below will deliver a message.

---

## Part 1 — before you drive out

- [ ] Confirm they have a **mobile** business line. Landlines usually cannot do
      conditional forwarding, and that kills the job before you start
- [ ] Ask which **carrier** — Verizon, AT&T and T-Mobile use different codes
- [ ] Bring a **second phone** you can call from. You cannot test this from theirs

---

## Part 2 — sitting with them (10 minutes, no computer needed)

Write these down. This is the whole product.

| Ask | Why it matters |
|---|---|
| Business name, exactly as they say it | Goes in the text |
| The number customers actually ring | Not their personal cell if different |
| Carrier | Decides the forwarding code |
| When they are usually unreachable | Sets expectations for the message |
| **What should the text say?** | The actual deliverable |

**Draft the message with them, out loud.** Keep it under 160 characters or it
bills as two segments. A good shape:

> *"Sorry we missed you — this is {Business}. We're on a job right now. Reply
> here and we'll get straight back to you."*

Rules worth holding: their name in it, an apology, a reason, and an instruction.
No links in the first message — links raise carrier filtering risk.

- [ ] Message agreed and written down
- [ ] Told them replies come to **their** phone, not yours

---

## Part 3 — take the money before you build

- [ ] **$300 setup** — Stripe invoice or a payment link on your phone
- [ ] **$250/month** — starts today, not after the trial
- [ ] Say plainly: cancel any time, and you will turn forwarding back off for them

Do not build first and invoice later. The forwarding change is the deliverable and
it is trivially reversible by them.

---

## Part 4 — build it (10 minutes)

- [ ] Buy a Twilio number **in their area code** — a local number is trusted more
- [ ] Copy the Studio flow template, set it on the new number
- [ ] Paste in their message, with the business name filled in
- [ ] Add the number to your A2P campaign

---

## Part 5 — the forwarding, on their phone

**This is the fiddly bit.** You want *conditional* forwarding — forward only when
they do not answer — never unconditional, which sends every call away.

Codes vary by carrier. **Verify against the carrier before you dial**, and expect
these to drift:

| Carrier | Conditional forward on | Turn off |
|---|---|---|
| Verizon | `*71` + 10-digit number | `*73` |
| AT&T | `*92` + number + `#` (no answer) | `##004#` |
| T-Mobile | `**61*` + number + `#` (no answer) | `##004#` |
| AT&T / T-Mobile, all conditions at once | `*004*` + number + `#` | `##004#` |

- [ ] Dial the code on **their** phone
- [ ] Confirm the carrier's success message

⚠️ **Never set unconditional forwarding** (`*72`, `**21*`). That sends every call
to Twilio and their phone stops ringing. If you do it by accident, `*73` or
`##21#` undoes it.

---

## Part 6 — test it in front of them (this is the sale)

- [ ] Call their number from your second phone
- [ ] **Let it ring out.** Do not answer
- [ ] Text arrives on your second phone within seconds
- [ ] Reply to it, and confirm the reply lands on **their** phone
- [ ] Call again and **answer** — confirm no text is sent

That last check matters. If it texts people who *did* get through, it is worse
than useless and they will cancel.

---

## Part 7 — hand over

- [ ] Show them the message on your phone so they know what customers see
- [ ] Tell them how to change the wording: ring you, no charge for small edits
- [ ] Tell them how to switch it off themselves: the carrier's cancel code above
- [ ] Note the renewal date

---

## When it goes wrong

| Symptom | Usually |
|---|---|
| No text arrives | Brand or campaign not approved yet, or number not on the campaign |
| Text arrives on an answered call | Unconditional forwarding by mistake — cancel and redo |
| Their phone stops ringing at all | Unconditional forwarding — `*73` or `##21#` |
| Texts arrive late or not at all on one carrier | Carrier filtering; check for links or all-caps in the message |
| Landline | Cannot do this. Offer a call-tracking number instead, or walk away |

---

## What each customer actually costs you

| | |
|---|---|
| Twilio number | ~$1.15/month |
| SMS + carrier surcharge | ~$0.011–0.013 per message |
| Campaign fee | $1.50–10/month, **per campaign, not per customer** |
| **Typical total** | **~$4/month against $250** |

Carrier surcharges rose in January 2026 and are pass-through, not fixed. Re-check
them before you quote a big volume customer.
