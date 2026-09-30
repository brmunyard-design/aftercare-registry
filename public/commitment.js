// A helper's own offer link: /c/<token>
(function () {
  'use strict';
  const { h, api, clear, date } = window.AR;
  const app = document.getElementById('app');
  const token = window.AR.tokenFromPath();
  const url = `/api/c/${encodeURIComponent(token)}`;

  const STATUS = {
    pending: 'Waiting on the coordinator',
    approved: 'Confirmed',
    completed: 'Done',
    declined: 'Not needed after all',
    withdrawn: 'Withdrawn',
  };

  function problem(title, body) {
    clear(app).append(h('h1', null, title), h('p', null, body), h('p', { class: 'actions' }, h('a', { href: '/recover' }, 'Find my commitment')));
  }

  function render(c) {
    clear(app);
    app.append(
      h('p', { class: 'kicker' }, `Offer for ${c.family_name}`),
      h('h1', null, c.care_block.title),
      h('p', null, h('span', { class: `pill ${c.status}` }, STATUS[c.status] || c.status))
    );
    if (c.care_block.description) app.append(h('p', { class: 'plain' }, c.care_block.description));

    const facts = h('dl', { class: 'facts' });
    facts.append(h('dt', null, 'Offered by'), h('dd', null, c.helper_name));
    if (c.area) facts.append(h('dt', null, 'Area'), h('dd', null, c.area));
    if (c.status === 'approved' || c.status === 'completed') {
      facts.append(h('dt', null, 'Confirmed day'), h('dd', null, c.confirmed_date ? date(c.confirmed_date) : 'Not set yet'));
    } else {
      facts.append(h('dt', null, 'Your proposed day'), h('dd', null, c.proposed_date ? date(c.proposed_date) : 'Not set yet'));
    }
    app.append(facts);

    if (c.status === 'pending') app.append(h('p', { class: 'notice' }, 'The coordinator will confirm this before it’s locked in. You can still change your proposed day below.'));
    if (c.status === 'approved') app.append(h('p', { class: 'notice' }, 'This is confirmed. If you need to change the day, please contact the coordinator directly.'));
    if (c.status === 'completed') app.append(h('p', { class: 'notice' }, 'The coordinator has marked this as done. Thank you for helping.'));
    if (c.status === 'declined') app.append(h('p', { class: 'notice' }, 'This one wasn’t needed after all — thank you for offering. Have a look for something else on the registry.'));
    if (c.status === 'withdrawn') app.append(h('p', { class: 'notice' }, 'You withdrew this offer. Thank you for letting us know.'));
    if (c.status !== 'declined' && c.status !== 'withdrawn' && !c.registry_open) {
      app.append(h('p', { class: 'notice' }, 'This registry is not open right now, so this offer can’t be changed here. Contact the coordinator if something has changed.'));
    }

    if (c.can_edit_date || c.can_withdraw) app.append(controls(c));
    app.append(h('p', { class: 'fine' }, 'Private pilot · fictional family details only. ', h('a', { href: '/privacy' }, 'Privacy & safety')));
  }

  function controls(c) {
    const wrap = h('section', { class: 'block' });
    const error = h('p', { class: 'error', role: 'alert', hidden: true });

    const act = async (body, button) => {
      error.hidden = true;
      button.disabled = true;
      try {
        await api(url, { method: 'POST', body });
        render(await api(url));
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
      }
    };

    wrap.append(h('h2', null, 'Need to change something?'), error);

    if (c.can_edit_date) {
      const when = h('input', { type: 'date', id: 'when' });
      if (c.proposed_date) when.value = c.proposed_date;
      const save = h('button', { type: 'button', class: 'btn' }, 'Save new day');
      save.addEventListener('click', () => {
        if (!when.value) {
          error.textContent = 'Choose the day you can help.';
          error.hidden = false;
          return;
        }
        act({ action: 'update', proposed_date: when.value }, save);
      });
      wrap.append(h('div', { class: 'field' }, h('label', { for: 'when' }, 'Your proposed day'), when), h('div', { class: 'actions' }, save));
    }

    if (c.can_withdraw) {
      const withdraw = h('button', { type: 'button', class: 'btn danger' }, 'Withdraw my offer');
      withdraw.addEventListener('click', () => {
        if (confirm('Withdraw your offer? It will go back to being needed.')) act({ action: 'withdraw' }, withdraw);
      });
      wrap.append(h('div', { class: 'actions' }, withdraw));
    }
    return wrap;
  }

  api(url).then(render).catch(() => problem('This link isn’t working', 'Check that you copied the whole link, or use your phone number or email and recovery code to find your offer again.'));
})();
