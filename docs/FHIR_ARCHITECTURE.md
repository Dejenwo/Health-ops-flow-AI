# FHIR architecture (future)

This document describes how HealthFlow could connect to FHIR R4 later. No FHIR client, SMART launch, or EHR connection is implemented. Integrations that mention FHIR are labeled Coming soon.

## Intended resources

| FHIR R4 resource | HealthFlow record | Notes |
| --- | --- | --- |
| Patient | patients | Demographics and identifiers. MRN is a local identifier, not a FHIR id. |
| Coverage | patient insurance fields | Member id, group number, primary payer. |
| Practitioner | providers | NPI would replace the `DEMO-NPI-` placeholder. |
| Organization | organizations and payers | Separate profiles for the clinic and the payer. |
| ServiceRequest | authorization cases | Procedure, diagnosis, requested date, priority. |
| Claim / ClaimResponse | payer response metadata | Only after a real payer workflow exists. Staff notes are not claims. |
| DocumentReference | authorization documents | Category, content type, authenticated URL. |

## Access

A future connection should use SMART on FHIR with OAuth 2.0 / OpenID Connect:

- Authorization code with PKCE for user launch.
- Backend services (client credentials with a signed JWT) only for system scopes a customer contract allows.
- Tokens stored server-side, encrypted, scoped to the HealthFlow organization that owns the connection.
- No token in the browser beyond a short-lived session.

Scopes should be the minimum set for the resources above. Write-back to the EHR is out of scope until a customer explicitly enables it and a human confirms each write.

## Mapping rules

- Store the FHIR server base URL and source resource id on the integration connection, not inside clinical free text.
- Treat incoming resources as untrusted input. Validate with the same Zod boundaries used for manual entry.
- Do not copy narrative diagnoses into fields the AI is allowed to invent. AI must not overwrite mapped clinical facts.
- Patient matching uses organization-scoped identifiers. A FHIR id from one tenant must never attach to another tenant's patient.

## Security

- TLS only.
- Per-organization credentials.
- Audit every read and write with actor, source system, and resource id. Do not store access tokens in the audit payload.
- Respect EHR rate limits and pagination.
- Fail closed if the token's `fhirUser` or organization context does not match the HealthFlow tenant.

## Explicitly not in this MVP

There is no public FHIR facade, no sample patient bundle endpoint, and no mocked "connected to Epic" state.
