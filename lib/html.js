'use strict';

// Plantillas HTML con escape automático.
// Todo valor interpolado se escapa salvo que vaya envuelto en raw() o sea
// el resultado de otra plantilla html``.

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1];
  }
  return new SafeHtml(out);
}

function raw(value) {
  return new SafeHtml(String(value));
}

module.exports = { html, raw, escapeHtml, SafeHtml };
