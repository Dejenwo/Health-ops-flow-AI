-- HealthFlow AI initial schema.
-- Demo mode does not execute this file. Apply it with the Supabase CLI before using DATA_PROVIDER=supabase.
-- This migration is the database authorization boundary. Application checks are not a substitute.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.role_rank(role text)
returns integer
language sql
immutable
as $$
  select case role
    when 'VIEWER' then 1
    when 'SPECIALIST' then 2
    when 'MANAGER' then 3
    when 'ADMIN' then 4
    when 'OWNER' then 5
    else 0
  end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  job_title text not null default '',
  phone text not null default '',
  onboarding_completed boolean not null default false,
  notification_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  specialty text not null default '',
  provider_count integer not null default 1 check (provider_count >= 1),
  workflows jsonb not null default '{"priorAuthorization": true}'::jsonb,
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'MANAGER', 'SPECIALIST', 'VIEWER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INVITED', 'SUSPENDED')),
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  unique (organization_id, user_id)
);

create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid()
    and status = 'ACTIVE';
$$;

create or replace function public.has_min_role(target uuid, min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where user_id = auth.uid()
      and organization_id = target
      and status = 'ACTIVE'
      and public.role_rank(role) >= public.role_rank(min_role)
  );
$$;

revoke all on function public.current_org_ids() from public;
revoke all on function public.has_min_role(uuid, text) from public;
grant execute on function public.current_org_ids() to authenticated;
grant execute on function public.has_min_role(uuid, text) to authenticated;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mrn text not null,
  first_name text not null,
  last_name text not null,
  date_of_birth date not null,
  sex text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  primary_payer_id uuid,
  member_id text not null default '',
  group_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  unique (organization_id, mrn)
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  npi text not null default '',
  specialty text not null,
  phone text not null default '',
  email text not null default '',
  status text not null default 'ACTIVE',
  organization_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id)
);

create table public.payers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  type text not null,
  identifier text not null,
  phone text not null default '',
  fax text not null default '',
  website text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id)
);

alter table public.patients
  add constraint patients_primary_payer_fk
  foreign key (primary_payer_id) references public.payers (id);

create table public.authorization_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_number text not null,
  patient_id uuid not null references public.patients (id),
  provider_id uuid not null references public.providers (id),
  payer_id uuid not null references public.payers (id),
  member_id text not null default '',
  group_number text not null default '',
  procedure text not null,
  procedure_code text not null,
  diagnosis_description text not null,
  diagnosis_code text not null,
  requested_service_date date not null,
  priority text not null,
  clinical_reason text not null default '',
  status text not null,
  assigned_user_id uuid references auth.users (id),
  submission_date timestamptz,
  decision_date timestamptz,
  expiration_date date,
  payer_reference text not null default '',
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  unique (organization_id, authorization_number)
);

create table public.authorization_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_id uuid not null references public.authorization_cases (id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid not null references auth.users (id),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.authorization_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid references public.patients (id),
  authorization_id uuid references public.authorization_cases (id),
  uploaded_by uuid not null references auth.users (id),
  filename text not null,
  storage_key text not null,
  size integer not null check (size > 0 and size <= 10485760),
  mime_type text not null,
  category text not null,
  processing_status text not null default 'STORED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_id uuid not null references public.authorization_cases (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_id uuid references public.authorization_cases (id),
  patient_id uuid references public.patients (id),
  title text not null,
  description text not null default '',
  assigned_user_id uuid references auth.users (id),
  due_date date,
  priority text not null,
  status text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id),
  type text not null,
  summary text not null,
  resource_type text not null,
  resource_id uuid not null,
  authorization_id uuid,
  patient_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_id uuid references public.authorization_cases (id),
  requested_by uuid not null references auth.users (id),
  provider text not null,
  model text not null,
  operation text not null,
  status text not null,
  input_fingerprint text not null,
  output jsonb,
  error text,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id),
  event text not null,
  resource_type text not null,
  resource_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider_key text not null,
  status text not null,
  requested_at timestamptz,
  requested_by uuid references auth.users (id),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_key)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan text not null,
  status text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null,
  token_hash text not null,
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index patients_org_idx on public.patients (organization_id);
create index providers_org_idx on public.providers (organization_id);
create index payers_org_idx on public.payers (organization_id);
create index authorization_cases_org_status_idx on public.authorization_cases (organization_id, status);
create index authorization_cases_org_payer_idx on public.authorization_cases (organization_id, payer_id);
create index authorization_cases_org_assignee_idx on public.authorization_cases (organization_id, assigned_user_id);
create index tasks_org_due_idx on public.tasks (organization_id, due_date);
create index documents_org_idx on public.authorization_documents (organization_id, authorization_id);
create index notes_org_idx on public.case_notes (organization_id, authorization_id);
create index activity_org_created_idx on public.activity_events (organization_id, created_at desc);
create index notifications_user_idx on public.notifications (organization_id, user_id, read_at);
create index audit_org_created_idx on public.audit_events (organization_id, created_at desc);
create index ai_runs_org_idx on public.ai_runs (organization_id, authorization_id);

-- Row level security

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.patients enable row level security;
alter table public.providers enable row level security;
alter table public.payers enable row level security;
alter table public.authorization_cases enable row level security;
alter table public.authorization_status_history enable row level security;
alter table public.authorization_documents enable row level security;
alter table public.case_notes enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_events enable row level security;
alter table public.ai_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;
alter table public.integration_connections enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invitations enable row level security;

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or id in (
    select peer.user_id
    from public.organization_members self
    join public.organization_members peer on peer.organization_id = self.organization_id
    where self.user_id = auth.uid() and self.status = 'ACTIVE' and peer.status = 'ACTIVE'
  )
);

