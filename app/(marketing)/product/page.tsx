import type { Metadata } from "next";

export const metadata: Metadata = { title: "Product" };

const AREAS = [
  ["Authorizations", "Draft through close, with a server-side state machine and a full case workspace."],
  ["Patients, providers, payers", "Directory records scoped to the organization. Demo identifiers are fictional."],
  ["Tasks and deadlines", "Open, in progress, completed, and cancelled. The dashboard separates overdue, due today, and upcoming."],
  ["Documents", "Metadata plus private file storage. Downloads require an authenticated member of the same organization."],
  ["AI assistant", "Predefined operational questions. The assistant does not execute model-written SQL."],
  ["Analytics", "Volume, approval and denial rates, aging, payer mix, and specialist workload from stored cases."],
];

export default function ProductPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-medium text-primary">Product</p>
      <h1 className="font-display mt-2 text-5xl tracking-tight">One queue for prior authorization work</h1>
      <p className="mt-4 text-muted-foreground">
        HealthFlow AI is an administrative workspace for clinics and billing teams. It is not a medical device, and it does not decide coverage.
      </p>
      <div className="mt-10 space-y-6">
        {AREAS.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-xl font-medium">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
