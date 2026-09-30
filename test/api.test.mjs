import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/api.js';
import { createDb } from './d1-shim.mjs';

const ORIGIN = 'https://example.test';

function setup() {
  const env = { DB: createDb(), DIRECTOR_PIN: '246810', SESSION_SECRET: 'test-secret-value' };
  let cookie = '';
  const call = async (method, path, body, { auth = true, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (auth && cookie) h.cookie = cookie;
    const res = await handle(
      new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
      env
    );
    const set = res.headers.get('set-cookie');
    if (set && path.endsWith('/login') && res.status === 200) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
  return { env, call, signIn: () => call('POST', '/api/director/login', { pin: '246810' }) };
}

const sampleRegistry = (extra = {}) => ({
  display_name: 'The Example Family',
  area: 'Perth hills',
  welcome_message: 'Thank you for wanting to help.',
  boundaries: 'Please no visits without arranging first.',
  coordinator_name: 'Sam Coordinator',
  family_contact: 'Jo Example 0400 000 000',
  home_address: '1 Example St',
  case_reference: 'CASE-1',
  dietary_details: 'No shellfish',
  access_notes: 'Side gate',
  support_start: '2026-10-01',
  support_end: '2026-10-31',
  consent: true,
  care_blocks: [
    { title: 'Mow the lawn', description: 'Front and back', target_date: '2026-10-05', visibility: 'public' },
    { title: 'Wednesday dinner', description: 'Four people', target_date: '2026-10-08', visibility: 'trusted' },
  ],
  ...extra,
});

test('director area needs the PIN', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/director/registries')).status, 401);
  assert.equal((await call('POST', '/api/director/login', { pin: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/api/director/session')).data.signedIn, false);
  assert.equal((await call('POST', '/api/director/login', { pin: '246810' })).status, 200);
  assert.equal((await call('GET', '/api/director/session')).data.signedIn, true);
  assert.equal((await call('GET', '/api/director/registries')).status, 200);
});

test('repeated wrong PINs are throttled', async () => {
  const { call } = setup();
  for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/api/director/login', { pin: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/director/login', { pin: 'nope' })).status, 429);
  assert.equal((await call('POST', '/api/director/login', { pin: '246810' })).status, 429);
});

test('cross-site writes are refused', async () => {
  const { call, signIn } = setup();
  await signIn();
  const res = await call('POST', '/api/director/registries', sampleRegistry(), { headers: { origin: 'https://evil.test' } });
  assert.equal(res.status, 403);
});

test('support end defaults to 90 days out, review date is +30 on that', async () => {
  const { call, signIn } = setup();
  await signIn();
  const created = await call('POST', '/api/director/registries', sampleRegistry({ support_end: undefined, care_blocks: [] }));
  const d = (await call('GET', `/api/director/registries/${created.data.id}`)).data.registry;
  assert.equal(d.support_end, '2026-12-30'); // 2026-10-01 + 90 days
  assert.equal(d.review_date, '2027-01-29'); // support_end + 30 days
});

test('consent gates activation', async () => {
  const { call, signIn } = setup();
  await signIn();
  const created = await call('POST', '/api/director/registries', sampleRegistry({ consent: false }));
  assert.equal(created.data.status, 'draft');
  const id = created.data.id;
  const links = (await call('GET', `/api/director/registries/${id}`)).data.links;

  assert.deepEqual((await call('GET', `/api/s/${links.public.split('/s/')[1]}`, undefined, { auth: false })).data, { open: false });
  assert.equal((await call('PATCH', `/api/director/registries/${id}`, { action: 'activate' })).status, 400);
  assert.equal((await call('PATCH', `/api/director/registries/${id}`, { action: 'activate', consent: true })).status, 200);
  const d = (await call('GET', `/api/director/registries/${id}`)).data;
  assert.equal(d.registry.status, 'active');
  assert.ok(d.registry.consent_recorded_at);
});

test('registry status lifecycle: active -> completed -> archived', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [] }))).data.id;
  const patch = (body) => call('PATCH', `/api/director/registries/${id}`, body);

  assert.equal((await patch({ action: 'complete' })).status, 200);
  assert.equal((await call('GET', `/api/director/registries/${id}`)).data.registry.status, 'completed');
  assert.equal((await patch({ action: 'complete' })).status, 409); // already completed, not active
  assert.equal((await patch({ action: 'archive' })).status, 200);
  assert.equal((await call('GET', `/api/director/registries/${id}`)).data.registry.status, 'archived');
  assert.equal((await patch({ action: 'reopen' })).status, 409); // archived, not completed
});

