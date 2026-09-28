/** Only allow same-origin relative paths. */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("://") || value.includes("\\")) return fallback;
  if (value.length > 300) return fallback;
  return value;
}
