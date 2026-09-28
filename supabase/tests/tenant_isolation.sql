-- Manual verification for a Supabase database that has two organizations.
-- Replace the UUIDs after creating fixture users. Expect every cross-tenant select to return zero rows.
--
-- begin;
-- set request.jwt.claim.sub = '<user-in-org-a>';
-- select * from patients where organization_id = '<org-b>';
-- select * from authorization_cases where organization_id = '<org-b>';
-- select * from authorization_documents where organization_id = '<org-b>';
-- select * from tasks where organization_id = '<org-b>';
-- select * from case_notes where organization_id = '<org-b>';
-- select * from ai_runs where organization_id = '<org-b>';
-- select * from notifications where organization_id = '<org-b>';
-- select * from audit_events where organization_id = '<org-b>';
-- rollback;
--
-- Application-level proof lives in tests/integration/workflow.test.ts and runs without Supabase.

select 'see comments in this file' as tenant_isolation_check;
