"use client";
import type React from "react";

import Link from "next/link";
import { CircleCheck, CircleX, Hand } from "lucide-react";
import { SeverityIcon } from "@/components/status-badge";
import type { CaseAlert } from "@/lib/domain/sla";
import type { AuthStatus } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/labels";
import { stageView } from "@/components/authorizations/stage";
import { cn } from "cn";

/**
 * The case's position in the prior-auth flow. Stages are connected by a single line that fills
 * up to the current stage — the product's signature element.
 */
export function StageTracker({
  status,
  wasAppealed,
  stoppedAt,
}: {
  status: AuthStatus;
  wasAppealed: boolean;
  stoppedAt: AuthStatus | null;
}) {
  const view = stageView(status, wasAppealed, stoppedAt);
  const current = view.stages[view.currentIndex];
  const done = status === "CLOSED";
  const note = view.stopped
    ? "Withdrawn before a decision"
    : view.waitingOnUs
      ? "The payer is waiting on us"
      : STATUS_LABEL[status];

  return (
    <section aria-label="Case progress" className="rounded-xl border bg-card px-4 py-3">
      <p className="text-sm sm:hidden">
        <span className="font-medium">
          Step {view.currentIndex + 1} of {view.stages.length} · {current.label}
        </span>
        <span className="block text-muted-foreground">{note}</span>
      </p>
      <ol className="hidden grid-flow-col auto-cols-fr sm:grid">
        {view.stages.map((stage, index) => {
          const complete = index < view.currentIndex || (done && index === view.currentIndex);
          const active = index === view.currentIndex && !done;
          const reached = index <= view.currentIndex;
          return (
            <li key={stage.key} className="relative flex flex-col items-center text-center" aria-current={active ? "step" : undefined}>
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-[11px] right-1/2 left-[-50%] h-0.5 transition-colors",
                    reached && !(view.stopped && index === view.currentIndex) ? "bg-primary" : "bg-border",
                    view.stopped && index === view.currentIndex && "bg-[repeating-linear-gradient(90deg,var(--muted-foreground)_0_4px,transparent_4px_8px)]",
                  )}
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 grid size-6 place-items-center rounded-full border-2 bg-card text-[11px] font-semibold",
                  complete && "border-primary bg-primary text-primary-foreground",
                  active && !view.stopped && "border-primary text-primary ring-4 ring-primary/15",
                  active && view.waitingOnUs && "border-warning text-warning ring-warning/15",
                  view.stopped && index === view.currentIndex && "border-muted-foreground text-muted-foreground",
                  !reached && "border-border text-muted-foreground",
                )}
              >
                {complete ? <CircleCheck className="size-3.5" /> : view.stopped && index === view.currentIndex ? <CircleX className="size-3.5" /> : active && view.waitingOnUs ? <Hand className="size-3" /> : index + 1}
              </span>
              <span className={cn("mt-1.5 text-xs", active ? "font-semibold text-foreground" : "text-muted-foreground")}>{stage.label}</span>
              {index === view.currentIndex ? <span className="mt-0.5 max-w-[14ch] text-xs text-muted-foreground">{done ? "Complete" : note}</span> : null}
              <span className="sr-only">
                {complete ? "completed" : active ? "current step" : view.stopped && index === view.currentIndex ? "stopped" : "not started"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export interface AlertAction {
  label: string;
  onClick: () => void;
}

export function CaseAlerts({ alerts, actionFor }: { alerts: CaseAlert[]; actionFor: (alert: CaseAlert) => AlertAction | null }) {
  if (!alerts.length) return null;
  return (
    <ul className="space-y-2" aria-label="Case alerts">
      {alerts.map((alert) => {
        const action = actionFor(alert);
        return (
          <li
            key={alert.kind}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
              alert.severity === "critical" && "border-critical/30 bg-critical-soft",
              alert.severity === "warning" && "border-warning/30 bg-warning-soft",
              alert.severity === "info" && "border-info/25 bg-info-soft",
            )}
          >
            <SeverityIcon severity={alert.severity} className="mt-0.5" />
            <p className="flex-1">{alert.message}</p>
            {action ? (
              <button
                type="button"
                onClick={action.onClick}
                className="shrink-0 rounded-md px-2 py-0.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {action.label}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
}

export function PacketChecklist({
  items,
  fixFor,
}: {
  items: ChecklistItem[];
  fixFor: (item: ChecklistItem) => { label: string; href?: string; onClick?: () => void } | null;
}) {
  const ready = items.filter((item) => item.ok).length;
  const percent = items.length ? Math.round((ready / items.length) * 100) : 0;
  return (
    <section id="packet-checklist" tabIndex={-1} className="scroll-mt-20 rounded-xl border bg-card p-4 text-sm focus-visible:outline-2 focus-visible:outline-ring" aria-label="Packet checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Packet checklist</h2>
        <p className={cn("text-sm", ready === items.length ? "text-success" : "text-muted-foreground")}>
          {ready} of {items.length} ready
        </p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={ready}
        aria-label="Packet items ready"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300", ready === items.length ? "bg-success" : "bg-primary")} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Every item must pass before the case can move to Ready for review or be submitted.</p>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {items.map((item) => {
          const fix = item.ok ? null : fixFor(item);
          return (
            <li key={item.key} className="flex items-start gap-2">
              {item.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" role="img" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-critical" aria-label="Missing" role="img" />
              )}
              <span className={cn("flex-1", item.ok ? "text-muted-foreground" : "font-medium")}>
                {item.label}
                {fix ? (
                  fix.href ? (
                    <Link href={fix.href} className="ml-2 text-primary underline-offset-4 hover:underline">{fix.label}</Link>
                  ) : (
                    <button type="button" onClick={fix.onClick} className="ml-2 text-primary underline-offset-4 hover:underline">{fix.label}</button>
                  )
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DetailCard({ title, rows, className }: { title: string; rows: [string, React.ReactNode][]; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", className)}>
      <h2 className="font-semibold">{title}</h2>
      <dl className="mt-3 divide-y text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
