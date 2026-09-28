-- HealthFlow AI: single sign-on.
-- Mirrors lib/services/sso.ts. Organization SSO settings, DNS-verified domains, and external
-- identities linked to users. A verified domain can belong to only one organization.

create table public.sso_connections (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  provider text not null check (provider in ('microsoft', 'google', 'oidc')),
  tenant_id text not null default '' check (tenant_id = '' or tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  issuer text not null default '' check (issuer = '' or issuer like 'https://%'),
  client_id text not null default '',
  -- Encrypted by the application (AES-256-GCM). Never readable through the API.
  client_secret_encrypted text,
  jit_provisioning boolean not null default true,
  default_role text not null default 'SPECIALIST' check (default_role in ('VIEWER', 'SPECIALIST', 'MANAGER')),
  require_sso boolean not null default false,
  last_login_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  check (not require_sso or enabled)
);

create table public.sso_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  domain text not null check (domain = lower(domain) and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  verification_token text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, domain),
  check (domain not in ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com'))
);

-- One organization per verified domain.
create unique index sso_domains_verified_unique on public.sso_domains (domain) where verified_at is not null;

create table public.user_identities (
  key text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('microsoft', 'google', 'oidc')),
  email text not null,
  linked_at timestamptz not null default now()
);

alter table public.sso_connections enable row level security;
alter table public.sso_domains enable row level security;
alter table public.user_identities enable row level security;

-- Admins manage their organization's SSO. Members cannot read it.
create policy sso_connections_select on public.sso_connections for select to authenticated
using (public.has_min_role(organization_id, 'ADMIN'));
create policy sso_connections_write on public.sso_connections for all to authenticated
using (public.has_min_role(organization_id, 'ADMIN'))
with check (public.has_min_role(organization_id, 'ADMIN'));

create policy sso_domains_select on public.sso_domains for select to authenticated
using (public.has_min_role(organization_id, 'ADMIN'));
create policy sso_domains_insert on public.sso_domains for insert to authenticated
with check (public.has_min_role(organization_id, 'ADMIN') and verified_at is null);
create policy sso_domains_delete on public.sso_domains for delete to authenticated
using (public.has_min_role(organization_id, 'ADMIN'));
-- No update policy: only the server (service role) marks a domain verified after the DNS check.

-- People can see their own linked identities. Links are created by the server during sign-in.
create policy user_identities_select on public.user_identities for select to authenticated
using (user_id = auth.uid());

-- The client secret column is never exposed through the Data API.
revoke select (client_secret_encrypted) on public.sso_connections from authenticated;
