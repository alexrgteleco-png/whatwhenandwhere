'use strict';

const crypto = require('crypto');

// Protección CSRF: un token por sesión que cada formulario POST debe devolver.
function csrfToken(req) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrf;
}

function verifyCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const sent = req.body && req.body._csrf;
  const expected = req.session.csrf;
  if (
    typeof sent === 'string' &&
    typeof expected === 'string' &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  ) {
    return next();
  }
  res.status(403).send('El formulario ha caducado. Vuelve atrás, recarga la página e inténtalo de nuevo.');
}

// Cabeceras de seguridad básicas.
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self' https:; frame-ancestors 'none'; base-uri 'self'",
  });
  next();
}

module.exports = { csrfToken, verifyCsrf, securityHeaders };
