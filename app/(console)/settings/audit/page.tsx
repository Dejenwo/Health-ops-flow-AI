import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/domain/permissions";
import { listAudit } from "@/lib/services/admin";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const ctx = await getRequestContext();
  if (!can(ctx.role, "audit.read")) {
    return <p className="text-sm text-muted-foreground">Audit history is limited to owners and admins.</p>;
  }
  const events = listAudit(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" description="Append-only. Passwords, tokens, and secrets are not stored in event metadata." />
      <ul className="divide-y rounded-xl border bg-card">
        {events.map((event) => (
          <li key={event.id} className="px-4 py-3 text-sm">
            <p className="font-medium">{event.event}</p>
            <p className="text-muted-foreground">{event.actorName} · {event.resourceType} · {formatDateTime(event.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
