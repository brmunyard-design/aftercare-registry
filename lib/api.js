// API for the Aftercare Registry pilot. One handler, mounted at /api/* by functions/api/[[path]].js.
//
// Model: a registry belongs to a family and holds Care Blocks (discrete needs, e.g. "Mow the
// lawn Saturday"). A helper makes an Offer against an available Care Block; the coordinator
// approves, declines, or — if nobody suitable turns up — moves the block to professional/
// community fallback. Each Care Block's `status` is kept in step with its current offer:
//   available -> pending -> approved -> completed
//                   \-> declined -> available (back to the top)
//   available -> fallback -> completed
//   (any open status) -> closed -> available   (coordinator says it's no longer needed / undo)

import {
  COOKIE_NAME,
  DEFAULT_SUPPORT_DAYS,
  HttpError,
  REVIEW_AFTER_DAYS,
  addDays,
  clampInt,
  clearThrottle,
  clientIp,
  emailKey,
  getCookie,
  isEmail,
  isoDate,
  json,
  makeSession,
  newRecoveryCode,
  normaliseCode,
  phoneKey,
  randomId,
  randomToken,
  readJson,
  sessionCookie,
  sha256Hex,
  text,
  throttle,
  timingSafeEqual,
  verifySession,
} from './util.js';

const nowIso = () => new Date().toISOString();
const OPEN_CARE_BLOCK_STATUSES = ['available', 'pending', 'approved', 'fallback'];

// ---------- router ----------

const dir = (fn) => async (ctx, ...args) => {
  await requireDirector(ctx);
  return fn(ctx, ...args);
};

const routes = [
  ['POST', /^\/api\/director\/login$/, login],
  ['POST', /^\/api\/director\/logout$/, logout],
  ['GET', /^\/api\/director\/session$/, session],
  ['GET', /^\/api\/director\/dashboard$/, dir(dashboard)],
  ['GET', /^\/api\/director\/registries$/, dir(listRegistries)],
  ['POST', /^\/api\/director\/registries$/, dir(createRegistry)],
  ['GET', /^\/api\/director\/registries\/([\w-]+)$/, dir(getRegistry)],
  ['PATCH', /^\/api\/director\/registries\/([\w-]+)$/, dir(patchRegistry)],
  ['DELETE', /^\/api\/director\/registries\/([\w-]+)$/, dir(deleteRegistry)],
  ['POST', /^\/api\/director\/registries\/([\w-]+)\/care-blocks$/, dir(addCareBlock)],
  ['GET', /^\/api\/director\/registries\/([\w-]+)\/export$/, dir(exportRegistry)],
  ['PATCH', /^\/api\/director\/care-blocks\/([\w-]+)$/, dir(patchCareBlock)],
  ['DELETE', /^\/api\/director\/care-blocks\/([\w-]+)$/, dir(deleteCareBlock)],
  ['GET', /^\/api\/s\/([\w-]+)$/, supporterView],
  ['POST', /^\/api\/s\/([\w-]+)\/offer$/, supporterOffer],
  ['POST', /^\/api\/recover$/, recover],
  ['GET', /^\/api\/c\/([\w-]+)$/, commitmentView],
  ['POST', /^\/api\/c\/([\w-]+)$/, commitmentAct],
];

export async function handle(request, env) {
  try {
    if (!env.DB) throw new HttpError(500, 'The database is not connected. Check the DB binding in wrangler.toml.');
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const ctx = { request, env, url, db: env.DB, origin: url.origin };

    let pathMatched = false;
    for (const [method, pattern, handler] of routes) {
      const m = pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (method !== request.method) continue;
      checkOrigin(ctx);
      return await handler(ctx, ...m.slice(1));
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'That method is not allowed.' : 'Not found.');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
}

// Browsers send Origin on cross-site writes; refuse anything that isn't this site.
function checkOrigin({ request, url }) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'That request came from another site.');
}

