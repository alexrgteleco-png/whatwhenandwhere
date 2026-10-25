'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta la variable DATABASE_URL');
  process.exit(1);
}

// La URL interna de Render no usa TLS; la externa (*.render.com) sí lo exige.
const useSsl = process.env.DATABASE_SSL === 'true' || /\.render\.com/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX || 5),
});

pool.on('error', (err) => console.error('Error en el pool de PostgreSQL:', err.message));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, migrate };
