-- HealthFlow AI: payer prior-auth rules ("does this code need auth for this payer?").
-- Mirrors lib/domain/auth-rules.ts. Imports write through the server, so no import table is needed.

create table public.payer_auth_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payer_id uuid not null references public.payers (id) on delete cascade,
  code_type text not null check (code_type in ('CPT', 'HCPCS')),
  -- Exact code or a family prefix ending in '*'.
  code text not null check (code ~ '^[0-9A-Z]{1,5}\*?$'),
  requirement text not null check (requirement in ('REQUIRED', 'NOT_REQUIRED')),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  unique (organization_id, payer_id, code_type, code)
);

create index payer_auth_rules_lookup on public.payer_auth_rules (organization_id, payer_id, code_type);

-- The rule's payer must belong to the same organization.
create or replace function public.enforce_payer_rule_org()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.payers p where p.id = new.payer_id and p.organization_id = new.organization_id) then
    raise exception 'payer does not belong to this organization';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payer_auth_rules_org
before insert or update on public.payer_auth_rules
for each row execute function public.enforce_payer_rule_org();

alter table public.payer_auth_rules enable row level security;

create policy payer_auth_rules_select on public.payer_auth_rules for select to authenticated
using (organization_id in (select public.current_org_ids()));
create policy payer_auth_rules_write on public.payer_auth_rules for all to authenticated
using (public.has_min_role(organization_id, 'MANAGER'))
with check (public.has_min_role(organization_id, 'MANAGER'));
