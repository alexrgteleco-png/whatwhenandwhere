'use strict';

const { pool, query } = require('./db');
const { TZ } = require('./time');

const PAGE_SIZE = 20;

// Un evento se considera "próximo" hasta que termina
// (o hasta 3 horas después de empezar si no tiene hora de fin).
const STILL_ON = `COALESCE(e.ends_at, e.starts_at + interval '3 hours') >= now()`;

function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function upsertUser(claims) {
  const name =
    claims.name ||
    [claims.given_name, claims.family_name].filter(Boolean).join(' ') ||
    claims.preferred_username ||
    (claims.email ? claims.email.split('@')[0] : 'Usuario');
  const { rows } = await query(
    `INSERT INTO www.users (id, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, last_login_at = now()
     RETURNING id, name, email`,
    [claims.sub, name.slice(0, 120), claims.email || null]
  );
  return rows[0];
}

const EVENT_COLUMNS = `
  e.id, e.title, e.description, e.starts_at, e.ends_at, e.place, e.lat, e.lon, e.created_at, e.owner_id,
  u.name AS owner_name,
  (SELECT count(*)::int FROM www.attendees a WHERE a.event_id = e.id) AS attendee_count,
  (SELECT count(*)::int FROM www.comments c WHERE c.event_id = e.id) AS comment_count,
  EXISTS (SELECT 1 FROM www.attendees a WHERE a.event_id = e.id AND a.user_id = $1) AS going,
  ${STILL_ON} AS upcoming`;

// Distancia en km entre el evento y un punto ($lat, $lon), fórmula del haversine.
function distanceSql(latParam, lonParam) {
  return `(6371 * 2 * asin(sqrt(
    power(sin(radians(e.lat - ${latParam}) / 2), 2) +
    cos(radians(${latParam})) * cos(radians(e.lat)) * power(sin(radians(e.lon - ${lonParam}) / 2), 2)
  )))`;
}

/**
 * Lista eventos con filtros opcionales:
 * - search: texto en nombre, descripción o lugar
 * - past: eventos pasados en vez de próximos (se ignora si hay rango de fechas)
 * - from / to: fechas 'YYYY-MM-DD' (hora de España); devuelve eventos que coinciden con ese rango
 * - near: { lat, lon, radiusKm } para eventos a menos de radiusKm del punto
 */
