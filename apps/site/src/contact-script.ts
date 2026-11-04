import { CONTACT_TIMEOUT_MS, siteContactUrl } from './load-contact.js';

/** Serializa um texto como literal JS seguro dentro de `<script>`. */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * Texto do script inline da página inicial: busca o contato na rota pública (até 3 s) e troca os
 * cinco pontos `data-contact` só se a resposta for válida. Sem resposta, o HTML do build fica como
 * está. Valores da API entram só por `textContent`/`setAttribute`, nunca como HTML, e os links do
 * WhatsApp e do e-mail são montados aqui a partir dos valores já validados.
 */
export function contactScript(apiUrl: string): string {
  return `(function () {
  'use strict';
  if (typeof fetch !== 'function') return;
  var url = ${jsString(siteContactUrl(apiUrl))};
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () {
    if (controller) controller.abort();
  }, ${CONTACT_TIMEOUT_MS});
  // Mesmo formato do z.email() do Zod 4: aceita ' + _ - . no começo e recusa ? & # % < > " e espaço.
  var EMAIL_PATTERN = /^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$/;
  function isText(value, max) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
  }
  function valid(data) {
    return (
      !!data &&
      typeof data === 'object' &&
      typeof data.whatsapp === 'string' &&
      /^\\+55[1-9]{2}9[0-9]{8}$/.test(data.whatsapp) &&
      isText(data.email, 254) &&
      EMAIL_PATTERN.test(data.email.trim()) &&
      isText(data.responseNote, 60)
    );
  }
  function set(name, apply) {
    var nodes = document.querySelectorAll('[data-contact="' + name + '"]');
    for (var i = 0; i < nodes.length; i++) apply(nodes[i]);
  }
  function update(data) {
    if (!valid(data)) return;
    var digits = data.whatsapp.slice(3);
    var label = '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
    var email = data.email.trim().toLowerCase();
    var note = data.responseNote.trim();
    set('whatsapp-link', function (el) {
      el.setAttribute('href', 'https://wa.me/' + data.whatsapp.slice(1));
    });
    set('whatsapp-label', function (el) {
      el.textContent = label;
    });
    set('response-note', function (el) {
      el.textContent = note;
    });
    set('email-link', function (el) {
      el.setAttribute('href', 'mailto:' + encodeURI(email));
    });
    set('email-label', function (el) {
      el.textContent = email;
    });
  }
  try {
    fetch(url, { signal: controller ? controller.signal : undefined, headers: { accept: 'application/json' } })
      .then(function (response) {
        return response && response.ok ? response.json() : null;
      })
      .then(update)
      .catch(function () {})
      .then(function () {
        clearTimeout(timer);
      });
  } catch (error) {
    clearTimeout(timer);
  }
})();`;
}
