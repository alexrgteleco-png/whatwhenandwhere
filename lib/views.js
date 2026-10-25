'use strict';

const { html, raw } = require('./html');
const { formatLong, formatEnd, formatShort, dayAndMonth, toInputValue, timeAgo } = require('./time');

const PLATFORM_URL = (process.env.PLATFORM_URL || '').replace(/\/$/, '');

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function avatar(name) {
  return html`<span class="avatar" aria-hidden="true">${initials(name)}</span>`;
}

// Convierte saltos de línea en párrafos sin permitir HTML del usuario.
function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => html`<p>${p.split('\n').map((line, i) => (i === 0 ? html`${line}` : html`<br>${line}`))}</p>`);
}

function csrfField(ctx) {
  return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
}

const MAPLIBRE = '4.7.1';

function layout(ctx, { title, body, active = '', maps = false }) {
  const user = ctx.user;
  return html`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title ? `${title} · WhatWhenAndWhere` : 'WhatWhenAndWhere'}</title>
  <meta name="description" content="Crea eventos, apúntate a los de otros y habla con quienes van.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Inter:wght@400;500;600&display=swap">
  ${maps ? html`<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${MAPLIBRE}/dist/maplibre-gl.css">` : ''}
  <link rel="stylesheet" href="/styles.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  ${maps ? html`<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE}/dist/maplibre-gl.js" defer></script>
  <script src="/maps.js" defer></script>` : ''}
</head>
<body>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="/">
        <span class="brand-mark" aria-hidden="true">W³</span>
        <span class="brand-name">WhatWhenAndWhere</span>
      </a>
      <nav class="nav" aria-label="Principal">
        <a href="/" class="${active === 'events' ? 'active' : ''}">Eventos</a>
        ${user ? html`<a href="/mine" class="${active === 'mine' ? 'active' : ''}">Mis eventos</a>` : ''}
        <a href="/events/new" class="button button-small">Crear evento</a>
        ${user
          ? html`<form method="post" action="/logout" class="inline">
              ${csrfField(ctx)}
              <button type="submit" class="link-button" title="Cerrar sesión de ${user.name}">${avatar(user.name)}<span class="hide-sm">Salir</span></button>
            </form>`
          : html`<a href="/login?returnTo=${encodeURIComponent(ctx.path)}">Entrar</a>`}
      </nav>
    </div>
  </header>
  ${ctx.flash ? html`<div class="wrap"><p class="flash flash-${ctx.flash.type}" role="status">${ctx.flash.message}</p></div>` : ''}
  <main class="wrap">
    ${body}
  </main>
  <footer class="footer">
    <div class="wrap footer-inner">
      <span>Una app de ${PLATFORM_URL ? html`<a href="${PLATFORM_URL}">theaipeoplehub</a>` : 'theaipeoplehub'}</span>
      ${PLATFORM_URL ? html`<span><a href="${PLATFORM_URL}/privacidad">Privacidad</a> · <a href="${PLATFORM_URL}/aviso-legal">Aviso legal</a></span>` : ''}
    </div>
  </footer>
</body>
</html>`;
}

function dateBadge(date) {
  const { day, month } = dayAndMonth(date);
  return html`<div class="date-badge" aria-hidden="true"><span class="date-day">${day}</span><span class="date-month">${month}</span></div>`;
}

function formatKm(km) {
  const n = Number(km);
  return n < 1 ? `${Math.round(n * 1000)} m` : `${n < 10 ? n.toFixed(1).replace('.', ',') : Math.round(n)} km`;
}

