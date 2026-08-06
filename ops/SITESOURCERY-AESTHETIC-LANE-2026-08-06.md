# Site Sourcery aesthetic lane — 2026-08-06

This lane extends the approved Site Sourcery visual world without redesigning
it. Backend authority and the canonical active-run ledger remain owned by the
Build lane. Public visual work lands page by page so it cannot be mixed into an
unsealed backend checkpoint.

## Objective

Give every major public page a memorable environment from the same Site
Sourcery universe. Remove the repeated pattern of a global wizard/storm
background plus a second floating copy of related artwork. Preserve product
truth, navigation, accessibility, and the approved interaction model.

## Frozen visual invariants

- Dark arcane atelier world: near-black void, violet depth, champagne gold,
  warm cream, and restrained mint accents.
- Georgia display type with the existing system sans; centered major
  statements and compact first-person copy.
- Frost pools and glass protect words locally. Do not dim an entire image to
  rescue one paragraph.
- Gold seals, rings, coins, fine borders, and metal-poured headings remain the
  shared brand grammar.
- Cards demonstrate what they sell where practical.
- The shared gilded header, menu language, phone pill, footer, buttons,
  cursor, and reduced-motion behavior remain consistent.
- The homepage is design-locked. Abracadabra/Alakazam's vessel and app-room
  state language remain outside this lane while backend work is active.
- Automated browser checks are necessary but do not replace the owner's
  visible desktop and phone walk.

## Collision-free ownership

The aesthetic lane owns:

- `vnext.css`
- `assets/site-sourcery-*.webp` and later versioned visual assets
- `domains/index.html`
- `custom/index.html`, with `custom/scope/` and `custom/process/` held until
  their approved fold into `/custom/` is resolved
- `responder/index.html`
- `work/index.html` and `work/work.css`
- the public presentation of About, Contact, FAQ, and Legal pages

The Build lane owns `server/**`, data-plane migrations/tests, hosted
composition, Abracadabra application runtime/customer controls, backend
operations, and `ops/SITESOURCERY-ACTIVE-RUN.md`. Generated `_site/` and
`_hosted/` artifacts are never edited directly.

Shared manifests, release evidence, and any public-copy change that alters a
commercial promise are integration checkpoints rather than unilateral visual
edits.

## Page environment matrix

| Page | Environment | Current state | Next visual gate |
| --- | --- | --- | --- |
| `/` | Storm Atelier | Locked | No change without owner approval |
| `/domains/` | Main Street | Local visual gate passed: page environment, frosted intro, no duplicate figure | Owner browser walk on the frozen release candidate |
| `/custom/` | Arcane Atelier plus two-room scope stage | Local visual gate passed: Arcane Atelier is the hero environment and Two Doors is a full-width section, not a card | Owner browser walk; resolve the later scope/process fold separately |
| `/responder/` | Hive Orchestra | Local visual gate passed: page environment and visible five-move flow | Reconcile commercial availability with the Build lane before release |
| `/work/` | CSS gallery room plus real project captures | Local visual gate passed: labeled live work and fictional studies at all target widths | Owner browser walk and final live-link check on the release candidate |
| `/about/` | One-person studio | Local visual gate passed: one desk and one chair, no invented portrait or floating Main Street image | Owner browser walk on the frozen release candidate |
| `/contact/` | Direct signal room | Local visual gate passed: phone, envelope, and one shared lantern behind sovereign HTML contact routes | Owner browser walk on the frozen release candidate |
| `/faq/` | Quiet index room | Local visual gate passed: subdued open index and opaque answer section | Reconcile held/public product truth before release |
| `/legal/` family | Archive and paired ledgers | Local visual gate passed: shared archive, privacy mint, terms champagne, long-form reading section protected | Rebuild truth slots and repeat the same-candidate browser gate after public-truth reconciliation |
| `/abracadabra/` | Existing altar/vessel system | Approved | Separate later owner walk; do not absorb into marketing-background work |

