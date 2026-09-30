# Aftercare Registry — Cloudflare Pages

**To go live, follow [START.md](START.md).** That is the dashboard path. The notes below are for someone who already has Wrangler.

# Aftercare Registry — pilot, on Cloudflare

This is the `aftercare-registry-pilot.brmunyard.chatgpt.site` build, rebuilt to run on
**Cloudflare Pages** (static hosting + Functions) and **Cloudflare D1** (SQLite at the edge)
instead of the ChatGPT Apps hosting it currently runs on — and, on the second pass, reworked
to match the fuller Coordinator/Care Block/fallback model rather than the simpler one-click
version originally guessed from the public pages alone. See **"Two builds in one repo's
history"** below if you're comparing against an earlier copy of this project.

## What's here

```
public/            The site: HTML pages + plain CSS/JS (no build step, no framework)
functions/         Cloudflare Pages Functions — routes /api/*, /s/<token>, /c/<token>
lib/                Server code the Functions call into (api.js, util.js, shell.js)
schema.sql         D1 database schema — registries, care_blocks, offers
scripts/vendor.mjs  Copies the QR-code library into public/vendor at build time
test/               API tests (run with plain Node, no Cloudflare account needed)
wrangler.toml       Cloudflare project config
```

**Stack:** no framework, no bundler. The API is hand-written against the Web Crypto / Fetch
APIs so it runs unmodified on Workers. The pages are static HTML with small vanilla-JS files.
The pilot should comfortably sit in Cloudflare's free tier.

## The model

- **Registry** — one family, with a lifecycle of `draft → active → completed → archived`.
  A draft is invisible to helpers until a coordinator records the family's consent. Support
  runs for a **90-day period by default** (editable), with a review date 30 days after it ends.
- **Care Block** — one discrete, practical need ("Mow the lawn Saturday morning", "A meal for
  four on Wednesday"). Each is `public` (visible on both links) or `trusted` (trusted-circle
  link only), and moves through: `available → pending → approved → completed`, with a
  `decline` at the pending *or* approved stage sending it back to `available`, and a separate
  `available/pending → fallback → completed` path for professional or community help when
  nobody from the trusted circle takes it on. `closed` marks something no longer needed.
- **Offer** — one helper's attempt at a Care Block, with its own bearer link (`/c/<token>`)
  and recovery code. A block keeps every offer made against it (so a decline followed by a
  new offer from someone else is a clean, distinct record), but only one `pending` or
  `approved` offer at a time.
- **Coordinator dashboard** (`/director`, hash-routed) — stat cards for *Active registries*,
  *Help still needed*, *Tasks claimed* and *Completed*, each linking to a live cross-registry
  list, plus a *Family registries* page listing every registry regardless of status.

## Deploy it

You'll need a Cloudflare account and Node 20+. Nothing here needs payment details up front.

**The D1 database is already provisioned and schema'd** — `aftercare-registry-live`
(`19f619ce-c7c8-44e7-8ce9-9404eb8f339f`), reused from an earlier session and brought up to
date with `schema.sql` via the Cloudflare API directly, so `wrangler.toml` already points at
it. You don't need to run `wrangler d1 create`; `npm run db:remote` is safe to run anyway
(every statement is `CREATE TABLE IF NOT EXISTS`) but isn't required.

```bash
npm install
npx wrangler login                 # opens a browser to authorise the CLI

npx wrangler pages project create aftercare-registry-pilot
npx wrangler pages secret put DIRECTOR_PIN     # the PIN coordinators sign in with
npx wrangler pages secret put SESSION_SECRET   # any long random string, e.g. `openssl rand -hex 32`

npm run deploy                     # vendors the QR library, then deploys
```

Wrangler prints a `*.pages.dev` URL when it finishes — that's the live pilot. To put it on
your own domain, add a custom domain to the Pages project from the Cloudflare dashboard
(Workers & Pages → your project → Custom domains) — no code changes needed.

