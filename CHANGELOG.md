# Changelog

## 0.7.0 — Integration layer and eligibility checks

- Integration hub: per-organization connections with encrypted API keys, vendor adapters behind
  one contract, retries with backoff, and a metadata-only message log (no patient details).
- Eligibility checks (X12 270/271) through a clearinghouse: Stedi adapter plus a built-in
  simulator the demo clinic uses out of the box.
- Integrations page: connect, test and monitor the clearinghouse; recent calls with timing and
  errors. The request-only catalog stays below as "More integrations".
- Case page: Eligibility card with coverage status, plan, dates, the payer's prior-auth
  indicator, history, and a plain explanation when Payer ID, member ID or NPI is missing.
- Postgres tables with RLS; the key column is hidden from the Data API.
- 8 new tests (86 total) with a negative control; docs in docs/INTEGRATIONS.md.

## 0.6.0 — Bulk import and "does this need prior auth?"

### Bulk import (Import data page, Import CSV buttons on Patients, Providers and Payers)
- CSV import for payers, providers, patients and payer prior-auth rules, with a downloadable
  template for each.
- Recognizes common export headers ("Patient Last Name", "DOB", "Subscriber ID", "Payer ID"...).
- Preview before anything is saved: every row marked new, update, skip or error with the reason;
  unused columns shown; downloadable error file (formula-safe) to fix and re-upload.
- Duplicates matched by MRN, NPI, payer ID or name, or payer + code; choose skip or update.
  Duplicates inside the same file are caught too.
- Reuses the app's validation: NPI check digits, dates (YYYY-MM-DD or MM/DD/YYYY, no future
  birth dates), sex values, payer lookup, payer types with timeframe defaults.
- Re-validated on commit from the raw file; valid rows written in one transaction; file never
  stored; 5,000 rows / 2 MB per file; owners, admins and managers only; audited.

### Payer prior-auth rules (Payers > Prior-auth rules)
- Record, per payer, which CPT/HCPCS codes require prior auth, by exact code or family prefix
  (7214*). Exact codes beat prefixes. Codes with no rule show "No rule on file", never "exempt".
- New request form shows the requirement next to each line and summarizes it in the packet preview.
- Case page adds a Payer rule column, a note when rules say no auth is needed (so the request can
  be withdrawn), and a prompt to add rules for unknown codes.
- Managers and above edit rules; demo data includes sample rules.
- Postgres table with RLS and a same-organization payer check.

9 new tests (78 total) and SQL checks.

## 0.5.0 — Automatic provisioning and form polish