## Implementation order

1. Preserve and review the inherited Domains, Responder, and Spell Book
   changes. Finish each page atomically with its body class, environment,
   figure removal where appropriate, mobile focal positions, checks, and
   screenshots.
2. Convert Sorcery to the Arcane Atelier environment without changing its
   commercial structure. Resolve `/custom/scope/` and `/custom/process/`
   folding before giving either route permanent new artwork.
3. Inventory the secondary pages in the owner's browser walk, then generate
   one coherent background at a time using the existing five images as visual
   references. New files are versioned and never overwrite approved assets.
4. Reconcile public truth with the Build/Polish lane. An aesthetic pass cannot
   make Domains or Responder look sellable while their provider fulfillment is
   held.
5. Seal the aesthetic lane only after the exact candidate passes the complete
   artifact and browser gates and the owner has walked every major route.

## Per-page evidence gate

Every page must pass all of the following before it is marked complete:

- body class and page-scoped selectors; no shared cascade regression
- no duplicate floating copy of the environment artwork
- useful art crop and readable copy at 320x720, 390x844, 480-wide, and
  1440x1000
- no horizontal overflow; controls remain at least 44 pixels where interactive
- visible focus, semantic heading order, useful text alternatives, and no
  essential motion
- local frost only where required; mobile Safari effects remain bounded
- responsive image/preload behavior and acceptable transfer size
- `git diff --check`, HTML validation, current site checks, artifact rebuild,
  and browser audit on the same frozen tree
- owner-visible screenshot or browser walk approval

## Inherited uncommitted work

At lane start the following public files were already modified and must be
preserved rather than overwritten:

- `domains/index.html`
- `responder/index.html`
- `vnext.css`
- `work/index.html`
- `work/work.css`

Domains already uses Main Street as its background. Responder already removes
the interactive ten-minute picker in favor of a visible five-move flow, but it
still falls back to the global storm. Spell Book has been rewritten toward a
clean, explorable portfolio and requires review rather than another redesign.

## Local aesthetic checkpoint evidence

The August 6 local checkpoint adds four versioned 1672x941 WebP environments:

- `site-sourcery-one-person-studio-v1.webp` — 170 KB
- `site-sourcery-signal-room-v1.webp` — 123 KB
- `site-sourcery-index-room-v1.webp` — 149 KB
- `site-sourcery-archive-room-v1.webp` — 142 KB

All four are explicitly listed in the public artifact allowlist. Generated
`_site/` and `_hosted/` artifacts were rebuilt; neither was edited directly.

Evidence on the same tree:

- exact CDP captures at 320x720, 390x844, 480x900, and 1440x1000 for the
  public environment pages: zero horizontal overflow, zero clipped headings,
  and header controls contained at every phone width
- `npm run check:html`: pass
- `node scripts/check-site.mjs` under Node 24.18.0: pass for 18 live pages,
  20 redirects, all links/resources, sitemap, canonical contact, and seals
- `node scripts/build-pages.mjs --check` under Node 24.18.0: 82 allowlisted
  files with exact source bytes
- hosted HTML validation: pass
- `scripts/browser-audit-current.mjs` under Node 24.18.0: pass for 15 hosted
  routes across three audited viewports, including the full maker and corrected
  Custom-build change/completion fixtures
- `git diff --check`: pass

This checkpoint changes presentation only. It does not change a commercial
promise, provider state, payment state, deployment, DNS, or production.

## Coordination with Core Launch

Core Launch completion is not an aesthetic percentage. The Build lane must
seal H1M, implement H1N including paid change orders and final handoff, finish
Alakazam lifecycle/tier authority, reconcile public truth, and prove the exact
hosted candidate through staging and cutover. This lane reports only page
gates. Core Launch reaches 100 percent only when every release gate is PASS;
Expansion work is tracked separately.
