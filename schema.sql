-- Aftercare Registry pilot: Cloudflare D1 schema.
-- Apply with:  npm run db:remote   (or db:local for wrangler dev)
--
-- v2: Care Blocks are the discrete unit of help ("Mow the lawn Saturday morning").
-- Each Care Block has zero or more Offers over its life (a helper proposing to do it);
-- the block's own `status` is kept in step with its current/latest offer, plus two
-- states offers don't have: 'fallback' (moved to professional/community help) and
-- 'closed' (no longer needed).

CREATE TABLE IF NOT EXISTS registries (
  id                  TEXT PRIMARY KEY,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),

  -- Shown to helpers
  display_name        TEXT NOT NULL,
  area                TEXT NOT NULL DEFAULT '',
  welcome_message     TEXT NOT NULL DEFAULT '',
  boundaries          TEXT NOT NULL DEFAULT '',

  -- Coordinator screens only
  coordinator_name    TEXT NOT NULL DEFAULT '',
  family_contact      TEXT NOT NULL DEFAULT '',
  home_address        TEXT NOT NULL DEFAULT '',
  case_reference      TEXT NOT NULL DEFAULT '',
  dietary_details     TEXT NOT NULL DEFAULT '',
  access_notes        TEXT NOT NULL DEFAULT '',

  support_start       TEXT,            -- YYYY-MM-DD
  support_end         TEXT,            -- YYYY-MM-DD, defaults to support_start + 90 days
  review_date         TEXT,            -- support_end + 30 days
  consent_recorded_at TEXT,            -- must be set before a registry can go active

  -- Unlisted bearer links (replaced together)
  trusted_token       TEXT NOT NULL UNIQUE,   -- sees every Care Block
  public_token        TEXT NOT NULL UNIQUE,   -- sees public-notice Care Blocks only

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_blocks (
  id                TEXT PRIMARY KEY,
  registry_id       TEXT NOT NULL REFERENCES registries(id) ON DELETE CASCADE,

  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  target_date       TEXT,                      -- the coordinator's preferred/target date, if any
  visibility        TEXT NOT NULL DEFAULT 'trusted' CHECK (visibility IN ('public', 'trusted')),
  sort_order        INTEGER NOT NULL DEFAULT 0,

  status            TEXT NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available', 'pending', 'approved', 'completed', 'fallback', 'closed')),

  -- Professional/community fallback, when nobody from the trusted circle takes it on.
  fallback_provider TEXT NOT NULL DEFAULT '',   -- e.g. "Rotary Midland", "Jim's Mowing"
  fallback_notes    TEXT NOT NULL DEFAULT '',

  status_history    TEXT NOT NULL DEFAULT '[]',  -- JSON: [{status, at, by, note?}]
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_care_blocks_registry ON care_blocks(registry_id);
CREATE INDEX IF NOT EXISTS idx_care_blocks_status ON care_blocks(status);

-- One row per helper attempt at a Care Block. A block can accumulate several over time
-- (declined, then someone else offers) but has at most one 'pending' or 'approved' row.
CREATE TABLE IF NOT EXISTS offers (
  id               TEXT PRIMARY KEY,
  care_block_id    TEXT NOT NULL REFERENCES care_blocks(id) ON DELETE CASCADE,
  registry_id      TEXT NOT NULL REFERENCES registries(id) ON DELETE CASCADE,

  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'declined', 'withdrawn')),

  helper_name      TEXT NOT NULL,
  helper_phone     TEXT NOT NULL,
  helper_phone_key TEXT NOT NULL,          -- digits only, +61 folded to 0
  helper_email     TEXT NOT NULL DEFAULT '',
  helper_email_key TEXT NOT NULL DEFAULT '',

  proposed_date    TEXT,                   -- the helper's proposed day
  confirmed_date   TEXT,                   -- set once the coordinator approves (may differ from proposed)

  -- The helper's own bearer link + recovery code.
  token            TEXT NOT NULL UNIQUE,
  code_hash        TEXT NOT NULL,          -- sha256(id:CODE); the code itself is never stored

  status_history   TEXT NOT NULL DEFAULT '[]',  -- JSON: [{status, at, by, note?}]
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_care_block ON offers(care_block_id);
CREATE INDEX IF NOT EXISTS idx_offers_registry ON offers(registry_id);
CREATE INDEX IF NOT EXISTS idx_offers_phone ON offers(helper_phone_key);
CREATE INDEX IF NOT EXISTS idx_offers_email ON offers(helper_email_key);

-- Attempt limiting for PIN sign-in, code recovery and helper offers.
CREATE TABLE IF NOT EXISTS attempts (
  bucket   TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
