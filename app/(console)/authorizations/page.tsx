import Link from "next/link";
import { AuthorizationTable } from "@/components/authorizations/authorization-table";
import { FilterBar } from "@/components/authorizations/filter-bar";
import { ALERT_SHORT_LABEL } from "@/components/status-badge";
import { X } from "lucide-react";
import { PageHeader, fieldClass } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTH_STATUSES, PRIORITIES } from "@/lib/domain/types";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/domain/labels";
import { listAuthorizations } from "@/lib/services/authorizations";
import { activeMembers, listPayers } from "@/lib/services/directory";
import { getRequestContext } from "@/lib/services/context";
import { cn } from "cn";

export const metadata = { title: "Authorizations" };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AuthorizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getRequestContext();
  const page = Number(one(params.page) || "1");
  const query = {
    q: one(params.q),
    status: one(params.status),
    payerId: one(params.payerId),
    priority: one(params.priority),
    assigneeId: one(params.assigneeId),
    alert: one(params.alert),
    from: one(params.from),
    to: one(params.to),
    sort: (one(params.sort) || "updatedAt") as "updatedAt",
    dir: (one(params.dir) || "desc") as "asc" | "desc",
    page,
    pageSize: 15,
  };
  const result = listAuthorizations(ctx, query);
  const payers = listPayers(ctx);
  const members = activeMembers(ctx);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value && key !== "page" && key !== "pageSize") qs.set(key, String(value));
  }

  const labelFor: Record<string, (value: string) => string> = {
    q: (value) => `“${value}”`,
    status: (value) => STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? value,
    payerId: (value) => payers.find((payer) => payer.id === value)?.name ?? "Payer",
    priority: (value) => PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL] ?? value,
    assigneeId: (value) => (value === "unassigned" ? "Unassigned" : members.find((member) => member.userId === value)?.name ?? "Assignee"),
    alert: (value) => ALERT_SHORT_LABEL[value as keyof typeof ALERT_SHORT_LABEL] ?? value,
    from: (value) => `From ${value}`,
    to: (value) => `To ${value}`,
  };
  const chips = Object.keys(labelFor)
    .filter((key) => query[key as keyof typeof query])
    .map((key) => {
      const rest = new URLSearchParams(qs);
      rest.delete(key);
      return { key, label: labelFor[key](String(query[key as keyof typeof query])), href: `/authorizations${rest.toString() ? `?${rest}` : ""}` };
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Authorizations"
        description="Search and filter the organization’s prior authorization queue."
        actions={<Link href="/authorizations/new" className={buttonVariants()}>New authorization</Link>}
      />
      <FilterBar activeCount={chips.length}>
      <form className="grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-9" method="get">
        <Input name="q" defaultValue={query.q} placeholder="Search" aria-label="Search authorizations" className="xl:col-span-2" />
        <select name="status" defaultValue={query.status} aria-label="Status" className={fieldClass}>
          <option value="">All statuses</option>
          {AUTH_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
        <select name="payerId" defaultValue={query.payerId} aria-label="Payer" className={fieldClass}>
          <option value="">All payers</option>
          {payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
        </select>
        <select name="priority" defaultValue={query.priority} aria-label="Priority" className={fieldClass}>
          <option value="">All priorities</option>
          {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
        </select>
        <select name="assigneeId" defaultValue={query.assigneeId} aria-label="Assignee" className={fieldClass}>
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
        </select>
        <select name="alert" defaultValue={query.alert} aria-label="Alert" className={fieldClass}>
          <option value="">Any alert state</option>
          <option value="PAYER_OVERDUE">Payer overdue</option>
          <option value="PAYER_DUE_SOON">Payer due within 24h</option>
          <option value="AUTH_EXPIRING">Approval expiring</option>
          <option value="SERVICE_OUTSIDE_WINDOW">Service outside window</option>
          <option value="APPEAL_DEADLINE_SOON">Appeal deadline soon</option>
          <option value="URGENT_NOT_SUBMITTED">Urgent, not submitted</option>
          <option value="STALE_INTERNAL">Stale internal work</option>
          <option value="DETERMINATION_LETTER_MISSING">Letter missing</option>
        </select>
        <Input name="from" type="date" defaultValue={query.from} aria-label="Requested from" />
        <Input name="to" type="date" defaultValue={query.to} aria-label="Requested to" />
        <button className={cn(buttonVariants({ variant: "outline" }))} type="submit">Apply</button>
      </form>
      </FilterBar>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label} <X className="size-3" aria-hidden />
            </Link>
          ))}
          <Link href="/authorizations" className="text-xs font-medium text-primary hover:underline">Clear all</Link>
        </div>
      ) : null}
      <AuthorizationTable rows={result.items} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>{result.total} cases</p>
        <div className="flex gap-2">
          {page > 1 ? <Link href={`/authorizations?${qs.toString()}&page=${page - 1}`}>Previous</Link> : null}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/authorizations?${qs.toString()}&page=${page + 1}`}>Next</Link> : null}
        </div>
      </div>
    </div>
  );
}
