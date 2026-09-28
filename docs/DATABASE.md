# Database

Two representations exist. The application reads and writes the demo repository. The SQL migration is the contract for a future Supabase PostgreSQL database.

## Demo repository

`lib/domain/types.ts` defines `Database`. `lib/demo/seed.ts` builds the initial document. `lib/store` persists it to `data/store.json` unless `HF_STORE=memory`.

Collections:

| Collection | Tenant key | Notes |
| --- | --- | --- |
| users | none | Credentials. Password hashes only |
| profiles | none | Name, title, phone, onboarding flag |
| organizations | id | Northstar is marked synthetic |
| organizationMembers | organizationId | Role and status |
| patients | organizationId | Synthetic demographics |
| providers | organizationId | Fictional NPI placeholders |
| payers | organizationId | Notes state there is no electronic connection |
| authorizationCases | organizationId | Workflow record |
| authorizationStatusHistory | organizationId | Previous status, new status, actor, reason |
| authorizationDocuments | organizationId | Metadata. Bytes live outside the JSON document |
| caseNotes | organizationId | |
| tasks | organizationId | |
| activityEvents | organizationId | Timeline |
| aiRuns | organizationId | Structured output and fingerprint |
| notifications | organizationId | Per user |
| auditEvents | organizationId | Append-only in services |
| integrationConnections | organizationId | Request records, not live links |
| subscriptions | organizationId | Local plan status |
| invitations | organizationId | Token hash, expiry, role |
| passwordResetTokens | none | Demo only. Not in the SQL migration yet |
| contactRequests | none | Marketing contact form. Stored locally, not emailed |

Document bytes use keys `orgs/{organizationId}/{id}.ext`. Seed documents use `seed/{organizationId}/{documentId}.txt` and are generated on download if the file is missing. Paths are not public URLs.

## PostgreSQL migration

File: `supabase/migrations/20260926120000_init.sql`.

Tables use UUID primary keys, `created_at` / `updated_at`, and `organization_id` on tenant data. Checks constrain roles, authorization statuses, priorities, task statuses, and document categories. Indexes cover organization foreign keys and the columns used by lists (status, assignee, dates).

`set_updated_at()` maintains `updated_at`. `role_rank()` and `has_min_role()` support policies. `current_org_ids()` returns organization ids for `auth.uid()` and is `security definer` with a fixed `search_path`.

Row level security is enabled on:

profiles, organizations, organization_members, patients, providers, payers, authorization_cases, authorization_status_history, authorization_documents, case_notes, tasks, activity_events, ai_runs, notifications, audit_events, integration_connections, subscriptions, invitations.

Select policies require membership in the row's organization. Write policies additionally call `has_min_role`. There are no delete policies on operational tables. `audit_events` has a select policy and a trigger that rejects update and delete with `audit_events are append-only`.

Storage: a private bucket `authorization-documents`. Object policies allow access only when the first folder matches an organization the user belongs to. The application download route does not use this bucket yet.

`supabase/tests/tenant_isolation.sql` is a commented checklist for a live database. It is not executed in CI because no Postgres service is provisioned. Application isolation is covered by `tests/integration/workflow.test.ts`.

## Applying the migration later

```bash
supabase link --project-ref <ref>
supabase db push
```

After apply, a Supabase adapter must replace `getStore()` before `DATA_PROVIDER` can mean anything. Until that adapter exists, the Next.js app ignores the hosted database.

## Seed shape

Northstar Specialty Clinic is the demo tenant (professional plan, status DEMO). Counts are approximately:

- 30 patients
- 5 providers (`DEMO-NPI-####`)
- 6 payers (Northwind, Harbor Mutual, Cedar Point PPO, Summit Advantage, Redwood Community Plan, Pinnacle WorkCover)
- 50 cases across draft, needs information, ready for review, submitted, pending, additional information requested, approved, denied, appealed, and closed
- Tasks, notes, document metadata, AI runs, notifications, and one audit event
- One open invitation

Lakeside Imaging Cooperative holds patient Rowan Isolated, case `PA-LK-9001`, and a Lakeside-only task. Northstar queries must not return those rows.

## Schema version 2 (workflow hardening)

The file store carries `schemaVersion`. `lib/store/migrate.ts` upgrades a v1 file at startup:
the single procedure and diagnosis codes become service lines and diagnoses, `expirationDate`
becomes `validTo`, payers get timeframe defaults by type, users get session and MFA fields, and
organizations get security settings and a case-number counter.

`supabase/migrations/20260927120000_workflow_hardening.sql` does the same in Postgres and adds:

- `authorization_lines` and `authorization_diagnoses` with format checks and RLS
- decision, approved window, appeal, peer-to-peer and replacement columns on `authorization_cases`
- payer timeframe columns and required documents
- `authorization_transitions` plus the `enforce_authorization_rules` trigger (illegal
  transitions, decisions without evidence, edits after submission, late appeals)
- a trigger that audits every case update from inside the database
- `next_case_number()` for race-free numbering, `is_valid_npi()`
- MFA enforcement: organizations with `require_mfa` are invisible to AAL1 sessions
- `record_audit()` restricted to access events

`npm run test:db` applies both migrations to a throwaway PostgreSQL cluster and runs
`supabase/tests/workflow_rules.sql`.
