// Coordinator area: /director
// Sign in with the pilot PIN. Dashboard summarises Care Blocks across every registry; each
// registry's own page is where a coordinator sets it up, shares its links, and works the
// approve / decline / fallback / complete lifecycle for its Care Blocks.
(function () {
  'use strict';
  const { h, api, clear, date, field, copyButton } = window.AR;
  const app = document.getElementById('app');
  let signedIn = false;

  const REGISTRY_STATUS = { draft: 'Draft', active: 'Active', completed: 'Completed', archived: 'Archived' };
  const BLOCK_STATUS = { available: 'Still needed', pending: 'Pending', approved: 'Approved', completed: 'Completed', fallback: 'Fallback', closed: 'Closed' };
  const OFFER_STATUS = { pending: 'Pending', approved: 'Approved', completed: 'Completed', declined: 'Declined', withdrawn: 'Withdrawn' };
  const VISIBILITY = { public: 'Public notice', trusted: 'Trusted circle' };

  // ---------- plumbing ----------

  async function call(path, options) {
    try {
      return await api(path, options);
    } catch (err) {
      if (err.status === 401 && signedIn) showLogin('Your session has ended. Sign in again.');
      throw err;
    }
  }

  async function show(view) {
    try {
      await view();
    } catch (err) {
      if (!signedIn) return;
      frame(
        h('h1', null, 'Something went wrong'),
        h('p', { class: 'error', role: 'alert' }, err.message),
        h('p', { class: 'actions' }, h('a', { class: 'btn quiet', href: '#/' }, 'Back to dashboard'))
      );
    }
  }

  function frame(...content) {
    clear(app).append(
      h('header', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' }, 'Aftercare Registry'),
        h('nav', { 'aria-label': 'Coordinator' },
          h('a', { href: '#/' }, 'Dashboard'),
          h('a', { href: '#/registries' }, 'Family registries'),
          h('a', { class: 'btn small', href: '#/new' }, 'Create a registry'),
          h('button', { type: 'button', class: 'btn quiet small', onclick: signOut }, 'Sign out'))),
      ...content
    );
  }

  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const detail = /^\/r\/([\w-]+)$/.exec(hash);
    const list = /^\/blocks\/(available|claimed|completed)$/.exec(hash);
    if (hash === '/new') return show(viewNew);
    if (hash === '/registries') return show(viewRegistries);
    if (detail) return show(() => viewDetail(detail[1]));
    if (list) return show(() => viewBlockList(list[1]));
    return show(viewDashboard);
  }

  function iso(offsetDays) {
    return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  }
  function addDays(isoDate, n) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // QR codes come from the qrcode-generator library (public/vendor/qrcode.js). If it isn't there, skip QR.
  function qrCanvas(value) {
    if (typeof window.qrcode !== 'function') return null;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const modules = qr.getModuleCount();
      const cell = 6;
      const margin = 4;
      const size = (modules + margin * 2) * cell;
      const canvas = h('canvas', { class: 'qr', width: size, height: size, role: 'img', 'aria-label': 'QR code for this link' });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (let row = 0; row < modules; row++) {
        for (let col = 0; col < modules; col++) {
          if (qr.isDark(row, col)) ctx.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
        }
      }
      return canvas;
    } catch (_) {
      return null;
    }
  }

  // ---------- sign in ----------

  function showLogin(message) {
    signedIn = false;
    const pin = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'error', role: 'alert', hidden: !message }, message || '');
    const submit = h('button', { type: 'submit', class: 'btn' }, 'Sign in');
    const form = h('form', { novalidate: true }, field('Pilot PIN', pin), error, h('div', { class: 'actions' }, submit, h('a', { href: '/' }, 'Back')));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        await api('/api/director/login', { method: 'POST', body: { pin: pin.value } });
        signedIn = true;
        route();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = false;
        pin.select();
      }
    });
    clear(app).append(
      h('p', { class: 'kicker' }, 'Aftercare Registry pilot'),
      h('h1', null, 'Coordinator sign in'),
      h('p', null, 'Enter the pilot PIN to set up and manage a family’s registry.'),
      form
    );
    pin.focus();
  }

  async function signOut() {
    try {
      await api('/api/director/logout', { method: 'POST' });
    } catch (_) { /* the cookie expires on its own */ }
    showLogin();
  }

  // ---------- dashboard ----------

  async function viewDashboard() {
    const { counts, help_needed, claimed, completed } = await call('/api/director/dashboard');

    function statCard(count, label, hash) {
      return h('a', { class: 'stat-card', href: hash },
        h('span', { class: 'stat-n' }, String(count)),
        h('span', { class: 'stat-label' }, label));
    }

    frame(
      h('div', { class: 'page-head' }, h('h1', null, 'Dashboard')),
      h('div', { class: 'stat-grid' },
        statCard(counts.active_registries, 'Active registries', '#/registries'),
        statCard(counts.help_needed, 'Help still needed', '#/blocks/available'),
        statCard(counts.claimed, 'Tasks claimed', '#/blocks/claimed'),
        statCard(counts.completed, 'Completed', '#/blocks/completed')),
      h('section', { class: 'block' },
        h('h2', null, 'Help still needed'),
        blockPreview(help_needed, 'Nothing outstanding right now.')),
      h('section', { class: 'block' },
        h('h2', null, 'Tasks claimed'),
        blockPreview(claimed, 'Nothing awaiting confirmation right now.'))
    );
  }

  function blockPreview(items, emptyText) {
    if (!items.length) return h('p', { class: 'empty' }, emptyText);
    return h('ul', { class: 'block-list' }, items.map((b) =>
      h('li', null,
        h('a', { href: `#/r/${b.registry_id}` }, b.title),
        h('span', { class: 'subtle' }, b.registry_name),
        h('span', { class: `pill ${b.status}` }, BLOCK_STATUS[b.status]))
    ));
  }

  async function viewBlockList(kind) {
    const { help_needed, claimed, completed } = await call('/api/director/dashboard');
    const map = { available: [help_needed, 'Help still needed'], claimed: [claimed, 'Tasks claimed'], completed: [completed, 'Completed'] };
    const [items, title] = map[kind];
    frame(
      h('div', { class: 'page-head' }, h('h1', null, title)),
      items.length
        ? h('ul', { class: 'block-list wide' }, items.map((b) =>
            h('li', null,
              h('a', { href: `#/r/${b.registry_id}` }, b.title),
              h('span', { class: 'subtle' }, b.registry_name),
              b.target_date && h('span', { class: 'subtle' }, date(b.target_date)),
              h('span', { class: `pill ${b.status}` }, BLOCK_STATUS[b.status]))
          ))
        : h('p', { class: 'empty' }, 'Nothing here right now.')
    );
  }

  // ---------- family registries (full list) ----------

  async function viewRegistries() {
    const { registries } = await call('/api/director/registries');
    const content = registries.length
      ? h('ul', { class: 'registry-list' }, registries.map(listRow))
      : h('div', { class: 'empty' },
          h('p', null, 'No registries yet. Start one when a family asks for practical support.'),
          h('a', { class: 'btn', href: '#/new' }, 'Create a registry'));
    frame(h('div', { class: 'page-head' }, h('h1', null, 'Family registries')), content);
  }

  function listRow(r) {
    return h('li', null,
      h('div', null,
        h('a', { class: 'name', href: `#/r/${r.id}` }, r.display_name),
        h('p', { class: 'subtle' }, [r.area, r.coordinator_name ? `Coordinated by ${r.coordinator_name}` : ''].filter(Boolean).join('. '))),
      h('div', { class: 'side' },
        h('span', { class: `pill ${r.status}` }, REGISTRY_STATUS[r.status]),
        h('p', { class: 'subtle' }, `${r.available_count} needed · ${r.claimed_count} claimed · ${r.completed_count} done`),
        r.review_date && h('p', { class: 'subtle' }, `Review by ${date(r.review_date)}`))
    );
  }

  // ---------- intake form ----------

  function viewNew() {
    const f = {};
    const rows = [];
    const input = (name, attrs) => (f[name] = h('input', { type: 'text', ...attrs }));
    const area = (name, attrs) => (f[name] = h('textarea', { rows: 3, ...attrs }));
    const day = (name) => (f[name] = h('input', { type: 'date' }));

    const periodNote = h('p', { class: 'hint' });
    const updatePeriodNote = () => {
      if (!f.support_start.value) { periodNote.textContent = ''; return; }
      const end = f.support_end.value || addDays(f.support_start.value, 90);
      periodNote.textContent = f.support_end.value
        ? `Review date: ${date(addDays(end, 30))}, 30 days after support ends.`
        : `Defaults to a 90-day support period, ending ${date(end)}. Set an end date to override.`;
    };

    const familyFields = h('fieldset', null,
      h('legend', null, 'About the family'),
      h('p', { class: 'legend-note' }, 'Helpers see this. Keep it to what the family is comfortable sharing.'),
      field('Family display name', input('display_name', { maxlength: 120, required: true }), 'The name the family would like helpers to see, for example “The Harlow family”.'),
      field('General area', input('area', { maxlength: 120 }), 'A suburb or region only. Do not add a street address.'),
      field('Welcome message', area('welcome_message', { maxlength: 1200 })),
      field('What is safe to share', area('boundaries', { maxlength: 1200 }), 'For example, when the family is happy to be contacted, or what to avoid.')
    );

    const staffFields = h('fieldset', null,
      h('legend', null, 'Kept private'),
      h('p', { class: 'legend-note' }, 'Only signed-in coordinators see these details. Helpers never do.'),
      field('Family contact', input('family_contact', { maxlength: 300 }), 'Who to contact in the family, and how.'),
      field('Home address', input('home_address', { maxlength: 300 })),
      field('Case reference', input('case_reference', { maxlength: 120 })),
      field('Dietary details', area('dietary_details', { maxlength: 600, rows: 2 })),
      field('Access notes', area('access_notes', { maxlength: 600, rows: 2 }), 'Gates, pets, parking, best times for drop-offs.')
    );

    const periodFields = h('fieldset', null,
      h('legend', null, 'Support period and handling'),
      h('div', { class: 'row two' },
        field('Support starts', day('support_start')),
        field('Support ends', day('support_end'), 'Leave blank for the standard 90-day period.')
      ),
      periodNote,
      field('Coordinator handling this family', input('coordinator_name', { maxlength: 120, required: true }))
    );
    f.support_start.addEventListener('change', updatePeriodNote);
    f.support_end.addEventListener('change', updatePeriodNote);

    const blockHost = h('div');
    function addRow(values = {}) {
      const title = h('input', { type: 'text', maxlength: 120 });
      const description = h('textarea', { rows: 2, maxlength: 600 });
      const when = h('input', { type: 'date' });
      const visibility = h('select', null,
        h('option', { value: 'trusted' }, 'Trusted circle only'),
        h('option', { value: 'public' }, 'Public notice link too'));
      title.value = values.title || '';
      description.value = values.description || '';
      when.value = values.target_date || '';
      visibility.value = values.visibility || 'trusted';
      const row = { title, description, when, visibility, el: null };
      row.el = h('div', { class: 'task-row' },
        field('What is needed', title),
        field('Details', description, 'Describe the job, not the family. Do not add health details, access codes or children’s names.'),
        h('div', { class: 'row two' },
          field('Target day (optional)', when),
          field('Who can see it', visibility)),
        h('p', null, h('button', {
          type: 'button', class: 'btn quiet small',
          onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); },
        }, 'Remove this Care Block'))
      );
      rows.push(row);
      blockHost.append(row.el);
    }
    addRow();

    const blockFields = h('fieldset', null,
      h('legend', null, 'Care Blocks — what help is needed'),
      h('p', { class: 'legend-note' }, 'Each Care Block is one specific, practical thing — a meal, a lift, a lawn mow. Trusted-circle blocks only appear on the trusted-circle link; public-notice blocks appear on both.'),
      blockHost,
      h('button', { type: 'button', class: 'btn quiet', onclick: () => addRow() }, 'Add another Care Block')
    );

    const consent = h('input', { type: 'checkbox', id: 'consent' });
    const consentFields = h('fieldset', null,
      h('legend', null, 'Family consent'),
      h('div', { class: 'check' },
        consent,
        h('label', { for: 'consent' }, 'The family has agreed to this registry being set up, and to helper contact details being used only to coordinate the help offered.')),
      h('p', { class: 'hint' }, 'Ticking this makes the registry live straight away. Leave it unticked to save a draft that helpers cannot see.')
    );

    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn' }, 'Create registry');
    const form = h('form', { novalidate: true }, familyFields, staffFields, periodFields, blockFields, consentFields, error, h('div', { class: 'actions' }, submit, h('a', { href: '#/' }, 'Cancel')));

    function fillExample() {
      f.display_name.value = 'The Harlow family';
      f.area.value = 'Northern suburbs';
      f.welcome_message.value = 'Thank you for wanting to help. Small, practical things make the biggest difference to us right now. Please choose one below.';
      f.boundaries.value = 'Please don’t phone the house. Drop-offs are best left on the front porch between 4 and 6 pm.';
      f.family_contact.value = 'Pat Harlow, 0400 000 000';
      f.home_address.value = '12 Example Street';
      f.case_reference.value = 'DEMO-0001';
      f.dietary_details.value = 'Vegetarian household. No nuts.';
      f.access_notes.value = 'Side gate is unlocked. The dog is friendly.';
      f.support_start.value = iso(0);
      f.coordinator_name.value = 'Jordan Lee';
      updatePeriodNote();
      for (const r of rows.splice(0)) r.el.remove();
      addRow({ title: 'Dinner for the family', description: 'A simple meal that freezes well. Vegetarian, no nuts.', target_date: iso(3), visibility: 'public' });
      addRow({ title: 'Lawn and garden tidy', description: 'Front and back lawns, about an hour.', target_date: iso(5), visibility: 'trusted' });
      addRow({ title: 'A lift to the service', description: 'Two adults need a lift from the north side of town.', target_date: iso(9), visibility: 'trusted' });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      const body = { consent: consent.checked };
      for (const name of Object.keys(f)) body[name] = f[name].value;
      body.care_blocks = rows.map((r) => ({
        title: r.title.value, description: r.description.value, target_date: r.when.value || null, visibility: r.visibility.value,
      }));
      if (!body.display_name.trim() || !body.coordinator_name.trim()) {
        error.textContent = 'Enter the family display name and the coordinator handling this family.';
        error.hidden = false;
        (body.display_name.trim() ? f.coordinator_name : f.display_name).focus();
        return;
      }
      submit.disabled = true;
      try {
        const { id } = await call('/api/director/registries', { method: 'POST', body });
        location.hash = `#/r/${id}`;
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = false;
      }
    });

    frame(
      h('div', { class: 'page-head' }, h('h1', null, 'Create a registry')),
      h('p', { class: 'lede' }, 'Record what the family has asked for. Helpers get a private link or QR code and choose a Care Block themselves.'),
      h('p', null, h('button', { type: 'button', class: 'btn quiet small', onclick: fillExample }, 'Fill with a fictional example')),
      form
    );
    f.display_name.focus();
  }

  // ---------- registry detail ----------

  async function viewDetail(id) {
    const { registry: r, care_blocks, links } = await call(`/api/director/registries/${id}`);
    const slug = r.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'registry';
    const banner = h('p', { class: 'error', role: 'alert', hidden: true });

    const fail = (err) => {
      if (err.status === 401) return;
      banner.textContent = err.message;
      banner.hidden = false;
      window.scrollTo(0, 0);
    };
    const reload = async () => {
      const y = window.scrollY;
      await show(() => viewDetail(id));
      window.scrollTo(0, y);
    };
    async function run(path, options, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      banner.hidden = true;
      try {
        await call(path, options);
        await reload();
      } catch (err) {
        fail(err);
      }
    }
    const patchRegistry = (body, confirmText) => run(`/api/director/registries/${id}`, { method: 'PATCH', body }, confirmText);
    const patchBlock = (blockId, body, confirmText) => run(`/api/director/care-blocks/${blockId}`, { method: 'PATCH', body }, confirmText);

    // ---- registry status controls ----
    let status;
    if (r.status === 'draft') {
      const box = h('input', { type: 'checkbox', id: 'consent-now' });
      const activate = h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => patchRegistry({ action: 'activate', consent: true }) }, 'Record consent and activate');
      box.addEventListener('change', () => { activate.disabled = !box.checked; });
      status = h('div', { class: 'notice' },
        h('p', null, 'This registry is a draft. Helpers can’t see anything until the family’s consent is recorded.'),
        h('div', { class: 'check' }, box, h('label', { for: 'consent-now' }, 'The family has agreed to this registry, and to helper contact details being used only to coordinate the help offered.')),
        activate);
    } else if (r.status === 'active') {
      status = h('div', { class: 'block' },
        h('p', { class: 'subtle' }, 'Helpers can see this registry through its links.'),
        h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchRegistry({ action: 'complete' }, 'Mark this registry complete? Helpers will no longer be able to make new offers. You can still work existing Care Blocks, and reopen it later if needed.') }, 'Mark support complete'));
    } else if (r.status === 'completed') {
      status = h('div', { class: 'block' },
        h('p', { class: 'subtle' }, 'Support is marked complete. Helpers see this registry as wrapped up and can’t make new offers.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchRegistry({ action: 'reopen' }) }, 'Reopen'),
          h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchRegistry({ action: 'archive' }, 'Archive this registry? It will drop off the active dashboard. Its record stays intact and can still be exported.') }, 'Archive')));
    } else {
      status = h('p', { class: 'subtle' }, 'This registry is archived. It’s read-only and no longer shown on the dashboard.');
    }

    // ---- share links ----
    function linkBlock(title, hint, url) {
      const box = h('input', { type: 'text', readonly: true, value: url, 'aria-label': `${title} link` });
      box.addEventListener('focus', () => box.select());
      const qr = qrCanvas(url);
      return h('div', { class: 'field' },
        h('h3', null, title),
        h('p', { class: 'hint' }, hint),
        h('div', { class: 'link-row' }, box, copyButton('Copy link', () => url)),
        qr && h('div', null, qr, h('p', null, h('a', { class: 'btn quiet small', href: qr.toDataURL('image/png'), download: `aftercare-registry-${slug}-${title.toLowerCase().split(' ')[0]}.png` }, 'Save QR image')))
      );
    }
    const share = h('section', { class: 'block' },
      h('h2', null, 'Share'),
      r.status !== 'active' && h('p', { class: 'hint' }, 'These links only show live Care Blocks while the registry is active.'),
      linkBlock('Trusted circle', 'For people the family knows. Shows every Care Block.', links.trusted),
      linkBlock('Public notice', 'For a notice or online post. Shows public-notice Care Blocks only.', links.public),
      h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchRegistry({ action: 'replace_links' }, 'Replace both links? The old links and QR codes stop working straight away, so anything already printed or sent will need replacing.') }, 'Replace both links')
    );

    // ---- Care Blocks ----
    function offerCard(o) {
      return h('div', { class: 'helper' },
        h('div', { class: 'top' }, h('strong', null, o.helper_name), h('span', { class: `pill ${o.status}` }, OFFER_STATUS[o.status])),
        h('p', null, `Phone ${o.helper_phone}`),
        o.helper_email && h('p', null, `Email ${o.helper_email}`),
        o.proposed_date && h('p', null, `Proposed ${date(o.proposed_date)}`),
        o.confirmed_date && h('p', null, `Confirmed ${date(o.confirmed_date)}`)
      );
    }

    function blockActions(b) {
      const live = b.offers.find((o) => o.status === 'pending' || o.status === 'approved');
      const wrap = h('div', { class: 'actions' });

      if (b.status === 'pending' && live) {
        const when = h('input', { type: 'date', value: live.proposed_date || '' });
        const approve = h('button', { type: 'button', class: 'btn small' }, 'Approve');
        approve.addEventListener('click', () => patchBlock(b.id, { action: 'approve', confirmed_date: when.value || undefined }));
        wrap.append(h('span', { class: 'inline-field' }, h('label', null, 'Confirm for '), when), approve,
          h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchBlock(b.id, { action: 'decline' }, `Decline ${live.helper_name}’s offer? The Care Block goes back to needing help.`) }, 'Decline'));
      } else if (b.status === 'approved' && live) {
        wrap.append(
          h('button', { type: 'button', class: 'btn small', onclick: () => patchBlock(b.id, { action: 'complete' }) }, 'Mark complete'),
          h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchBlock(b.id, { action: 'decline' }, `Stand down ${live.helper_name}’s confirmed help? The Care Block goes back to needing help.`) }, 'Cancel arrangement'));
      } else if (b.status === 'available') {
        wrap.append(h('button', { type: 'button', class: 'btn quiet small', onclick: () => openFallback(b) }, 'Move to professional/community fallback'));
      } else if (b.status === 'fallback') {
        wrap.append(
          h('button', { type: 'button', class: 'btn small', onclick: () => patchBlock(b.id, { action: 'complete' }) }, 'Mark complete'),
          h('button', { type: 'button', class: 'btn quiet small', onclick: () => openFallback(b, true) }, 'Edit fallback details'),
          h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchBlock(b.id, { action: 'reopen' }) }, 'Back to needing help'));
      } else if (b.status === 'closed') {
        wrap.append(h('button', { type: 'button', class: 'btn quiet small', onclick: () => patchBlock(b.id, { action: 'reopen' }) }, 'Reopen'));
      }

      if (['available', 'closed'].includes(b.status)) {
        wrap.append(h('button', {
          type: 'button', class: 'btn quiet small',
          onclick: () => patchBlock(b.id, { action: 'close' }, `Mark “${b.title}” as no longer needed?`),
        }, 'No longer needed'));
      }
      return wrap;
    }

    function openFallback(b, editing) {
      const host = document.getElementById(`fallback-${b.id}`);
      const provider = h('input', { type: 'text', maxlength: 200, placeholder: 'e.g. Rotary Midland, Jim’s Mowing' });
      provider.value = b.fallback_provider || '';
      const notes = h('textarea', { rows: 2, maxlength: 600 });
      notes.value = b.fallback_notes || '';
      const save = h('button', { type: 'button', class: 'btn small' }, editing ? 'Save' : 'Move to fallback');
      save.addEventListener('click', () => patchBlock(b.id, { action: editing ? 'update_fallback' : 'fallback', fallback_provider: provider.value, fallback_notes: notes.value }));
      clear(host).append(
        field('Who is arranging this', provider),
        field('Notes', notes),
        h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'btn quiet small', onclick: () => clear(host) }, 'Cancel'))
      );
    }

    function blockCard(b) {
      const history = b.offers.length > 1 ? h('details', null, h('summary', null, `History (${b.offers.length} offers)`), b.offers.slice().reverse().map(offerCard)) : null;
      const liveOffer = b.offers.find((o) => o.status === 'pending' || o.status === 'approved');
      const completedOffer = b.status === 'completed' ? b.offers.slice().reverse().find((o) => o.status === 'completed') : null;
      return h('article', { class: 'director-task' },
        h('header', null, h('h3', null, b.title), h('span', { class: 'pill' }, VISIBILITY[b.visibility]), h('span', { class: `pill ${b.status}` }, BLOCK_STATUS[b.status])),
        b.target_date && h('p', { class: 'subtle' }, `Target day ${date(b.target_date)}`),
        b.description && h('p', { class: 'plain' }, b.description),
        liveOffer && offerCard(liveOffer),
        b.status === 'fallback' && h('p', { class: 'subtle' }, [b.fallback_provider, b.fallback_notes].filter(Boolean).join(' — ') || 'No fallback details recorded yet.'),
        completedOffer && offerCard(completedOffer),
        blockActions(b),
        b.status === 'available' && h('div', { id: `fallback-${b.id}` }),
        b.status === 'fallback' && h('div', { id: `fallback-${b.id}` }),
        history,
        h('p', null, h('button', { type: 'button', class: 'btn danger small', onclick: () => run(`/api/director/care-blocks/${b.id}`, { method: 'DELETE' }, `Remove “${b.title}” and all its history? This can’t be undone.`) }, 'Remove Care Block'))
      );
    }

    function addBlockForm() {
      const title = h('input', { type: 'text', maxlength: 120 });
      const description = h('textarea', { rows: 2, maxlength: 600 });
      const when = h('input', { type: 'date' });
      const visibility = h('select', null, h('option', { value: 'trusted' }, 'Trusted circle only'), h('option', { value: 'public' }, 'Public notice link too'));
      const add = h('button', { type: 'submit', class: 'btn' }, 'Add Care Block');
      const form = h('form', { novalidate: true },
        h('h3', null, 'Add a Care Block'),
        field('What is needed', title),
        field('Details', description),
        h('div', { class: 'row two' }, field('Target day (optional)', when), field('Who can see it', visibility)),
        add
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!title.value.trim()) return fail(new Error('Enter what is needed.'));
        await run(`/api/director/registries/${id}/care-blocks`, {
          method: 'POST',
          body: { title: title.value, description: description.value, target_date: when.value || null, visibility: visibility.value },
        });
      });
      return form;
    }

    const work = h('section', { class: 'block' },
      h('h2', null, 'Care Blocks'),
      care_blocks.length ? care_blocks.map(blockCard) : h('p', { class: 'empty' }, 'No Care Blocks yet. Add the first one below.'),
      addBlockForm()
    );

    // ---- kept-private details ----
    const fact = (label, value) => [h('dt', null, label), h('dd', null, value || h('span', { class: 'subtle' }, 'Not recorded'))];
    const period = r.support_start || r.support_end ? `${r.support_start ? date(r.support_start) : '…'} to ${r.support_end ? date(r.support_end) : '…'}` : '';
    const details = h('section', { class: 'block' },
      h('h2', null, 'Kept private'),
      h('dl', { class: 'facts' },
        fact('Coordinator', r.coordinator_name),
        fact('Family contact', r.family_contact),
        fact('Home address', r.home_address),
        fact('Case reference', r.case_reference),
        fact('Dietary details', r.dietary_details),
        fact('Access notes', r.access_notes),
        fact('Support period', period),
        fact('Review date', r.review_date ? date(r.review_date) : ''),
        fact('Consent recorded', r.consent_recorded_at ? new Date(r.consent_recorded_at).toLocaleString('en-AU') : '')
      )
    );

    // ---- record and deletion ----
    const confirmBox = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    const del = h('button', { type: 'button', class: 'btn danger', disabled: true, onclick: () => deleteRegistry() }, 'Delete permanently');
    confirmBox.addEventListener('input', () => { del.disabled = confirmBox.value.trim() !== r.display_name; });
    async function deleteRegistry() {
      banner.hidden = true;
      try {
        await call(`/api/director/registries/${id}`, { method: 'DELETE' });
        location.hash = '#/registries';
      } catch (err) {
        fail(err);
      }
    }
    const record = h('section', { class: 'block' },
      h('h2', null, 'Record'),
      h('p', null, 'Download everything held about this registry. Helper contact details are included, so store the file carefully.'),
      h('p', null, h('a', { class: 'btn quiet', href: `/api/director/registries/${id}/export`, download: '' }, 'Download record')),
      h('h3', null, 'Delete this registry'),
      h('p', null, 'This permanently removes the registry, its Care Blocks and every offer made. It can’t be undone.'),
      field('Type the family display name to confirm', confirmBox, r.display_name),
      del
    );

    frame(
      h('div', { class: 'page-head' }, h('h1', null, r.display_name), h('span', { class: `pill ${r.status}` }, REGISTRY_STATUS[r.status])),
      h('p', { class: 'subtle' }, [r.area, r.coordinator_name ? `Coordinated by ${r.coordinator_name}` : ''].filter(Boolean).join('. ')),
      banner,
      status,
      h('div', { class: 'split' }, h('div', null, work), h('div', null, share, details, record))
    );
  }

  // ---------- start ----------

  window.addEventListener('hashchange', () => { if (signedIn) route(); });

  api('/api/director/session')
    .then((s) => { if (s.signedIn) { signedIn = true; route(); } else showLogin(); })
    .catch((err) => { clear(app).append(h('h1', null, 'Something went wrong'), h('p', { class: 'error', role: 'alert' }, err.message)); });
})();
