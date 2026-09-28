import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusChart, VolumeChart } from "@/components/charts/ops-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDays, formatPercent } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/domain/labels";
import { getAnalytics } from "@/lib/services/intelligence";
import { getRequestContext } from "@/lib/services/context";
import { cn } from "cn";

export const metadata = { title: "Analytics" };

const PRESETS = [
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["90d", "90 days"],
  ["ytd", "Year to date"],
  ["all", "All"],
];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.range) ? params.range[0] : params.range;
  const range = raw || "all";
  const ctx = await getRequestContext();
  const data = getAnalytics(ctx, range);
  const metrics = [
    ["Authorization volume", String(data.volume)],
    ["Approval rate", formatPercent(data.approvalRate)],
    ["Denial rate", formatPercent(data.denialRate)],
    ["Partial approvals", formatPercent(data.partialApprovalRate)],
    ["Payer on-time rate", formatPercent(data.payerOnTimeRate)],
    ["Pending cases", String(data.pending)],
    ["Average processing", formatDays(data.averageProcessingDays)],
    ["Needing information", String(data.needingInformation)],
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Calculated from authorization records in this organization." />
      <div className="flex flex-wrap gap-2 text-sm">
        {PRESETS.map(([value, label]) => (
          <Link key={value} href={`/analytics?range=${value}`} className={cn("rounded-full border px-3 py-1", range === value && "bg-primary text-primary-foreground")}>{label}</Link>
        ))}
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader><CardTitle className="text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{value}</CardContent>
          </Card>
        ))}
      </section>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Status distribution</CardTitle></CardHeader>
          <CardContent><StatusChart data={data.statusDistribution.map((item) => ({ name: STATUS_LABEL[item.name as keyof typeof STATUS_LABEL] ?? item.name, count: item.count }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Monthly volume</CardTitle></CardHeader>
          <CardContent><VolumeChart data={data.volumeTrend} /></CardContent>
        </Card>
      </section>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Breakdown title="Cases by payer" rows={data.byPayer} />
        <Breakdown title="Cases by procedure" rows={data.byProcedure} />
        <Breakdown title="Cases by specialist" rows={data.bySpecialist} />
      </section>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-3">
            <span>{row.key}</span>
            <span className="text-muted-foreground">{row.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
