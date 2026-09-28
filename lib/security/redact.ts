import type { SafeMetadata } from "@/lib/domain/types";

/**
 * Keys that must never reach audit or activity metadata.
 * Matches credential-like keys (password, token, secret, api key, cookie, the HTTP
 * Authorization header, session ids) without catching domain keys such as `authorizationId`.
 */
const BLOCKED = /(password|passwd|secret|token|api[_-]?key|cookie|^authorization$|^auth[_-]?header$|^session$|session[_-]?id)/i;

export function toSafeMetadata(input: Record<string, unknown> | undefined): SafeMetadata {
  const output: SafeMetadata = {};
  if (!input) return output;
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED.test(key)) continue;
    if (typeof value === "string") {
      output[key] = value.slice(0, 300);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      output[key] = value;
    }
  }
  return output;
}
