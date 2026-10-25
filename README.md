# WhatWhenAndWhere

App de eventos de [theaipeoplehub](https://theaipeoplehub.com): cualquier persona crea un evento con
**nombre, descripción, fecha y lugar**, otras personas se **apuntan** y cada evento tiene su **foro**.

- Node.js + Express, páginas renderizadas en el servidor (sin build).
- Login único con **Keycloak** (OpenID Connect, Authorization Code + PKCE).
- PostgreSQL en el esquema `www` (puede compartir base de datos con otras apps).
- Mapas abiertos: **MapLibre GL** con teselas de **OpenFreeMap** (datos de OpenStreetMap), sin claves de API.
- Autocompletado de direcciones con **Photon** (OpenStreetMap), a través de `/geo/search` y `/geo/reverse` con caché y límite de peticiones. `PHOTON_URL` permite usar un servidor Photon propio.

## Funcionalidades

| Qué | Quién |
| --- | --- |
| Ver eventos próximos y pasados, buscar por texto y filtrar por ubicación (radio en km) y fechas | Cualquiera |
| Ver los eventos en un mapa y cómo llegar | Cualquiera |
| Ver el detalle, quién va y el foro | Cualquiera |
| Crear un evento (queda apuntado automáticamente) | Usuarios con sesión |
| Apuntarse / desapuntarse de eventos próximos | Usuarios con sesión |
| Comentar en el foro | Usuarios con sesión |
| Editar o borrar un evento | Quien lo organiza |
| Borrar un comentario | Su autor o quien organiza el evento |

## Variables de entorno

| Variable | Ejemplo | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | URL interna de la Postgres en Render | Conexión a la base de datos |
| `SESSION_SECRET` | cadena aleatoria larga | Firma de la cookie de sesión |
| `OIDC_ISSUER` | `https://keycloak-8s55.onrender.com/realms/theaipeoplehub` | Realm de Keycloak |
| `OIDC_CLIENT_ID` | `whatwhenandwhere` | Cliente OIDC en Keycloak |
| `OIDC_CLIENT_SECRET` | (de Keycloak) | Secreto del cliente |
| `BASE_URL` | `https://whatwhenandwhere.onrender.com` | URL pública (por defecto, la que da Render) |
| `PLATFORM_URL` | `https://theaipeoplehub-platform.onrender.com` | Enlaces al portal y a los textos legales |

## En local

```bash
npm install
DATABASE_URL=postgres://localhost/www SESSION_SECRET=dev OIDC_ISSUER=... OIDC_CLIENT_ID=... OIDC_CLIENT_SECRET=... npm start
```

En Keycloak, añade `http://localhost:3000/auth/callback` a las *Valid redirect URIs* del cliente.

## Base de datos

`db/schema.sql` se ejecuta en cada arranque y es idempotente: crea el esquema `www` y sus tablas
(`users`, `events`, `attendees`, `comments`, `session`). Las fechas se guardan en UTC y se muestran
en hora de España (`APP_TIMEZONE`, por defecto `Europe/Madrid`).
