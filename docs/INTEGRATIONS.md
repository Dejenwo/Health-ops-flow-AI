# Integrations

HealthFlow connects to outside systems through an integration layer in `lib/integrations` and
`lib/services/integrations.ts`. Each vendor has its own adapter behind a common contract, so a
second clearinghouse (Availity, Waystar...) is one new file.

## What's live: eligibility checks

Checks a patient's coverage (X12 270/271) through a clearinghouse from the case page.

**Needed on the case:** the payer's electronic Payer ID (Payers page), the member ID, and a valid
NPI on the ordering provider. HealthFlow explains what's missing instead of calling the payer.

**Stored:** coverage status, plan name, coverage dates, the payer's prior-auth indicator, short
notes, and a trace ID. The full payer response is not stored.

**Logged:** timing, result, HTTP status and retry count for every call, never patient details.
The last 500 calls per organization are kept (Integrations page, "Recent activity").

**Reliability:** 20-second timeout, up to 3 attempts with backoff on timeouts, 429 and 5xx.
Authentication and validation errors are not retried.

### Demo simulator
The demo clinic has the simulator connected. It contacts no one. Member IDs ending in
**0** return inactive coverage, **5** return "prior auth required", **9** simulate a payer
timeout, anything else returns active coverage.

### Connecting Stedi
1. Create an account at Stedi and generate a **test** API key.
2. Integrations > Eligibility checks > Clearinghouse: Stedi, Environment: Test, paste the key, Save.
3. Click **Test connection**.
4. Set each payer's **Payer ID** to Stedi's ID for that payer (Stedi's payer list).
5. Before using a production key with real patients, sign Stedi's BAA and switch Environment to
   Production.

The Stedi adapter (`lib/integrations/stedi.ts`) follows Stedi's published eligibility API. If
your first sandbox call fails with a field error, send the error text; the mapping is isolated
in that one file. `STEDI_BASE_URL` overrides the endpoint.

## Next

1. Fax in and out (send the submission packet, match incoming payer letters to cases).
2. One EHR over FHIR (SMART on FHIR): patients, coverage, providers and orders.
3. Payer submission: X12 278 through the clearinghouse, then FHIR Da Vinci PAS as payers go live
   under CMS-0057-F.

Every vendor that receives patient data must sign a BAA first.
