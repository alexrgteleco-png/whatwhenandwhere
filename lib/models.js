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
  e.id, e.title, e.description, e.starts_at, e.ends_at, e.place, e.created_at, e.owner_id,
  u.name AS owner_name,
  (SELECT count(*)::int FROM www.attendees a WHERE a.event_id = e.id) AS attendee_count,
  (SELECT count(*)::int FROM www.comments c WHERE c.event_id = e.id) AS comment_count,
  EXISTS (SELECT 1 FROM www.attendees a WHERE a.event_id = e.id AND a.user_id = $1) AS going,
  ${STILL_ON} AS upcoming`;

async function listEvents({ userId = null, search = '', past = false, page = 1 }) {
  const params = [userId];
  const where = [past ? `NOT (${STILL_ON})` : STILL_ON];
  if (search) {
    params.push(likePattern(search));
    where.push(`(e.title ILIKE $${params.length} OR e.description ILIKE $${params.length} OR e.place ILIKE $${params.length})`);
  }
  params.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const { rows } = await query(
    `SELECT ${EVENT_COLUMNS}
     FROM www.events e JOIN www.users u ON u.id = e.owner_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.starts_at ${past ? 'DESC' : 'ASC'}, e.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
      `INSERT INTO www.events (owner_id, title, description, starts_at, ends_at, place)
       VALUES ($1, $2, $3, ($4::timestamp AT TIME ZONE $7), ($5::timestamp AT TIME ZONE $7), $6)
       RETURNING id`,
      [ownerId, data.title, data.description, data.startsAt, data.endsAt || null, data.place, TZ]
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
         place = $7, updated_at = now()
     WHERE id = $1 AND owner_id = $2`,
    [id, ownerId, data.title, data.description, data.startsAt, data.endsAt || null, data.place, TZ]
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
