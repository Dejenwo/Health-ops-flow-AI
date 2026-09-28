import { CircleHelp, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "cn";

/** Prior-auth requirement from the practice's payer rules. Always icon + text, never color alone. */
export function RequirementBadge({ requirement, className }: { requirement: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN"; className?: string }) {
  const config = {
    REQUIRED: { icon: ShieldAlert, label: "Auth required", style: "border-warning/30 bg-warning-soft" },
    NOT_REQUIRED: { icon: ShieldCheck, label: "No auth needed", style: "border-success/30 bg-success-soft" },
    UNKNOWN: { icon: CircleHelp, label: "No rule on file", style: "border-border bg-muted text-muted-foreground" },
  }[requirement];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium", config.style, className)}>
      <Icon className="size-3.5" aria-hidden />
      {config.label}
    </span>
  );
}
