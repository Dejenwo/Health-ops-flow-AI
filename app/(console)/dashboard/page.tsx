import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, CheckCircle2, Clock3, Hand, ListTodo, Scale, Timer } from "lucide-react";
import { SeverityIcon, StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProcessingChart, StatusChart, VolumeChart } from "@/components/charts/ops-charts";
import { formatDays, formatPercent, formatRelative } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/domain/labels";
import { getAnalytics, getDashboard } from "@/lib/services/intelligence";
import { listAuthorizations } from "@/lib/services/authorizations";
import { getRequestContext } from "@/lib/services/context";
import { cn } from "cn";

export const metadata = { title: "Dashboard" };

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Adler, Elena" -> "Adler, E." so the dashboard shows no more of the name than it needs. */
function shortName(name: string): string {
  const [last, first] = name.split(",").map((part) => part.trim());
  return first ? `${last}, ${first.charAt(0)}.` : last;
}

interface Metric {
  label: string;
  value: string;
  href?: string;
  icon: LucideIcon;
  tone?: "critical" | "warning" | "default";
}

function MetricGroup({ title, description, metrics }: { title: string; description: string; metrics: Metric[] }) {
  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby={`group-${title}`}>
      <h2 id={`group-${title}`} className="font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const body = (
            <>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className={cn("size-3.5", metric.tone === "critical" && "text-critical", metric.tone === "warning" && "text-warning")} aria-hidden />
                {metric.label}
              </dt>
              <dd className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", metric.tone === "critical" && metric.value !== "0" && "text-critical")}>
                {metric.value}
              </dd>
            </>
          );
          return metric.href ? (
            <Link key={metric.label} href={metric.href} className="rounded-lg p-2 -m-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              {body}
            </Link>
          ) : (
            <div key={metric.label}>{body}</div>
          );
        })}
      </dl>
    </section>
  );
}

