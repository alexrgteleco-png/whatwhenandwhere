-- Esquema de WhatWhenAndWhere. Se ejecuta en cada arranque y es idempotente.
-- Vive en su propio esquema ("www") para poder compartir base de datos con otras apps.

CREATE SCHEMA IF NOT EXISTS www;

CREATE TABLE IF NOT EXISTS www.users (
  id            text PRIMARY KEY,               -- "sub" de Keycloak
  name          text NOT NULL,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS www.events (
  id          bigserial PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES www.users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz CHECK (ends_at IS NULL OR ends_at >= starts_at),
  place       text NOT NULL CHECK (char_length(place) BETWEEN 2 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON www.events (starts_at);
CREATE INDEX IF NOT EXISTS events_owner_idx ON www.events (owner_id);

CREATE TABLE IF NOT EXISTS www.attendees (
  event_id  bigint NOT NULL REFERENCES www.events(id) ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES www.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS attendees_user_idx ON www.attendees (user_id);

CREATE TABLE IF NOT EXISTS www.comments (
  id         bigserial PRIMARY KEY,
  event_id   bigint NOT NULL REFERENCES www.events(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES www.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_event_idx ON www.comments (event_id, created_at);

-- Sesiones de usuario (formato de connect-pg-simple).
CREATE TABLE IF NOT EXISTS www.session (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON www.session (expire);
