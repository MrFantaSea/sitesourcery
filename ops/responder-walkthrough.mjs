#!/usr/bin/env node
//
// The Responder - on-site walkthrough
//
//   node ops/responder-walkthrough.mjs
//
// One step at a time. Plain Node, no dependencies, no network.
// Works with no signal. Type ? at any prompt for help.
//
// Companion documents:
//   ops/RESPONDER-PREFLIGHT.md   what must be done before customer one
//   ops/RESPONDER-SETUP.md       the reference runbook
//

import { createInterface } from 'node:readline';

// ---------------------------------------------------------------
// output
// ---------------------------------------------------------------

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const red = (s) => c('1;31', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const cyan = (s) => c('36', s);
const invert = (s) => c('7', s);

const W = 62;
const out = (s = '') => process.stdout.write(s + '\n');
const rule = () => out(dim('-'.repeat(W)));

function heading(text) {
  out();
  rule();
  out(bold(text));
  rule();
  out();
}

function step(n, text) {
  out();
  out(bold(`STEP ${n}`) + '  ' + bold(text));
  out();
}

function bullet(text) {
  const chunks = wrap(text, W - 4);
  out('  - ' + chunks[0]);
  for (const chunk of chunks.slice(1)) out('    ' + chunk);
}

function numbered(n, text) {
  const chunks = wrap(text, W - 6);
  out('  ' + n + '. ' + chunks[0]);
  for (const chunk of chunks.slice(1)) out('     ' + chunk);
}

function big(text) {
  out();
  out('    ' + invert(' ' + text + ' '));
  out();
}

// Consecutive non-empty entries are one paragraph and get reflowed
// together; an empty entry is a blank line between paragraphs.
function warn(lines) {
  const paras = [];
  let current = [];
  for (const l of lines) {
    if (!l) {
      if (current.length) paras.push(current.join(' '));
      paras.push('');
      current = [];
    } else {
      current.push(l);
    }
  }
  if (current.length) paras.push(current.join(' '));

  out();
  let first = true;
  for (const p of paras) {
    if (!p) {
      out();
      continue;
    }
    for (const chunk of wrap(p, W - 6)) {
      out(red((first ? '  !! ' : '     ') + chunk));
      first = false;
    }
  }
  out();
}

function good(text) {
  out(green('  OK  ') + text);
}

// ---------------------------------------------------------------
// input
// ---------------------------------------------------------------

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});
const lines = rl[Symbol.asyncIterator]();

const record = {
  startedAt: new Date(),
  tier: null,
  tierFlavour: null,
  install: null,
  business: null,
  publicNumber: null,
  ownerMobile: null,
  carrierKey: null,
  carrierName: null,
  twilioNumber: null,
  testTarget: null,
  missedMessage: null,
  followUpMessage: null,
  activationCode: null,
  cancelCode: null,
  statusCode: null,
  notes: [],
  testsPassed: [],
  testsFailed: [],
};

let ended = false;

async function rawLine() {
  const { value, done } = await lines.next();
  if (done) return null;
  return String(value).replace(/\r$/, '');
}

function askLines(question) {
  for (const chunk of wrap(question, W - 4)) out(cyan('  ' + chunk));
}

async function ask(question, { allowBlank = false, hint = null } = {}) {
  for (;;) {
    out();
    askLines(question);
    if (hint) out(dim('  ' + hint));
    process.stdout.write(dim('  > '));
    const line = await rawLine();
    if (line === null) return finish('input ended');
    const answer = line.trim();
    if (answer === '?' || answer.toLowerCase() === 'help') {
      troubleshooting();
      continue;
    }
    if (answer.toLowerCase() === 'quit' || answer.toLowerCase() === 'stop') {
      return finish('stopped by you');
    }
    if (!answer && !allowBlank) {
      out(dim('  (an answer is needed here)'));
      continue;
    }
    return answer;
  }
}

async function pause(text = 'Press Enter when that is done.') {
  out();
  for (const chunk of wrap(text, W - 4)) out(dim('  ' + chunk));
  process.stdout.write(dim('  > '));
  const line = await rawLine();
  if (line === null) return finish('input ended');
  const answer = line.trim().toLowerCase();
  if (answer === '?' || answer === 'help') {
    troubleshooting();
    return pause(text);
  }
  if (answer === 'quit' || answer === 'stop') return finish('stopped by you');
  return true;
}

async function yesNo(question) {
  for (;;) {
    const a = (await ask(question, { hint: '(yes / no)' })).toLowerCase();
    if (['y', 'yes', 'yeah', 'yep', 'ok', 'done', 'true'].includes(a)) return true;
    if (['n', 'no', 'nope', 'not', 'false'].includes(a)) return false;
    out(dim('  (please answer yes or no)'));
  }
}

async function choose(question, options) {
  const keys = options.map((o) => o.key);
  for (;;) {
    out();
    askLines(question);
    out();
    options.forEach((o, i) => {
      out('    ' + bold(String(i + 1)) + '. ' + o.label);
      if (o.hint) {
        for (const chunk of wrap(o.hint, W - 9)) out('       ' + dim(chunk));
      }
    });
    process.stdout.write('\n' + dim('  > '));
    const line = await rawLine();
    if (line === null) return finish('input ended');
    const a = line.trim().toLowerCase();
    if (a === '?' || a === 'help') {
      troubleshooting();
      continue;
    }
    if (a === 'quit' || a === 'stop') return finish('stopped by you');
    const byNumber = Number.parseInt(a, 10);
    if (byNumber >= 1 && byNumber <= options.length) return keys[byNumber - 1];
    const byKey = options.find(
      (o) => o.key === a || o.label.toLowerCase().startsWith(a)
    );
    if (byKey && a.length >= 2) return byKey.key;
    out(dim('  (pick a number from the list)'));
  }
}

