# Body Growth

A standalone pnpm workspace for the Body Growth personal measurement record. It
contains the React/Vite web app, Express API, shared health contract, ordered
PostgreSQL migrations, and regression tests. The application supports personal
registration and login, USER/ADMIN authorization, immutable measurement
revisions, and the Moore 2015 height-only reference display.

The reference display is not a diagnosis, future-height prediction, training
recommendation, or selection tool.

## Requirements

- Node.js 22 or newer
- pnpm 10
- PostgreSQL 15 or newer for migrations and application use

## Install

```sh
pnpm install --frozen-lockfile
```

For the first install before a lockfile exists, use `pnpm install`; commit the
generated `pnpm-lock.yaml`, then use the frozen command in automation.

Copy `.env.example` to `.env`, replace every placeholder locally, and load it
into the current shell:

```sh
set -a
. ./.env
set +a
```

Do not commit `.env`. The example contains variable names and placeholders only.

## Database migrations

Migrations are applied in filename order and recorded in
`body_growth.schema_migrations`:

```sh
pnpm db:migrate
```

The runner requires `DATABASE_URL`. It deliberately stops before writing if it
finds legacy Body Growth business data without the replacement migration
history. Back up the database and review the migration SQL before applying it.
Migration `005_remove_sitting_height.sql` also stops before changing the schema
when any recorded sitting-height value exists. Never point development or tests
at production.

## Development

After applying migrations and loading the environment:

```sh
pnpm dev
```

Vite listens on `WEB_PORT` (default `5173`), the API listens on `API_DEV_PORT`
(default `3001`), and Vite proxies same-origin browser requests under `/api` to
`API_DEV_ORIGIN`. Open `http://localhost:5173`; the browser never needs a
cross-origin API URL.

## Verify

The default suite does not require database credentials:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Database-backed auth coverage is opt-in. Use a disposable, already-migrated
database and loaded admin variables:

```sh
pnpm test:db
```

## Production start

Build first, load `DATABASE_URL`, `BODY_GROWTH_ADMIN_USERNAME`,
`BODY_GROWTH_ADMIN_PASSWORD`, `PORT`, and production settings, then run:

```sh
pnpm build
pnpm start
```

The Express process serves the built web app and `/api` from one origin.
Terminate TLS at a trusted reverse proxy and forward the original host. Health
checks are available at `/api/healthz`.

Production database connections require TLS certificate verification. Set
`DATABASE_SSL_CA` only when the database uses a private certificate authority;
otherwise the platform trust store is used.

## Workspace layout

- `apps/web` — React/Vite browser application
- `apps/api` — Express API and migration runner
- `packages/api-contract` — shared Zod response contract
- `db/migrations` — ordered PostgreSQL migrations
- `tests/unit` — authorization, domain, Moore, security, migration regressions
- `tests/integration` — Express routing plus opt-in disposable-database auth
