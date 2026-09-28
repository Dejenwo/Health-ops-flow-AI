import type { Metadata } from "next";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-medium text-primary">Security</p>
      <h1 className="font-display mt-2 text-5xl tracking-tight">Built for tenancy. Not certified for PHI.</h1>
      <p className="mt-4 text-muted-foreground">
        HealthFlow is not HIPAA compliant, and this demo must not be used with real patient information. The controls below are what the MVP actually implements.
      </p>
      <ul className="mt-8 space-y-4 text-sm">
        {[
          "Organization membership is checked on every read and write. A record from another organization returns the same not-found result as a missing record.",
          "Roles are enforced in services, not by hiding buttons. Viewers cannot create or update operational records.",
          "PostgreSQL row-level security policies ship in supabase/migrations for a Supabase deployment. Demo mode enforces the same organization boundary in the application store.",
          "Document downloads are authenticated and organization-scoped. Seeded files are synthetic text. Uploads are limited by type, size, and file signature.",
          "Audit events can be inserted. The application does not offer an update or delete path, and the SQL migration blocks updates and deletes.",
          "AI runs on the server. API keys are read from the environment and are not sent to the browser. The default provider is a mock.",
          "Session cookies are httpOnly. Production on Vercel marks them secure. Set SESSION_SECRET before any shared deployment.",
        ].map((item) => (
          <li key={item} className="border-b pb-4">{item}</li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted-foreground">
        Before real PHI: a signed BAA, encryption review, access logging retention, backup and restore tests, vendor reviews, penetration testing, and a decision not to rely on the demo session secret or on-screen password reset links. Details are in docs/SECURITY.md and docs/PRODUCTION_READINESS.md.
      </p>
    </article>
  );
}
