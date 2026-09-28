# Deployment

## Target

A single Node.js 22 process on a VM or container host with:

- HTTPS terminated by a load balancer or reverse proxy that forwards to port 43123
- a persistent, encrypted, backed-up volume mounted at `HF_DATA_DIR`
- secrets injected from a secrets manager

Serverless platforms are refused at startup until the Postgres adapter ships, because they do not
keep the data file.

## Steps

```bash
npm ci
npm run build
export NODE_ENV=production
export SESSION_SECRET="$(openssl rand -base64 48)"   # store in your secrets manager
export HF_DATA_KEY="$(openssl rand -base64 32)"      # store separately from the data
export HF_DATA_DIR=/var/lib/healthflow
export NEXT_PUBLIC_APP_URL=https://app.example.com
export RESEND_API_KEY=... EMAIL_FROM="HealthFlow <no-reply@example.com>"
npm start
```

If a setting is missing the process exits and lists every problem. Production starts with an
empty database; the first person to sign up owns their organization.

## Backups

Back up `HF_DATA_DIR` (store.json, store.json.bak and uploads/) on a schedule. The files are
encrypted, so the backup is only useful together with `HF_DATA_KEY`, which must be backed up
separately. Test a restore before go-live and at least quarterly.

## Upgrades

Stop the process, back up `HF_DATA_DIR`, deploy, start. The store is migrated at startup
(`lib/store/migrate.ts`). A data file from a newer build stops startup instead of being downgraded.

## Checks before go-live

```bash
npm run typecheck && npm run lint && npm test
npm run test:db                       # needs PostgreSQL binaries
npm run test:smoke -- https://staging.example.com   # against a demo-mode staging copy only
```

`test:smoke` signs a cookie for the demo owner, so run it only against synthetic data with
`HF_DEMO_MODE=true` and `HF_SKIP_CONFIG_CHECK=true`, never against production.

## Postgres (next step)

`supabase/migrations` holds the schema, RLS and workflow triggers. Apply them with
`supabase db push`. The app does not read from Postgres yet; see `docs/PRODUCTION_READINESS.md`.
