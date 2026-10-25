'use strict';

// Datos de prueba: actividades repartidas por toda España (octubre–diciembre de 2026).
// Se activan con la variable DEMO_EVENTS:
//   DEMO_EVENTS=seed   crea las actividades si aún no existen (una sola vez)
//   DEMO_EVENTS=clear  borra todas las actividades y perfiles de prueba
// Los perfiles de prueba tienen id "demo:…" (no son cuentas de Keycloak); al borrarlos,
// sus actividades, asistencias y comentarios se borran en cascada.

const { pool } = require('./db');

const DEMO_PREFIX = 'demo:';
const COUNT = Number(process.env.DEMO_EVENTS_COUNT || 1000);

// Generador pseudoaleatorio con semilla: siempre produce las mismas actividades.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ciudad, comunidad, latitud, longitud y peso (aprox. proporcional a la población).
const CITIES = [
  ['Madrid', 'Comunidad de Madrid', 40.4168, -3.7038, 60],
  ['Alcalá de Henares', 'Comunidad de Madrid', 40.4818, -3.3643, 6],
  ['Getafe', 'Comunidad de Madrid', 40.3083, -3.7327, 5],
  ['Barcelona', 'Cataluña', 41.3874, 2.1686, 45],
  ['Girona', 'Cataluña', 41.9794, 2.8214, 5],
  ['Tarragona', 'Cataluña', 41.1189, 1.2445, 5],
  ['Lleida', 'Cataluña', 41.6176, 0.62, 5],
  ['Sabadell', 'Cataluña', 41.5463, 2.1086, 5],
  ['Valencia', 'Comunidad Valenciana', 39.4699, -0.3763, 25],
  ['Alicante', 'Comunidad Valenciana', 38.3452, -0.481, 12],
  ['Castellón de la Plana', 'Comunidad Valenciana', 39.9864, -0.0513, 6],
  ['Elche', 'Comunidad Valenciana', 38.2699, -0.6983, 7],
  ['Benidorm', 'Comunidad Valenciana', 38.5411, -0.1225, 4],
  ['Sevilla', 'Andalucía', 37.3891, -5.9845, 22],
  ['Málaga', 'Andalucía', 36.7213, -4.4214, 18],
  ['Córdoba', 'Andalucía', 37.8882, -4.7794, 10],
  ['Granada', 'Andalucía', 37.1773, -3.5986, 10],
  ['Cádiz', 'Andalucía', 36.5271, -6.2886, 6],
  ['Jerez de la Frontera', 'Andalucía', 36.6866, -6.1373, 6],
  ['Almería', 'Andalucía', 36.834, -2.4637, 6],
  ['Huelva', 'Andalucía', 37.2614, -6.9447, 5],
  ['Jaén', 'Andalucía', 37.7796, -3.7849, 5],
  ['Marbella', 'Andalucía', 36.5101, -4.8825, 5],
  ['Ronda', 'Andalucía', 36.7423, -5.1671, 2],
  ['Zaragoza', 'Aragón', 41.6488, -0.8891, 14],
  ['Huesca', 'Aragón', 42.1401, -0.4089, 3],
  ['Teruel', 'Aragón', 40.3456, -1.1065, 2],
  ['Bilbao', 'País Vasco', 43.263, -2.935, 12],
  ['San Sebastián', 'País Vasco', 43.3183, -1.9812, 8],
  ['Vitoria-Gasteiz', 'País Vasco', 42.8467, -2.6716, 7],
  ['Pamplona', 'Navarra', 42.8125, -1.6458, 7],
  ['Logroño', 'La Rioja', 42.4627, -2.4449, 5],
  ['Santander', 'Cantabria', 43.4623, -3.81, 6],
  ['Oviedo', 'Asturias', 43.3614, -5.8593, 6],
  ['Gijón', 'Asturias', 43.5322, -5.6611, 7],
  ['A Coruña', 'Galicia', 43.3623, -8.4115, 8],
  ['Vigo', 'Galicia', 42.2406, -8.7207, 8],
  ['Santiago de Compostela', 'Galicia', 42.8782, -8.5448, 6],
  ['Lugo', 'Galicia', 43.0097, -7.556, 3],
  ['Ourense', 'Galicia', 42.3358, -7.8639, 3],
  ['Pontevedra', 'Galicia', 42.431, -8.6444, 3],
  ['Valladolid', 'Castilla y León', 41.6523, -4.7245, 9],
  ['Salamanca', 'Castilla y León', 40.9701, -5.6635, 6],
  ['Burgos', 'Castilla y León', 42.3439, -3.6969, 5],
  ['León', 'Castilla y León', 42.5987, -5.5671, 5],
  ['Segovia', 'Castilla y León', 40.9429, -4.1088, 3],
  ['Ávila', 'Castilla y León', 40.6565, -4.6818, 2],
  ['Soria', 'Castilla y León', 41.7666, -2.479, 2],
  ['Zamora', 'Castilla y León', 41.5035, -5.7446, 2],
  ['Palencia', 'Castilla y León', 42.0095, -4.5288, 2],
  ['Toledo', 'Castilla-La Mancha', 39.8628, -4.0273, 4],
  ['Albacete', 'Castilla-La Mancha', 38.9943, -1.8585, 5],
  ['Ciudad Real', 'Castilla-La Mancha', 38.9848, -3.9274, 3],
  ['Cuenca', 'Castilla-La Mancha', 40.0704, -2.1374, 2],
  ['Guadalajara', 'Castilla-La Mancha', 40.6328, -3.1673, 3],
  ['Mérida', 'Extremadura', 38.9161, -6.3437, 3],
  ['Badajoz', 'Extremadura', 38.8794, -6.9707, 5],
  ['Cáceres', 'Extremadura', 39.4753, -6.3724, 4],
  ['Murcia', 'Región de Murcia', 37.9922, -1.1307, 12],
  ['Cartagena', 'Región de Murcia', 37.6257, -0.9966, 6],
  ['Lorca', 'Región de Murcia', 37.6772, -1.7008, 3],
  ['Palma', 'Islas Baleares', 39.5696, 2.6502, 10],
  ['Ibiza', 'Islas Baleares', 38.9067, 1.4206, 3],
  ['Mahón', 'Islas Baleares', 39.8885, 4.2658, 2],
  ['Las Palmas de Gran Canaria', 'Canarias', 28.1235, -15.4363, 10],
  ['Santa Cruz de Tenerife', 'Canarias', 28.4636, -16.2518, 8],
  ['San Cristóbal de La Laguna', 'Canarias', 28.4874, -16.3159, 4],
  ['Arrecife', 'Canarias', 28.963, -13.5477, 2],
  ['Puerto del Rosario', 'Canarias', 28.5004, -13.8627, 2],
  ['Ceuta', 'Ceuta', 35.8894, -5.3213, 2],
  ['Melilla', 'Melilla', 35.2923, -2.9381, 2],
];

