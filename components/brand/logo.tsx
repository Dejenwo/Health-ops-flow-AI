import { cn } from "cn";

/** Three connected stages on a flowing line: a case moving from request to decision. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden focusable="false">
      <rect width="28" height="28" rx="7" className="fill-primary" />
      <path d="M6 18.5c3.2 0 3.6-9 7.6-9s4.4 9 8.4 9" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="6" cy="18.5" r="2.1" fill="white" />
      <circle cx="13.6" cy="9.5" r="2.1" fill="white" />
      <circle cx="22" cy="18.5" r="2.1" className="fill-[#9ff0f3]" />
    </svg>
  );
}

export function Logo({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      {wordmark ? (
        <span>
          HealthFlow<span className="font-normal opacity-70"> AI</span>
        </span>
      ) : null}
    </span>
  );
}