export default async function DashboardPage() {
  const ctx = await getRequestContext();
  const now = new Date();
  const data = getDashboard(ctx, now);
  const analytics = getAnalytics(ctx, "all");
  const dueSoon = listAuthorizations(ctx, { alert: "PAYER_DUE_SOON", pageSize: 1 }, now).total;
  const waitingOnUs = listAuthorizations(ctx, { status: "ADDITIONAL_INFORMATION_REQUESTED", pageSize: 1 }, now).total;
  const firstName = ctx.profile.fullName.split(" ")[0] || "there";

  const summaryParts = [
    data.kpis.payerOverdue ? `${plural(data.kpis.payerOverdue, "payer decision is", "payer decisions are")} overdue` : null,
    data.kpis.appealDeadlines ? `${plural(data.kpis.appealDeadlines, "appeal deadline is", "appeal deadlines are")} within 10 days` : null,
    data.kpis.expiring ? `${plural(data.kpis.expiring, "approval needs", "approvals need")} a date check` : null,
    data.kpis.tasksDue ? `${plural(data.kpis.tasksDue, "task is", "tasks are")} due` : null,
  ].filter(Boolean) as string[];
  const summary = summaryParts.length
    ? `${summaryParts.slice(0, -1).join(", ")}${summaryParts.length > 1 ? " and " : ""}${summaryParts.at(-1)}.`
    : "Nothing is overdue. Payer clocks, approvals and appeal deadlines are all on track.";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{ctx.organization.name}</p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          {greeting(now)}, {firstName}
        </h1>
        <p className="max-w-[70ch] text-muted-foreground">{summary.charAt(0).toUpperCase() + summary.slice(1)}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricGroup
          title="Payer clock"
          description="Submitted cases against each payer's decision timeframe"
          metrics={[
            { label: "Payer decisions overdue", value: String(data.kpis.payerOverdue), href: "/authorizations?alert=PAYER_OVERDUE", icon: Clock3, tone: "critical" },
            { label: "Due within 24 hours", value: String(dueSoon), href: "/authorizations?alert=PAYER_DUE_SOON", icon: Timer, tone: "warning" },
            { label: "Waiting on us", value: String(waitingOnUs), href: "/authorizations?status=ADDITIONAL_INFORMATION_REQUESTED", icon: Hand, tone: "warning" },
            { label: "Appeal deadlines", value: String(data.kpis.appealDeadlines), href: "/authorizations?alert=APPEAL_DEADLINE_SOON", icon: Scale, tone: "critical" },
          ]}
        />
        <MetricGroup
          title="Decisions"
          description="From recorded payer outcomes, all time"
          metrics={[
            { label: "Approved (incl. partial)", value: String(data.kpis.approved), icon: CheckCircle2 },
            { label: "Denied", value: String(data.kpis.denied), href: "/authorizations?status=DENIED", icon: Scale },
            { label: "Approval rate", value: formatPercent(data.kpis.approvalRate), icon: CheckCircle2 },
            { label: "Payer on-time rate", value: formatPercent(analytics.payerOnTimeRate), icon: Timer },
          ]}
        />
        <MetricGroup
          title="Workload"
          description="What the team is carrying right now"
          metrics={[
            { label: "Needs attention", value: String(data.kpis.needsAttention), icon: CalendarClock, tone: "warning" },
            { label: "Pending with payer", value: String(data.kpis.pending), href: "/authorizations?status=PENDING", icon: Clock3 },
            { label: "Tasks due", value: String(data.kpis.tasksDue), href: "/tasks", icon: ListTodo },
            { label: "Avg. processing", value: formatDays(data.kpis.averageProcessingDays), icon: Timer },
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <CardTitle>Work to do first</CardTitle>
            <p className="text-xs text-muted-foreground">Ranked by alert severity from payer timeframes, approval windows and appeal deadlines.</p>
          </CardHeader>
          <CardContent>
            {data.recommendations.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <CheckCircle2 className="mx-auto size-6 text-success" aria-hidden />
                <p className="mt-2 font-medium">You&apos;re all caught up</p>
                <p className="text-sm text-muted-foreground">No case has an open deadline or alert right now.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {data.recommendations.map((item) => (
                  <li key={item.href + item.suggestion} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <SeverityIcon severity={item.severity as "critical" | "warning" | "info"} className="mt-0.5" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p>
                        <span className="font-medium">{item.title}</span>
                        <span className="text-muted-foreground"> for {shortName(item.patient)}</span>
                      </p>
                      <p className="text-muted-foreground">{item.suggestion}</p>
                    </div>
                    <Link href={item.href} className="shrink-0 rounded-md border px-2.5 py-1 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                      Open case
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tasks due today</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.tasksDueToday.length === 0 ? <p className="text-muted-foreground">Nothing is due today.</p> : null}
            {data.tasksDueToday.map((task) => (
              <Link key={task.id} href={task.authorizationId ? `/authorizations/${task.authorizationId}` : "/tasks"} className="flex items-start gap-2 rounded-md p-1.5 -mx-1.5 hover:bg-muted">
                <ListTodo className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {task.title}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-4 xl:grid-cols-3" aria-label="Trends">
        <Card>
          <CardHeader><CardTitle>Status distribution</CardTitle></CardHeader>
          <CardContent>
            <StatusChart data={data.statusDistribution.map((item) => ({ name: STATUS_LABEL[item.name as keyof typeof STATUS_LABEL] ?? item.name, count: item.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Authorization volume</CardTitle></CardHeader>
          <CardContent><VolumeChart data={data.volume} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Processing time trend</CardTitle></CardHeader>
          <CardContent><ProcessingChart data={data.processing} /></CardContent>
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Urgent cases</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.urgent.length === 0 ? <p className="text-sm text-muted-foreground">No open urgent cases.</p> : null}
            {data.urgent.map((item) => (
              <Link key={item.id} href={`/authorizations/${item.id}`} className="block rounded-lg border p-3 transition-colors hover:bg-muted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.number}</span>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{shortName(item.patient)}, {item.procedure}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cases by payer</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {data.byPayer.map((item) => {
              const max = Math.max(...data.byPayer.map((row) => row.count), 1);
              return (
                <div key={item.key}>
                  <div className="flex items-center justify-between gap-3">
                    <span>{item.key}</span>
                    <span className="tabular-nums text-muted-foreground">{item.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${(item.count / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.activity.slice(0, 6).map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p>{item.summary}</p>
                  <p className="text-xs text-muted-foreground">{item.actorName}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{formatRelative(item.createdAt)}</time>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
