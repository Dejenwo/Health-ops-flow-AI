-- HealthFlow AI: prior-authorization workflow hardening.
-- Mirrors the application rules in lib/domain so the database stays the authorization boundary
-- once DATA_PROVIDER=supabase is enabled and clients can reach PostgREST directly:
--   * service lines and diagnoses as child tables with format checks
--   * payer timeframes, decision evidence, approved window, appeal deadline, peer-to-peer
--   * the status transition table (kept in sync with lib/domain/transitions.ts by a unit test)
--   * a trigger that rejects illegal transitions, decisions without evidence, and edits to
--     submitted requests
--   * audit rows written by the database itself for every status change
--   * record_audit() limited to access events, and MFA (AAL2) enforced per organization

-- ---------------------------------------------------------------------------
-- Identifier checks
-- ---------------------------------------------------------------------------

create or replace function public.is_valid_npi(value text)
returns boolean
language plpgsql
immutable
as $$
declare
  digits text;
  total integer := 0;
  digit integer;
  i integer;
begin
  if value is null or value !~ '^[12][0-9]{9}$' then
    return false;
  end if;
  digits := '80840' || substr(value, 1, 9);
  for i in 0 .. length(digits) - 1 loop
    digit := substr(digits, length(digits) - i, 1)::integer;
    if i % 2 = 0 then
      digit := digit * 2;
      if digit > 9 then digit := digit - 9; end if;
    end if;
    total := total + digit;
  end loop;
  return (10 - (total % 10)) % 10 = substr(value, 10, 1)::integer;
end;
$$;

alter table public.providers
  add constraint providers_npi_valid check (npi = '' or public.is_valid_npi(npi));

-- ---------------------------------------------------------------------------
-- Organization security and case numbering
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column require_mfa boolean not null default false,
  add column idle_timeout_minutes integer not null default 15 check (idle_timeout_minutes between 5 and 60),
  add column case_sequence integer not null default 0 check (case_sequence >= 0);

