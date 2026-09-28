-- Executable checks for the hardening migration. Run with scripts/test-db.sh.
-- Each block raises an exception (and fails the run) if the database lets a bad change through.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into auth.users values
  ('10000000-0000-4000-8000-000000000001', 'specialist@a.test'),
  ('10000000-0000-4000-8000-000000000002', 'manager@a.test'),
  ('10000000-0000-4000-8000-000000000003', 'owner@b.test');
insert into public.organizations (id, name, type) values
  ('20000000-0000-4000-8000-00000000000a', 'Org A', 'CLINIC'),
  ('20000000-0000-4000-8000-00000000000b', 'Org B', 'CLINIC');
insert into public.organization_members (organization_id, user_id, role) values
  ('20000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'SPECIALIST'),
  ('20000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000002', 'MANAGER'),
  ('20000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000003', 'OWNER');
insert into public.payers (id, organization_id, name, type, identifier) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000a', 'Payer', 'COMMERCIAL', 'P1');
insert into public.providers (id, organization_id, name, npi, specialty, organization_name) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000a', 'Dr A', '1234567893', 'Ortho', 'Org A');
insert into public.patients (id, organization_id, mrn, first_name, last_name, date_of_birth, sex)
values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000a', 'MRN1', 'Test', 'Patient', '1980-01-01', 'UNKNOWN');
insert into public.authorization_cases (id, organization_id, authorization_number, patient_id, provider_id, payer_id, procedure, requested_service_date, priority, status)
values ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000a', 'PA-2026-00001',
        '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        'Knee', '2026-10-01', 'NORMAL', 'DRAFT');
insert into public.authorization_documents (id, organization_id, authorization_id, uploaded_by, filename, storage_key, size, mime_type, category)
values ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', 'letter.pdf', 'k', 10, 'application/pdf', 'PAYER_CORRESPONDENCE');

-- Format checks
do $$ begin
  begin
    insert into public.providers (organization_id, name, npi, specialty, organization_name)
    values ('20000000-0000-4000-8000-00000000000a', 'Bad', '1234567890', 'x', 'y');
    raise exception 'FAIL: invalid NPI accepted';
  exception when check_violation then null; end;
  begin
    insert into public.authorization_lines (organization_id, authorization_id, code_type, code, description, requested_units)
    values ('20000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'CPT', 'J1745', 'x', 1);
    raise exception 'FAIL: HCPCS code accepted as CPT';
  exception when check_violation then null; end;
  begin
    insert into public.authorization_diagnoses (organization_id, authorization_id, code, description)
    values ('20000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'U07.1', 'x');
    raise exception 'FAIL: invalid ICD-10-CM accepted';
  exception when check_violation then null; end;
end $$;

insert into public.authorization_lines (id, organization_id, authorization_id, code_type, code, description, requested_units)
values ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'CPT', '27447', 'TKA', 1);
insert into public.authorization_diagnoses (organization_id, authorization_id, code, description)
values ('20000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'M17.11', 'OA');

-- Act as the specialist through RLS from here on.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);

do $$ begin
  if (select count(*) from public.authorization_cases where organization_id = '20000000-0000-4000-8000-00000000000b') <> 0 then
    raise exception 'FAIL: cross-tenant read';
  end if;
  begin
    update public.authorization_cases set status = 'SUBMITTED' where id = '60000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: DRAFT -> SUBMITTED allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

update public.authorization_cases set status = 'READY_FOR_REVIEW' where id = '60000000-0000-4000-8000-000000000001';
update public.authorization_cases set status = 'SUBMITTED', submission_date = now() where id = '60000000-0000-4000-8000-000000000001';

do $$ begin
  begin
    update public.authorization_cases set procedure = 'Hip' where id = '60000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: locked case edited';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    update public.authorization_lines set code = '27130' where id = '80000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: locked line code edited';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    insert into public.authorization_lines (organization_id, authorization_id, code_type, code, description, requested_units)
    values ('20000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-000000000001', 'CPT', '27130', 'x', 1);
    raise exception 'FAIL: line added to locked case';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    update public.authorization_cases set status = 'DENIED', decision_outcome = 'DENIED', payer_reference = 'R', decision_date = now()
    where id = '60000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: denial without letter';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    perform public.record_audit('20000000-0000-4000-8000-00000000000a', 'authorization.decision_recorded', 'authorization', 'x', '{}');
    raise exception 'FAIL: client wrote a non-access audit event';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- A complete denial goes through; approved units may still be recorded on the locked line.
update public.authorization_lines set approved_units = 0, decision = 'DENIED' where id = '80000000-0000-4000-8000-000000000001';
update public.authorization_cases
   set status = 'DENIED', decision_outcome = 'DENIED', payer_reference = 'R-1', decision_date = now(),
       denial_reason = 'MEDICAL_NECESSITY', determination_document_id = '70000000-0000-4000-8000-000000000001',
       appeal_deadline = current_date - 1
 where id = '60000000-0000-4000-8000-000000000001';
select public.record_audit('20000000-0000-4000-8000-00000000000a', 'authorization.viewed', 'authorization', '60000000-0000-4000-8000-000000000001', '{}');

do $$ begin
  begin
    update public.authorization_cases set status = 'APPEALED' where id = '60000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: specialist filed a late appeal';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
update public.authorization_cases set status = 'APPEALED' where id = '60000000-0000-4000-8000-000000000001';

reset role;
do $$ begin
  if (select count(*) from public.audit_events where resource_id = '60000000-0000-4000-8000-000000000001' and event = 'authorization.status_changed') < 4 then
    raise exception 'FAIL: database did not audit status changes';
  end if;
  if (select count(*) from public.audit_events where event = 'authorization.viewed') <> 1 then
    raise exception 'FAIL: access event not recorded';
  end if;
end $$;

-- MFA: once the organization requires it, an AAL1 session sees nothing.
update public.organizations set require_mfa = true where id = '20000000-0000-4000-8000-00000000000a';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (select count(*) from public.authorization_cases) <> 0 then raise exception 'FAIL: AAL1 session read an MFA-required org'; end if;
end $$;
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$ begin
  if (select count(*) from public.authorization_cases) <> 1 then raise exception 'FAIL: AAL2 session blocked'; end if;
end $$;
reset role;

select 'workflow_rules: all checks passed' as result;

-- SSO: one organization per verified domain, public domains refused, members cannot read SSO settings.
reset role;
insert into public.sso_domains (organization_id, domain, verification_token, verified_at)
values ('20000000-0000-4000-8000-00000000000a', 'orga.example', 't1', now());
do $$ begin
  begin
    insert into public.sso_domains (organization_id, domain, verification_token, verified_at)
    values ('20000000-0000-4000-8000-00000000000b', 'orga.example', 't2', now());
    raise exception 'FAIL: two organizations verified the same domain';
  exception when unique_violation then null; end;
  begin
    insert into public.sso_domains (organization_id, domain, verification_token) values ('20000000-0000-4000-8000-00000000000b', 'gmail.com', 't3');
    raise exception 'FAIL: public domain accepted';
  exception when check_violation then null; end;
end $$;
insert into public.sso_connections (organization_id, enabled, provider, tenant_id) values ('20000000-0000-4000-8000-00000000000a', true, 'microsoft', '11111111-2222-4333-8444-555555555555');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$ begin
  if (select count(*) from public.sso_connections) <> 0 or (select count(*) from public.sso_domains) <> 0 then
    raise exception 'FAIL: a specialist can read SSO settings';
  end if;
end $$;
reset role;
select 'sso rules: all checks passed' as result;

-- Payer auth rules: format checks and same-organization payer.
do $$ begin
  begin
    insert into public.payer_auth_rules (organization_id, payer_id, code_type, code, requirement)
    values ('20000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-000000000001', 'CPT', '72148', 'REQUIRED');
    raise exception 'FAIL: rule linked to another organization''s payer';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    insert into public.payer_auth_rules (organization_id, payer_id, code_type, code, requirement)
    values ('20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', 'CPT', 'ABC-1', 'REQUIRED');
    raise exception 'FAIL: malformed code accepted';
  exception when check_violation then null; end;
end $$;
insert into public.payer_auth_rules (organization_id, payer_id, code_type, code, requirement)
values ('20000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001', 'CPT', '7214*', 'REQUIRED');
select 'payer auth rules: all checks passed' as result;