create policy organizations_select on public.organizations
for select to authenticated
using (id in (select public.current_org_ids()));

create policy organizations_update on public.organizations
for update to authenticated
using (public.has_min_role(id, 'ADMIN'))
with check (public.has_min_role(id, 'ADMIN'));

create policy organization_members_select on public.organization_members
for select to authenticated
using (organization_id in (select public.current_org_ids()));

create policy organization_members_insert on public.organization_members
for insert to authenticated
with check (public.has_min_role(organization_id, 'MANAGER'));

create policy organization_members_update on public.organization_members
for update to authenticated
using (public.has_min_role(organization_id, 'ADMIN'))
with check (public.has_min_role(organization_id, 'ADMIN'));

create policy patients_select on public.patients for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy patients_insert on public.patients for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy patients_update on public.patients for update to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'))
with check (public.has_min_role(organization_id, 'SPECIALIST'));

create policy providers_select on public.providers for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy providers_insert on public.providers for insert to authenticated
with check (public.has_min_role(organization_id, 'MANAGER'));
create policy providers_update on public.providers for update to authenticated
using (public.has_min_role(organization_id, 'MANAGER'))
with check (public.has_min_role(organization_id, 'MANAGER'));

create policy payers_select on public.payers for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy payers_insert on public.payers for insert to authenticated
with check (public.has_min_role(organization_id, 'MANAGER'));
create policy payers_update on public.payers for update to authenticated
using (public.has_min_role(organization_id, 'MANAGER'))
with check (public.has_min_role(organization_id, 'MANAGER'));

create policy authorization_cases_select on public.authorization_cases for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy authorization_cases_insert on public.authorization_cases for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy authorization_cases_update on public.authorization_cases for update to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'))
with check (public.has_min_role(organization_id, 'SPECIALIST'));

create policy authorization_status_history_select on public.authorization_status_history for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy authorization_status_history_insert on public.authorization_status_history for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST') and changed_by = auth.uid());

create policy authorization_documents_select on public.authorization_documents for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy authorization_documents_insert on public.authorization_documents for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST') and uploaded_by = auth.uid());

create policy case_notes_select on public.case_notes for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy case_notes_insert on public.case_notes for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST') and author_id = auth.uid());

create policy tasks_select on public.tasks for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy tasks_insert on public.tasks for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy tasks_update on public.tasks for update to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'))
with check (public.has_min_role(organization_id, 'SPECIALIST'));

create policy activity_events_select on public.activity_events for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy activity_events_insert on public.activity_events for insert to authenticated
with check (organization_id in (select public.current_org_ids()) and (actor_id = auth.uid() or actor_id is null));

create policy ai_runs_select on public.ai_runs for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy ai_runs_insert on public.ai_runs for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST') and requested_by = auth.uid());

create policy notifications_select on public.notifications for select to authenticated
using (organization_id in (select public.current_org_ids()) and user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
with check (organization_id in (select public.current_org_ids()));
create policy notifications_update on public.notifications for update to authenticated
using (user_id = auth.uid() and organization_id in (select public.current_org_ids()))
with check (user_id = auth.uid());

create policy audit_events_select on public.audit_events for select to authenticated
using (public.has_min_role(organization_id, 'ADMIN'));

create policy integration_connections_select on public.integration_connections for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy integration_connections_insert on public.integration_connections for insert to authenticated
with check (public.has_min_role(organization_id, 'ADMIN'));
create policy integration_connections_update on public.integration_connections for update to authenticated
using (public.has_min_role(organization_id, 'ADMIN'))
with check (public.has_min_role(organization_id, 'ADMIN'));

create policy subscriptions_select on public.subscriptions for select to authenticated
using (public.has_min_role(organization_id, 'MANAGER'));
create policy subscriptions_update on public.subscriptions for update to authenticated
using (public.has_min_role(organization_id, 'ADMIN'))
with check (public.has_min_role(organization_id, 'ADMIN'));

create policy invitations_select on public.invitations for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy invitations_insert on public.invitations for insert to authenticated
with check (public.has_min_role(organization_id, 'MANAGER') and invited_by = auth.uid());

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events are append-only';
end;
$$;

create trigger audit_events_no_update
before update or delete on public.audit_events
for each row execute function public.prevent_audit_mutation();

create or replace function public.record_audit(
  target_org uuid,
  event_name text,
  resource_type text,
  resource_id text,
  meta jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.has_min_role(target_org, 'SPECIALIST') then
    raise exception 'not authorized';
  end if;
  insert into public.audit_events (organization_id, actor_id, event, resource_type, resource_id, metadata)
  values (target_org, auth.uid(), event_name, resource_type, resource_id, coalesce(meta, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_audit(uuid, text, text, text, jsonb) from public;
grant execute on function public.record_audit(uuid, text, text, text, jsonb) to authenticated;

insert into storage.buckets (id, name, public)
values ('authorization-documents', 'authorization-documents', false)
on conflict (id) do nothing;

create policy authorization_documents_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'authorization-documents'
  and (storage.foldername(name))[1] in (select public.current_org_ids()::text)
);

create policy authorization_documents_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'authorization-documents'
  and (storage.foldername(name))[1] in (select public.current_org_ids()::text)
  and public.has_min_role(((storage.foldername(name))[1])::uuid, 'SPECIALIST')
);

-- No update or delete policy is created for audit_events.
-- No public storage policy is created. The bucket is private.
