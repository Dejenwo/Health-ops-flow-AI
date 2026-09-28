# Production readiness

What this build does, what was checked, and what still stands between it and real patient data.
Nothing here is a legal or HIPAA certification.

## Supported deployment today

One long-lived Node.js process on a single host (a VM or a container with a persistent volume),
behind HTTPS, with the encrypted file store. That fits a pilot with one or a few clinics.

The server refuses to start in production unless `SESSION_SECRET`, `HF_DATA_KEY`,
`NEXT_PUBLIC_APP_URL` (https), `RESEND_API_KEY` and `EMAIL_FROM` are set, demo mode is off, and
any remote AI model has `AI_BAA_CONFIRMED=true`. It also refuses serverless hosts, because the
file store needs a persistent disk.

## Prior authorization workflow

| Area | Behavior |
| --- | --- |
| Request content | Multiple CPT/HCPCS lines with units, unit type and modifiers. Multiple ICD-10-CM diagnoses, first is primary. Ordering and rendering provider, place of service, site of care, facility |
| Validation | NPI check digit, CPT/HCPCS/ICD-10-CM/modifier/POS formats, in the form, the service and Postgres |
| Packet checklist | Member ID, valid lines and diagnoses, valid ordering NPI, place of service, clinical support document, and any documents the payer requires. Blocks Ready for review and Submitted |
| Lock | Clinical content is frozen once submitted. Date changes use Reschedule. Anything else uses Start replacement request, which links the new draft and withdraws the old one |
| Payer clock | Due time set at each submission from the payer's standard days or expedited hours. Paused while the payer is waiting on information. Restarted on resubmission and on appeal |
| Decisions | Only through Record decision: payer reference, payer decision date, approved units per line, approved window, and for denials and partial approvals the reason and the determination letter |
| After a decision | Appeal deadline from the payer's appeal window. Tasks for letters, out-of-window service dates and appeal decisions. Late appeals need a manager |
| Alerts | Payer overdue or due within 24 hours, info requested, approval expiring or expired, service date outside the window, appeal deadline near, urgent not submitted, stale drafts, missing letter |
| Metrics | Approval, denial and partial rates from the recorded outcome (so closed cases still count), payer on-time rate, denial reasons |

Timeframe defaults per payer type are starting points to confirm against each contract and the
rules that apply (for example CMS-0057-F, ERISA claims rules, state workers' comp rules).

## Security controls

- Sessions: signed httpOnly cookie, 12-hour absolute limit, per-organization inactivity limit
  (5–60 minutes, default 15), rolling refresh. Every request re-checks the account, the session
  version and the membership. Role comes from the membership, never the cookie.
- Revocation: password change, password reset, MFA changes and "Sign out everywhere" invalidate
  all existing sessions.
- MFA: TOTP with replay protection, 8 single-use recovery codes, secrets encrypted at rest.
  Organizations can require it; members without it are signed out and routed to enrollment.
- Passwords: scrypt N=2^15, minimum 12 characters, older hashes upgraded at sign-in, equal
  timing for unknown emails, lockout after repeated failures.
- Password reset and invitations are emailed. The response is the same whether or not the email
  exists. On-screen links exist only in demo mode.
- Encryption at rest: AES-256-GCM for the store, every uploaded document and MFA secrets. A
  wrong key stops the server at startup without touching the data.
- Store durability: atomic write (temp file, fsync, rename), previous copy kept as
  `store.json.bak`, cross-process lock, files created with mode 600, versioned schema with
  migrations.
- Headers: CSP with a per-request nonce and `strict-dynamic`, HSTS, frame denial, no-sniff,
  COOP, and `no-store` on authenticated pages. Fonts are self-hosted.
- Audit: every case and patient page view, document download, sign-in, failed sign-in, status
  change, decision, reschedule, peer-to-peer, security setting change. Case updates record which
  fields changed.
- AI: the model never receives name, date of birth, MRN, member ID, address, phone, email or
  staff names. Document excerpts and free text are filtered for them again. Remote models are
  off until a BAA is confirmed, calls time out, and OpenAI calls set `store: false`.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | Clean |
| Lint | `npm run lint` | 0 errors |
| Unit and integration tests | `npm test` | 48 passing |
| Postgres rules | `npm run test:db` | Migrations apply on PostgreSQL 16; database rejects illegal transitions, edits after submission, denials without a letter, late appeals by specialists, bad codes, cross-tenant reads, and AAL1 access to MFA-required orgs. Negative control confirmed |
| HTTP smoke test | `npm run test:smoke` against `next start` | 27 checks passing: CSP nonce on every script, HSTS, redirects, idle sign-out, revoked sessions, MFA gating, every new screen, audit of views |
| Browser flow | `npm run test:e2e` | Updated for the new form and decision flow. Runs in CI; not run in the sandbox this pass was built in |

## Still required before real PHI

These are outside the code:

- A BAA with the hosting provider, email provider, backup storage and any AI vendor.
- HIPAA risk analysis, policies, workforce training, and a named security officer.
- Encrypted, backed-up volume for `HF_DATA_DIR`, with a tested restore.
- Key management for `HF_DATA_KEY` and `SESSION_SECRET` (secrets manager, rotation plan).
- An independent penetration test.
- Log shipping to a store operators cannot edit, with a retention period.

## Next engineering step: Postgres at runtime

The Postgres schema, RLS policies, triggers and audit rules are written and tested
(`supabase/migrations`). The running app still reads and writes the encrypted file store through
`lib/store`. Moving to Postgres means rewriting the service layer's in-memory queries as SQL
queries. It is needed before running more than one server process across hosts, before large
tenants, and before letting any client call the database directly.

Also planned: SSO/SCIM, shared rate limiting, OCR for scanned documents, electronic submission
(X12 278 or FHIR Da Vinci PAS), and payer coverage-rule lookup.