// Datos para el mapa (JSON no ejecutable, leído por maps.js).
function mapData(id, data) {
  return raw(`<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
}

function eventCard(e) {
  return html`<li>
    <a class="event-card ${e.upcoming ? '' : 'is-past'}" href="/events/${e.id}">
      ${dateBadge(e.starts_at)}
      <div class="event-card-body">
        <h3>${e.title}</h3>
        <p class="meta"><span class="meta-item">🕒 ${formatShort(e.starts_at)}</span><span class="meta-item">📍 ${e.place}</span>${e.distance_km !== null && e.distance_km !== undefined ? html`<span class="meta-item distance">a ${formatKm(e.distance_km)}</span>` : ''}</p>
        <p class="meta subtle">${e.attendee_count} ${e.attendee_count === 1 ? 'persona va' : 'personas van'} · ${e.comment_count} ${e.comment_count === 1 ? 'comentario' : 'comentarios'}${e.going ? html` · <strong class="going-tag">Vas</strong>` : ''}</p>
      </div>
    </a>
  </li>`;
}

function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function eventsPage(ctx, { events, filters: f, hasMore, radii }) {
  const hasDates = Boolean(f.from || f.to);
  const base = () => {
    const params = new URLSearchParams();
    if (f.search) params.set('q', f.search);
    if (f.near) {
      params.set('near', f.nearLabel);
      params.set('lat', String(f.lat));
      params.set('lon', String(f.lon));
      params.set('r', String(f.radius));
    }
    return params;
  };
  const withDates = (params) => {
    if (f.when) params.set('when', f.when);
    else {
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);
    }
    return params;
  };
  const url = (params) => (params.toString() ? `/?${params}` : '/');
  const pageUrl = (p) => {
    const params = withDates(base());
    if (f.past && !hasDates) params.set('past', '1');
    if (p > 1) params.set('page', String(p));
    return url(params);
  };
  const whenUrl = (when) => {
    const params = base();
    if (when) params.set('when', when);
    return url(params);
  };
  const tabUrl = (past) => {
    const params = base();
    if (past) params.set('past', '1');
    return url(params);
  };

  const active = [];
  if (f.search) active.push(`«${f.search}»`);
  if (f.near) active.push(`a menos de ${f.radius} km de ${f.nearLabel}`);
  if (hasDates) active.push(f.from === f.to ? `el ${formatDay(f.from)}` : `${f.from ? `del ${formatDay(f.from)}` : ''} ${f.to ? `al ${formatDay(f.to)}` : 'en adelante'}`.trim());

  const mappable = events.filter((e) => e.lat !== null && e.lon !== null);
  const body = html`
    <section class="hero">
      <h1>¿Qué pasa, cuándo y dónde?</h1>
      <p>Crea cualquier evento, apúntate a los de otras personas y habla con quienes van.</p>
    </section>

    <form class="filters card" method="get" action="/" role="search">
      <div class="filters-grid">
        <div class="field">
          <label for="q">Qué</label>
          <input id="q" name="q" type="search" placeholder="Nombre o descripción" value="${f.search}">
        </div>
        <div class="field geo-field" data-geo-autocomplete>
          <label for="near">Dónde</label>
          <div class="input-with-action">
            <input id="near" name="near" autocomplete="off" placeholder="Ciudad, barrio o dirección" value="${f.nearLabel}" data-geo-input aria-autocomplete="list" aria-controls="near-suggestions">
            <button type="button" class="icon-button" data-geo-locate title="Usar mi ubicación" aria-label="Usar mi ubicación">◎</button>
          </div>
          <ul class="suggestions" id="near-suggestions" role="listbox" hidden></ul>
          <input type="hidden" name="lat" value="${f.near ? f.lat : ''}" data-geo-lat>
          <input type="hidden" name="lon" value="${f.near ? f.lon : ''}" data-geo-lon>
        </div>
        <div class="field field-small">
          <label for="r">Radio</label>
          <select id="r" name="r">
            ${radii.map((r) => html`<option value="${r}"${r === f.radius ? raw(' selected') : ''}>${r} km</option>`)}
          </select>
        </div>
        <div class="field field-small">
          <label for="from">Desde</label>
          <input id="from" name="from" type="date" value="${f.from}">
        </div>
        <div class="field field-small">
          <label for="to">Hasta</label>
          <input id="to" name="to" type="date" value="${f.to}">
        </div>
        <div class="field field-submit">
          <button type="submit" class="button">Buscar</button>
        </div>
      </div>
      <div class="chips" aria-label="Fechas rápidas">
        <a class="chip ${f.when === 'hoy' ? 'active' : ''}" href="${whenUrl('hoy')}">Hoy</a>
        <a class="chip ${f.when === 'finde' ? 'active' : ''}" href="${whenUrl('finde')}">Este fin de semana</a>
        <a class="chip ${f.when === 'semana' ? 'active' : ''}" href="${whenUrl('semana')}">Próximos 7 días</a>
        ${active.length ? html`<a class="chip chip-clear" href="/">Quitar filtros ✕</a>` : ''}
      </div>
      ${f.geoError ? html`<p class="field-error">No hemos encontrado «${f.nearLabel}». Prueba con otra dirección o elige una sugerencia.</p>` : ''}
    </form>

    ${hasDates
      ? html`<p class="results-note">Eventos ${active.join(' · ')}</p>`
      : html`<div class="tabs" role="tablist">
          <a role="tab" aria-selected="${!f.past}" class="${!f.past ? 'active' : ''}" href="${tabUrl(false)}">Próximos</a>
          <a role="tab" aria-selected="${f.past}" class="${f.past ? 'active' : ''}" href="${tabUrl(true)}">Pasados</a>
          ${active.length ? html`<span class="tabs-note">${active.join(' · ')}</span>` : ''}
        </div>`}

    ${mappable.length
      ? html`<div class="map map-results" id="results-map" data-map="results" role="region" aria-label="Mapa de los eventos de la lista"></div>
          ${mapData('results-data', {
            center: f.near ? { lat: f.lat, lon: f.lon, radiusKm: f.radius } : null,
            events: mappable.map((e) => ({ id: e.id, title: e.title, lat: e.lat, lon: e.lon, when: formatShort(e.starts_at), place: e.place })),
          })}`
      : ''}

    ${events.length
      ? html`<ul class="event-list">${events.map(eventCard)}</ul>`
      : html`<div class="empty">
          <p>${active.length ? 'No hay eventos con estos filtros.' : f.past ? 'Todavía no hay eventos pasados.' : 'No hay eventos próximos.'}</p>
          ${active.length ? html`<a class="button button-ghost" href="/">Ver todos los eventos</a>` : !f.past ? html`<a class="button" href="/events/new">Crea el primero</a>` : ''}
        </div>`}
    ${f.page > 1 || hasMore
      ? html`<nav class="pager" aria-label="Páginas">
          ${f.page > 1 ? html`<a href="${pageUrl(f.page - 1)}">← Anteriores</a>` : html`<span></span>`}
          ${hasMore ? html`<a href="${pageUrl(f.page + 1)}">Siguientes →</a>` : ''}
        </nav>`
      : ''}`;
  return layout(ctx, { title: active.length ? 'Buscar eventos' : '', body, active: 'events', maps: true });
}

function eventFormPage(ctx, { event = {}, errors = {}, mode = 'new' }) {
  const isEdit = mode === 'edit';
  const action = isEdit ? `/events/${event.id}/edit` : '/events';
  const field = (name) => (errors[name] ? html`<p class="field-error" id="${name}-error">${errors[name]}</p>` : '');
  const invalid = (name) => (errors[name] ? raw(` aria-invalid="true" aria-describedby="${name}-error"`) : '');
  const body = html`
    <div class="narrow">
      <p class="back"><a href="${isEdit ? `/events/${event.id}` : '/'}">← Volver</a></p>
      <h1>${isEdit ? 'Editar evento' : 'Crear un evento'}</h1>
      <p class="subtle">Cualquier plan vale: una quedada, un concierto, un taller, una ruta…</p>
      ${errors._form ? html`<p class="flash flash-error">${errors._form}</p>` : ''}
      <form method="post" action="${action}" class="form" novalidate>
        ${csrfField(ctx)}
        <label for="title">Nombre del evento</label>
        <input id="title" name="title" maxlength="120" required value="${event.title || ''}" placeholder="Ej.: Ruta en bici por el río"${invalid('title')}>
        ${field('title')}

        <div class="grid-2">
          <div>
            <label for="startsAt">Empieza</label>
            <input id="startsAt" name="startsAt" type="datetime-local" required value="${event.startsAt || ''}"${invalid('startsAt')}>
            ${field('startsAt')}
          </div>
          <div>
            <label for="endsAt">Termina <span class="optional">(opcional)</span></label>
            <input id="endsAt" name="endsAt" type="datetime-local" value="${event.endsAt || ''}"${invalid('endsAt')}>
            ${field('endsAt')}
          </div>
        </div>

        <div class="geo-field" data-geo-autocomplete data-geo-map="place-map">
          <label for="place">Lugar</label>
          <div class="geo-input-wrap">
            <input id="place" name="place" maxlength="200" required autocomplete="off" value="${event.place || ''}" placeholder="Empieza a escribir una dirección o escribe «Online»" data-geo-input aria-autocomplete="list" aria-controls="place-suggestions"${invalid('place')}>
            <ul class="suggestions" id="place-suggestions" role="listbox" hidden></ul>
          </div>
          <input type="hidden" name="lat" value="${event.lat ?? ''}" data-geo-lat>
          <input type="hidden" name="lon" value="${event.lon ?? ''}" data-geo-lon>
          ${field('place')}
          <p class="hint" data-geo-hint>${event.lat !== null && event.lat !== undefined ? 'Ubicación marcada en el mapa. Puedes arrastrar el marcador para afinarla.' : 'Elige una sugerencia para situar el evento en el mapa. Si es online, escríbelo sin más.'}</p>
          <div class="map map-form" id="place-map" data-map="picker" role="region" aria-label="Mapa para situar el lugar del evento"></div>
        </div>

        <label for="description">Descripción <span class="optional">(opcional)</span></label>
        <textarea id="description" name="description" rows="7" maxlength="5000" placeholder="Cuenta de qué va, qué hay que llevar, cómo llegar…"${invalid('description')}>${event.description || ''}</textarea>
        ${field('description')}

        <div class="form-actions">
          <button type="submit" class="button">${isEdit ? 'Guardar cambios' : 'Publicar evento'}</button>
          <a href="${isEdit ? `/events/${event.id}` : '/'}" class="button button-ghost">Cancelar</a>
        </div>
      </form>
    </div>`;
  return layout(ctx, { title: isEdit ? 'Editar evento' : 'Crear evento', body, maps: true });
}

function eventDetailPage(ctx, { event, attendees, comments }) {
  const user = ctx.user;
  const isOwner = user && user.id === event.owner_id;
  const hasCoords = event.lat !== null && event.lat !== undefined;
  const mapsUrl = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lon}#map=17/${event.lat}/${event.lon}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(event.place)}`;
  const directionsUrl = hasCoords ? `https://www.openstreetmap.org/directions?to=${event.lat}%2C${event.lon}` : null;
  const body = html`
    <p class="back"><a href="/">← Todos los eventos</a></p>
    <article class="event-detail">
      <header class="event-header">
        ${dateBadge(event.starts_at)}
        <div>
          <h1>${event.title}</h1>
          <p class="subtle">Organiza ${event.owner_name}${event.upcoming ? '' : ' · Evento pasado'}</p>
        </div>
      </header>

      <div class="event-layout">
        <div class="event-main">
          <dl class="facts">
            <div><dt>Cuándo</dt><dd>${formatLong(event.starts_at)}${event.ends_at ? html`<br><span class="subtle">${formatEnd(event.starts_at, event.ends_at)}</span>` : ''}</dd></div>
            <div><dt>Dónde</dt><dd>${event.place}<br><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Abrir en OpenStreetMap ↗</a>${directionsUrl ? html` · <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Cómo llegar ↗</a>` : ''}</dd></div>
          </dl>
          ${hasCoords
            ? html`<div class="map map-detail" id="event-map" data-map="event" role="region" aria-label="Mapa con la ubicación del evento"></div>
                ${mapData('event-data', { lat: event.lat, lon: event.lon, title: event.title })}`
            : ''}
          ${event.description ? html`<div class="description">${paragraphs(event.description)}</div>` : ''}

          <section class="forum" aria-labelledby="forum-title">
            <h2 id="forum-title">Foro <span class="count">${comments.length}</span></h2>
            ${comments.length
              ? html`<ol class="comments">${comments.map(
                  (c) => html`<li class="comment" id="c${c.id}">
                    ${avatar(c.user_name)}
                    <div class="comment-body">
                      <p class="comment-meta"><strong>${c.user_name}</strong>${c.user_id === event.owner_id ? html` <span class="tag">Organiza</span>` : ''} <span class="subtle" title="${formatLong(c.created_at)}">${timeAgo(c.created_at)}</span></p>
                      ${paragraphs(c.body)}
                      ${user && (user.id === c.user_id || isOwner)
                        ? html`<form method="post" action="/comments/${c.id}/delete" class="inline">
                            ${csrfField(ctx)}
                            <button type="submit" class="link-button danger-link" data-confirm="¿Borrar este comentario?">Borrar</button>
                          </form>`
                        : ''}
                    </div>
                  </li>`
                )}</ol>`
              : html`<p class="subtle">Nadie ha comentado todavía. ¡Rompe el hielo!</p>`}

            ${user
              ? html`<form method="post" action="/events/${event.id}/comments" class="form comment-form">
                  ${csrfField(ctx)}
                  <label for="body" class="sr-only">Escribe un comentario</label>
                  <textarea id="body" name="body" rows="3" maxlength="2000" required placeholder="Pregunta, comenta u organízate con el resto…"></textarea>
                  <button type="submit" class="button">Comentar</button>
                </form>`
              : html`<p class="login-cta"><a href="/login?returnTo=${encodeURIComponent(`/events/${event.id}`)}">Entra</a> para comentar en el foro.</p>`}
          </section>
        </div>

        <aside class="event-side">
          <div class="card">
            <p class="big-number">${event.attendee_count}</p>
            <p class="subtle">${event.attendee_count === 1 ? 'persona va' : 'personas van'}</p>
            ${!user
              ? html`<a class="button button-block" href="/login?returnTo=${encodeURIComponent(`/events/${event.id}`)}">Entra para apuntarte</a>`
              : isOwner
                ? html`<p class="subtle small">Eres quien organiza.</p>`
                : !event.upcoming
                  ? html`<p class="subtle small">Este evento ya ha pasado.</p>`
                  : event.going
                    ? html`<form method="post" action="/events/${event.id}/leave">${csrfField(ctx)}<button type="submit" class="button button-ghost button-block">Ya no voy</button></form>`
                    : html`<form method="post" action="/events/${event.id}/join">${csrfField(ctx)}<button type="submit" class="button button-block">Me apunto</button></form>`}
            ${attendees.length
              ? html`<ul class="attendees">${attendees.map((a) => html`<li>${avatar(a.name)}<span>${a.name}</span></li>`)}</ul>`
              : ''}
          </div>
          ${isOwner
            ? html`<div class="card owner-actions">
                <a class="button button-ghost button-block" href="/events/${event.id}/edit">Editar evento</a>
                <form method="post" action="/events/${event.id}/delete">
                  ${csrfField(ctx)}
                  <button type="submit" class="button button-danger button-block" data-confirm="¿Borrar este evento? Se perderán también los comentarios.">Borrar evento</button>
                </form>
              </div>`
            : ''}
        </aside>
      </div>
    </article>
    <script src="/confirm.js" defer></script>`;
  return layout(ctx, { title: event.title, body, maps: hasCoords });
}

function myEventsPage(ctx, { events }) {
  const organizing = events.filter((e) => e.owner_id === ctx.user.id);
  const attending = events.filter((e) => e.owner_id !== ctx.user.id);
  const section = (title, list, empty) => html`
    <section class="my-section">
      <h2>${title} <span class="count">${list.length}</span></h2>
      ${list.length ? html`<ul class="event-list">${list.map(eventCard)}</ul>` : html`<p class="subtle">${empty}</p>`}
    </section>`;
  const body = html`
    <h1>Mis eventos</h1>
    ${section('Organizo', organizing, 'Aún no has creado ningún evento.')}
    ${section('Me he apuntado', attending, 'Aún no te has apuntado a ningún evento.')}
    <p><a class="button" href="/events/new">Crear evento</a></p>`;
  return layout(ctx, { title: 'Mis eventos', body, active: 'mine' });
}

function errorPage(ctx, { status, message }) {
  const body = html`
    <div class="empty">
      <h1>${status === 404 ? 'No encontrado' : 'Algo ha fallado'}</h1>
      <p>${message}</p>
      <a class="button" href="/">Volver a los eventos</a>
    </div>`;
  return layout(ctx, { title: status === 404 ? 'No encontrado' : 'Error', body });
}

module.exports = { eventsPage, eventFormPage, eventDetailPage, myEventsPage, errorPage, toInputValue };