const VENUES = [
  'Plaza Mayor', 'Parque municipal', 'Centro cívico', 'Biblioteca pública', 'Casa de la Cultura',
  'Auditorio municipal', 'Mercado central', 'Polideportivo', 'Paseo marítimo', 'Jardín botánico',
  'Sala de conciertos', 'Ateneo', 'Teatro principal', 'Plaza del Ayuntamiento', 'Centro social del barrio',
  'Café librería', 'Coworking del centro', 'Museo de la ciudad', 'Estación de autobuses (punto de encuentro)', 'Mirador',
];

// Categorías: plantillas de título y descripción. {city} se sustituye por la ciudad.
const CATEGORIES = [
  { w: 10, titles: ['Concierto acústico en {city}', 'Noche de jazz', 'Jam session abierta', 'Concierto de bandas locales', 'Coro popular: ensayo abierto'],
    desc: 'Música en directo en un ambiente cercano. Entrada libre hasta completar aforo. Trae a quien quieras.', dur: [2, 3], hours: [19, 20, 21] },
  { w: 9, titles: ['Ruta de senderismo por los alrededores de {city}', 'Paseo fotográfico por el casco antiguo', 'Ruta en bici por la ciudad', 'Caminata matinal', 'Ruta urbana de arquitectura'],
    desc: 'Punto de encuentro a la hora indicada. Calzado cómodo, agua y ganas de caminar. Ritmo tranquilo, apto para todos.', dur: [2, 4], hours: [9, 10, 11] },
  { w: 8, titles: ['Taller de introducción a la IA', 'Aprende a usar el móvil sin miedo', 'Taller de cerámica para principiantes', 'Taller de cocina de temporada', 'Iniciación a la fotografía con móvil'],
    desc: 'Taller práctico y sin conocimientos previos. Plazas limitadas: apúntate para que sepamos cuántos seremos.', dur: [2, 2], hours: [10, 11, 17, 18] },
  { w: 7, titles: ['Partido amistoso de fútbol 7', 'Running de grupo: 5 km', 'Yoga al aire libre', 'Torneo de pádel amateur', 'Clase abierta de baile'],
    desc: 'Actividad deportiva abierta a todos los niveles. Ven con ropa cómoda. Si llueve, te avisamos en el foro.', dur: [1, 2], hours: [8, 9, 10, 18, 19] },
  { w: 7, titles: ['Mercadillo de segunda mano', 'Mercado de productores locales', 'Feria de artesanía', 'Intercambio de libros', 'Trueque de ropa y juguetes'],
    desc: 'Puestos de vecinos y productores de la zona. Ideal para ir en familia y descubrir cosas nuevas.', dur: [4, 5], hours: [10, 11] },
  { w: 6, titles: ['Cine fórum: clásicos en VOSE', 'Proyección al aire libre', 'Club de lectura mensual', 'Tertulia de historia local', 'Presentación de libro y firma'],
    desc: 'Después habrá coloquio con café. Puedes venir aunque no hayas visto la película o leído el libro.', dur: [2, 3], hours: [18, 19, 20] },
  { w: 6, titles: ['Ruta de tapas por el centro', 'Cata de vinos de la tierra', 'Degustación de quesos artesanos', 'Comida popular solidaria', 'Taller de pan casero'],
    desc: 'Plan gastronómico para conocer gente y sabores de la zona. Cada cual paga lo suyo salvo que se indique.', dur: [2, 3], hours: [13, 14, 20, 21] },
  { w: 5, titles: ['Quedada de juegos de mesa', 'Intercambio de idiomas', 'Encuentro de nuevos vecinos', 'Afterwork para conocer gente', 'Noche de trivial'],
    desc: 'Ambiente relajado para charlar y conocer gente nueva. No hace falta venir acompañado.', dur: [2, 3], hours: [18, 19, 20] },
  { w: 4, titles: ['Voluntariado: limpieza de playa y entorno', 'Recogida de alimentos', 'Plantación de árboles', 'Acompañamiento a personas mayores', 'Taller de reparación de bicis'],
    desc: 'Actividad solidaria abierta. Ponemos el material; tú pones las manos. Gracias por sumarte.', dur: [2, 3], hours: [10, 11] },
  { w: 3, titles: ['Visita guiada al museo', 'Exposición de artistas locales', 'Ruta de leyendas nocturna', 'Visita al patrimonio histórico', 'Observación astronómica'],
    desc: 'Actividad cultural con guía. Las plazas son limitadas, así que apúntate y llega con cinco minutos de margen.', dur: [1, 2], hours: [11, 12, 18, 21] },
];

