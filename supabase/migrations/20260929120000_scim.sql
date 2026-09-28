-- HealthFlow AI: SCIM provisioning. Mirrors lib/services/scim.ts.
-- Only a SHA-256 hash of the provisioning token is stored. Deprovisioning suspends memberships;
-- rows are never deleted so audit history stays intact.

alter table public.organizations
  add column scim_token_hash text check (scim_token_hash is null or scim_token_hash ~ '^[0-9a-f]{64}$'),
  add column scim_token_prefix text,
  add column scim_token_created_at timestamptz,
  add column scim_last_used_at timestamptz;

alter table public.organization_members
  add column scim_external_id text;

create unique index organization_members_scim_external_id
  on public.organization_members (organization_id, scim_external_id)
  where scim_external_id is not null;

-- The token hash is never readable through the Data API; the SCIM endpoint runs server-side.
revoke select (scim_token_hash) on public.organizations from authenticated;
