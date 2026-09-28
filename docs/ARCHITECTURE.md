# Architecture

HealthFlow AI is a multi-tenant administrative workflow application. One Next.js process serves the marketing site, authentication, and the organization console.

## Boundaries

| Layer | Location | Responsibility |
| --- | --- | --- |
| Routes | `app/` | Pages, layouts, route handlers |
| Server actions | `app/actions/` | Parse form input, call services, revalidate |
| UI | `components/` | Presentation. No direct store access |
| Domain | `lib/domain/` | Types, Zod schemas, permissions, status transitions, labels |
| Services | `lib/services/` | Tenant-scoped reads and writes, audit, notifications |
| AI | `lib/ai/` | Provider interface. Server-only |
| Store | `lib/store/` | Repository used by services |
| SQL | `supabase/migrations/` | Future PostgreSQL schema and RLS |

Services accept an explicit `RequestContext`: user id, organization id, and role. The role is loaded from `organization_members` in the store. The session cookie carries a role only so the edge proxy can redirect incomplete onboarding. Services do not trust that cookie role for authorization.

Missing records and records that belong to another organization both return not found. List and search queries filter by `organizationId` before any other predicate.

## Request path

1. `proxy.ts` checks the HMAC session cookie, applies security headers, and redirects anonymous users to `/login`.
2. Console layouts call `getRequestContext()`, which verifies the cookie and reloads membership.
3. A server action validates input with Zod (`lib/domain/schemas.ts`) and calls a service.
4. The service checks `assertCan`, mutates only rows in the caller's organization, and appends activity plus audit events.
5. The store replaces the whole document after the mutation. Tests use an in-memory store (`HF_STORE=memory`). Development uses `data/store.json`.

## Authorization state machine

Transitions are listed in `lib/domain/transitions.ts`. Invalid moves throw before any write. Each successful move inserts `authorization_status_history` with the previous status, new status, actor, timestamp, and reason.

Draft cases can move to needs-information or ready-for-review. Ready-for-review can be submitted. Submitted cases become pending. Pending cases can be approved, denied, or sent back for additional information. Approved cases can close. Denied cases can be appealed or closed. Closed cases cannot move.

AI analysis does not call the transition function.

## Roles

`lib/domain/permissions.ts` is the server-side matrix.

- OWNER controls the organization, including assigning OWNER and ADMIN.
- ADMIN administers the organization but cannot grant OWNER or ADMIN.
- MANAGER runs workflow operations, assigns cases, and invites specialists and viewers.
- SPECIALIST works cases, tasks, notes, documents, and AI. Specialists cannot assign, change roles, manage billing, or read the audit log.
- VIEWER is read-only.

A user cannot change their own role. The last owner cannot be demoted.

## AI

`AIProvider` defines administrative methods: analyze a case, summarize documents, identify missing information, build a checklist, draft a case summary, draft a payer follow-up, and summarize a payer response. `getAIProvider()` returns `MockAIProvider` unless `AI_PROVIDER` is `anthropic` or `openai` and the matching API key is present. Remote calls use `fetch` on the server. Stored runs keep a fingerprint and the structured output, not the raw prompt.

The assistant page matches a fixed question list to service functions. It never executes generated SQL.

## Billing and integrations

Plan copy and prices live in `lib/billing/plans.ts`. Changing a plan in settings updates the local subscription row with status `DEMO`. No Stripe Checkout session is created.

The integrations page lists products as Available or Coming soon. Requesting an integration writes a connection row with status `REQUESTED`. Nothing is marked Connected.

## Session

`lib/auth/session-token.ts` signs `{ sub, org, role, onboarded, exp }` with HMAC-SHA256. The cookie name is `hf_session`. Passwords are stored as scrypt hashes. The demo cost parameter is N=4096, which is not a production password-hashing setting.

## What is not wired

- Supabase Auth, Data API, and Storage clients are not on the request path. `createAdminClient()` returns null without a service-role key and is unused by services.
- `DATA_PROVIDER=supabase` does not change `dataMode()`. The health endpoint reports `demo`.
- Email, Stripe webhooks, FHIR, HL7, and payer APIs have no runtime clients.