### SCIM 2.0 provisioning
- `/api/scim/v2` for Microsoft Entra ID and Okta: list with filters, get, create, replace, patch
  (including Entra's `"False"` string values) and delete Users; ServiceProviderConfig and
  ResourceTypes.
- Deactivation suspends the membership and ends every session at once; records are kept.
- Owners are protected from SCIM changes; only verified-domain emails are accepted; tenant
  isolation by token.
- Token generated in Settings > Security, shown once, stored as a SHA-256 hash, replaceable and
  revocable. Last sync time shown.
- Postgres: token and external-ID columns, token hash hidden from the Data API.
- 6 new tests plus a negative control.

### UI (remaining items from the enhancement brief)
- Authorization form: sticky section menu that follows your scroll, live packet preview, Duplicate
  line button, and a save bar pinned to the bottom on phones.
- Dialogs: errors now appear inside the dialog, and validation messages sit under the field they
  belong to.

## 0.4.0 — Single sign-on

- Organizations sign in with Microsoft Entra ID, Google Workspace, or any OpenID Connect provider
  (Okta, Ping, OneLogin). Authorization code flow with PKCE, state and nonce; ID tokens verified
  against the provider's keys, issuer, audience and age.
- Per-provider trust rules: Entra tokens must come from the organization's tenant and accounts are
  keyed on tenant + object ID (never the email claim alone); Google requires a verified Workspace
  hosted domain, so personal Gmail is refused; other OIDC providers require a verified email.
- Email domains proven through a DNS TXT record. Public mail domains cannot be claimed, and a
  verified domain can belong to only one organization.
- Automatic accounts on first sign-in (optional) with a default role capped at Manager; existing
  members are linked by their verified email.
- "Require SSO": member passwords stop working and existing password sessions end. Owners keep
  password + MFA as a break-glass way in, and each such sign-in is audited.
- MFA for SSO users is enforced by the organization's identity provider.
- Admin screen in Settings > Security with DNS instructions and per-provider setup; "Sign in with
  SSO" on the login page.
- Audit events for SSO settings, domains, sign-ins, failures and provisioning.
- Postgres: sso_connections, sso_domains and user_identities with RLS (admin-only), a unique index
  for verified domains, and the client secret column hidden from the Data API.
- 11 new tests against a mock identity provider that signs real tokens (63 total), plus SQL checks.

## 0.3.0 — UI enhancement (phases 1, 3 and most of 4 from docs/UI_ENHANCEMENT_PROMPT.md)

### Look and feel
- New "Lagoon & Harbor" palette: deep lagoon teal for actions, harbor navy sidebar, cool mist
  background, semantic critical/warning/success/info colors, and an iris color used only for AI output.
  Light and dark mode both defined.
- New flow mark logo. Active nav item gets an accent bar and `aria-current`.
- Status badges carry an icon per status; alerts carry a severity icon, so nothing relies on color alone.
- Reduced-motion users get no animation.

### Case workspace
- Stage tracker (Prepare, Review, With payer, Decision, Appeal, Closed) built from the real statuses,
  with "waiting on us" and "withdrawn" states and a compact phone view. Mapping in
  `components/authorizations/stage.ts` with unit tests.
- One primary action per status (Finish packet, Mark ready for review, Submit to payer, Record
  decision, Upload requested info, File appeal, Close case); the rest in a More actions menu.
- Alerts as a banner stack with a direct action on each.
- Packet checklist with icons, "n of m ready", progress bar and fix links.
- Overview regrouped into Service lines, Payer decision, Dates, People and Coverage cards;
  approved against requested units with cues for reduced and denied lines.
- Add task, Add note and Run AI analysis live on their tabs.
- Dialogs open as bottom sheets on phones; save buttons show a spinner; decision form shows a
  summary of what will be recorded.

### Dashboard and queue
- Greeting and a plain-language summary built from real counts.
- KPI cards grouped into Payer clock, Decisions and Workload, linking to matching queue filters.
- "Work to do first" with severity icons, short patient names, an Open case button and an
  all-caught-up state.
- Queue: short alert labels, phone card list, filters behind a button on phones, removable filter
  chips with Clear all, and a helpful empty state.

### States
- Loading skeletons for dashboard, queue, case and patient pages; console error boundary.

### Tests
- e2e: Add task, Add note and Run AI analysis are now clicked on their tabs.
- New unit test for the stage mapping (52 tests total).

### Not done yet (phase 2 and the rest of phase 4)
- Authorization form: section menu, live checklist preview, Duplicate line.
- Inline field errors inside dialogs.
- Consistent styling for the remaining plain selects across the app.
- Visual pass at 1440/1024/768/390 in a real browser (no browser was available when building this).

## 0.2.0 — workflow and security hardening

### Prior authorization
- Service lines (CPT/HCPCS, units, unit type, modifiers) and multiple ICD-10-CM diagnoses replace
  the single procedure and diagnosis code.
- Ordering and rendering provider, place of service, site of care, facility, review type.
- New statuses: Partially approved, Withdrawn. Decisions recorded only through Record decision,
  with payer reference, decision date, per-line approved units, approved window, denial reason and
  determination letter.
- Packet checklist gates Ready for review and Submitted, including payer-required documents.
- Submitted requests are locked; Reschedule and Start replacement request cover the real changes.
- Payer timeframes per payer, due times, clock pause on info requests, appeal deadlines, late
  appeals need a manager, peer-to-peer tracking.
- Alerts, alert filter in the queue, dashboard counts; metrics from recorded outcomes, payer
  on-time rate, denial reasons.
- Case numbers from a per-organization counter.

### Security
- TOTP MFA with recovery codes and an organization-level requirement.
- Inactivity sign-out, 12-hour sessions, server-side revocation.
- scrypt N=2^15 with automatic upgrade; 12-character minimum; equal timing for unknown emails.
- Password resets and invitations emailed; no reset links on screen outside demo mode.
- AES-256-GCM encryption at rest for the store, documents and MFA secrets.
- Atomic, locked, versioned file store with migrations; opened at startup.
- Audit of every case and patient view; changed-field audit on updates.
- Fixed: audit metadata dropped `authorizationId` because the redaction pattern matched it.
- CSP with per-request nonce, HSTS, COOP; self-hosted fonts.
- Production config guard at startup.
- AI: identifier-free model input, document text extraction, BAA gate, timeouts.

### Database
- New migration with lines, diagnoses, workflow columns, transition table and triggers,
  database-side audit, MFA (AAL2) enforcement, restricted `record_audit`.
- Executable SQL tests on PostgreSQL.
