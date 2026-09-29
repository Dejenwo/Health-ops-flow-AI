"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleHelp, CircleX, Loader2, ShieldCheck } from "lucide-react";
import { eligibilityAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import type { EligibilityCheck } from "@/lib/domain/types";
import { cn } from "cn";

const STATUS = {
  ACTIVE: { label: "Coverage active", icon: CircleCheck, className: "text-success" },
  INACTIVE: { label: "Coverage not active", icon: CircleX, className: "text-critical" },
  UNKNOWN: { label: "Coverage unclear", icon: CircleHelp, className: "text-warning" },
  ERROR: { label: "Check failed", icon: CircleX, className: "text-critical" },
} as const;

export function EligibilityCard({
  authorizationId,
  history,
  available,
  canRun,
}: {
  authorizationId: string;
  history: EligibilityCheck[];
  available: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = history[0];
  const style = latest ? STATUS[latest.status] : null;
  const Icon = style?.icon ?? ShieldCheck;

  return (
    <section className="rounded-xl border bg-card p-4 text-sm" aria-label="Eligibility">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Eligibility</h2>
        {available && canRun ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await eligibilityAction(authorizationId);
            setBusy(false);
            if (!result.ok) setError(result.error);
            router.refresh();
          }}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} {latest ? "Check again" : "Check eligibility"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-destructive" role="alert">{error}</p> : null}
      {!available ? (
        <p className="mt-2 text-muted-foreground">Not connected. An admin can connect a clearinghouse under Integrations.</p>
      ) : !latest ? (
        <p className="mt-2 text-muted-foreground">Not checked yet for this case.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p className={cn("flex items-center gap-1.5 font-medium", style?.className)}>
            <Icon className="size-4" aria-hidden /> {style?.label}
          </p>
          {latest.status === "ERROR" ? <p className="text-muted-foreground">{latest.errorMessage}</p> : null}
          {latest.planName ? <p>{latest.planName}</p> : null}
          {latest.coverageStart || latest.coverageEnd ? (
            <p className="text-muted-foreground">Coverage {latest.coverageStart ?? "?"} to {latest.coverageEnd ?? "open"}</p>
          ) : null}
          {latest.authIndicator !== "UNKNOWN" ? (
            <p>Payer says prior auth is {latest.authIndicator === "REQUIRED" ? "required" : "not required"} for general plan coverage.</p>
          ) : null}
          {latest.notes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          <p className="text-xs text-muted-foreground">
            Checked {new Date(latest.checkedAt).toLocaleString()} via {latest.provider}{latest.environment === "test" ? " (test)" : ""}.
            {history.length > 1 ? ` ${history.length - 1} earlier check${history.length > 2 ? "s" : ""}.` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