// ---------------------------------------------------------------
// phone numbers
// ---------------------------------------------------------------

function digits(s) {
  return String(s).replace(/\D/g, '');
}

function tidyNumber(s) {
  let d = digits(s);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

function prettyNumber(d) {
  if (d.length !== 10) return d;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

async function askNumber(question) {
  for (;;) {
    const raw = await ask(question);
    const d = tidyNumber(raw);
    if (d.length === 10) return d;
    out(dim('  (needs to be a 10-digit US number)'));
  }
}

// ---------------------------------------------------------------
// carrier codes
//
// Verified 2026-07-31. Carrier codes drift. If a code is refused
// on the handset, stop and check with the carrier - do not guess
// in front of a customer.
// ---------------------------------------------------------------

const GSM = {
  family: 'gsm',
  conditional: (n) => `**61*${n}#`,
  conditionalAlt: (n) => `*61*${n}#`,
  conditionalCancel: '##61#',
  ringTime: (n) => `**61*${n}**25#`,
  allConditions: (n) => `**004*${n}#`,
  allConditionsCancel: '##004#',
  unconditional: (n) => `**21*${n}#`,
  unconditionalCancel: '##21#',
  statusConditional: '*#61#',
  statusUnconditional: '*#21#',
  dialNote: 'Type it exactly, including the # at the end, then press call.',
};

const CDMA = {
  family: 'cdma',
  conditional: (n) => `*71${n}`,
  conditionalAlt: null,
  conditionalCancel: '*73',
  ringTime: null,
  allConditions: null,
  allConditionsCancel: '*73',
  unconditional: (n) => `*72${n}`,
  unconditionalCancel: '*73',
  statusConditional: null,
  statusUnconditional: null,
  dialNote:
    'No # at the end. Dial it like a phone number and press call. ' +
    'Wait for the confirmation tone or announcement before hanging up.',
};

const CARRIERS = {
  verizon: {
    name: 'Verizon',
    codes: CDMA,
    caution:
      'No Answer / Busy Transfer is not on every Verizon plan, and is ' +
      'often missing on prepaid. If *71 is refused, the feature is not ' +
      'on the line - they must ring Verizon to add it.',
  },
  att: {
    name: 'AT&T',
    codes: GSM,
    caution: null,
  },
  tmobile: {
    name: 'T-Mobile',
    codes: GSM,
    caution: null,
  },
  uscellular: {
    name: 'US Cellular',
    codes: CDMA,
    caution:
      'US Cellular follows the Verizon-style star codes. Confirm the ' +
      'success announcement before you trust it.',
  },
  mvno_tmo: {
    name: 'Mint / Ultra / Metro (T-Mobile network)',
    codes: GSM,
    caution:
      'MVNOs sometimes ship with conditional forwarding disabled. If ' +
      'the code is refused, the parent network has it switched off for ' +
      'that plan - not something you can fix on the handset.',
  },
  mvno_att: {
    name: 'Cricket / AT&T-network prepaid',
    codes: GSM,
    caution:
      'MVNOs sometimes ship with conditional forwarding disabled. If ' +
      'the code is refused, the parent network has it switched off for ' +
      'that plan - not something you can fix on the handset.',
  },
  mvno_vzw: {
    name: 'Visible / Total / Verizon-network prepaid',
    codes: CDMA,
    caution:
      'Verizon prepaid brands very often do NOT include No Answer / ' +
      'Busy Transfer. Expect *71 to fail. Have the alternative ready.',
  },
  googlefi: {
    name: 'Google Fi',
    codes: GSM,
    caution:
      'Google Fi does not officially support conditional forwarding. ' +
      'The GSM codes sometimes work from the dialler and sometimes do ' +
      'not. Test before you promise anything.',
  },
  unknown: {
    name: 'Unknown / other',
    codes: GSM,
    caution:
      'Carrier not identified. The GSM codes below work on most US ' +
      'networks EXCEPT Verizon and US Cellular. If the handset refuses ' +
      'them, the line is probably Verizon-family - go back and pick ' +
      'Verizon.',
  },
};

// ---------------------------------------------------------------
// troubleshooting
// ---------------------------------------------------------------

function troubleshooting() {
  heading('SOMETHING WENT WRONG');

  out(bold('  No text arrives at all'));
  bullet(
    'Brand or campaign not approved yet. Check the Twilio console. ' +
      'Nothing is deliverable until every carrier shows approved. ' +
      'See RESPONDER-PREFLIGHT.md, Stage 4.'
  );
  bullet(
    'Or: the number is not in the Messaging Service that is attached ' +
      'to the campaign. Add it, wait a minute, retest.'
  );
  bullet('Or: the Twilio balance is zero. Check it.');
  out();

  out(bold('  The text arrives on some phones and not others'));
  bullet(
    'Almost always AT&T still pending. Verizon and T-Mobile approve ' +
      'in days, AT&T takes 2-4 weeks. Do not hand over.'
  );
  out();

  out(bold('  Their phone stopped ringing entirely'));
  bullet('Unconditional forwarding is on by mistake.');
  bullet('GSM (AT&T, T-Mobile, most): dial  ##21#');
  bullet('Verizon / US Cellular: dial  *73');
  bullet('Then have them call the line to confirm it rings.');
  out();

  out(bold('  A caller who WAS answered got the "we missed you" text'));
  bullet('The flow branched wrong. In Studio, the Split Based On');
  out('    widget must test  widgets.connect_call.DialCallStatus');
  out('    and the missed-call branch must match only');
  out('      busy, no-answer, failed, cancelled');
  out('    and NOT completed. Fix before anyone else calls.');
  out();

  out(bold('  The forwarding code is refused by the handset'));
  bullet(
    'Wrong family of code. Verizon and US Cellular use *71. ' +
      'Everyone else uses **61*number#.'
  );
  bullet(
    'If the right family is refused, the carrier has the feature ' +
      'switched off for that plan. That is a phone call to the ' +
      'carrier, not something you can fix on site.'
  );
  out();

  out(bold('  Texts are late, or one carrier drops them'));
  bullet('Carrier filtering. Take out any link. Take out ALL CAPS.');
  bullet('Make sure the business name is in the message.');
  bullet('Make sure it ends with: Reply STOP to opt out.');
  out();

  out(bold('  It is a landline'));
  bullet('This product cannot be installed on a landline.');
  bullet(
    'Do not improvise. See the alternatives the script gave you at ' +
      'the landline check.'
  );
  out();

  out(bold('  Everything is broken and the customer is watching'));
  bullet('Cancel the forwarding first, so their phone works:');
  out('      ##21#  and  ##004#   (GSM)    or   *73  (Verizon)');
  bullet('Tell them plainly you will finish it remotely today.');
  bullet('A working phone and an honest sentence beats fiddling.');
  out();

  rule();
  out(dim('  Back to where you were.'));
}

// ---------------------------------------------------------------
// summary
// ---------------------------------------------------------------

function summary() {
  const r = record;
  const line = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    out(`${k.padEnd(22)}${v}`);
  };

  out();
  out('='.repeat(W));
  out('THE RESPONDER - INSTALL RECORD');
  out('='.repeat(W));
  out();
  line('Date', r.startedAt.toLocaleString());
  line('Business', r.business);
  line('Published number', r.publicNumber ? prettyNumber(r.publicNumber) : null);
  line('Owner mobile', r.ownerMobile ? prettyNumber(r.ownerMobile) : null);
  line('Carrier', r.carrierName);
  line('Twilio number', r.twilioNumber ? prettyNumber(r.twilioNumber) : null);
  line('Tier', r.tier);
  line('Follow-up style', r.tierFlavour);
  line('Install method', r.install);
  out();
  line('Activation code', r.activationCode);
  line('CANCEL code', r.cancelCode);
  line('Status check', r.statusCode);
  out();

  if (r.missedMessage) {
    out('Missed-call message:');
    out('  ' + r.missedMessage);
    out();
  }
  if (r.followUpMessage) {
    out('Answered-call follow-up:');
    out('  ' + r.followUpMessage);
    out();
  }

  if (r.testsPassed.length) {
    out('Tests passed:');
    for (const t of r.testsPassed) out('  [x] ' + t);
    out();
  }
  if (r.testsFailed.length) {
    out('TESTS FAILED - NOT FINISHED:');
    for (const t of r.testsFailed) out('  [ ] ' + t);
    out();
  }
  if (r.notes.length) {
    out('Notes:');
    for (const n of r.notes) {
      const chunks = wrap(n, 68);
      out('  - ' + chunks[0]);
      for (const chunk of chunks.slice(1)) out('    ' + chunk);
    }
    out();
  }

  out('Billing: $300 setup, $250/month.');
  out('Rule given to customer: transactional replies only.');
  out('No sales or promotional texts through this number, ever.');
  out();
  out('='.repeat(W));
  out();
}

function finish(reason) {
  if (ended) return;
  ended = true;
  out();
  out(dim(`  (${reason})`));
  summary();
  rl.close();
  process.exit(0);
}

// ---------------------------------------------------------------
// the walkthrough
// ---------------------------------------------------------------

async function main() {
  let publishedInstall = false;
  let consoleInstall = false;

  heading('THE RESPONDER - ON-SITE WALKTHROUGH');
  out('  One step at a time. Do not read ahead.');
  out();
  out('  ' + dim('?    at any prompt = troubleshooting'));
  out('  ' + dim('quit at any prompt = stop and print what we have'));
  out();
  await pause('Press Enter to begin.');

  // ---- 1. tier -------------------------------------------------
  step(1, 'Which tier are you installing?');
  const tier = await choose('Pick the tier.', [
    {
      key: 'tier1',
      label: 'TIER 1 - missed calls only',
      hint: 'Sorry we missed you. Conditional forwarding.',
    },
    {
      key: 'tier2',
      label: 'TIER 2 - missed calls AND answered-call follow-up',
      hint: 'Twilio sits in front of the line. More setup.',
    },
  ]);
  record.tier = tier === 'tier1' ? 'Tier 1 (missed calls only)' : 'Tier 2';

  if (tier === 'tier2') {
    const flavour = await choose('Which follow-up are you building?', [
      {
        key: 'auto',
        label: '2a - generic auto follow-up',
        hint: '"Thanks for calling {Business}. Anything you need, reply here."',
      },
      {
        key: 'relay',
        label: '2b - reply-relay',
        hint: 'Twilio texts the owner, his reply is relayed to the caller.',
      },
    ]);
    record.tierFlavour = flavour === 'auto' ? '2a generic auto' : '2b reply-relay';

    if (flavour === 'relay') {
      warn([
        'REPLY-RELAY NEEDS A TWILIO FUNCTION.',
        'It cannot be built from Studio widgets alone - the owner',
        'reply arrives as a new execution with no memory of the call.',
        'If you have not deployed and tested that Function already,',
        'do not install 2b today. Install 2a and come back.',
      ]);
      const ready = await yesNo(
        'Is the reply-relay Function already deployed AND tested on your own number?'
      );
      if (!ready) {
        out();
        out(bold('  Stop here on 2b.'));
        bullet('Install Tier 2a today. It works with no code.');
        bullet(
          'Tell the customer the relay is coming and do not charge ' +
            'for it until it runs.'
        );
        out();
        const fallback = await yesNo('Switch to Tier 2a and carry on?');
        if (!fallback) return finish('2b not ready, install not started');
        record.tierFlavour = '2a generic auto (2b deferred)';
        record.notes.push('2b reply-relay deferred - Function not ready.');
      }
    }
  }

  // ---- 2. preflight gate --------------------------------------
  step(2, 'Preflight gate');
  out('  If the A2P campaign is not fully approved, nothing you');
  out('  build today will deliver, and you will not find out');
  out('  until a customer complains.');
  out();
  const approved = await yesNo(
    'In the Twilio console, does the campaign show approved for ALL carriers, including AT&T?'
  );
  if (!approved) {
    warn([
      'DO NOT INSTALL TODAY. DO NOT TAKE THE MONEY.',
      'AT&T approval takes 2-4 weeks on its own.',
      'Book the install for a date after approval, and say so',
      'plainly. A promise you keep is worth more than a deposit',
      'you have to refund.',
    ]);
    return finish('campaign not approved');
  }
  good('Campaign approved.');

  const funded = await yesNo('Does the Twilio account have money on it?');
  if (!funded) {
    warn(['Top the balance up before you go any further.']);
    await pause('Press Enter once the balance is topped up.');
  }

  // ---- 3. landline check - HARD STOP ---------------------------
  step(3, 'The landline check');
  out('  Ask them, in these words:');
  big('"Is the number on your van a mobile, or a landline?"');
  out('  If they are not sure, these are landlines:');
  bullet('a desk phone plugged into a wall socket');
  bullet('a number from Comcast / Verizon Fios / a cable bundle');
  bullet('a number that only rings inside the building');
  out();
  out('  These are NOT landlines:');
  bullet('a cell phone, on any carrier');
  bullet('Google Voice or a VoIP app (different problem, see below)');
  out();

  const kind = await choose('What is the line?', [
    { key: 'mobile', label: 'Mobile / cell phone' },
    { key: 'landline', label: 'Landline' },
    { key: 'voip', label: 'VoIP or Google Voice' },
    { key: 'unsure', label: 'They genuinely do not know' },
  ]);

  if (kind === 'landline') {
    warn([
      'STOP. DO NOT INSTALL. DO NOT TAKE PAYMENT.',
      'Landlines do not reliably do conditional forwarding, and',
      'the ones that do need the carrier to enable it on the',
      'account. You cannot do it from the handset today.',
    ]);
    out(bold('  Say this, out loud:'));
    out();
    out('  "Your line is a landline, so I cannot put this on it');
    out('   today without your phone company involved. I am not');
    out('   going to charge you for something I cannot finish."');
    out();
    out(bold('  Then offer one of these:'));
    numbered(
      1,
      'A NEW number. I give you a fresh local number, it goes on ' +
        'your Google listing, your cards and your van, and it does ' +
        'everything we just discussed. Your old landline keeps ' +
        'working exactly as it does now. This is the option that ' +
        'actually works.'
    );
    out();
    numbered(
      2,
      'Ring your phone company and ask them to switch on "call ' +
        'forward on no answer". If they will, I come back and finish ' +
        'it. No charge for the second visit.'
    );
    out();
    numbered(
      3,
      'Move the business line to a mobile. Bigger job, worth doing ' +
        'anyway, and I can help.'
    );
    out();
    const newNumber = await yesNo('Did they take option 1 (a new number)?');
    if (!newNumber) {
      record.notes.push(
        'LANDLINE. Not installed. Left the three options with them.'
      );
      return finish('landline - install correctly refused');
    }
    record.notes.push(
      'LANDLINE. Installed on a NEW published Twilio number instead. ' +
        'No forwarding codes on their line.'
    );
    publishedInstall = true;
    out();
    good('Good. That is the clean install anyway.');
    out('  No forwarding codes. Twilio is the front door.');
  }

  if (kind === 'voip') {
    warn([
      'VoIP and Google Voice do not use carrier star codes.',
      'Forwarding is set in the provider web console instead.',
      'You cannot follow the handset steps in this script.',
    ]);
    out('  If you can log into their VoIP console with them and');
    out('  set "forward on no answer" to the Twilio number, carry');
    out('  on and skip the dialling steps. If you cannot get into');
    out('  that console today, stop and book a second visit.');
    out();
    const canDo = await yesNo('Can you get into their VoIP console right now?');
    if (!canDo) {
      record.notes.push('VoIP line, no console access. Second visit booked.');
      return finish('VoIP without console access');
    }
    record.notes.push('VoIP line. Forwarding set in provider console.');
    consoleInstall = true;
  }

  if (kind === 'unsure') {
    out();
    out('  Settle it now. Two ways:');
    bullet(
      'Ask them to pick the phone up and walk 20 feet away. If it ' +
        'still works, it is a mobile.'
    );
    bullet('Or look at the last phone bill on their phone.');
    out();
    const settled = await yesNo('Is it a mobile?');
    if (!settled) {
      warn([
        'Treat it as a landline. Stop and use the landline script.',
        'Run this walkthrough again and pick Landline.',
      ]);
      return finish('line type unresolved - treated as landline');
    }
  }

  // ---- 4. their details ---------------------------------------
  step(4, 'Write down who this is for');
  record.business = await ask(
    'Business name, spelled exactly as they say it. This goes in the text.'
  );
  record.publicNumber = await askNumber(
    'The number customers actually ring.'
  );
  record.ownerMobile = await askNumber(
    'The mobile where THEY want replies to land. Often the same number.'
  );
  good(`${record.business} / ${prettyNumber(record.publicNumber)}`);

  // ---- 5. carrier ---------------------------------------------
  step(5, 'Which carrier?');
  out('  Ask them. If they do not know, the carrier name is at');
  out('  the top of the phone screen, or on the bill.');

  const carrierKey = await choose('Carrier for the line customers ring:', [
    { key: 'verizon', label: 'Verizon' },
    { key: 'att', label: 'AT&T' },
    { key: 'tmobile', label: 'T-Mobile' },
    { key: 'uscellular', label: 'US Cellular' },
    { key: 'mvno_tmo', label: 'Mint / Ultra / Metro' },
    { key: 'mvno_att', label: 'Cricket / AT&T prepaid' },
    { key: 'mvno_vzw', label: 'Visible / Total / Verizon prepaid' },
    { key: 'googlefi', label: 'Google Fi' },
    { key: 'unknown', label: 'Something else / not sure' },
  ]);
  const carrier = CARRIERS[carrierKey];
  record.carrierKey = carrierKey;
  record.carrierName = carrier.name;
  good(carrier.name);
  if (carrier.caution) {
    out();
    out(yellow('  Heads up on ' + carrier.name + ':'));
    for (const chunk of wrap(carrier.caution, W - 6)) out('    ' + yellow(chunk));
  }

  // ---- 6. money ------------------------------------------------
  step(6, 'Take the money now, before you build');
  bullet('$300 setup - Stripe link on your phone');
  bullet('$250/month - starts today, not after a trial');
  bullet(
    'Say: cancel any time, and I turn the forwarding back off for ' +
      'you myself'
  );
  out();
  out('  The forwarding change is the deliverable and they can');
  out('  undo it in ten seconds. Do not build first.');
  out();
  const paid = await yesNo('Has the $300 cleared and the $250/month started?');
  if (!paid) {
    const proceed = await yesNo(
      'Building unpaid. Are you sure you want to carry on?'
    );
    if (!proceed) return finish('stopped before payment');
    record.notes.push('BUILT BEFORE PAYMENT - chase this.');
  }

  // ---- 7. the consent rule, said out loud ----------------------
  step(7, 'Say the rule out loud, now, while they are signing');
  out();
  out(bold('  Say this:'));
  out();
  out('  "This texts people back who called you. That is legal');
  out('   and it is solid, because they rang you first.');
  out('   It never sends sales texts. Not offers, not specials,');
  out('   not review requests. If you send one sales text');
  out('   through this, I have to shut it off, because it puts');
  out('   every other customer I have at risk."');
  out();
  const said = await yesNo('Have you said it, and did they understand?');
  if (!said) {
    warn(['Say it before you build. It is the rule the whole', 'product rests on.']);
    await pause('Press Enter once you have said it.');
  }
  good('Consent rule given.');

  // ---- 8. the messages -----------------------------------------
  step(8, 'Write the messages WITH them, out loud');
  out(bold('  Rules that are not optional:'));
  bullet('Their business name in it');
  bullet('Ends with: Reply STOP to opt out.');
  bullet('No links in the first message');
  bullet(
    'Plain ASCII only - no em dashes, no curly quotes, no emoji. ' +
      'One curly apostrophe triples the cost.'
  );
  out();
  out('  A good shape for the missed-call text:');
  out();
  out(dim(`  Sorry we missed you - this is ${record.business}.`));
  out(dim("  We're on a job right now. Reply here and we'll get"));
  out(dim('  straight back to you. Reply STOP to opt out.'));
  out();

  record.missedMessage = await askMessage(
    'Type the missed-call message you agreed with them.'
  );

  if (tier === 'tier2') {
    out();
    out('  Now the ANSWERED-call follow-up. Different message.');
    out('  This one goes to people who DID get through.');
    out();
    if (record.tierFlavour.startsWith('2a')) {
      out(dim(`  Thanks for calling ${record.business}.`));
      out(dim('  Anything you need, just reply here.'));
      out(dim('  Reply STOP to opt out.'));
    } else {
      out(dim(`  Thanks for calling ${record.business} - {his reply}`));
      out(dim('  Reply STOP to opt out.'));
      out();
      out('  And the prompt HE gets, after each call:');
      out(dim('  Call with {caller} ended. Reply with a message to'));
      out(dim('  send them.'));
    }
    out();
    record.followUpMessage = await askMessage(
      'Type the answered-call follow-up you agreed with them.'
    );
    out();
    out(bold('  Check this with them before you move on:'));
    out('  These two messages must not sound alike. If someone');
    out('  who just spoke to them gets "sorry we missed you",');
    out('  the customer looks broken. Read both aloud.');
    out();
    await pause('Press Enter once both have been read aloud and agreed.');
  }

  const toldReplies = await yesNo(
    'Have you told them replies land on THEIR phone, not yours?'
  );
  if (!toldReplies) {
    await pause('Tell them now. Press Enter when done.');
  }

  // ---- 9. build in Twilio --------------------------------------
  step(9, 'Build it in Twilio (about 10 minutes)');
  bullet(`Buy a number in area code ${record.publicNumber.slice(0, 3)}`);
  bullet('Local numbers are trusted more than out-of-area ones');
  bullet('Add the new number to the Responder Messaging Service');
  bullet('Copy the ' + (tier === 'tier1' ? 'TIER 1' : 'TIER 2') + ' Studio flow template');
  bullet('Point the new number at the copied flow for INCOMING CALLS');
  bullet(
    'Point the same number at the SMS-forward flow for INCOMING ' +
      `MESSAGES, so caller replies land on ${prettyNumber(record.ownerMobile)}. ` +
      'Without this the caller replies into a void.'
  );
  out();
  if (publishedInstall) {
    out('  ' + bold('This one is a published-number install:'));
    bullet(
      'Connect Call To goes to the line they actually answer - their ' +
        'landline is fine, it will just ring'
    );
    bullet(
      `Text replies still go to the mobile: ${prettyNumber(record.ownerMobile)}`
    );
    out();
  }
  if (tier === 'tier1') {
    out('  In the copied flow, set:');
    bullet(`Connect Call To -> ${prettyNumber(record.ownerMobile)}`);
    bullet('Split on widgets.connect_call.DialCallStatus');
    bullet('Missed branch matches: busy, no-answer, failed, cancelled');
    bullet('Send Message -> the missed-call text');
  } else {
    out('  In the copied flow, set:');
    bullet(`Connect Call To -> ${prettyNumber(record.ownerMobile)}`);
    bullet('Split on widgets.connect_call.DialCallStatus');
    bullet('Branch A, matches busy/no-answer/failed/cancelled');
    out('      -> Send Message: the missed-call text');
    bullet('Branch B, matches completed');
    out('      -> Send Message: the follow-up text');
    out();
    warn([
      'The two branches must not overlap.',
      'completed must NOT appear in the missed-call branch.',
      'Look at it twice. This is the mistake that loses the',
      'customer.',
    ]);
  }
  out();
  record.twilioNumber = await askNumber('What number did you buy?');
  await pause('Press Enter once the flow is published and live on that number.');
  good('Built.');

  // ---- 10. forwarding ------------------------------------------
  step(10, 'Point their line at the Twilio number');

  const t = record.twilioNumber;
  const codes = carrier.codes;

  if (publishedInstall) {
    // Landline that took a brand-new published number.
    // Nothing gets dialled on their line at all.
    await publishTheNumber(t);
  } else if (consoleInstall) {
    record.install = 'Forward-on-no-answer set in their VoIP console';
    out('  Their line is VoIP, so there are no handset codes.');
    out();
    if (tier === 'tier1') {
      bullet('In their VoIP console, find "forward on no answer"');
      bullet(`Set the destination to ${prettyNumber(t)}`);
      bullet(
        'Set the ring time to 20-25 seconds so they get a fair chance ' +
          'to pick up'
      );
      bullet('Do NOT set "forward all calls"');
    } else {
      record.install = 'All calls forwarded into Twilio from their VoIP console';
      warn([
        'Tier 2 needs EVERY call to go through Twilio.',
        'In their console that means "forward all calls", which is',
        'the setting that stops their phone ringing if Twilio is',
        'down. Say that out loud before you save it.',
      ]);
      bullet('In their VoIP console, set "forward all calls"');
      bullet(`Set the destination to ${prettyNumber(t)}`);
      bullet('Twilio answers and rings them straight back');
    }
    out();
    out('  ' + bold('Write down how to switch it off:'));
    out('  the same screen, set forwarding back to off.');
    record.activationCode = 'VoIP console: forward on no answer -> ' + prettyNumber(t);
    record.cancelCode = 'VoIP console: set forwarding to off';
    await pause('Press Enter once it is saved in their console.');
    record.testsPassed.push(
      tier === 'tier1'
        ? 'VoIP forward-on-no-answer configured'
        : 'VoIP forward-all-calls configured'
    );
  } else if (tier === 'tier1') {
    record.install = 'Conditional forwarding on their existing number';
    out('  You want CONDITIONAL forwarding - forward only when');
    out('  they do not answer. Their phone must still ring first.');
    out();
    out('  ' + bold('On THEIR phone, dial exactly this:'));
    big(codes.conditional(t));
    for (const chunk of wrap(codes.dialNote, W - 4)) out(dim('  ' + chunk));
    record.activationCode = codes.conditional(t);
    record.cancelCode = codes.conditionalCancel;
    record.statusCode = codes.statusConditional;

    out();
    out('  ' + bold('If they ever want it OFF, this is the code:'));
    big(codes.conditionalCancel);
    out('  ' + dim('Write this one on the invoice. They will ask.'));

    if (codes.conditionalAlt) {
      out();
      out(dim('  If the handset refuses that, try: ' + codes.conditionalAlt(t)));
    }
    if (codes.ringTime) {
      out();
      out(dim('  To give them longer to pick up (25 seconds):'));
      out(dim('    ' + codes.ringTime(t)));
    }
    out();
    const dialled = await yesNo(
      'Did the phone confirm it? (a success message or announcement)'
    );
    if (!dialled) {
      troubleshooting();
      const retry = await yesNo('Did it work on the second try?');
      if (!retry) {
        record.testsFailed.push('Forwarding code refused by the handset');
        warn([
          'Do not leave it half-set. Dial the cancel code now:',
          codes.conditionalCancel,
          'Then tell them you will finish it once the carrier has',
          'switched the feature on, and refund if they want out.',
        ]);
        return finish('forwarding could not be set');
      }
    }
    record.testsPassed.push('Conditional forwarding accepted by the carrier');
  } else {
    // Tier 2 needs Twilio in front of the line.
    out('  Tier 2 needs Twilio IN FRONT of the line, because');
    out('  conditional forwarding never tells Twilio about calls');
    out('  they DID answer. There are two ways.');
    out();
    const install = await choose('Which install?', [
      {
        key: 'publish',
        label: 'Publish the Twilio number (recommended)',
        hint: 'New number on Google, cards, van. No codes on their phone.',
      },
      {
        key: 'forward',
        label: 'Unconditional-forward their existing number into Twilio',
        hint: 'Keeps their published number. Riskier - read the warning.',
      },
    ]);

    if (install === 'publish') {
      await publishTheNumber(t);
    } else {
      record.install = 'Unconditional forwarding into Twilio';
      warn([
        'READ THIS TO THEM BEFORE YOU DIAL ANYTHING.',
        '',
        'This sends EVERY call to Twilio, which rings you back',
        'immediately. It works. But if Twilio goes down, or the',
        'balance runs out, YOUR PHONE STOPS RINGING ALTOGETHER.',
        'Tier 1 fails quietly. This fails loudly.',
      ]);
      const heard = await yesNo(
        'Have you said that out loud, and do they still want it this way?'
      );
      if (!heard) {
        out();
        out('  Good. Go back and publish the Twilio number instead.');
        record.notes.push(
          'Customer declined unconditional forwarding after hearing the ' +
            'failure mode. Reconfigure as a published number.'
        );
        return finish('customer declined unconditional forwarding');
      }
      out();
      out('  ' + bold('On THEIR phone, dial exactly this:'));
      big(codes.unconditional(t));
      for (const chunk of wrap(codes.dialNote, W - 4)) out(dim('  ' + chunk));
      out();
      out('  ' + red(bold('THE CANCEL CODE - write it down NOW:')));
      big(codes.unconditionalCancel);
      out('  ' + red('  If anything goes wrong at any point today,'));
      out('  ' + red('  dial that first. It gives them their phone back.'));
      record.activationCode = codes.unconditional(t);
      record.cancelCode = codes.unconditionalCancel;
      record.statusCode = codes.statusUnconditional;
      out();
      const ok = await yesNo('Did the phone confirm it?');
      if (!ok) {
        troubleshooting();
        const retry = await yesNo('Did it work on the second try?');
        if (!retry) {
          record.testsFailed.push('Unconditional forwarding refused');
          warn(['Dial ' + codes.unconditionalCancel + ' now and stop.']);
          return finish('forwarding could not be set');
        }
      }
      record.testsPassed.push('Unconditional forwarding accepted');
    }
  }

  // ---- 11. status check ----------------------------------------
  if (record.statusCode) {
    step(11, 'Confirm what is actually set');
    out('  Do not trust the success message. Check it.');
    out();
    out('  ' + bold('Dial:'));
    big(record.statusCode);
    out('  It should show forwarding to ' + prettyNumber(t) + '.');
    out();
    if (codes.family === 'gsm' && tier === 'tier1') {
      out('  ' + bold('Also dial ' + codes.statusUnconditional + ':'));
      out('  It must come back DISABLED. If it shows a number,');
      out('  unconditional forwarding is on by mistake - dial');
      out('  ' + codes.unconditionalCancel + ' immediately.');
      out();
    }
    await pause('Press Enter once you have checked.');
  }

  // ---- 12. test A: the missed call ------------------------------
  const stepA = record.statusCode ? 12 : 11;
  step(stepA, 'TEST A - the missed call');
  out('  Use your SECOND phone. Not theirs. Not the one you are');
  out('  showing them.');
  out();
  const dialTarget = record.testTarget || record.publicNumber;
  bullet(`Call ${prettyNumber(dialTarget)}`);
  bullet('LET IT RING OUT. Do not answer.');
  bullet('Wait for it to stop.');
  out();
  await pause('Press Enter once the call has rung out.');

  const gotMissed = await yesNo(
    'Did the MISSED-CALL text arrive on your second phone?'
  );
  if (!gotMissed) {
    troubleshooting();
    const fixed = await yesNo('Fixed, and the text arrived on a retry?');
    if (!fixed) {
      record.testsFailed.push('Missed-call text did not arrive');
      warn([
        'Do not hand over. Cancel the forwarding so their phone',
        'works normally: ' + record.cancelCode,
        'Tell them you are finishing it remotely today.',
      ]);
      return finish('missed-call test failed');
    }
  }
  record.testsPassed.push('Missed call -> missed-call text arrives');
  good('Missed call works.');

  const replyLands = await yesNo(
    'Reply to that text. Did the reply land on THEIR phone?'
  );
  if (replyLands) {
    record.testsPassed.push('Caller reply reaches the owner');
  } else {
    record.testsFailed.push('Caller reply did not reach the owner');
    warn([
      'The reply path is the product. Without it they are just',
      'sending an autoresponder into the void.',
      'Check the Twilio number forwards inbound SMS to their',
      'mobile before you hand over.',
    ]);
  }

  // ---- 13. test B: the answered call - MANDATORY ----------------
  step(stepA + 1, 'TEST B - the ANSWERED call  (not optional)');
  out('  This is the test that stops the product embarrassing');
  out('  them. Run it every single time.');
  out();
  bullet(`Call ${prettyNumber(dialTarget)} again`);
  bullet('Have them ANSWER it this time');
  bullet('Talk for a few seconds, then hang up');
  out();
  await pause('Press Enter once the answered call has ended.');

  if (tier === 'tier1') {
    const gotAny = await yesNo(
      'Did ANY text arrive on your second phone after that answered call?'
    );
    if (gotAny) {
      record.testsFailed.push(
        'Tier 1: answered call wrongly triggered a text'
      );
      warn([
        'THIS MUST NOT SHIP.',
        'On Tier 1 an answered call sends nothing at all.',
        'A caller who spoke to them and then gets "sorry we',
        'missed you" makes the business look broken.',
        '',
        'Cancel the forwarding now: ' + record.cancelCode,
        'Fix the Studio split, then rerun both tests.',
      ]);
      troubleshooting();
      const fixed = await yesNo('Fixed, and a retest sent nothing?');
      if (!fixed) return finish('answered-call test failed - do not hand over');
      record.testsFailed.pop();
    }
    record.testsPassed.push('Tier 1: answered call sends nothing');
    good('Answered calls stay silent. Correct.');
  } else {
    const gotFollowUp = await yesNo(
      'Did the ANSWERED-CALL FOLLOW-UP arrive on your second phone?'
    );
    const gotMissedToo = await yesNo(
      'Did the MISSED-CALL message also arrive after that answered call?'
    );

    if (gotFollowUp && !gotMissedToo) {
      record.testsPassed.push(
        'Tier 2: answered call -> follow-up only, no crossover'
      );
      good('Correct message, no crossover.');
    } else {
      if (!gotFollowUp) {
        record.testsFailed.push('Tier 2: follow-up did not arrive');
      }
      if (gotMissedToo) {
        record.testsFailed.push(
          'Tier 2: CROSSOVER - answered call sent the missed-call text'
        );
      }
      warn([
        'THE BRANCHES ARE CROSSED. DO NOT HAND OVER.',
        'In Studio: the completed branch sends the follow-up,',
        'and the missed branch matches ONLY',
        '  busy, no-answer, failed, cancelled.',
        'completed must not appear in the missed branch.',
      ]);
      troubleshooting();
      const fixed = await yesNo('Fixed, and a clean retest of BOTH call types?');
      if (!fixed) {
        warn([
          'Cancel the forwarding so their phone works:',
          record.cancelCode,
          'Finish it remotely today.',
        ]);
        return finish('tier 2 branch test failed');
      }
      record.testsFailed = record.testsFailed.filter(
        (x) => !x.startsWith('Tier 2:')
      );
      record.testsPassed.push('Tier 2: both branches correct after fix');
    }

    if (record.tierFlavour.startsWith('2b')) {
      out();
      out(bold('  TEST C - the relay'));
      bullet('They should have a text: "Call with ... ended."');
      bullet('Have them reply to it with a short sentence');
      bullet('That sentence must appear on your second phone');
      out();
      await pause('Press Enter once they have replied.');
      const relayed = await yesNo(
        'Did their reply arrive on your second phone, worded correctly?'
      );
      if (relayed) {
        record.testsPassed.push('Reply-relay works end to end');
        good('Relay works.');
      } else {
        record.testsFailed.push('Reply-relay did not deliver');
        warn([
          'Do not bill the relay. It is not working.',
          'Leave Tier 2a running, which does work, and finish',
          'the relay remotely.',
        ]);
      }
    }
  }

  // ---- 14. hand over -------------------------------------------
  step(stepA + 2, 'Hand over');
  bullet(
    'Show them the actual text on your phone, so they know exactly ' +
      'what their customers see'
  );
  bullet('Tell them: wording changes are free, just ring me');
  bullet('Give them the cancel code, written down:');
  out('        ' + bold(String(record.cancelCode)));
  bullet('Tell them the renewal date');
  bullet('Repeat the rule: no sales texts through this number');
  out();
  await pause('Press Enter when handed over.');

  const anythingElse = await ask(
    'Anything worth recording? (or press Enter for nothing)',
    { allowBlank: true }
  );
  if (anythingElse) record.notes.push(anythingElse);

  heading('DONE');
  out('  Copy the record below into the customer file or an');
  out('  email to yourself.');
  summary();
  rl.close();
}

// ---------------------------------------------------------------
// the published-number install (no forwarding codes at all)
// ---------------------------------------------------------------

async function publishTheNumber(t) {
  record.install = 'Twilio number published as the business number';
  record.testTarget = t;
  out();
  good('The clean install. No forwarding codes at all.');
  bullet(`Their new published number is ${prettyNumber(t)}`);
  bullet('Twilio answers and rings their real mobile straight away');
  bullet('Their personal number stays private');
  out();
  out('  ' + bold('Before you leave, this must be updated:'));
  bullet('Google Business Profile');
  bullet('Website and any booking form');
  bullet('Business cards, van, invoices, email signature');
  out();
  out('  Their OLD number keeps working, unchanged. Old');
  out('  customers ringing it get nothing new. Say that.');
  record.activationCode = 'None - Twilio number published directly';
  record.cancelCode = 'None - stop by changing the published number back';
  await pause('Press Enter once Google Business Profile is updated.');
}

// ---------------------------------------------------------------
// message checks
// ---------------------------------------------------------------

async function askMessage(question) {
  for (;;) {
    const msg = await ask(question);
    const clean = checkMessage(msg, record.business);
    if (clean) return msg;
    const retype = await yesNo('Fix it and retype it now?');
    if (!retype) {
      record.notes.push('Message sent with known problems: ' + msg);
      return msg;
    }
  }
}

function checkMessage(msg, business) {
  const problems = [];
  const nonAscii = [...msg].filter((ch) => ch.codePointAt(0) > 127);
  if (nonAscii.length) {
    problems.push(
      'Contains non-ASCII characters: ' +
        [...new Set(nonAscii)].join(' ') +
        '  -> retype them as plain - and \' or the message costs 3x'
    );
  }
  if (!/stop/i.test(msg)) {
    problems.push('No opt-out. Add: Reply STOP to opt out.');
  }
  if (business && !msg.toLowerCase().includes(business.toLowerCase().slice(0, 6))) {
    problems.push('Business name does not appear in the message.');
  }
  if (/https?:\/\/|www\.|\.com\b/i.test(msg)) {
    problems.push('Contains a link. Links get filtered. Take it out.');
  }
  if (msg.length > 306) {
    problems.push(
      `${msg.length} characters - three or more segments. Trim it.`
    );
  }

  out();
  if (problems.length === 0) {
    const segs = msg.length <= 160 ? 1 : Math.ceil(msg.length / 153);
    good(`${msg.length} chars, ${segs} segment(s), about $${(segs * 0.013).toFixed(3)} per send.`);
    return true;
  }
  for (const p of problems) {
    for (const chunk of wrap(p, W - 8)) out(yellow('  !  ' + chunk));
  }
  return false;
}

// ---------------------------------------------------------------
// util
// ---------------------------------------------------------------

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= width) line += ' ' + w;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

// ---------------------------------------------------------------

main().catch((err) => {
  out();
  out(red('  The script hit a problem: ' + err.message));
  out(red('  Nothing on the phone has changed because of this.'));
  out();
  troubleshooting();
  summary();
  rl.close();
  process.exit(1);
});