// Temporada: actividades extra con fecha fija.
const SEASONAL = [
  { from: '2026-10-28', to: '2026-10-31', titles: ['Pasaje del terror de Halloween', 'Fiesta de disfraces de Halloween', 'Ruta de cuentos de miedo'], hours: [18, 20, 22] },
  { from: '2026-11-01', to: '2026-11-02', titles: ['Castañada popular', 'Ruta por la historia del cementerio antiguo'], hours: [11, 17] },
  { from: '2026-12-04', to: '2026-12-08', titles: ['Ruta por los belenes de {city}', 'Encendido del alumbrado navideño'], hours: [18, 19] },
  { from: '2026-12-10', to: '2026-12-23', titles: ['Mercadillo navideño', 'Concierto de villancicos', 'Recogida de juguetes solidaria', 'Taller de adornos navideños'], hours: [11, 17, 19] },
  { from: '2026-12-26', to: '2026-12-31', titles: ['San Silvestre popular', 'Despedida del año en la plaza'], hours: [17, 22] },
];

const FIRST_NAMES = ['Lucía', 'Hugo', 'Martina', 'Mateo', 'Sofía', 'Leo', 'Julia', 'Daniel', 'Paula', 'Álvaro', 'Carmen', 'Pablo', 'Laura', 'Manuel', 'Elena', 'Javier', 'Marta', 'Sergio', 'Ana', 'David', 'Irene', 'Adrián', 'Nerea', 'Iker', 'Aitana', 'Xabier', 'Uxía', 'Pol', 'Núria', 'Jordi'];
const LAST_NAMES = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Gil', 'Vidal', 'Etxeberria', 'Castro'];

function pickWeighted(rand, items, weight) {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = rand() * total;
  for (const x of items) {
    r -= weight(x);
    if (r <= 0) return x;
  }
  return items[items.length - 1];
}

const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);
}

// Desplaza unas coordenadas hasta ~radiusKm de forma aleatoria.
function jitter(rand, lat, lon, radiusKm) {
  const r = radiusKm * Math.sqrt(rand());
  const a = rand() * 2 * Math.PI;
  return {
    lat: Number((lat + (r / 111.32) * Math.sin(a)).toFixed(6)),
    lon: Number((lon + (r / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a)).toFixed(6)),
  };
}

