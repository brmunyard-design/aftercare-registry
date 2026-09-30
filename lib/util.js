// Shared helpers for the Aftercare Registry pilot.
// Runs on Cloudflare Workers/Pages Functions (Web Crypto, no Node APIs).

const enc = new TextEncoder();

export const COOKIE_NAME = 'ar_director';
export const SESSION_SECONDS = 8 * 60 * 60;
export const DEFAULT_SUPPORT_DAYS = 90; // the support period, unless the coordinator sets their own end date
export const REVIEW_AFTER_DAYS = 30; // review date = support end + this many days

// Keep in step with public/_headers.
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export async function readJson(request) {
  const body = await request.text();
  if (body.length > 60000) throw new HttpError(413, 'That request is too large.');
  try {
    const value = JSON.parse(body || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch (_) {
    /* fall through */
  }
  throw new HttpError(400, 'That request could not be read.');
}

// ---------- validation ----------

export function text(value, { max = 200, required = false, label = 'This field' } = {}) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return s;
}

export function isoDate(value, label = 'Date') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} must be a date.`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} must be a real date.`);
  }
  return value;
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Contact keys let a supporter recover a commitment however they type their details.
export function emailKey(s) {
  return String(s || '').trim().toLowerCase();
}

export function phoneKey(s) {
  let d = String(s || '').replace(/\D+/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('61') && d.length === 11) d = `0${d.slice(2)}`; // +61 4xx -> 04xx
  return d;
}

// ---------- ids, tokens, codes ----------

export function randomId() {
  return crypto.randomUUID();
}

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Unlisted bearer-link token (192 bits).
export function randomToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

// No I, L, O, 0 or 1, so a code read off a screen or a screenshot isn't misread.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 characters

export function newRecoveryCode() {
  let out = '';
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < 8) out += CODE_ALPHABET[b % 31]; // 248 = 31 * 8, avoids modulo bias
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normaliseCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload))));
}

// ---------- funeral director session (signed cookie) ----------

export async function makeSession(secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${exp}.${await hmac(secret, `director:${exp}`)}`;
}

export async function verifySession(secret, value) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(sig, await hmac(secret, `director:${exp}`));
}

export function getCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${value}; Path=/api/director; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

// ---------- attempt limiting (sign-in, recovery, sign-ups) ----------

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}

export async function throttle(db, bucket, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare('SELECT count, reset_at FROM attempts WHERE bucket = ?').bind(bucket).first();
  if (!row || row.reset_at <= now) {
    await db
      .prepare(
        'INSERT INTO attempts (bucket, count, reset_at) VALUES (?, 1, ?) ' +
          'ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at'
      )
      .bind(bucket, now + windowSeconds)
      .run();
    return;
  }
  if (row.count >= limit) {
    throw new HttpError(429, 'Too many attempts. Wait a few minutes, then try again.');
  }
  await db.prepare('UPDATE attempts SET count = count + 1 WHERE bucket = ?').bind(bucket).run();
}

export async function clearThrottle(db, bucket) {
  await db.prepare('DELETE FROM attempts WHERE bucket = ?').bind(bucket).run();
}