function safeParse(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function pushHistory(historyJson, status, by, note) {
  const history = safeParse(historyJson);
  history.push({ status, at: nowIso(), by, ...(note ? { note } : {}) });
  return JSON.stringify(history);
}

// ---------- coordinator sign-in ----------

function requireSecrets(env) {
  if (!env.DIRECTOR_PIN || !env.SESSION_SECRET) {
    throw new HttpError(500, 'Sign-in is not set up yet. Set the DIRECTOR_PIN and SESSION_SECRET secrets.');
  }
}

async function login({ request, env, db }) {
  requireSecrets(env);
  const bucket = `login:${clientIp(request)}`;
  await throttle(db, bucket, 8, 15 * 60);
  const { pin } = await readJson(request);
  const given = await sha256Hex(typeof pin === 'string' ? pin.trim() : '');
  const wanted = await sha256Hex(String(env.DIRECTOR_PIN).trim());
  if (!timingSafeEqual(given, wanted)) throw new HttpError(401, 'That PIN is not right.');
  await clearThrottle(db, bucket);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await makeSession(env.SESSION_SECRET)) });
}

async function logout() {
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function isDirector({ request, env }) {
  if (!env.SESSION_SECRET) return false;
  return verifySession(env.SESSION_SECRET, getCookie(request, COOKIE_NAME));
}

async function session(ctx) {
  return json({ signedIn: await isDirector(ctx) });
}

async function requireDirector(ctx) {
  requireSecrets(ctx.env);
  if (!(await isDirector(ctx))) throw new HttpError(401, 'Sign in to continue.');
}

// ---------- coordinator: dashboard ----------

// Cross-registry summary: counts, plus short lists for "Help still needed", "Tasks claimed"
// (pending or approved — a helper is attached but it isn't done yet) and "Completed".
async function dashboard({ db }) {
  const activeCount = (
    await db.prepare("SELECT COUNT(*) AS n FROM registries WHERE status = 'active'").first()
  ).n;

  const blockList = async (statusList, limit = 12) => {
    const placeholders = statusList.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT cb.id, cb.title, cb.status, cb.target_date, r.id AS registry_id, r.display_name AS registry_name
         FROM care_blocks cb JOIN registries r ON r.id = cb.registry_id
         WHERE cb.status IN (${placeholders}) AND r.status IN ('active', 'completed')
         ORDER BY cb.updated_at DESC LIMIT ?`
      )
      .bind(...statusList, limit)
      .all();
    return results;
  };

  const [help_needed, claimed, completed] = await Promise.all([
    blockList(['available']),
    blockList(['pending', 'approved']),
    blockList(['completed']),
  ]);
  const counts = {
    active_registries: activeCount,
    help_needed: (await db.prepare("SELECT COUNT(*) AS n FROM care_blocks cb JOIN registries r ON r.id = cb.registry_id WHERE cb.status = 'available' AND r.status IN ('active','completed')").first()).n,
    claimed: (await db.prepare("SELECT COUNT(*) AS n FROM care_blocks cb JOIN registries r ON r.id = cb.registry_id WHERE cb.status IN ('pending','approved') AND r.status IN ('active','completed')").first()).n,
    completed: (await db.prepare("SELECT COUNT(*) AS n FROM care_blocks cb JOIN registries r ON r.id = cb.registry_id WHERE cb.status = 'completed' AND r.status IN ('active','completed')").first()).n,
  };
  return json({ counts, help_needed, claimed, completed });
}

// ---------- coordinator: registries ----------

function withoutTokens(r) {
  const { trusted_token, public_token, ...rest } = r;
  return rest;
}

async function listRegistries({ db }) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.display_name, r.area, r.status, r.coordinator_name, r.support_end, r.review_date, r.created_at,
        (SELECT COUNT(*) FROM care_blocks cb WHERE cb.registry_id = r.id AND cb.status = 'available') AS available_count,
        (SELECT COUNT(*) FROM care_blocks cb WHERE cb.registry_id = r.id AND cb.status IN ('pending','approved')) AS claimed_count,
        (SELECT COUNT(*) FROM care_blocks cb WHERE cb.registry_id = r.id AND cb.status = 'completed') AS completed_count
       FROM registries r ORDER BY r.created_at DESC`
    )
    .all();
  return json({ registries: results });
}

function parseCareBlock(t) {
  return {
    title: text(t.title, { max: 120, required: true, label: 'Care Block title' }),
    description: text(t.description, { max: 600, label: 'Care Block details' }),
    target_date: isoDate(t.target_date, 'Target date'),
    visibility: t.visibility === 'public' ? 'public' : 'trusted',
  };
}

async function createRegistry({ request, db }) {
  const b = await readJson(request);
  const display_name = text(b.display_name, { max: 120, required: true, label: 'Family display name' });
  const coordinator_name = text(b.coordinator_name, { max: 120, required: true, label: 'Coordinator name' });
  const area = text(b.area, { max: 120, label: 'General area' });
  const welcome_message = text(b.welcome_message, { max: 1200, label: 'Welcome message' });
  const boundaries = text(b.boundaries, { max: 1200, label: 'Safe-to-share boundaries' });
  const family_contact = text(b.family_contact, { max: 300, label: 'Family contact' });
  const home_address = text(b.home_address, { max: 300, label: 'Home address' });
  const case_reference = text(b.case_reference, { max: 120, label: 'Case reference' });
  const dietary_details = text(b.dietary_details, { max: 600, label: 'Dietary details' });
  const access_notes = text(b.access_notes, { max: 600, label: 'Access notes' });
  const support_start = isoDate(b.support_start, 'Support start date');
  let support_end = isoDate(b.support_end, 'Support end date');
  if (support_start && !support_end) support_end = addDays(support_start, DEFAULT_SUPPORT_DAYS);
  if (support_start && support_end && support_end < support_start) {
    throw new HttpError(400, 'The support end date must be on or after the start date.');
  }
  const rawBlocks = Array.isArray(b.care_blocks) ? b.care_blocks.filter((t) => t && String(t.title || '').trim()) : [];
  if (rawBlocks.length > 30) throw new HttpError(400, 'Add up to 30 Care Blocks at a time.');
  const blocks = rawBlocks.map(parseCareBlock);

  const consent = b.consent === true;
  const id = randomId();
  const now = nowIso();
  const statements = [
    db
      .prepare(
        `INSERT INTO registries (id, status, display_name, area, welcome_message, boundaries, coordinator_name,
          family_contact, home_address, case_reference, dietary_details, access_notes,
          support_start, support_end, review_date, consent_recorded_at,
          trusted_token, public_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, consent ? 'active' : 'draft', display_name, area, welcome_message, boundaries, coordinator_name,
        family_contact, home_address, case_reference, dietary_details, access_notes,
        support_start, support_end, support_end ? addDays(support_end, REVIEW_AFTER_DAYS) : null, consent ? now : null,
        randomToken(), randomToken(), now, now
      ),
    ...blocks.map((t, i) =>
      db
        .prepare(
          `INSERT INTO care_blocks (id, registry_id, title, description, target_date, visibility, sort_order, status_history, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(randomId(), id, t.title, t.description, t.target_date, t.visibility, i, JSON.stringify([{ status: 'available', at: now, by: 'coordinator' }]), now, now)
    ),
  ];
  await db.batch(statements);
  return json({ id, status: consent ? 'active' : 'draft' }, 201);
}

async function loadRegistry(db, id) {
  const r = await db.prepare('SELECT * FROM registries WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'That registry was not found.');
  return r;
}

async function registryRecord(db, r) {
  const blocks = (
    await db.prepare('SELECT * FROM care_blocks WHERE registry_id = ? ORDER BY sort_order, created_at').bind(r.id).all()
  ).results;
  const offers = (
    await db
      .prepare(
        `SELECT id, care_block_id, helper_name, helper_phone, helper_email, proposed_date, confirmed_date,
                status, status_history, created_at
         FROM offers WHERE registry_id = ? ORDER BY created_at`
      )
      .bind(r.id)
      .all()
  ).results.map((o) => ({ ...o, status_history: safeParse(o.status_history) }));
  return {
    registry: withoutTokens(r),
    care_blocks: blocks.map((cb) => ({
      ...cb,
      status_history: safeParse(cb.status_history),
      offers: offers.filter((o) => o.care_block_id === cb.id),
    })),
  };
}

async function getRegistry({ db, origin }, id) {
  const r = await loadRegistry(db, id);
  return json({
    ...(await registryRecord(db, r)),
    links: { trusted: `${origin}/s/${r.trusted_token}`, public: `${origin}/s/${r.public_token}` },
  });
}

async function patchRegistry({ request, db }, id) {
  const b = await readJson(request);
  const r = await loadRegistry(db, id);
  const now = nowIso();

  switch (b.action) {
    case 'activate': {
      let consentAt = r.consent_recorded_at;
      if (!consentAt) {
        if (b.consent !== true) throw new HttpError(400, 'Record the family’s consent before activating this registry.');
        consentAt = now;
      }
      await db
        .prepare("UPDATE registries SET status = 'active', consent_recorded_at = ?, updated_at = ? WHERE id = ?")
        .bind(consentAt, now, id)
        .run();
      break;
    }
    case 'complete':
      if (r.status !== 'active') throw new HttpError(409, 'Only an active registry can be marked complete.');
      await db.prepare("UPDATE registries SET status = 'completed', updated_at = ? WHERE id = ?").bind(now, id).run();
      break;
    case 'reopen':
      if (r.status !== 'completed') throw new HttpError(409, 'Only a completed registry can be reopened.');
      await db.prepare("UPDATE registries SET status = 'active', updated_at = ? WHERE id = ?").bind(now, id).run();
      break;
    case 'archive':
      if (r.status !== 'completed') throw new HttpError(409, 'Complete a registry before archiving it.');
      await db.prepare("UPDATE registries SET status = 'archived', updated_at = ? WHERE id = ?").bind(now, id).run();
      break;
    case 'replace_links':
      await db
        .prepare('UPDATE registries SET trusted_token = ?, public_token = ?, updated_at = ? WHERE id = ?')
        .bind(randomToken(), randomToken(), now, id)
        .run();
      break;
    default:
      throw new HttpError(400, 'Unknown action.');
  }
  return json({ ok: true });
}

async function deleteRegistry({ db }, id) {
  await loadRegistry(db, id);
  await db.batch([
    db.prepare('DELETE FROM offers WHERE registry_id = ?').bind(id),
    db.prepare('DELETE FROM care_blocks WHERE registry_id = ?').bind(id),
    db.prepare('DELETE FROM registries WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function addCareBlock({ request, db }, registryId) {
  await loadRegistry(db, registryId);
  const t = parseCareBlock(await readJson(request));
  const { next } = await db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM care_blocks WHERE registry_id = ?')
    .bind(registryId)
    .first();
  const id = randomId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO care_blocks (id, registry_id, title, description, target_date, visibility, sort_order, status_history, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, registryId, t.title, t.description, t.target_date, t.visibility, next, JSON.stringify([{ status: 'available', at: now, by: 'coordinator' }]), now, now)
    .run();
  return json({ id }, 201);
}

async function deleteCareBlock({ db }, blockId) {
  const block = await db.prepare('SELECT id FROM care_blocks WHERE id = ?').bind(blockId).first();
  if (!block) throw new HttpError(404, 'That Care Block was not found.');
  await db.batch([
    db.prepare('DELETE FROM offers WHERE care_block_id = ?').bind(blockId),
    db.prepare('DELETE FROM care_blocks WHERE id = ?').bind(blockId),
  ]);
  return json({ ok: true });
}

// The coordinator's actions on a Care Block. `action` drives what else is required.
async function patchCareBlock({ request, db }, blockId) {
  const b = await readJson(request);
  const block = await db.prepare('SELECT * FROM care_blocks WHERE id = ?').bind(blockId).first();
  if (!block) throw new HttpError(404, 'That Care Block was not found.');
  const now = nowIso();

  const currentOffer = async () =>
    db
      .prepare("SELECT * FROM offers WHERE care_block_id = ? AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1")
      .bind(blockId)
      .first();

  // Returns an unexecuted statement, so callers can either run it alone or fold it into a batch.
  const setBlockStatus = (status, note) =>
    db
      .prepare('UPDATE care_blocks SET status = ?, status_history = ?, updated_at = ? WHERE id = ?')
      .bind(status, pushHistory(block.status_history, status, 'coordinator', note), now, blockId);

  switch (b.action) {
    case 'approve': {
      const offer = await currentOffer();
      if (!offer || offer.status !== 'pending') throw new HttpError(409, 'There is no pending offer to approve.');
      const confirmed = isoDate(b.confirmed_date, 'Confirmed date') || offer.proposed_date;
      await db.batch([
        db
          .prepare('UPDATE offers SET status = ?, confirmed_date = ?, status_history = ?, updated_at = ? WHERE id = ?')
          .bind('approved', confirmed, pushHistory(offer.status_history, 'approved', 'coordinator'), now, offer.id),
        setBlockStatus('approved'),
      ]);
      break;
    }
    case 'decline': {
      // Works on a pending offer (declining it) or an approved one (standing it down again).
      const offer = await currentOffer();
      if (!offer) throw new HttpError(409, 'There is no offer to decline.');
      await db.batch([
        db
          .prepare('UPDATE offers SET status = ?, status_history = ?, updated_at = ? WHERE id = ?')
          .bind('declined', pushHistory(offer.status_history, 'declined', 'coordinator', text(b.note, { max: 300 })), now, offer.id),
        setBlockStatus('available', 'offer declined'),
      ]);
      break;
    }
    case 'complete': {
      if (!['approved', 'fallback'].includes(block.status)) {
        throw new HttpError(409, 'Approve an offer, or arrange fallback help, before marking this complete.');
      }
      const statements = [setBlockStatus('completed')];
      const offer = await currentOffer();
      if (offer) {
        statements.push(
          db
            .prepare('UPDATE offers SET status = ?, status_history = ?, updated_at = ? WHERE id = ?')
            .bind('completed', pushHistory(offer.status_history, 'completed', 'coordinator'), now, offer.id)
        );
      }
      await db.batch(statements);
      break;
    }
    case 'fallback': {
      if (!['available', 'pending'].includes(block.status)) {
        throw new HttpError(409, 'Fallback is for a Care Block nobody has taken on yet.');
      }
      const offer = await currentOffer();
      const statements = [];
      if (offer) {
        statements.push(
          db
            .prepare('UPDATE offers SET status = ?, status_history = ?, updated_at = ? WHERE id = ?')
            .bind('declined', pushHistory(offer.status_history, 'declined', 'coordinator', 'moved to fallback'), now, offer.id)
        );
      }
      const provider = text(b.fallback_provider, { max: 200, label: 'Provider' });
      const notes = text(b.fallback_notes, { max: 600, label: 'Fallback notes' });
      statements.push(
        db
          .prepare('UPDATE care_blocks SET status = ?, fallback_provider = ?, fallback_notes = ?, status_history = ?, updated_at = ? WHERE id = ?')
          .bind('fallback', provider, notes, pushHistory(block.status_history, 'fallback', 'coordinator', provider || undefined), now, blockId)
      );
      await db.batch(statements);
      break;
    }
    case 'update_fallback': {
      if (block.status !== 'fallback') throw new HttpError(409, 'This Care Block is not in fallback.');
      const provider = text(b.fallback_provider, { max: 200, label: 'Provider' });
      const notes = text(b.fallback_notes, { max: 600, label: 'Fallback notes' });
      await db
        .prepare('UPDATE care_blocks SET fallback_provider = ?, fallback_notes = ?, updated_at = ? WHERE id = ?')
        .bind(provider, notes, now, blockId)
        .run();
      break;
    }
    case 'close':
      if (block.status === 'closed') throw new HttpError(409, 'This Care Block is already closed.');
      await setBlockStatus('closed', text(b.note, { max: 300 })).run();
      break;
    case 'reopen':
      if (!['closed', 'fallback'].includes(block.status)) throw new HttpError(409, 'Only a closed or fallback Care Block can be reopened.');
      await setBlockStatus('available', 're-opened').run();
      break;
    default:
      throw new HttpError(400, 'Unknown action.');
  }
  return json({ ok: true });
}

// The downloadable record leaves out bearer tokens and code hashes.
async function exportRegistry({ db }, id) {
  const r = await loadRegistry(db, id);
  const record = await registryRecord(db, r);
  const slug = r.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'record';
  return new Response(JSON.stringify({ exported_at: nowIso(), ...record }, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="aftercare-registry-${slug}.json"`,
      'cache-control': 'no-store',
    },
  });
}

// ---------- helpers (private bearer links) ----------

async function registryByToken(db, token) {
  const r = await db
    .prepare('SELECT * FROM registries WHERE trusted_token = ? OR public_token = ?')
    .bind(token, token)
    .first();
  if (!r) throw new HttpError(404, 'This link is not working.');
  return { r, circle: r.trusted_token === token ? 'trusted' : 'public' };
}

async function supporterView({ db }, token) {
  const { r, circle } = await registryByToken(db, token);
  if (!['active', 'completed'].includes(r.status)) return json({ open: false });
  const { results } = await db
    .prepare(
      `SELECT id, title, description, target_date, status
       FROM care_blocks
       WHERE registry_id = ? AND status != 'closed' ${circle === 'public' ? "AND visibility = 'public'" : ''}
       ORDER BY sort_order, created_at`
    )
    .bind(r.id)
    .all();
  return json({
    open: true,
    registry_status: r.status,
    family: {
      display_name: r.display_name,
      area: r.area,
      welcome_message: r.welcome_message,
      boundaries: r.boundaries,
    },
    care_blocks: results,
  });
}

async function supporterOffer({ request, db, origin }, token) {
  const { r, circle } = await registryByToken(db, token);
  if (r.status !== 'active') throw new HttpError(409, 'This registry is not open for new offers right now.');
  await throttle(db, `offer:${clientIp(request)}`, 20, 60 * 60);

  const b = await readJson(request);
  const block = await db
    .prepare('SELECT * FROM care_blocks WHERE id = ? AND registry_id = ?')
    .bind(String(b.care_block_id || ''), r.id)
    .first();
  if (!block || (circle === 'public' && block.visibility !== 'public')) {
    throw new HttpError(404, 'That Care Block is not available.');
  }

  const helper_name = text(b.helper_name, { max: 80, required: true, label: 'Your name' });
  const helper_phone = text(b.helper_phone, { max: 40, required: true, label: 'Your mobile number' });
  const pKey = phoneKey(helper_phone);
  if (pKey.length < 8 || pKey.length > 15) throw new HttpError(400, 'Enter a phone number we can reach you on.');
  const helper_email = text(b.helper_email, { max: 120, label: 'Your email' });
  if (helper_email && !isEmail(helper_email)) throw new HttpError(400, 'Check your email address.');
  const proposed_date = isoDate(b.proposed_date, 'Your proposed date') ?? block.target_date;

  const id = randomId();
  const offerToken = randomToken();
  const code = newRecoveryCode();
  const codeHash = await sha256Hex(`${id}:${normaliseCode(code)}`);
  const now = nowIso();

  // The status check and the insert are one statement, so two people can't both claim it at once.
  const result = await db
    .prepare(
      `INSERT INTO offers (id, care_block_id, registry_id, status, helper_name, helper_phone, helper_phone_key,
         helper_email, helper_email_key, proposed_date, token, code_hash, status_history, created_at, updated_at)
       SELECT ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT status FROM care_blocks WHERE id = ?) = 'available'`
    )
    .bind(
      id, block.id, r.id, helper_name, helper_phone, pKey, helper_email, emailKey(helper_email), proposed_date,
      offerToken, codeHash, JSON.stringify([{ status: 'pending', at: now, by: 'helper' }]), now, now, block.id
    )
    .run();
  if (!result.meta || result.meta.changes !== 1) {
    throw new HttpError(409, 'Someone has just offered to help with this. Have a look at what else is needed.');
  }
  await db
    .prepare('UPDATE care_blocks SET status = ?, status_history = ?, updated_at = ? WHERE id = ?')
    .bind('pending', pushHistory(block.status_history, 'pending', 'helper', helper_name), now, block.id)
    .run();

  return json(
    { code, commitment_link: `${origin}/c/${offerToken}`, care_block_title: block.title, family_name: r.display_name },
    201
  );
}

// ---------- helpers: recover an offer ----------

async function recover({ request, db }) {
  const b = await readJson(request);
  const contact = text(b.contact, { max: 120, required: true, label: 'Phone number or email' });
  const code = normaliseCode(text(b.code, { max: 40, required: true, label: 'Recovery code' }));
  const byEmail = contact.includes('@');
  const key = byEmail ? emailKey(contact) : phoneKey(contact);

  await throttle(db, `recover-ip:${clientIp(request)}`, 30, 60 * 60);
  await throttle(db, `recover:${key}`, 8, 15 * 60);

  const notFound = new HttpError(
    404,
    'We could not find an offer with those details. Check the phone number or email and the code, then try again.'
  );
  if (!key || !code) throw notFound;

  const { results } = await db
    .prepare(`SELECT id, token, code_hash FROM offers WHERE ${byEmail ? 'helper_email_key' : 'helper_phone_key'} = ? ORDER BY created_at DESC`)
    .bind(key)
    .all();
  for (const row of results) {
    if (timingSafeEqual(row.code_hash, await sha256Hex(`${row.id}:${code}`))) {
      await clearThrottle(db, `recover:${key}`);
      return json({ link: `/c/${row.token}` });
    }
  }
  throw notFound;
}

async function loadOffer(db, token) {
  const o = await db
    .prepare(
      `SELECT o.id, o.helper_name, o.proposed_date, o.confirmed_date, o.status, o.status_history,
              cb.id AS care_block_id, cb.status_history AS block_status_history,
              cb.title AS block_title, cb.description AS block_description, cb.target_date AS target_date,
              r.display_name AS family_name, r.area AS area, r.status AS registry_status
       FROM offers o
       JOIN care_blocks cb ON cb.id = o.care_block_id
       JOIN registries r ON r.id = o.registry_id
       WHERE o.token = ?`
    )
    .bind(token)
    .first();
  if (!o) throw new HttpError(404, 'This link is not working.');
  return o;
}

async function commitmentView({ db }, token) {
  const o = await loadOffer(db, token);
  const open = o.registry_status === 'active';
  return json({
    helper_name: o.helper_name,
    status: o.status,
    proposed_date: o.proposed_date,
    confirmed_date: o.confirmed_date,
    family_name: o.family_name,
    area: o.area,
    care_block: { title: o.block_title, description: o.block_description, target_date: o.target_date },
    registry_open: open,
    can_edit_date: open && o.status === 'pending',
    can_withdraw: open && ['pending', 'approved'].includes(o.status),
  });
}

async function commitmentAct({ request, db }, token) {
  const b = await readJson(request);
  const o = await loadOffer(db, token);
  if (o.registry_status !== 'active') {
    throw new HttpError(409, 'This registry is not open right now. Contact the coordinator if something has changed.');
  }
  const now = nowIso();

  if (b.action === 'withdraw') {
    if (!['pending', 'approved'].includes(o.status)) throw new HttpError(409, 'This offer can no longer be withdrawn.');
    await db.batch([
      db
        .prepare('UPDATE offers SET status = ?, status_history = ?, updated_at = ? WHERE token = ?')
        .bind('withdrawn', pushHistory(o.status_history, 'withdrawn', 'helper'), now, token),
      db
        .prepare("UPDATE care_blocks SET status = 'available', status_history = ?, updated_at = ? WHERE id = ?")
        .bind(pushHistory(o.block_status_history, 'available', 'helper', 'offer withdrawn'), now, o.care_block_id),
    ]);
  } else if (b.action === 'update') {
    if (o.status !== 'pending') throw new HttpError(409, 'This offer can no longer be changed here — contact the coordinator.');
    const proposed = isoDate(b.proposed_date, 'Your proposed date');
    if (!proposed) throw new HttpError(400, 'Choose the day you can help.');
    await db
      .prepare('UPDATE offers SET proposed_date = ?, status_history = ?, updated_at = ? WHERE token = ?')
      .bind(proposed, pushHistory(o.status_history, 'pending', 'helper', 'date changed'), now, token)
      .run();
  } else {
    throw new HttpError(400, 'Unknown action.');
  }
  return json({ ok: true });
}
