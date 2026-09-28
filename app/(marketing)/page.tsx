import type { Metadata } from "next";
import Link from "next/link";
import { DemoButton } from "@/components/marketing/site-frame";
import { buttonVariants } from "@/components/ui/button";
import { PLANS } from "@/lib/billing/plans";
import { cn } from "cn";

export const metadata: Metadata = {
  title: "Prior authorization workflows, powered by AI",
  description: "Organize cases, documents, tasks and payer follow-ups from one intelligent workspace.",
};

const PROBLEMS = [
  { title: "Work lives in inboxes", body: "Authorization packets, payer faxes, and follow-ups scatter across email, shared drives, and spreadsheets." },
  { title: "Status is tribal knowledge", body: "Managers cannot see which cases are waiting on documents, which are pending with a payer, and which are past due." },
  { title: "AI without a workflow is a liability", body: "A chatbot that drafts clinical claims or approves coverage is the wrong product. Staff need an auditable queue." },
];

const STEPS = [
  { n: "01", title: "Open the case", body: "Capture the patient, payer, procedure, and assignee. The case starts as a draft." },
  { n: "02", title: "Assemble the packet", body: "Attach documents, tasks, and notes. HealthFlow flags missing administrative items." },
  { n: "03", title: "Move it deliberately", body: "Status changes follow a server-side state machine. Invalid jumps are rejected." },
  { n: "04", title: "Review AI drafts", body: "Summaries and follow-ups stay internal until a person decides to save or copy them." },
];

const FAQ = [
  { q: "Does HealthFlow approve or deny authorizations?", a: "No. People change status. AI can summarize, list missing administrative information, and draft follow-ups for review." },
  { q: "Is this HIPAA compliant?", a: "No. This MVP uses synthetic data and is not certified for protected health information. A production deployment needs a security review, a BAA, and additional controls documented in the security guide." },
  { q: "Are the payer and EHR connections live?", a: "No. Epic, Oracle Health, athenahealth, FHIR, HL7, fax, and payer APIs are shown as future integrations. Requesting one records interest. Nothing is submitted." },
  { q: "Can I evaluate it without accounts for Stripe or an AI vendor?", a: "Yes. Demo mode signs you into Northstar Specialty Clinic with a mock AI provider and local data. No card is charged." },
];

export default function HomePage() {
  return (
    <div>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-24">
        <div>
          <p className="text-sm font-medium text-primary">Prior authorization operations</p>
          <h1 className="font-display mt-3 text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl md:text-6xl">
            Prior Authorization Workflows, Powered by AI
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Organize cases, documents, tasks and payer follow-ups from one intelligent workspace.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}>
              Start Free
            </Link>
            <DemoButton className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 px-4")} label="View Demo" />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Synthetic clinic data. AI output is administrative and must be reviewed.</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <p className="text-sm font-medium">Northstar queue</p>
            <span className="text-xs text-muted-foreground">Illustrative</span>
          </div>
          <ul className="divide-y">
            {[
              ["PA-2026-1014", "MRI lumbar spine", "Urgent", "Pending"],
              ["PA-2026-1022", "Knee arthroplasty", "High", "Needs information"],
              ["PA-2026-1008", "Colonoscopy", "Normal", "Approved"],
              ["PA-2026-1031", "Stress test", "Normal", "Info requested"],
            ].map((row) => (
              <li key={row[0]} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">{row[0]}</p>
                  <p className="text-muted-foreground">{row[1]}</p>
                </div>
                <div className="text-right">
                  <p>{row[3]}</p>
                  <p className="text-xs text-muted-foreground">{row[2]}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y bg-card/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-3">
          {PROBLEMS.map((item) => (
            <div key={item.title}>
              <h2 className="text-lg font-medium">{item.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-4xl tracking-tight">A workspace for the work, not a diagnosis engine</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          HealthFlow keeps patients, payers, packets, tasks, and decisions in one organization-scoped record. AI organizes what staff already entered. It does not determine medical necessity.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {STEPS.map((step) => (
            <article key={step.n} className="rounded-xl border bg-card p-4">
              <p className="text-xs font-medium text-primary">{step.n}</p>
              <h3 className="mt-2 font-medium">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
          <div>
            <h2 className="font-display text-4xl tracking-tight">AI that stays in its lane</h2>
            <p className="mt-3 text-muted-foreground">Every generated summary, checklist, and payer draft is labeled “AI-generated — review before use.” Nothing is submitted, approved, or denied by the model.</p>
          </div>
          <div>
            <h2 className="font-display text-4xl tracking-tight">Operations you can explain</h2>
            <p className="mt-3 text-muted-foreground">Volume, approval rate, aging, and payer mix come from the case record. Roles are enforced on the server. Audit events are append-only in the application and in the database policies.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-4xl tracking-tight">Pricing</h2>
        <p className="mt-2 text-sm text-muted-foreground">Configuration-driven plans. The demo changes plans locally and does not charge a card.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <article key={plan.id} className={cn("rounded-xl border bg-card p-5", plan.highlighted && "border-primary")}>
              <h3 className="text-lg font-medium">{plan.name}</h3>
              <p className="mt-2 font-display text-4xl">{plan.priceLabel}</p>
              <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-display text-4xl tracking-tight">Questions worth asking</h2>
          <div className="mt-6 divide-y border-y">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="cursor-pointer text-base font-medium">{item.q}</summary>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary px-6 py-8 text-primary-foreground">
            <div>
              <h2 className="font-display text-3xl">See the Northstar clinic</h2>
              <p className="mt-1 text-sm text-primary-foreground/80">A populated prior-authorization queue, with no real patient data.</p>
            </div>
            <DemoButton className="rounded-lg bg-background px-4 py-2 text-sm font-medium text-foreground" label="View Demo" />
          </div>
        </div>
      </section>
    </div>
  );
}