async function listEvents({ userId = null, search = '', past = false, from = null, to = null, near = null, page = 1 }) {
  const params = [userId];
  const where = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const hasDates = Boolean(from || to);
  if (hasDates) {
    const tz = add(TZ);
    if (from) where.push(`COALESCE(e.ends_at, e.starts_at) >= (${add(from)}::date::timestamp AT TIME ZONE ${tz})`);
    if (to) where.push(`e.starts_at < ((${add(to)}::date + 1)::timestamp AT TIME ZONE ${tz})`);
  } else {
    where.push(past ? `NOT (${STILL_ON})` : STILL_ON);
  }

  if (search) {
    const p = add(likePattern(search));
    where.push(`(e.title ILIKE ${p} OR e.description ILIKE ${p} OR e.place ILIKE ${p})`);
  }

  let distanceColumn = 'NULL::float AS distance_km';
  if (near) {
    const lat = add(near.lat);
    const lon = add(near.lon);
    const radius = add(near.radiusKm);
    // Recuadro previo (barato) y después la distancia exacta.
    const dLat = add(near.radiusKm / 111.32);
    const dLon = add(near.radiusKm / (111.32 * Math.max(0.01, Math.cos((near.lat * Math.PI) / 180))));
    where.push(`e.lat IS NOT NULL`);
    where.push(`e.lat BETWEEN ${lat}::float - ${dLat}::float AND ${lat}::float + ${dLat}::float`);
    where.push(`e.lon BETWEEN ${lon}::float - ${dLon}::float AND ${lon}::float + ${dLon}::float`);
    where.push(`${distanceSql(`${lat}::float`, `${lon}::float`)} <= ${radius}::float`);
    distanceColumn = `${distanceSql(`${lat}::float`, `${lon}::float`)} AS distance_km`;
  }

  const order = !hasDates && past ? 'DESC' : 'ASC';
  const limit = add(PAGE_SIZE + 1);
  const offset = add((page - 1) * PAGE_SIZE);
  const { rows } = await query(
    `SELECT ${EVENT_COLUMNS}, ${distanceColumn}
     FROM www.events e JOIN www.users u ON u.id = e.owner_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.starts_at ${order}, e.id
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return { events: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

async function getEvent(id, userId = null) {
  const { rows } = await query(
    `SELECT ${EVENT_COLUMNS}
     FROM www.events e JOIN www.users u ON u.id = e.owner_id
     WHERE e.id = $2`,
    [userId, id]
  );
  return rows[0] || null;
}

async function createEvent(ownerId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO www.events (owner_id, title, description, starts_at, ends_at, place, lat, lon)
       VALUES ($1, $2, $3, ($4::timestamp AT TIME ZONE $7), ($5::timestamp AT TIME ZONE $7), $6, $8, $9)
       RETURNING id`,
      [ownerId, data.title, data.description, data.startsAt, data.endsAt || null, data.place, TZ, data.lat, data.lon]
    );
    // Quien crea el evento queda apuntado automáticamente.
    await client.query('INSERT INTO www.attendees (event_id, user_id) VALUES ($1, $2)', [rows[0].id, ownerId]);
    await client.query('COMMIT');
    return rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateEvent(id, ownerId, data) {
  const { rowCount } = await query(
    `UPDATE www.events
     SET title = $3, description = $4,
         starts_at = ($5::timestamp AT TIME ZONE $8),
         ends_at = ($6::timestamp AT TIME ZONE $8),
         place = $7, lat = $9, lon = $10, updated_at = now()
     WHERE id = $1 AND owner_id = $2`,
    [id, ownerId, data.title, data.description, data.startsAt, data.endsAt || null, data.place, TZ, data.lat, data.lon]
  );
  return rowCount === 1;
}

async function deleteEvent(id, ownerId) {
  const { rowCount } = await query('DELETE FROM www.events WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return rowCount === 1;
}

async function joinEvent(eventId, userId) {
  await query(
    'INSERT INTO www.attendees (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [eventId, userId]
  );
}

async function leaveEvent(eventId, userId) {
  // El organizador no puede desapuntarse de su propio evento.
  await query(
    `DELETE FROM www.attendees a USING www.events e
     WHERE a.event_id = $1 AND a.user_id = $2 AND e.id = a.event_id AND e.owner_id <> $2`,
    [eventId, userId]
  );
}

async function listAttendees(eventId) {
  const { rows } = await query(
    `SELECT u.id, u.name, a.joined_at
     FROM www.attendees a JOIN www.users u ON u.id = a.user_id
     WHERE a.event_id = $1
     ORDER BY a.joined_at`,
    [eventId]
  );
  return rows;
}

async function listComments(eventId) {
  const { rows } = await query(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.name AS user_name
     FROM www.comments c JOIN www.users u ON u.id = c.user_id
     WHERE c.event_id = $1
     ORDER BY c.created_at, c.id`,
    [eventId]
  );
  return rows;
}

async function addComment(eventId, userId, body) {
  const { rows } = await query(
    'INSERT INTO www.comments (event_id, user_id, body) VALUES ($1, $2, $3) RETURNING id',
    [eventId, userId, body]
  );
  return rows[0].id;
}

// Puede borrar un comentario su autor o el organizador del evento.
async function deleteComment(commentId, userId) {
  const { rows } = await query(
    `DELETE FROM www.comments c USING www.events e
     WHERE c.id = $1 AND e.id = c.event_id AND (c.user_id = $2 OR e.owner_id = $2)
     RETURNING c.event_id`,
    [commentId, userId]
  );
  return rows[0] ? rows[0].event_id : null;
}

async function myEvents(userId) {
  const { rows } = await query(
    `SELECT ${EVENT_COLUMNS}
     FROM www.events e
     JOIN www.users u ON u.id = e.owner_id
     JOIN www.attendees me ON me.event_id = e.id AND me.user_id = $1
     ORDER BY (${STILL_ON}) DESC,
              CASE WHEN ${STILL_ON} THEN e.starts_at END ASC,
              e.starts_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  PAGE_SIZE,
  upsertUser,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  listAttendees,
  listComments,
  addComment,
  deleteComment,
  myEvents,
};