test('validation and Care Block CRUD', async () => {
  const { call, signIn } = setup();
  await signIn();
  assert.equal((await call('POST', '/api/director/registries', sampleRegistry({ display_name: '  ' }))).status, 400);
  assert.equal((await call('POST', '/api/director/registries', sampleRegistry({ support_end: '2026-09-01' }))).status, 400);
  assert.equal((await call('POST', '/api/director/registries', sampleRegistry({ support_start: '2026-02-30' }))).status, 400);

  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [] }))).data.id;
  const t = await call('POST', `/api/director/registries/${id}/care-blocks`, { title: 'Lift to the service', visibility: 'public' });
  assert.equal(t.status, 201);
  assert.equal((await call('POST', `/api/director/registries/${id}/care-blocks`, { title: '' })).status, 400);
  let d = (await call('GET', `/api/director/registries/${id}`)).data;
  assert.equal(d.care_blocks.length, 1);
  assert.equal(d.care_blocks[0].status, 'available');
  assert.equal((await call('DELETE', `/api/director/care-blocks/${t.data.id}`)).status, 200);
  assert.equal((await call('GET', `/api/director/registries/${id}`)).data.care_blocks.length, 0);

  const list = (await call('GET', '/api/director/registries')).data.registries;
  assert.equal(list.length, 1);
  assert.equal(list[0].display_name, 'The Example Family');
});

test('supporter offer input is checked', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry())).data.id;
  const links = (await call('GET', `/api/director/registries/${id}`)).data.links;
  const token = links.trusted.split('/s/')[1];
  const block = (await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks[0];
  const offer = (b) => call('POST', `/api/s/${token}/offer`, { care_block_id: block.id, ...b }, { auth: false });
  assert.equal((await offer({ helper_name: '', helper_phone: '0412 345 678' })).status, 400);
  assert.equal((await offer({ helper_name: 'A', helper_phone: '123' })).status, 400);
  assert.equal((await offer({ helper_name: 'A', helper_phone: '0412 345 678', helper_email: 'nope' })).status, 400);
  assert.equal((await offer({ helper_name: 'A', helper_phone: '0412 345 678', proposed_date: 'soon' })).status, 400);
  assert.equal((await call('GET', '/api/s/not-a-real-token', undefined, { auth: false })).status, 404);
  assert.equal((await call('GET', '/api/nothing-here', undefined, { auth: false })).status, 404);
  assert.equal((await call('DELETE', '/api/recover', undefined, { auth: false })).status, 405);
});

test('recovery is throttled per contact', async () => {
  const { call } = setup();
  for (let i = 0; i < 8; i++) {
    assert.equal((await call('POST', '/api/recover', { contact: '0412 345 678', code: 'AAAA-AAAA' }, { auth: false })).status, 404);
  }
  assert.equal((await call('POST', '/api/recover', { contact: '0412 345 678', code: 'AAAA-AAAA' }, { auth: false })).status, 429);
});

