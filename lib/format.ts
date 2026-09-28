import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = value.length <= 10 ? parseISO(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, yyyy");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, yyyy · h:mm a");
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

export function daysBetween(fromIso: string, to: Date = new Date()): number {
  const from = new Date(fromIso);
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Calendar-date arithmetic in UTC so results never shift with the server's time zone. */
export function addDaysISO(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Whole calendar days from `fromDate` to `toDate` (YYYY-MM-DD). Negative when `toDate` is earlier. */
export function calendarDaysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatDays(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}d`;
}

export function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}
