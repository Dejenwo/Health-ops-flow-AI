# AI architecture

HealthFlow AI uses models only as administrative drafting tools. A person reviews every result. The product does not diagnose, prescribe, recommend treatment, determine medical necessity, approve, deny, appeal, or submit a case.

## Interface

`lib/ai/types.ts` defines `AIProvider`:

- `analyzeAuthorization`
- `summarizeDocuments`
- `identifyMissingInformation`
- `generateChecklist`
- `draftAuthorizationSummary`
- `draftPayerFollowup`
- `summarizePayerResponse`

Each user-visible payload includes `disclaimer: "AI-generated — review before use."`

## Providers

| Provider | When it runs |
| --- | --- |
| `MockAIProvider` | Default. Deterministic text from the case fields already stored. |
| Anthropic | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and `AI_BAA_CONFIRMED=true`. Optional `ANTHROPIC_MODEL`. |
| OpenAI | `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `AI_BAA_CONFIRMED=true`. Optional `OPENAI_MODEL`. Requests set `store: false`. |

A remote provider with no key or no BAA confirmation raises a clear error instead of quietly sending data or quietly falling back. Calls time out after `AI_TIMEOUT_MS` (30 s default). Calls use `fetch` from server code in `lib/ai/remote-provider.ts`. The system instruction tells the model to return JSON, not to invent clinical facts, and not to approve or deny.

Remote analysis is parsed, length-limited, and rejected if the JSON is incomplete. A limitations line is always appended stating that a person must review the output.

## What is stored

`ai_runs` records the organization, case, actor, provider name, a fingerprint of the request, the structured output, and timestamps. The raw prompt is not stored. Dashboard "AI recommendations" on the operations page are rule-based (missing clinical note, pending longer than five days, urgent work). They are labeled with the same disclaimer and are not a model call.

## Human confirmation

- Run AI analysis writes an `ai_runs` row and an activity event. Status stays the same.
- Draft payer follow-up returns text. It is saved as an internal note only after the user confirms.
- Recording a payer response writes a staff note and reference number. It does not contact the payer and does not change status.

## Assistant

`/ai-assistant` matches questions such as "What needs attention today?" to functions in `lib/services/intelligence.ts`. Unknown questions get a short refusal that lists the supported prompts. The model is not asked to write SQL.

## Operational rules

- Never put API keys in `NEXT_PUBLIC_*` variables.
- Never send real PHI to a model vendor from this MVP. The seed data is synthetic.
- If a remote provider is enabled later, sign a business associate agreement and disable training on customer content before any real record is included. That work is not done here.

## What the model sees

`buildInput` in `lib/services/intelligence.ts` assembles the only input a model receives:
case number, status, priority, review type, request summary, service lines, diagnoses, place and
site of service, payer name and type, whether a member ID is on file (not the value), service
date, the reason for request, document categories, open readiness gaps and alerts, and the
recorded decision.

It never includes the patient's name, date of birth, MRN, member ID, group number, address,
phone, email, or staff names. Free text and document excerpts pass through
`lib/security/phi-redact.ts`, which removes emails, phone numbers, SSNs, street addresses, dates
of birth and the patient's own identifiers. That filter is a second layer, not de-identification,
which is why a BAA is still required.

## Document text

Text documents and PDFs with a text layer are read on demand (`lib/documents/extract.ts`), capped
at 6,000 characters each and four documents per run. Extracted text is not stored. Scanned images
need an OCR service covered by a BAA and are reported as unreadable rather than guessed at.
