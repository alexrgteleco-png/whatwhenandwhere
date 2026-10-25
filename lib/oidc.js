'use strict';

// Login con Keycloak mediante OpenID Connect (Authorization Code + PKCE).
// Sin dependencias externas: usa fetch y crypto de Node 18+.

const crypto = require('crypto');

const ISSUER = (process.env.OIDC_ISSUER || '').replace(/\/$/, '');
const CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
const REDIRECT_URI = `${BASE_URL}/auth/callback`;

let discoveryCache = null;
let jwksCache = { keys: [], fetchedAt: 0 };

function isConfigured() {
  return Boolean(ISSUER && CLIENT_ID && CLIENT_SECRET);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no JSON de ${url} (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new Error(`Error de Keycloak: ${detail}`);
  }
  return body;
}

async function discovery() {
  if (!discoveryCache) {
    discoveryCache = await fetchJson(`${ISSUER}/.well-known/openid-configuration`);
  }
  return discoveryCache;
}

async function getJwks(forceRefresh) {
  const ageMs = Date.now() - jwksCache.fetchedAt;
  if (forceRefresh || jwksCache.keys.length === 0 || ageMs > 60 * 60 * 1000) {
    const meta = await discovery();
    const body = await fetchJson(meta.jwks_uri);
    jwksCache = { keys: body.keys || [], fetchedAt: Date.now() };
  }
  return jwksCache.keys;
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

const ALGORITHMS = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256', padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
};

async function verifyIdToken(idToken, expectedNonce) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('id_token mal formado');
  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);
  const alg = ALGORITHMS[header.alg];
  if (!alg) throw new Error(`Algoritmo de firma no admitido: ${header.alg}`);

  let jwk = (await getJwks(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getJwks(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('No se encontró la clave de firma del token');

  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const options = { key };
  if (alg.padding) options.padding = alg.padding;
  if (alg.dsaEncoding) options.dsaEncoding = alg.dsaEncoding;
  if (!crypto.verify(alg.hash, signed, options, signature)) {
    throw new Error('Firma del id_token no válida');
  }

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER) throw new Error('Emisor del token no válido');
  if (!audiences.includes(CLIENT_ID)) throw new Error('Audiencia del token no válida');
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) throw new Error('Token caducado');
  if (payload.nonce !== expectedNonce) throw new Error('Nonce del token no válido');
  return payload;
}

// Monta /login, /auth/callback y /logout en la app Express.
// onLogin(claims) se llama tras un login correcto y devuelve el usuario de sesión.
function mountAuthRoutes(app, { onLogin }) {
  app.get('/login', async (req, res, next) => {
    try {
      if (!isConfigured()) {
        return res.status(503).send('El login no está configurado: faltan OIDC_ISSUER, OIDC_CLIENT_ID u OIDC_CLIENT_SECRET.');
      }
      const meta = await discovery();
      const state = base64url(crypto.randomBytes(24));
      const nonce = base64url(crypto.randomBytes(24));
      const verifier = base64url(crypto.randomBytes(48));
      const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
      const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') && !req.query.returnTo.startsWith('//')
        ? req.query.returnTo
        : '/';
      req.session.oidc = { state, nonce, verifier, returnTo };
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      if (req.query.signup === '1') {
        // Keycloak abre directamente el formulario de registro.
        params.set('prompt', 'create');
      }
      req.session.save(() => res.redirect(`${meta.authorization_endpoint}?${params}`));
    } catch (err) {
      next(err);
    }
  });

  app.get('/auth/callback', async (req, res, next) => {
    try {
      const pending = req.session.oidc;
      if (req.query.error) {
        return res.redirect('/');
      }
      if (!pending || req.query.state !== pending.state || typeof req.query.code !== 'string') {
        return res.status(400).send('La sesión de login ha caducado. <a href="/login">Vuelve a intentarlo</a>.');
      }
      const meta = await discovery();
      const tokens = await fetchJson(meta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code_verifier: pending.verifier,
        }),
      });
      const claims = await verifyIdToken(tokens.id_token, pending.nonce);
      const user = await onLogin(claims);
      const returnTo = pending.returnTo || '/';
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = user;
        req.session.idToken = tokens.id_token;
        req.session.save(() => res.redirect(returnTo));
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/logout', async (req, res, next) => {
    try {
      const idToken = req.session.idToken;
      req.session.destroy(async () => {
        res.clearCookie('sid');
        if (!isConfigured()) return res.redirect('/');
        try {
          const meta = await discovery();
          const params = new URLSearchParams({ post_logout_redirect_uri: `${BASE_URL}/`, client_id: CLIENT_ID });
          if (idToken) params.set('id_token_hint', idToken);
          res.redirect(`${meta.end_session_endpoint}?${params}`);
        } catch {
          res.redirect('/');
        }
      });
    } catch (err) {
      next(err);
    }
  });
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  let returnTo = '/';
  if (req.method === 'GET') {
    returnTo = req.originalUrl;
  } else {
    try {
      returnTo = new URL(req.get('referer') || '/', BASE_URL).pathname;
    } catch {
      returnTo = '/';
    }
  }
  res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

module.exports = { mountAuthRoutes, requireLogin, isConfigured, BASE_URL, ISSUER };
