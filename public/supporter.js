// A helper's private link: /s/<token>
(function () {
  'use strict';
  const { h, api, clear, date, field, copyButton } = window.AR;
  const app = document.getElementById('app');
  const token = window.AR.tokenFromPath();

  const STATUS_NOTE = {
    pending: 'Someone has offered to help with this — waiting on confirmation.',
    approved: 'This is being taken care of.',
    completed: 'Done — thank you to whoever helped with this.',
    fallback: 'This is being arranged another way.',
  };

  function footer() {
    return h('p', { class: 'fine' }, 'Private pilot · fictional family details only. ', h('a', { href: '/privacy' }, 'Privacy & safety'));
  }

  function problem(title, body) {
    clear(app).append(h('h1', null, title), h('p', null, body), footer());
  }

  function renderRegistry(data) {
    clear(app);
    const { family, care_blocks } = data;
    app.append(h('p', { class: 'kicker' }, 'Aftercare Registry'), h('h1', null, family.display_name));
    if (family.area) app.append(h('p', { class: 'subtle' }, family.area));
    if (family.welcome_message) app.append(h('p', { class: 'lede plain' }, family.welcome_message));
    if (family.boundaries) {
      app.append(h('div', { class: 'boundaries' }, h('h2', null, 'What is safe to share'), h('p', { class: 'plain' }, family.boundaries)));
    }
    if (data.registry_status === 'completed') {
      app.append(h('p', { class: 'notice' }, 'This family’s support period has wrapped up. Thank you for being willing to help.'));
    }

    app.append(h('h2', null, 'How you can help'));
    if (!care_blocks.length) {
      app.append(h('p', { class: 'empty' }, 'Nothing has been listed yet. Check back soon, or ask the coordinator who shared this link.'));
    }
    for (const block of care_blocks) app.append(renderBlock(block, data.registry_status === 'active'));
    app.append(footer());
  }

  function renderBlock(block, canOffer) {
    const card = h('section', { class: 'task' });
    const when = h('div', { class: 'when' });
    if (block.target_date) when.append(h('span', null, date(block.target_date)));
    when.append(h('span', { class: `pill ${block.status}` }, block.status === 'available' ? 'Still needed' : { pending: 'Offered', approved: 'Arranged', completed: 'Done', fallback: 'Arranged' }[block.status]));
    card.append(h('h3', null, block.title), when);
    if (block.description) card.append(h('p', { class: 'plain' }, block.description));

    if (block.status === 'available' && canOffer) {
      const slot = h('div');
      const open = h('button', { type: 'button', class: 'btn' }, 'I can help with this');
      open.addEventListener('click', () => {
        open.hidden = true;
        slot.append(renderForm(block, () => { open.hidden = false; clear(slot); }));
        const first = slot.querySelector('input');
        if (first) first.focus();
      });
      card.append(open, slot);
    } else if (block.status !== 'available' && STATUS_NOTE[block.status]) {
      card.append(h('p', { class: 'subtle' }, STATUS_NOTE[block.status]));
    }
    return card;
  }

  function renderForm(block, onCancel) {
    const name = h('input', { type: 'text', autocomplete: 'name', maxlength: 80, required: true });
    const phone = h('input', { type: 'tel', autocomplete: 'tel', maxlength: 40, required: true });
    const email = h('input', { type: 'email', autocomplete: 'email', maxlength: 120 });
    const when = h('input', { type: 'date' });
    if (block.target_date) when.value = block.target_date;
    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn' }, 'Offer to help');

    const form = h('form', { class: 'form', novalidate: true },
      field('Your name', name),
      field('Mobile number', phone, 'Only the coordinator can see this. It is used to confirm the details of your help.'),
      field('Email (optional)', email),
      field('The day you can help', when, 'The coordinator will confirm this before it’s locked in.'),
      error,
      h('div', { class: 'actions' }, submit, h('button', { type: 'button', class: 'btn quiet', onclick: onCancel }, 'Cancel'))
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      if (!name.value.trim() || !phone.value.trim()) {
        error.textContent = 'Enter your name and a mobile number we can reach you on.';
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      try {
        const result = await api(`/api/s/${encodeURIComponent(token)}/offer`, {
          method: 'POST',
          body: {
            care_block_id: block.id,
            helper_name: name.value,
            helper_phone: phone.value,
            helper_email: email.value,
            proposed_date: when.value || null,
          },
        });
        renderThanks(result, name.value.trim());
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = false;
      }
    });
    return form;
  }

  function renderThanks(result, name) {
    clear(app);
    window.scrollTo(0, 0);
    const code = h('p', { class: 'code' },
      h('span', { 'aria-hidden': 'true' }, result.code),
      h('span', { class: 'visually-hidden' }, result.code.replace('-', ', ').split('').join(' ')));
    app.append(
      h('p', { class: 'kicker' }, 'Aftercare Registry'),
      h('h1', null, `Thank you, ${name}.`),
      h('p', { class: 'lede' }, `Your offer to help with “${result.care_block_title}” is with ${result.family_name}’s coordinator now.`),
      h('div', { class: 'code-plate' }, h('p', { class: 'label' }, 'Your recovery code'), code, copyButton('Copy code', () => result.code)),
      h('p', null, 'Keep this code. To find or change your offer later, enter it on the “Find my commitment” page with the phone number or email you just gave.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: new URL(result.commitment_link).pathname }, 'View my offer'),
        copyButton('Copy my link', () => result.commitment_link)
      ),
      h('p', { class: 'fine' }, 'Anyone with your link can see and change this offer, so keep it to yourself.'),
      footer()
    );
  }

  api(`/api/s/${encodeURIComponent(token)}`)
    .then((data) => {
      if (!data.open) return problem('This registry isn’t open right now', 'Ask the coordinator who shared this link for an update.');
      renderRegistry(data);
    })
    .catch(() => problem('This link isn’t working', 'Check that you copied the whole link, or ask the coordinator who shared it to send a new one.'));
})();
