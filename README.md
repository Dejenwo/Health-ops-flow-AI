# HealthFlow AI

HealthFlow AI is a prior-authorization workspace for healthcare organizations. Staff build the
request (service lines, diagnoses, providers, place of service), check the packet, submit, track
the payer's deadline, record the payer's decision with its evidence, and handle appeals. AI drafts
summaries and follow-ups that a person reviews before use.

It does not diagnose, prescribe, determine medical necessity, or approve or deny cases. It is not
a medical device and it is not HIPAA certified. See `docs/PRODUCTION_READINESS.md` before using it
with real patient data.

## Workflow

```
Draft ──▶ Ready for review ──▶ Submitted ──▶ Pending ──▶ Approved ─────────▶ Closed
  ▲  │      (packet checklist     (payer clock    │   ├─▶ Partially approved ─▶ Appealed / Closed
  │  ▼       must pass)            starts)        │   └─▶ Denied ─────────────▶ Appealed / Closed
Needs information                                 └─▶ Info requested (clock paused) ─▶ Ready for review
Any open case ─▶ Withdrawn
```

- Decisions are recorded only through **Record decision**, with the payer reference, decision
  date, approved units per line, approved window, and for adverse decisions the reason and letter.
- Submitted requests are locked. **Reschedule** changes the date; **Start replacement request**
  files an amended request linked to the original.
- Alerts cover payer overdue, approvals expiring or out of window, appeal deadlines, urgent work
  not submitted, stale drafts and missing letters. They drive the dashboard and the queue filter.

## Onboarding a practice

Import payers first, then providers, patients and payer prior-auth rules from CSV exports
(Import data page). Each import shows a preview with row-level errors before anything is saved.

## Architecture

The UI is a Next.js App Router application. Business rules live in `lib/domain` and
`lib/services`. Server Actions and route handlers call services with a `RequestContext` rebuilt
from the database on every request.

```
app/            routes, layouts, server actions
components/     UI
lib/domain      types, permissions, state machine, readiness, payer timeframes, code checks
lib/services    tenant-scoped operations
lib/ai          provider interface, mock, Anthropic, OpenAI
lib/store       encrypted file store with locking and schema migrations
lib/security    encryption, redaction, upload checks
supabase/       Postgres schema, RLS, workflow triggers, SQL tests
scripts/        database tests and HTTP smoke test
```

The running data path is the file store (`HF_DATA_DIR/store.json`), encrypted with `HF_DATA_KEY`.
The Postgres migrations are written and tested but not yet used at runtime. See
`docs/ARCHITECTURE.md` and `docs/DATABASE.md`.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev        # http://127.0.0.1:43123
```

Development runs in demo mode with no configuration: it seeds a synthetic clinic, shows demo
accounts and shows password-reset links on screen. Production refuses to start until the required
settings are present. See `.env.example` and `docs/DEPLOYMENT.md`.

## Demo accounts

Password for every account: `Northstar-demo-2026`

| Email | Role | Organization |
| --- | --- | --- |
| owner@northstar.demo | OWNER | Northstar Specialty Clinic |
| admin@northstar.demo | ADMIN | Northstar Specialty Clinic |
| manager@northstar.demo | MANAGER | Northstar Specialty Clinic |
| specialist@northstar.demo | SPECIALIST | Northstar Specialty Clinic |
| viewer@northstar.demo | VIEWER | Northstar Specialty Clinic |
| rival@lakeside.demo | OWNER | Lakeside Imaging Cooperative |

The seed includes cases that trigger each alert: an overdue payer, an approval about to expire, a
service date outside its window, a denial near its appeal deadline, partial approvals and a
withdrawn request. Do not enter real patient information in demo mode.

## Testing

```bash
npm run typecheck
npm run lint
npm test               # 78 unit and integration tests
npm run test:db        # applies migrations to a throwaway PostgreSQL cluster and runs SQL checks
npm run build && npm start   # then, in demo mode only:
npm run test:smoke -- http://127.0.0.1:43123
npm run test:e2e       # Playwright: npx playwright install chromium first
```

CI runs all of these (`.github/workflows/ci.yml`).

## Security summary

Single sign-on with Microsoft Entra ID, Google Workspace or any OIDC provider, SCIM 2.0 provisioning
that removes access the moment someone is disabled (see `docs/SSO.md`),
MFA (TOTP, recovery codes, org-level requirement), 12-hour sessions with per-org inactivity
sign-out and server-side revocation, scrypt N=2^15, emailed resets and invitations,
AES-256-GCM encryption at rest, audit logging of every record view, nonce-based CSP and HSTS,
and minimum-necessary AI input gated on a BAA. Details in `docs/SECURITY.md`.

## Limitations

- Runtime storage is a single-host encrypted file. Multi-host deployments need the Postgres
  adapter (next engineering step).
- Rate limits are per process.
- No electronic submission to payers yet (X12 278 / FHIR Da Vinci PAS), no EHR connection, no OCR.
- Stripe checkout is not live.
- Real PHI also requires BAAs, a risk analysis, policies, backups with tested restore, and a
  penetration test.