test('full approval path: offer -> approve -> complete', async () => {
  const { call, signIn } = setup();
  await signIn();
  const created = await call('POST', '/api/director/registries', sampleRegistry());
  const id = created.data.id;
  const links = (await call('GET', `/api/director/registries/${id}`)).data.links;
  const publicToken = links.public.split('/s/')[1];
  const trustedToken = links.trusted.split('/s/')[1];

  // Public link hides the trusted-only Care Block
  const pub = (await call('GET', `/api/s/${publicToken}`, undefined, { auth: false })).data;
  assert.deepEqual(pub.care_blocks.map((c) => c.title), ['Mow the lawn']);
  const trusted = (await call('GET', `/api/s/${trustedToken}`, undefined, { auth: false })).data;
  assert.equal(trusted.care_blocks.length, 2);
  const dinnerId = trusted.care_blocks.find((c) => c.title === 'Wednesday dinner').id;

  // Can't offer on a trusted-only block through the public link
  assert.equal(
    (await call('POST', `/api/s/${publicToken}/offer`, { care_block_id: dinnerId, helper_name: 'X', helper_phone: '0411 222 333' }, { auth: false })).status,
    404
  );

  // Offer on the public block
  const lawnId = pub.care_blocks[0].id;
  const offer = await call('POST', `/api/s/${publicToken}/offer`, {
    care_block_id: lawnId, helper_name: 'Alex Helper', helper_phone: '0412 345 678',
    helper_email: 'Alex@Example.com', proposed_date: '2026-10-06',
  }, { auth: false });
  assert.equal(offer.status, 201);
  assert.match(offer.data.code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const code = offer.data.code;

  // Block is now pending; a second offer is refused
  assert.equal((await call('GET', `/api/s/${publicToken}`, undefined, { auth: false })).data.care_blocks[0].status, 'pending');
  const second = await call('POST', `/api/s/${publicToken}/offer`, {
    care_block_id: lawnId, helper_name: 'Late Larry', helper_phone: '0499 111 222',
  }, { auth: false });
  assert.equal(second.status, 409);

  // Dashboard reflects it
  let dash = (await call('GET', '/api/director/dashboard')).data;
  assert.equal(dash.counts.claimed, 1);
  assert.equal(dash.counts.help_needed, 1); // the dinner block

  // Recovery: phone typed differently, code without the dash, lowercase
  const bad = await call('POST', '/api/recover', { contact: '0412 345 678', code: 'AAAA-AAAA' }, { auth: false });
  assert.equal(bad.status, 404);
  const good = await call('POST', '/api/recover', { contact: '+61 412 345 678', code: code.replace('-', '').toLowerCase() }, { auth: false });
  assert.equal(good.status, 200);
  const ctoken = good.data.link.split('/c/')[1];

  let view = (await call('GET', `/api/c/${ctoken}`, undefined, { auth: false })).data;
  assert.equal(view.status, 'pending');
  assert.equal(view.can_edit_date, true);
  assert.equal(view.can_withdraw, true);
  assert.equal(JSON.stringify(view).includes('0412'), false);

  // Helper changes their proposed day while still pending
  assert.equal((await call('POST', `/api/c/${ctoken}`, { action: 'update', proposed_date: '2026-10-07' }, { auth: false })).status, 200);
  view = (await call('GET', `/api/c/${ctoken}`, undefined, { auth: false })).data;
  assert.equal(view.proposed_date, '2026-10-07');

  // Coordinator approves with a specific confirmed date
  const blockBefore = (await call('GET', `/api/director/registries/${id}`)).data.care_blocks.find((c) => c.id === lawnId);
  assert.equal(blockBefore.offers[0].status, 'pending');
  const approve = await call('PATCH', `/api/director/care-blocks/${lawnId}`, { action: 'approve', confirmed_date: '2026-10-06' });
  assert.equal(approve.status, 200);

  view = (await call('GET', `/api/c/${ctoken}`, undefined, { auth: false })).data;
  assert.equal(view.status, 'approved');
  assert.equal(view.confirmed_date, '2026-10-06');
  assert.equal(view.can_edit_date, false); // locked once approved
  assert.equal(view.can_withdraw, true);

  // Can't change the date after approval, but can still withdraw
  assert.equal((await call('POST', `/api/c/${ctoken}`, { action: 'update', proposed_date: '2026-10-09' }, { auth: false })).status, 409);

  // Coordinator marks it done
  assert.equal((await call('PATCH', `/api/director/care-blocks/${lawnId}`, { action: 'complete' })).status, 200);
  view = (await call('GET', `/api/c/${ctoken}`, undefined, { auth: false })).data;
  assert.equal(view.status, 'completed');
  assert.equal(view.can_withdraw, false);
  const afterDetail = (await call('GET', `/api/director/registries/${id}`)).data.care_blocks.find((c) => c.id === lawnId);
  assert.equal(afterDetail.status, 'completed');
  assert.equal(afterDetail.offers[0].status, 'completed');
  assert.equal(afterDetail.offers[0].code_hash, undefined);

  dash = (await call('GET', '/api/director/dashboard')).data;
  assert.equal(dash.counts.completed, 1);
  assert.equal(dash.counts.claimed, 0);

  // Export leaves out tokens and hashes but keeps helper details
  const exp = await call('GET', `/api/director/registries/${id}/export`);
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment; filename="aftercare-registry-the-example-family\.json"/);
  assert.equal(/token|code_hash/.test(JSON.stringify(exp.data)), false);
  assert.equal(exp.data.care_blocks.find((c) => c.id === lawnId).offers[0].helper_phone, '0412 345 678');
});

test('decline returns a Care Block to available; old link reflects it', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [{ title: 'Garden tidy', visibility: 'public' }] }))).data.id;
  const links = (await call('GET', `/api/director/registries/${id}`)).data.links;
  const token = links.public.split('/s/')[1];
  const block = (await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks[0];

  const offer = await call('POST', `/api/s/${token}/offer`, {
    care_block_id: block.id, helper_name: 'Jordan', helper_phone: '0400 111 222',
  }, { auth: false });
  const ctoken = offer.data.commitment_link.split('/c/')[1];

  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'decline', note: 'family changed their mind' })).status, 200);
  assert.equal((await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks[0].status, 'available');

  const view = (await call('GET', `/api/c/${ctoken}`, undefined, { auth: false })).data;
  assert.equal(view.status, 'declined');
  assert.equal(view.can_withdraw, false);
  assert.equal(view.can_edit_date, false);

  // Someone else can now offer on the same, now-available, block
  const second = await call('POST', `/api/s/${token}/offer`, {
    care_block_id: block.id, helper_name: 'Priya', helper_phone: '0400 333 444',
  }, { auth: false });
  assert.equal(second.status, 201);
});

