'use strict';

// Búsqueda de direcciones con Photon (geocodificador abierto sobre OpenStreetMap).
// El navegador no llama a Photon directamente: pasa por /geo/* para cachear resultados,
// limitar peticiones y poder cambiar de servidor (p. ej. un Photon propio) con una variable.

const PHOTON_URL = (process.env.PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, '');
const USER_AGENT = 'WhatWhenAndWhere/1.0 (theaipeoplehub)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;

// Al elegir automáticamente un lugar escrito a mano, se prefieren localidades a calles o comercios.
const PLACE_RANK = { city: 0, district: 1, locality: 2, county: 3, state: 4, country: 5 };

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Renueva su posición (LRU sencillo).
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// Límite por IP: 60 peticiones por minuto.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > 60;
}

function label(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const main = p.name && p.name !== p.street ? p.name : street || p.name;
  const parts = [main, p.name && p.name !== p.street ? street : null, p.postcode, p.city || p.town || p.village, p.state, p.country];
  const seen = new Set();
  return parts
    .filter((x) => x && !seen.has(x) && seen.add(x))
    .join(', ');
}

function toResults(geojson) {
  return (geojson.features || [])
    .filter((f) => f.geometry && Array.isArray(f.geometry.coordinates))
    .map((f) => ({
      label: label(f.properties || {}),
      lat: Number(f.geometry.coordinates[1].toFixed(6)),
      lon: Number(f.geometry.coordinates[0].toFixed(6)),
      type: (f.properties && f.properties.type) || null,
      country: (f.properties && f.properties.countrycode) || null,
    }))
    .filter((r) => r.label);
}

async function photon(path, params) {
  const url = `${PHOTON_URL}${path}?${new URLSearchParams(params)}`;
  const cached = cacheGet(url);
  if (cached) return cached;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Photon respondió ${res.status}`);
  const results = toResults(await res.json());
  cacheSet(url, results);
  return results;
}

function validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

async function search(q, bias) {
  const text = String(q || '').trim().slice(0, 120);
  if (text.length < 3) return [];
  const params = { q: text, limit: '6' };
  // Solo se prioriza la cercanía cuando hay un punto real (p. ej. el centro del mapa).
  if (bias && validCoord(bias.lat, bias.lon)) {
    params.lat = bias.lat.toFixed(3);
    params.lon = bias.lon.toFixed(3);
  }
  return photon('/api/', params);
}

// Mejor coincidencia para un lugar escrito sin elegir sugerencia:
// localidades antes que calles, y dentro de ellas, las de España.
async function bestPlace(q) {
  const results = await search(q);
  if (!results.length) return null;
  const rank = (r) => (r.type in PLACE_RANK ? PLACE_RANK[r.type] : 10) + (r.country === 'ES' ? 0 : 20);
  return results
    .map((r, i) => ({ r, score: rank(r) * 100 + i }))
    .sort((a, b) => a.score - b.score)[0].r;
}

async function reverse(lat, lon) {
  if (!validCoord(lat, lon)) return null;
  const results = await photon('/reverse', { lat: lat.toFixed(5), lon: lon.toFixed(5), limit: '1' });
  return results[0] || null;
}

function mountGeoRoutes(app) {
  app.get('/geo/search', async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Demasiadas búsquedas, espera un momento.' });
    try {
      const bias = { lat: Number(req.query.lat), lon: Number(req.query.lon) };
      res.set('Cache-Control', 'private, max-age=3600');
      res.json(await search(req.query.q, bias));
    } catch (err) {
      console.error('Geo search:', err.message);
      res.status(502).json({ error: 'El buscador de direcciones no responde ahora mismo.' });
    }
  });

  app.get('/geo/reverse', async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Demasiadas búsquedas, espera un momento.' });
    try {
      const result = await reverse(Number(req.query.lat), Number(req.query.lon));
      res.json(result || {});
    } catch (err) {
      console.error('Geo reverse:', err.message);
      res.status(502).json({ error: 'El buscador de direcciones no responde ahora mismo.' });
    }
  });
}

module.exports = { mountGeoRoutes, search, bestPlace, reverse, validCoord, label };
