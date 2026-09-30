(function () {
  'use strict';
  const { api } = window.AR;
  const form = document.getElementById('recover');
  const msg = document.getElementById('msg');
  const button = form.querySelector('button');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    msg.hidden = true;
    const contact = form.elements.contact.value.trim();
    const code = form.elements.code.value.trim();
    if (!contact || !code) {
      msg.textContent = 'Enter the phone number or email you used, and your recovery code.';
      msg.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      const { link } = await api('/api/recover', { method: 'POST', body: { contact, code } });
      location.assign(link);
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
      button.disabled = false;
    }
  });
})();