test('withdrawing frees the Care Block', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [{ title: 'School pickup', visibility: 'public' }] }))).data.id;
  const token = (await call('GET', `/api/director/registries/${id}`)).data.links.public.split('/s/')[1];
  const block = (await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks[0];
  const offer = await call('POST', `/api/s/${token}/offer`, { care_block_id: block.id, helper_name: 'Robin', helper_phone: '0400 555 666' }, { auth: false });
  const ctoken = offer.data.commitment_link.split('/c/')[1];

  assert.equal((await call('POST', `/api/c/${ctoken}`, { action: 'withdraw' }, { auth: false })).status, 200);
  assert.equal((await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks[0].status, 'available');
  assert.equal((await call('POST', `/api/c/${ctoken}`, { action: 'withdraw' }, { auth: false })).status, 409);
});

test('an approved offer can also be stood down', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [{ title: 'Ironing', visibility: 'public' }] }))).data.id;
  const token = (await call('GET', `/api/director/registries/${id}`)).data.links.public.split('/s/')[1];
  const block = (await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks[0];
  await call('POST', `/api/s/${token}/offer`, { care_block_id: block.id, helper_name: 'Sam', helper_phone: '0400 777 888' }, { auth: false });
  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'approve' })).status, 200);
  assert.equal((await call('GET', `/api/director/registries/${id}`)).data.care_blocks[0].status, 'approved');
  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'decline' })).status, 200);
  assert.equal((await call('GET', `/api/director/registries/${id}`)).data.care_blocks[0].status, 'available');
});

test('professional/community fallback path', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [{ title: 'Grocery run', visibility: 'trusted' }] }))).data.id;
  const block = (await call('GET', `/api/director/registries/${id}`)).data.care_blocks[0];

  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'complete' })).status, 409); // nothing approved yet
  const fb = await call('PATCH', `/api/director/care-blocks/${block.id}`, {
    action: 'fallback', fallback_provider: 'Rotary Midland', fallback_notes: 'Contacted Tuesday, confirmed Thursday drop-off',
  });
  assert.equal(fb.status, 200);
  let d = (await call('GET', `/api/director/registries/${id}`)).data.care_blocks[0];
  assert.equal(d.status, 'fallback');
  assert.equal(d.fallback_provider, 'Rotary Midland');

  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'complete' })).status, 200);
  d = (await call('GET', `/api/director/registries/${id}`)).data.care_blocks[0];
  assert.equal(d.status, 'completed');
});

test('closing and reopening a Care Block', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry({ care_blocks: [{ title: 'Weekly check-in', visibility: 'public' }] }))).data.id;
  const links = (await call('GET', `/api/director/registries/${id}`)).data.links;
  const token = links.public.split('/s/')[1];
  const block = (await call('GET', `/api/director/registries/${id}`)).data.care_blocks[0];

  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'close' })).status, 200);
  assert.equal((await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks.length, 0); // hidden once closed
  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'close' })).status, 409);

  assert.equal((await call('PATCH', `/api/director/care-blocks/${block.id}`, { action: 'reopen' })).status, 200);
  assert.equal((await call('GET', `/api/s/${token}`, undefined, { auth: false })).data.care_blocks.length, 1);
});

test('replacing links invalidates the old ones; delete removes everything', async () => {
  const { call, signIn } = setup();
  await signIn();
  const id = (await call('POST', '/api/director/registries', sampleRegistry())).data.id;
  const links1 = (await call('GET', `/api/director/registries/${id}`)).data.links;
  const oldToken = links1.public.split('/s/')[1];

  assert.equal((await call('PATCH', `/api/director/registries/${id}`, { action: 'replace_links' })).status, 200);
  assert.equal((await call('GET', `/api/s/${oldToken}`, undefined, { auth: false })).status, 404);
  const links2 = (await call('GET', `/api/director/registries/${id}`)).data.links;
  assert.notEqual(links2.public, links1.public);
  assert.equal((await call('GET', `/api/s/${links2.public.split('/s/')[1]}`, undefined, { auth: false })).data.open, true);

  assert.equal((await call('DELETE', `/api/director/registries/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/director/registries/${id}`)).status, 404);
});