-- Issues the next case number atomically. The row lock serializes concurrent callers.
create or replace function public.next_case_number(target_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seq integer;
begin
  if not public.has_min_role(target_org, 'SPECIALIST') then
    raise exception 'not authorized';
  end if;
  update public.organizations
     set case_sequence = case_sequence + 1
   where id = target_org
  returning case_sequence into seq;
  return 'PA-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(seq::text, 5, '0');
end;
$$;

revoke all on function public.next_case_number(uuid) from public;
grant execute on function public.next_case_number(uuid) to authenticated;

-- Organizations that require MFA are only visible to sessions at AAL2 (Supabase Auth MFA).
create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and m.status = 'ACTIVE'
    and (not o.require_mfa or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2');
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
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid()
      and m.organization_id = target
      and m.status = 'ACTIVE'
      and public.role_rank(m.role) >= public.role_rank(min_role)
      and (not o.require_mfa or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  );
$$;

-- ---------------------------------------------------------------------------
-- Payer timeframes
-- ---------------------------------------------------------------------------

alter table public.payers
  add column standard_turnaround_days integer not null default 15 check (standard_turnaround_days between 1 and 60),
  add column expedited_turnaround_hours integer not null default 72 check (expedited_turnaround_hours between 1 and 168),
  add column appeal_window_days integer not null default 60 check (appeal_window_days between 1 and 365),
  add column required_documents text[] not null default '{}';

update public.payers set standard_turnaround_days = 7, appeal_window_days = 65 where type = 'MEDICARE_ADVANTAGE';
update public.payers set standard_turnaround_days = 7, appeal_window_days = 60 where type = 'MEDICAID_MANAGED';
update public.payers set appeal_window_days = 180 where type = 'COMMERCIAL';
update public.payers set standard_turnaround_days = 14, appeal_window_days = 30 where type = 'WORKERS_COMP';

-- ---------------------------------------------------------------------------
-- Authorization case columns
-- ---------------------------------------------------------------------------

alter table public.authorization_cases
  add column rendering_provider_id uuid references public.providers (id),
  add column facility_name text not null default '',
  add column place_of_service text not null default '' check (place_of_service = '' or place_of_service ~ '^[0-9]{2}$'),
  add column site_of_care text not null default 'OTHER' check (site_of_care in (
    'OFFICE', 'OUTPATIENT_HOSPITAL', 'AMBULATORY_SURGERY_CENTER', 'INPATIENT_HOSPITAL',
    'IMAGING_CENTER', 'HOME', 'TELEHEALTH', 'OTHER')),
  add column review_type text not null default 'STANDARD' check (review_type in ('STANDARD', 'EXPEDITED')),
  add column payer_due_at timestamptz,
  add column decision_outcome text check (decision_outcome is null or decision_outcome in ('APPROVED', 'PARTIALLY_APPROVED', 'DENIED')),
  add column valid_from date,
  add column valid_to date,
  add column denial_reason text check (denial_reason is null or denial_reason in (
    'MEDICAL_NECESSITY', 'MISSING_INFORMATION', 'NOT_A_COVERED_BENEFIT', 'OUT_OF_NETWORK',
    'MEMBER_NOT_ELIGIBLE', 'DUPLICATE_REQUEST', 'SITE_OF_CARE', 'OTHER')),
  add column denial_detail text not null default '',
  add column determination_document_id uuid references public.authorization_documents (id),
  add column appeal_deadline date,
  add column appeal_submitted_at timestamptz,
  add column peer_to_peer_status text not null default 'NOT_REQUESTED' check (peer_to_peer_status in (
    'NOT_REQUESTED', 'REQUESTED', 'SCHEDULED', 'COMPLETED', 'DECLINED')),
  add column peer_to_peer_at timestamptz,
  add column peer_to_peer_notes text not null default '',
  add column closed_reason text not null default '',
  add column supersedes_id uuid references public.authorization_cases (id),
  add constraint authorization_cases_window check (valid_to is null or valid_from is null or valid_to >= valid_from);

update public.authorization_cases set valid_to = expiration_date where expiration_date is not null;
update public.authorization_cases set review_type = 'EXPEDITED' where priority = 'URGENT';

alter table public.authorization_cases
  add constraint authorization_cases_status_check check (status in (
    'DRAFT', 'NEEDS_INFORMATION', 'READY_FOR_REVIEW', 'SUBMITTED', 'PENDING',
    'ADDITIONAL_INFORMATION_REQUESTED', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED',
    'APPEALED', 'WITHDRAWN', 'CLOSED'));

-- ---------------------------------------------------------------------------
-- Service lines and diagnoses
-- ---------------------------------------------------------------------------

create table public.authorization_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_id uuid not null references public.authorization_cases (id) on delete cascade,
  position integer not null default 0,
  code_type text not null check (code_type in ('CPT', 'HCPCS')),
  code text not null,
  modifiers text[] not null default '{}',
  description text not null,
  requested_units integer not null check (requested_units between 1 and 9999),
  unit_type text not null default 'UNITS' check (unit_type in ('UNITS', 'VISITS', 'DAYS')),
  approved_units integer check (approved_units is null or (approved_units >= 0 and approved_units <= requested_units)),
  decision text not null default 'PENDING' check (decision in ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authorization_lines_code_format check (
    (code_type = 'CPT' and code ~ '^[0-9]{4}[0-9FT]$') or
    (code_type = 'HCPCS' and code ~ '^[A-V][0-9]{4}$')
  )
);

create table public.authorization_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  authorization_id uuid not null references public.authorization_cases (id) on delete cascade,
  position integer not null default 0,
  code text not null check (code ~ '^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$'),
  description text not null,
  unique (authorization_id, code)
);

create index authorization_lines_case_idx on public.authorization_lines (authorization_id, position);
create index authorization_diagnoses_case_idx on public.authorization_diagnoses (authorization_id, position);
create index authorization_cases_due_idx on public.authorization_cases (organization_id, payer_due_at) where payer_due_at is not null;
create index authorization_cases_valid_to_idx on public.authorization_cases (organization_id, valid_to) where valid_to is not null;

-- Carry the single code on existing cases into the new child tables.
insert into public.authorization_lines (organization_id, authorization_id, code_type, code, description, requested_units, approved_units, decision)
select organization_id, id,
       case when procedure_code ~ '^[A-V][0-9]{4}$' then 'HCPCS' else 'CPT' end,
       procedure_code, procedure, 1,
       case when status in ('APPROVED', 'CLOSED') then 1 when status = 'DENIED' then 0 else null end,
       case when status in ('APPROVED', 'CLOSED') then 'APPROVED' when status = 'DENIED' then 'DENIED' else 'PENDING' end
from public.authorization_cases
where procedure_code ~ '^([0-9]{4}[0-9FT]|[A-V][0-9]{4})$';

insert into public.authorization_diagnoses (organization_id, authorization_id, code, description)
select organization_id, id, upper(diagnosis_code), diagnosis_description
from public.authorization_cases
where upper(diagnosis_code) ~ '^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$';

alter table public.authorization_cases
  drop column procedure_code,
  drop column diagnosis_code,
  drop column diagnosis_description,
  drop column expiration_date;

alter table public.authorization_lines enable row level security;
alter table public.authorization_diagnoses enable row level security;

create policy authorization_lines_select on public.authorization_lines for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy authorization_lines_insert on public.authorization_lines for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy authorization_lines_update on public.authorization_lines for update to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'))
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy authorization_lines_delete on public.authorization_lines for delete to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'));

create policy authorization_diagnoses_select on public.authorization_diagnoses for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy authorization_diagnoses_insert on public.authorization_diagnoses for insert to authenticated
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy authorization_diagnoses_update on public.authorization_diagnoses for update to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'))
with check (public.has_min_role(organization_id, 'SPECIALIST'));
create policy authorization_diagnoses_delete on public.authorization_diagnoses for delete to authenticated
using (public.has_min_role(organization_id, 'SPECIALIST'));

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------

create table public.authorization_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

-- Keep in sync with ALLOWED_TRANSITIONS in lib/domain/transitions.ts (checked by tests/unit/domain.test.ts).
insert into public.authorization_transitions (from_status, to_status) values
  ('DRAFT', 'NEEDS_INFORMATION'),
  ('DRAFT', 'READY_FOR_REVIEW'),
  ('DRAFT', 'WITHDRAWN'),
  ('NEEDS_INFORMATION', 'DRAFT'),
  ('NEEDS_INFORMATION', 'READY_FOR_REVIEW'),
  ('NEEDS_INFORMATION', 'WITHDRAWN'),
  ('READY_FOR_REVIEW', 'NEEDS_INFORMATION'),
  ('READY_FOR_REVIEW', 'SUBMITTED'),
  ('READY_FOR_REVIEW', 'WITHDRAWN'),
  ('SUBMITTED', 'PENDING'),
  ('SUBMITTED', 'ADDITIONAL_INFORMATION_REQUESTED'),
  ('SUBMITTED', 'APPROVED'),
  ('SUBMITTED', 'PARTIALLY_APPROVED'),
  ('SUBMITTED', 'DENIED'),
  ('SUBMITTED', 'WITHDRAWN'),
  ('PENDING', 'APPROVED'),
  ('PENDING', 'PARTIALLY_APPROVED'),
  ('PENDING', 'DENIED'),
  ('PENDING', 'ADDITIONAL_INFORMATION_REQUESTED'),
  ('PENDING', 'WITHDRAWN'),
  ('ADDITIONAL_INFORMATION_REQUESTED', 'READY_FOR_REVIEW'),
  ('ADDITIONAL_INFORMATION_REQUESTED', 'WITHDRAWN'),
  ('APPROVED', 'CLOSED'),
  ('PARTIALLY_APPROVED', 'APPEALED'),
  ('PARTIALLY_APPROVED', 'CLOSED'),
  ('DENIED', 'APPEALED'),
  ('DENIED', 'CLOSED'),
  ('APPEALED', 'PENDING'),
  ('APPEALED', 'APPROVED'),
  ('APPEALED', 'PARTIALLY_APPROVED'),
  ('APPEALED', 'DENIED'),
  ('APPEALED', 'WITHDRAWN'),
  ('APPEALED', 'CLOSED');

alter table public.authorization_transitions enable row level security;
create policy authorization_transitions_select on public.authorization_transitions for select to authenticated using (true);

create or replace function public.authorization_is_locked(status text)
returns boolean
language sql
immutable
as $$
  select status not in ('DRAFT', 'NEEDS_INFORMATION', 'READY_FOR_REVIEW');
$$;

create or replace function public.enforce_authorization_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id <> old.organization_id or new.authorization_number <> old.authorization_number then
    raise exception 'organization and case number cannot change';
  end if;

  if new.status <> old.status then
    if not exists (
      select 1 from public.authorization_transitions t
      where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'illegal status transition % -> %', old.status, new.status;
    end if;

    if new.status in ('APPROVED', 'PARTIALLY_APPROVED', 'DENIED') then
      if coalesce(new.payer_reference, '') = '' or new.decision_date is null or new.decision_outcome is distinct from new.status then
        raise exception 'a payer decision needs the reference number, decision date and outcome';
      end if;
      if new.status <> 'APPROVED' and (new.determination_document_id is null or new.denial_reason is null) then
        raise exception 'an adverse decision needs the determination letter and denial reason';
      end if;
      if new.status <> 'DENIED' and (new.valid_from is null or new.valid_to is null) then
        raise exception 'an approval needs the approved date window';
      end if;
    end if;

    if new.status = 'APPEALED' and old.appeal_deadline is not null and current_date > old.appeal_deadline
       and not public.has_min_role(new.organization_id, 'MANAGER') then
      raise exception 'the appeal window has closed; a manager must file a late appeal';
    end if;
  end if;

  if public.authorization_is_locked(old.status) and (
       new.patient_id is distinct from old.patient_id or
       new.provider_id is distinct from old.provider_id or
       new.rendering_provider_id is distinct from old.rendering_provider_id or
       new.payer_id is distinct from old.payer_id or
       new.member_id is distinct from old.member_id or
       new.group_number is distinct from old.group_number or
       new.procedure is distinct from old.procedure or
       new.place_of_service is distinct from old.place_of_service or
       new.site_of_care is distinct from old.site_of_care or
       new.facility_name is distinct from old.facility_name or
       new.review_type is distinct from old.review_type or
       new.clinical_reason is distinct from old.clinical_reason
     ) then
    raise exception 'submitted requests are locked; file a replacement request instead';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger authorization_cases_rules
before update on public.authorization_cases
for each row execute function public.enforce_authorization_rules();

-- Lines and diagnoses follow their case: frozen after submission, except that a payer decision
-- may record approved units and a per-line decision.
create or replace function public.enforce_authorization_child_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  case_status text;
  case_org uuid;
begin
  select status, organization_id into case_status, case_org
  from public.authorization_cases
  where id = coalesce(new.authorization_id, old.authorization_id);

  if tg_op <> 'DELETE' and new.organization_id <> case_org then
    raise exception 'child row organization must match its case';
  end if;

  if public.authorization_is_locked(case_status) then
    if tg_op <> 'UPDATE' then
      raise exception 'submitted requests are locked; file a replacement request instead';
    end if;
    if tg_table_name <> 'authorization_lines' then
      raise exception 'submitted requests are locked; file a replacement request instead';
    end if;
    if new.code_type is distinct from old.code_type or new.code is distinct from old.code or
       new.modifiers is distinct from old.modifiers or new.description is distinct from old.description or
       new.requested_units is distinct from old.requested_units or new.unit_type is distinct from old.unit_type or
       new.authorization_id is distinct from old.authorization_id then
      raise exception 'submitted requests are locked; only approved units can be recorded';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger authorization_lines_rules
before insert or update or delete on public.authorization_lines
for each row execute function public.enforce_authorization_child_rules();

create trigger authorization_diagnoses_rules
before insert or update or delete on public.authorization_diagnoses
for each row execute function public.enforce_authorization_child_rules();

-- ---------------------------------------------------------------------------
-- Database-written audit trail
-- ---------------------------------------------------------------------------

create or replace function public.audit_authorization_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Written by the database so no client path can change a case without leaving a record.
  insert into public.audit_events (organization_id, actor_id, event, resource_type, resource_id, metadata)
  values (
    new.organization_id,
    auth.uid(),
    case when new.status <> old.status then 'authorization.status_changed' else 'authorization.updated' end,
    'authorization',
    new.id::text,
    jsonb_build_object('previous', old.status, 'status', new.status, 'authorizationNumber', new.authorization_number)
  );
  return new;
end;
$$;

create trigger authorization_cases_audit
after update on public.authorization_cases
for each row execute function public.audit_authorization_change();

-- Clients may only log access events. Everything else is written by triggers or the server.
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
  if event_name not in ('authorization.viewed', 'patient.viewed', 'document.viewed', 'document.accessed') then
    raise exception 'event % cannot be written by clients', event_name;
  end if;
  if resource_type not in ('authorization', 'patient', 'document') then
    raise exception 'unknown resource type %', resource_type;
  end if;
  if not public.has_min_role(target_org, 'VIEWER') then
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