**Retiring the earlier attempt:** the same Cloudflare account also has a standalone Worker
called `aftercare-registry` (no relation to the Pages project name above) — an earlier,
simpler spike with its own data model (plain task categories, admin-link-by-URL-token instead
of coordinator sign-in). It's separate infrastructure and won't conflict with this deploy, but
once the Pages site above is confirmed working, delete it from the Cloudflare dashboard
(Workers & Pages → `aftercare-registry` → Settings → Delete) or with
`npx wrangler delete --name aftercare-registry`, so there's only one live version.

**Re-deploying:** `npm run deploy` again after any change. The D1 database persists between
deploys; `schema.sql` is safe to re-run (`npm run db:remote`) since every statement is
`CREATE TABLE IF NOT EXISTS`.

## Local development

```bash
cp .dev.vars.example .dev.vars     # sets a local DIRECTOR_PIN + SESSION_SECRET
npm run db:local                   # creates local D1 tables (SQLite file under .wrangler/)
npm run dev                        # wrangler pages dev, with live D1 + Functions
```

That serves the whole site, including `/api/*`, at `http://localhost:8788`.

Before Wrangler is set up, you can also sanity-check the server logic alone:

```bash
npm run test                       # 16 API tests, against a Node-native SQLite shim
```

## Two builds in one repo's history

The first pass matched only the pages reachable without a coordinator session — the
homepage, the "Find my commitment" form shell, and the privacy notice — and, behind
sign-in, guessed at a simpler model (a "task" with fixed helper slots, an instant one-click
commit, and an optional dollar pledge). That guess turned out to diverge from the real
product in several places, so this pass replaces it with the model described above, taken
from a fuller description of the coordinator dashboard and workflow. If you're holding onto
the earlier version for comparison, the main differences are:

| | First pass | This pass |
|---|---|---|
| Unit of help | "task", multiple helper spots | Care Block, one helper at a time |
| Claiming | instant one-click commit | offer → coordinator approves or declines |
| Unclaimed help | stays open indefinitely | can move to professional/community fallback |
| Money | optional "Care Block pledge" amount | not part of this model — removed |
| Registry states | draft / active / closed | draft / active / completed / archived |
| Support period | arbitrary start/end dates | 90 days by default, still editable |

**Coordinator sign-in is still the one deliberate substitution**, in both passes. The
original says *"Sign in with the exact ChatGPT email approved for this pilot"* — that's
ChatGPT's own account system, which only works inside ChatGPT Apps and can't run on
Cloudflare. This build uses a single shared PIN (`DIRECTOR_PIN`), checked server-side and
rate-limited. Fine for a pilot demo; if more than one or two coordinators need access, or
this needs to hold real families' details, that's the first thing to revisit — options
include Cloudflare Access (email OTP, no code changes) or per-coordinator logins.

**Still not built**, per the source description's own 🟡/🔵 split between what's live and
what's proposed: a distinct Family/Recipient login (families aren't a system user here, just
data a coordinator enters), multiple organisations, automated notifications, and a
structured fallback-provider directory (fallback is a free-text "who's helping and how"
field, not a lookup of local businesses or service clubs).

## Where things live (for when you extend it)

- **`lib/api.js`** — every route. Search for the path you care about (e.g. `/api/s/`,
  `care-blocks`).
- **`lib/util.js`** — validation, tokens, the recovery code alphabet, sessions, rate limiting.
- **`schema.sql`** — the whole data model in one file: `registries`, `care_blocks`, `offers`.
- **`public/director.js`** — the coordinator dashboard (hash-routed: `#/`, `#/blocks/<kind>`,
  `#/registries`, `#/new`, `#/r/<id>`).
- **`public/supporter.js`** / **`commitment.js`** / **`recover.js`** — the three
  helper-facing pages.
- Security headers and the Content-Security-Policy live in **`public/_headers`**
  (`lib/util.js` mirrors the same policy so API responses match).

## Known gaps, worth flagging for a real launch

- Single shared PIN for all coordinators (see above).
- No automated backups beyond what Cloudflare D1 provides — for real family data, add a
  periodic export.
- No SMS/email is sent (matches the pilot as described — nothing here sends notifications).
- Fallback is a coordinator-entered note, not an integration with Lions/Rotary/local
  businesses or a funding mechanism.
- The privacy notice is still a draft, as it says at the top: get it checked against
  Australian privacy law before any real family's details go in.
