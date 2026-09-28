# HealthFlow AI — UI enhancement brief

You're working on HealthFlow AI, a prior-authorization workspace for clinics and revenue-cycle
teams. The backend, workflow rules and security were just hardened and are covered by tests. This
job is a focused UI polish pass on four areas. It is not a redesign of the whole app and it must
not change how anything works.

Work one phase at a time. At the end of each phase, run the checks listed at the bottom, fix
anything you broke, then stop and give me a short summary before starting the next phase.

---

## Before you start

1. Read `README.md`, `CHANGELOG.md` and `docs/SECURITY.md`.
2. Look at `package.json` and `components/ui/` to see which UI primitives already exist. Reuse
   them. Don't add a new UI library. If you really need a new dependency, tell me why first.
3. Read these so you understand the rules the UI has to reflect:
   - `lib/domain/transitions.ts`: statuses and allowed moves
   - `lib/domain/readiness.ts`: the packet checklist
   - `lib/domain/sla.ts`: alerts and their severity
   - `lib/domain/labels.ts`: display labels (use these, don't hardcode new ones)
4. Run the app (`npm run dev`, sign in as `specialist@northstar.demo` / `Northstar-demo-2026`)
   and open a Draft, a Pending, an Approved and a Denied case so you see each state.

---

## Hard rules

**Don't touch these folders or files** except to read them:
`lib/domain`, `lib/services`, `lib/store`, `lib/security`, `lib/auth`, `app/actions`,
`proxy.ts`, `instrumentation.ts`, `supabase/`. If a UI change seems to need a backend change,
stop and ask me.

**Keep every behavior.** Every button and form must call the same server action with the same
payload it does today. Permission checks that hide buttons must stay (`canWrite`,
`canTransition`, `canAi` and so on in the workspace).

**Keep the audit calls.** The page loaders call `recordAuthorizationView` and
`recordPatientView`. They must stay in place and still run once per page view.

**Content Security Policy.** The app sends a strict CSP with a per-request nonce.
- No inline `<script>` tags, no `dangerouslySetInnerHTML` with scripts, no `eval`.
- No CDN links, no Google Fonts, no remote images. Fonts are already self-hosted in `app/fonts`.
- Inline `style` attributes are fine. Prefer Tailwind and CSS transitions for motion.

**Patient data.**
- Don't store any form data or patient data in localStorage, sessionStorage or IndexedDB. No
  "autosave to browser".
- Don't put patient names, DOB, MRN or member IDs in URLs, toast messages or page titles.
- Show DOB and MRN only where the task needs them (patient header, case header), not in lists
  that don't need them.

**Honest UI.**
- Only show data the app actually has. Don't invent metrics, trends, "AI confidence", automation
  counts, eligibility checks or a workflow builder. None of those exist.
- Label something "AI" only if it came from an AI run. The dashboard's "Work to do first" list is
  rule-based, not AI.
- Don't add "HIPAA compliant" or similar claims anywhere.

**Accessibility.**
- Never show status or severity by color alone. Pair it with an icon and text.
- Every input keeps a real `<label>` or `aria-label`. Visible focus rings on everything you can tab to.
- Keep heading order logical (one `h1` per page).
- Check contrast in both light and dark mode. Dark mode already exists; keep it working.

**Tests depend on text and labels.** `e2e/demo.spec.ts` and `scripts/smoke-test.mjs` find
elements by label and by visible text. Either keep these exactly as they are, or update the tests
in the same change and tell me what you changed:

- Form labels: Patient, Payer, Member ID, Ordering provider, Place of service, Requested service
  date, Request summary, Line 1 code, Line 1 description, Diagnosis 1 code, Diagnosis 1
  description
- Buttons: Create authorization, Change status, Update status, Upload document, Upload, Record
  decision, Save decision
- Decision form labels: Payer reference, Approved from, Approved through, Note for the history
- Status dialog labels: Next status, Reason
- Region label: Packet checklist
- Smoke test text: "Payer decisions overdue", "Alerts", "Record decision", "Packet checklist",
  "is locked", "Service lines", "Add service line", "Two-factor sign-in", "Payer on-time rate",
  "appeal deadlines"

---

## Phase 1 — Case workspace

File: `components/authorizations/workspace.tsx` (and small new components next to it).

**1. Stage tracker.** Add a horizontal progress tracker under the case header, built from the
real statuses. Put the mapping in a small pure function (for example
`components/authorizations/stage.ts`) and add a unit test for it.

| Stage | Statuses |
| --- | --- |
| Prepare | DRAFT, NEEDS_INFORMATION |
| Review | READY_FOR_REVIEW |
| With payer | SUBMITTED, PENDING, ADDITIONAL_INFORMATION_REQUESTED |
| Decision | APPROVED, PARTIALLY_APPROVED, DENIED |
| Appeal | APPEALED (only show this step if the case has been appealed) |
| Closed | CLOSED, WITHDRAWN |

Under the current stage, show the exact status label. When the status is
ADDITIONAL_INFORMATION_REQUESTED, say the payer is waiting on us. When the status is WITHDRAWN,
show the tracker as stopped, not completed. On phones, collapse it to "Step 3 of 5 · With payer".

**2. One main action.** The header currently shows up to eight buttons. Show one primary button
for the obvious next step, and move everything else into a "More actions" menu. Use only
existing actions, and respect the existing permission flags.

| Status | Primary action |
| --- | --- |
| DRAFT, NEEDS_INFORMATION | "Mark ready for review" if the checklist passes, otherwise "Finish packet" (scrolls to the checklist) |
| READY_FOR_REVIEW | "Submit to payer" (opens the status dialog with SUBMITTED preselected) |
| SUBMITTED, PENDING, APPEALED | "Record decision" |
| ADDITIONAL_INFORMATION_REQUESTED | "Upload requested info" |
| DENIED, PARTIALLY_APPROVED | "File appeal" if the appeal deadline hasn't passed, otherwise "Close case" |
| APPROVED | "Close case" |
| WITHDRAWN, CLOSED | No primary action |

Keep a visible "Change status" entry, either in the menu or as a secondary button, because the
e2e test clicks it by name.

**3. Alerts.** Show the case alerts as a compact banner stack with an icon per severity
(critical, warning, info) and the message. Critical alerts first. Give each one a short action
link where one makes sense, for example "Reschedule" on an out-of-window alert, or "Record
decision" on a payer-overdue alert.

**4. Packet checklist.** Replace the ✓ and ✗ characters with proper icons that have accessible
labels. Show a count ("5 of 7 ready") and a thin progress bar. Keep `aria-label="Packet
checklist"` on the section. For each missing item, add a link to the place it gets fixed (Edit
for form fields, Upload document for documents).

**5. Layout.** Group the overview into clear cards: Request (lines and diagnoses), Payer
decision, People, Dates. Right-align the numbers in the service-line table and show approved
against requested (for example "6 / 12 visits") with a small visual cue for reduced or denied
lines.

---

## Phase 2 — Authorization form and dialogs

File: `components/authorizations/authorization-form.tsx`, plus the dialogs inside
`workspace.tsx`.

**1. Form navigation.** Keep a single page and a single react-hook-form instance. Add a sticky
section menu on desktop (Patient & payer, Providers & setting, Request, Handling, Notes) that
highlights the section in view. On phones, make the sections collapsible and open the first one
with an error. Do not split this into separate routes or submissions, and keep the final submit
payload exactly the same.

**2. Live checklist preview.** In a side panel (or at the bottom on phones), show which packet
items the form already satisfies as the user types: member ID, valid codes, a diagnosis, place
of service, a service date. Use the same format checks from `lib/domain/codes.ts`. Mention that
documents are added after the case is created.

**3. Service lines.** Make each line easier to read. Show the code type and code together, and
the units with the unit type. Show errors inline under each field (they already come from zod).
Add a "Duplicate line" button next to Remove.

**4. Dialogs.** For Record decision, Reschedule, Peer-to-peer, Attach letter, Start replacement
request and Change status:
- Show validation errors next to the field, not only at the top.
- Replace raw `<select>` styling with the existing styled select, if `components/ui` has one.
  If it doesn't, style the native select consistently instead of adding a library.
- Under 640px wide, open these as a bottom sheet with the primary button pinned at the bottom.
  Build the sheet on the existing dialog primitive.
- In Record decision, show and hide fields as the outcome changes (the app already does this).
  Add a one-line summary above the Save button, for example "Partial approval: 2 lines, 1
  reduced. Appeal deadline will be set."
- Disable the submit button while saving and show a spinner on it.

---

## Phase 3 — Dashboard and queue

Files: `app/(console)/dashboard/page.tsx`, `app/(console)/authorizations/page.tsx`,
`components/authorizations/authorization-table.tsx`, `components/status-badge.tsx`.

**1. Dashboard greeting.** Add "Good morning/afternoon, {first name}" using the server's time,
and a one-line summary built from real counts (for example "3 payer decisions are overdue and 2
appeal deadlines are this week").

**2. Group the KPI cards.** Replace the 11 separate cards with three groups:
- Payer clock: overdue, due within 24 hours, waiting on us
- Decisions: approved (including partial), denied, approval rate, payer on-time rate
- Workload: open cases, needs attention, tasks due, average processing time

Every number that has a matching queue filter should link to it (for example
`/authorizations?alert=PAYER_OVERDUE`). Keep the exact text "Payer decisions overdue" somewhere
on the page for the smoke test.

**3. "Work to do first."** Show the severity icon, the case number, the patient's last name and
first initial, the alert message, and a direct action button. Add an empty state that says
"You're all caught up".

**4. Queue alerts column.** Replace the lowercase text badge with a severity icon and a short
label (for example "Payer overdue"), with a "+2" count and a tooltip listing the rest. Keep the
column header "Alerts".

**5. Queue on phones.** Under 768px, show a card list instead of the table: case number, status,
patient, payer, main alert and service date, with the whole card as a link.

**6. Filters.** Put the filters in a collapsible bar on phones. Show active filters as removable
chips with a "Clear all" button.

---

## Phase 4 — States and consistency

1. Add `loading.tsx` skeletons for the dashboard, the authorizations list, the case workspace
   and the patient page, shaped like the real content so the page doesn't jump when it loads.
2. Add friendly empty states with a next step for: empty queue, a filter with no results, no
   documents, no tasks, no notes and no AI runs.
3. Add an error boundary (`error.tsx`) for the console area with a retry button. Don't show
   stack traces or record data.
4. Go through the remaining plain `<select>` elements across the app and make them consistent.
5. Status badges: add a small icon per status group so status doesn't depend on color alone.
   Keep the colors that already exist.
6. Do a final pass at 1440, 1024, 768 and 390px wide in light and dark mode. Fix overflow,
   cramped spacing, and any text smaller than 12px.

---

## Checks after every phase

```
npm run typecheck
npm run lint
npm test
npm run build
```

After phase 4, also run these:

```
# terminal 1
HF_DEMO_MODE=true HF_SKIP_CONFIG_CHECK=true SESSION_SECRET=local-smoke-secret-local-smoke-secret-00 HF_DATA_DIR=/tmp/hf-smoke npm start
# terminal 2
SESSION_SECRET=local-smoke-secret-local-smoke-secret-00 HF_DATA_DIR=/tmp/hf-smoke npm run test:smoke -- http://127.0.0.1:43123
npm run test:e2e
```

All must pass. Don't delete or weaken a test to make it pass. If a test has to change because a
label or text changed on purpose, update it and tell me.

## What to send me after each phase

- What changed, in a few lines
- Files touched
- Test results
- Screenshots or a description of each changed screen, at desktop and phone width
- Anything you weren't sure about, or anything you decided not to do and why
