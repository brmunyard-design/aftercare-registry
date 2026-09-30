// Small helpers shared by every page. Everything that shows user-entered text goes through
// textContent (via h()), never innerHTML.
(function () {
  'use strict';
  const AR = (window.AR = {});

  // h('div', { class: 'x', onclick: fn }, 'text', childNode, [more children])
  AR.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  AR.clear = function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };

  AR.api = async function api(path, options = {}) {
    const { method = 'GET', body } = options;
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* not JSON */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong. Try again.');
      err.status = res.status;
      throw err;
    }
    return data;
  };

  // '2026-10-08' -> 'Thursday 8 October 2026'
  AR.date = function date(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  };

  AR.money = (cents) => (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

  AR.copy = async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      return false;
    }
  };

  // /s/<token> and /c/<token>
  AR.tokenFromPath = () => decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');

  // A copy button that says what happened, then goes back.
  AR.copyButton = function copyButton(label, getValue, className = 'btn quiet small') {
    const button = AR.h('button', { type: 'button', class: className }, label);
    button.addEventListener('click', async () => {
      const ok = await AR.copy(getValue());
      button.textContent = ok ? 'Copied' : 'Select and copy it by hand';
      setTimeout(() => { button.textContent = label; }, 2200);
    });
    return button;
  };

  AR.field = (function () {
    let n = 0;
    return function field(label, control, hint) {
      const id = `f${++n}`;
      control.id = id;
      const wrap = AR.h('div', { class: 'field' }, AR.h('label', { for: id }, label), control);
      if (hint) {
        control.setAttribute('aria-describedby', `${id}-hint`);
        wrap.append(AR.h('p', { class: 'hint', id: `${id}-hint` }, hint));
      }
      return wrap;
    };
  })();
})();
