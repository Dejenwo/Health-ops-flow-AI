-- HealthFlow AI: integration hub (clearinghouse connections, eligibility results, message log).
-- Mirrors lib/services/integrations.ts. Message rows hold metadata only, never payloads.

create table public.integration_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('clearinghouse')),
  provider text not null check (provider in ('simulator', 'stedi')),
  environment text not null default 'test' check (environment in ('test', 'production')),
  secret_encrypted text,
  enabled boolean not null default false,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  unique (organization_id, kind)
);

create table public.eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id),
  payer_id uuid not null references public.payers (id),
  authorization_id uuid references public.authorization_cases (id),
  provider text not null,
  environment text not null check (environment in ('test', 'production')),
  status text not null check (status in ('ACTIVE', 'INACTIVE', 'UNKNOWN', 'ERROR')),
  plan_name text not null default '',
  coverage_start date,
  coverage_end date,
  auth_indicator text not null default 'UNKNOWN' check (auth_indicator in ('REQUIRED', 'NOT_REQUIRED', 'UNKNOWN')),
  notes text[] not null default '{}',
  error_message text not null default '',
  trace_id text not null default '',
  checked_at timestamptz not null default now(),
  checked_by uuid references auth.users (id)
);

create table public.integration_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  endpoint_id uuid references public.integration_endpoints (id) on delete set null,
  provider text not null,
  operation text not null,
  direction text not null check (direction in ('OUTBOUND', 'INBOUND')),
  outcome text not null check (outcome in ('SUCCESS', 'FAILED')),
  http_status integer,
  attempts integer not null default 1,
  duration_ms integer not null default 0,
  trace_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now()
);

create index eligibility_checks_case_idx on public.eligibility_checks (authorization_id, checked_at desc);
create index integration_messages_org_idx on public.integration_messages (organization_id, created_at desc);

alter table public.integration_endpoints enable row level security;
alter table public.eligibility_checks enable row level security;
alter table public.integration_messages enable row level security;

-- Connections: admins only. The encrypted key is never readable through the Data API.
create policy integration_endpoints_admin on public.integration_endpoints for all to authenticated
using (public.has_min_role(organization_id, 'ADMIN'))
with check (public.has_min_role(organization_id, 'ADMIN'));
revoke select (secret_encrypted) on public.integration_endpoints from authenticated;

-- Eligibility results: readable by members; written by the server.
create policy eligibility_checks_select on public.eligibility_checks for select to authenticated
using (organization_id in (select public.current_org_ids()));

-- Message log: admins can read; written by the server; append-only.
create policy integration_messages_select on public.integration_messages for select to authenticated
using (public.has_min_role(organization_id, 'ADMIN'));
