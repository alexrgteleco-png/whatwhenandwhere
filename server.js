'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool, migrate } = require('./lib/db');
const { mountAuthRoutes, requireLogin, isConfigured } = require('./lib/oidc');
const { csrfToken, verifyCsrf, securityHeaders } = require('./lib/security');
const models = require('./lib/models');
const views = require('./lib/views');

const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

if (!process.env.SESSION_SECRET && isProduction) {
  console.error('Falta la variable SESSION_SECRET');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

app.get('/healthz', (req, res) => res.send('ok'));

app.use(
  session({
    name: 'sid',
    store: new PgSession({ pool, schemaName: 'www', tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'solo-para-desarrollo-local',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

// Contexto común para las vistas.
app.use((req, res, next) => {
  res.locals.ctx = {
    user: req.session.user || null,
    path: req.originalUrl,
    get csrf() {
      return csrfToken(req);
    },
    flash: req.session.flash || null,
  };
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function parseId(value) {
  return /^\d{1,15}$/.test(String(value)) ? Number(value) : null;
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(verifyCsrf);

mountAuthRoutes(app, { onLogin: (claims) => models.upsertUser(claims) });

// ---------- Listado ----------
app.get(
  '/',
  asyncRoute(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const past = req.query.past === '1';
    const page = Math.max(1, Math.min(500, parseInt(req.query.page, 10) || 1));
    const userId = req.session.user ? req.session.user.id : null;
    const { events, hasMore } = await models.listEvents({ userId, search, past, page });
    res.send(String(views.eventsPage(res.locals.ctx, { events, search, past, page, hasMore })));
  })
);

app.get(
  '/mine',
  requireLogin,
  asyncRoute(async (req, res) => {
    const events = await models.myEvents(req.session.user.id);
    res.send(String(views.myEventsPage(res.locals.ctx, { events })));
  })
);

// ---------- Crear / editar ----------
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function readEventForm(body) {
  const data = {
    title: String(body.title || '').trim(),
    description: String(body.description || '').replace(/\r\n/g, '\n').trim(),
    startsAt: String(body.startsAt || '').trim(),
    endsAt: String(body.endsAt || '').trim(),
    place: String(body.place || '').trim(),
  };
  const errors = {};
  if (data.title.length < 3) errors.title = 'Ponle un nombre de al menos 3 caracteres.';
  if (data.title.length > 120) errors.title = 'El nombre no puede pasar de 120 caracteres.';
  if (!DATETIME_RE.test(data.startsAt)) errors.startsAt = 'Indica la fecha y hora de inicio.';
  if (data.endsAt && !DATETIME_RE.test(data.endsAt)) errors.endsAt = 'La fecha de fin no es válida.';
  if (!errors.startsAt && data.endsAt && !errors.endsAt && data.endsAt < data.startsAt) {
    errors.endsAt = 'El evento no puede terminar antes de empezar.';
  }
  if (data.place.length < 2) errors.place = 'Indica dónde será (o escribe «Online»).';
  if (data.place.length > 200) errors.place = 'El lugar no puede pasar de 200 caracteres.';
  if (data.description.length > 5000) errors.description = 'La descripción no puede pasar de 5.000 caracteres.';
  return { data, errors };
}

app.get('/events/new', requireLogin, (req, res) => {
  res.send(String(views.eventFormPage(res.locals.ctx, {})));
});

app.post(
  '/events',
  requireLogin,
  asyncRoute(async (req, res) => {
    const { data, errors } = readEventForm(req.body);
    if (Object.keys(errors).length) {
      return res.status(422).send(String(views.eventFormPage(res.locals.ctx, { event: data, errors })));
    }
    const id = await models.createEvent(req.session.user.id, data);
    flash(req, 'success', '¡Evento publicado! Comparte el enlace para que se apunte más gente.');
    res.redirect(`/events/${id}`);
  })
);

async function loadOwnedEvent(req, res) {
  const id = parseId(req.params.id);
  const event = id && (await models.getEvent(id, req.session.user.id));
  if (!event) {
    res.status(404).send(String(views.errorPage(res.locals.ctx, { status: 404, message: 'Este evento no existe o se ha borrado.' })));
    return null;
  }
  if (event.owner_id !== req.session.user.id) {
    res.status(403).send(String(views.errorPage(res.locals.ctx, { status: 403, message: 'Solo quien organiza el evento puede cambiarlo.' })));
    return null;
  }
  return event;
}

app.get(
  '/events/:id/edit',
  requireLogin,
  asyncRoute(async (req, res) => {
    const event = await loadOwnedEvent(req, res);
    if (!event) return;
    const formData = {
      id: event.id,
      title: event.title,
      description: event.description,
      place: event.place,
      startsAt: views.toInputValue(event.starts_at),
      endsAt: views.toInputValue(event.ends_at),
    };
    res.send(String(views.eventFormPage(res.locals.ctx, { event: formData, mode: 'edit' })));
  })
);

app.post(
  '/events/:id/edit',
  requireLogin,
  asyncRoute(async (req, res) => {
    const event = await loadOwnedEvent(req, res);
    if (!event) return;
    const { data, errors } = readEventForm(req.body);
    if (Object.keys(errors).length) {
      return res.status(422).send(String(views.eventFormPage(res.locals.ctx, { event: { ...data, id: event.id }, errors, mode: 'edit' })));
    }
    await models.updateEvent(event.id, req.session.user.id, data);
    flash(req, 'success', 'Cambios guardados.');
    res.redirect(`/events/${event.id}`);
  })
);

app.post(
  '/events/:id/delete',
  requireLogin,
  asyncRoute(async (req, res) => {
    const event = await loadOwnedEvent(req, res);
    if (!event) return;
    await models.deleteEvent(event.id, req.session.user.id);
    flash(req, 'success', 'Evento borrado.');
    res.redirect('/mine');
  })
);

// ---------- Detalle ----------
app.get(
  '/events/:id',
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const userId = req.session.user ? req.session.user.id : null;
    const event = id && (await models.getEvent(id, userId));
    if (!event) {
      return res.status(404).send(String(views.errorPage(res.locals.ctx, { status: 404, message: 'Este evento no existe o se ha borrado.' })));
    }
    const [attendees, comments] = await Promise.all([models.listAttendees(id), models.listComments(id)]);
    res.send(String(views.eventDetailPage(res.locals.ctx, { event, attendees, comments })));
  })
);

// ---------- Apuntarse ----------
app.post(
  '/events/:id/join',
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const event = id && (await models.getEvent(id, req.session.user.id));
    if (!event) return res.redirect('/');
    if (event.upcoming) {
      await models.joinEvent(id, req.session.user.id);
      flash(req, 'success', '¡Te has apuntado! Saluda en el foro.');
    }
    res.redirect(`/events/${id}`);
  })
);

app.post(
  '/events/:id/leave',
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.redirect('/');
    await models.leaveEvent(id, req.session.user.id);
    flash(req, 'info', 'Te has desapuntado del evento.');
    res.redirect(`/events/${id}`);
  })
);

// ---------- Foro ----------
app.post(
  '/events/:id/comments',
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const event = id && (await models.getEvent(id, req.session.user.id));
    if (!event) return res.redirect('/');
    const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
    if (!body) {
      flash(req, 'error', 'El comentario está vacío.');
      return res.redirect(`/events/${id}#forum-title`);
    }
    if (body.length > 2000) {
      flash(req, 'error', 'El comentario no puede pasar de 2.000 caracteres.');
      return res.redirect(`/events/${id}#forum-title`);
    }
    const commentId = await models.addComment(id, req.session.user.id, body);
    res.redirect(`/events/${id}#c${commentId}`);
  })
);

app.post(
  '/comments/:id/delete',
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    const eventId = id && (await models.deleteComment(id, req.session.user.id));
    if (!eventId) return res.redirect('/');
    flash(req, 'info', 'Comentario borrado.');
    res.redirect(`/events/${eventId}#forum-title`);
  })
);

// ---------- Errores ----------
app.use((req, res) => {
  res.status(404).send(String(views.errorPage(res.locals.ctx || { user: null, path: req.originalUrl, csrf: '' }, { status: 404, message: 'Esta página no existe.' })));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const ctx = res.locals.ctx || { user: null, path: req.originalUrl, csrf: '' };
  res.status(500).send(String(views.errorPage(ctx, { status: 500, message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo en unos segundos.' })));
});

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`WhatWhenAndWhere escuchando en el puerto ${PORT}`);
      if (!isConfigured()) console.warn('Aviso: el login con Keycloak no está configurado (variables OIDC_*).');
    });
  })
  .catch((err) => {
    console.error('No se pudo preparar la base de datos:', err);
    process.exit(1);
  });