function generate(count = COUNT, seed = 2026) {
  const rand = mulberry32(seed);
  const users = Array.from({ length: 120 }, (_, i) => ({
    id: `${DEMO_PREFIX}${i + 1}`,
    name: `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`,
  }));

  const events = [];
  const seasonalCount = Math.round(count * 0.12);
  for (let i = 0; i < count; i++) {
    const [city, region, cLat, cLon] = pickWeighted(rand, CITIES, (c) => c[4]);
    let title;
    let description;
    let day;
    let hour;
    let durationH;
    if (i < seasonalCount) {
      const s = pick(rand, SEASONAL);
      day = addDays(s.from, Math.floor(rand() * (daysBetween(s.from, s.to) + 1)));
      title = pick(rand, s.titles).replace('{city}', city);
      description = `Actividad de temporada en ${city}. Ven con tiempo, que suele llenarse. Cualquier novedad la contamos en el foro del evento.`;
      hour = pick(rand, s.hours);
      durationH = 2;
    } else {
      const cat = pickWeighted(rand, CATEGORIES, (c) => c.w);
      day = addDays('2026-10-01', Math.floor(rand() * 92)); // 1 oct – 31 dic
      title = pick(rand, cat.titles).replace('{city}', city);
      description = `${cat.desc}\n\nActividad de prueba generada para la demo de WhatWhenAndWhere.`;
      hour = pick(rand, cat.hours);
      durationH = cat.dur[0] + Math.floor(rand() * (cat.dur[1] - cat.dur[0] + 1));
    }
    const minutes = pick(rand, [0, 0, 0, 30, 30, 15, 45]);
    const startsAt = `${day}T${pad(hour)}:${pad(minutes)}`;
    let endsAt = null;
    if (rand() < 0.7) {
      const endMinutes = hour * 60 + minutes + durationH * 60;
      if (endMinutes < 24 * 60) endsAt = `${day}T${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`;
    }
    const venue = pick(rand, VENUES);
    // Radio pequeño para no caer en el mar en ciudades costeras; Madrid es interior y extensa.
    const coords = jitter(rand, cLat, cLon, city === 'Madrid' ? 5 : 1.5);
    const owner = pick(rand, users);
    const attendeeCount = Math.floor(rand() * rand() * 25);
    const attendees = new Set([owner.id]);
    while (attendees.size < attendeeCount + 1) attendees.add(pick(rand, users).id);
    events.push({
      ownerId: owner.id,
      title: title.slice(0, 120),
      description,
      startsAt,
      endsAt,
      place: `${venue}, ${city}, ${region}`,
      lat: coords.lat,
      lon: coords.lon,
      attendees: [...attendees],
    });
  }
  return { users, events };
}

async function seed() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM www.users WHERE id LIKE $1`, [`${DEMO_PREFIX}%`]);
    if (rows[0].n > 0) {
      console.log('Datos de prueba: ya existen, no se vuelven a crear.');
      return;
    }
    const { users, events } = generate();
    await client.query('BEGIN');
    for (const u of users) {
      await client.query('INSERT INTO www.users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [u.id, u.name]);
    }
    const BATCH = 100;
    for (let i = 0; i < events.length; i += BATCH) {
      const chunk = events.slice(i, i + BATCH);
      const values = [];
      const params = [];
      chunk.forEach((e, j) => {
        const b = j * 8;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, ($${b + 4}::timestamp AT TIME ZONE 'Europe/Madrid'), ($${b + 5}::timestamp AT TIME ZONE 'Europe/Madrid'), $${b + 6}, $${b + 7}, $${b + 8})`);
        params.push(e.ownerId, e.title, e.description, e.startsAt, e.endsAt, e.place, e.lat, e.lon);
      });
      const inserted = await client.query(
        `INSERT INTO www.events (owner_id, title, description, starts_at, ends_at, place, lat, lon)
         VALUES ${values.join(', ')} RETURNING id`,
        params
      );
      const att = [];
      const attParams = [];
      inserted.rows.forEach((row, j) => {
        for (const userId of chunk[j].attendees) {
          attParams.push(row.id, userId);
          att.push(`($${attParams.length - 1}, $${attParams.length})`);
        }
      });
      if (att.length) {
        await client.query(`INSERT INTO www.attendees (event_id, user_id) VALUES ${att.join(', ')} ON CONFLICT DO NOTHING`, attParams);
      }
    }
    await client.query('COMMIT');
    console.log(`Datos de prueba: creadas ${events.length} actividades y ${users.length} perfiles.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function clear() {
  const { rowCount } = await pool.query(`DELETE FROM www.users WHERE id LIKE $1`, [`${DEMO_PREFIX}%`]);
  console.log(`Datos de prueba: borrados ${rowCount} perfiles y sus actividades.`);
}

async function runFromEnv() {
  const mode = (process.env.DEMO_EVENTS || '').toLowerCase();
  if (mode === 'seed') await seed();
  else if (mode === 'clear') await clear();
}

module.exports = { generate, seed, clear, runFromEnv, CITIES, DEMO_PREFIX };
