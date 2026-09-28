import type { AuthRequirement, CodeType, PayerAuthRule } from "@/lib/domain/types";
import { normalizeCode } from "@/lib/domain/codes";

/** Exact code ("72148") or a family prefix ending in "*" ("7214*", "J17*"). */
export const RULE_CODE_PATTERN = /^[0-9A-Z]{1,5}\*?$/;

export interface RequirementResult {
  requirement: AuthRequirement | "UNKNOWN";
  rule: PayerAuthRule | null;
}

/**
 * Looks up whether this payer needs prior auth for this code, using the practice's own rules.
 * An exact code beats a prefix; a longer prefix beats a shorter one. With no rule, the answer is
 * UNKNOWN: HealthFlow never assumes a code is exempt.
 */
export function authRequirement(rules: PayerAuthRule[], payerId: string, codeType: CodeType, rawCode: string): RequirementResult {
  const code = normalizeCode(rawCode);
  let best: PayerAuthRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (rule.payerId !== payerId || rule.codeType !== codeType) continue;
    let score = -1;
    if (rule.code === code) score = 100;
    else if (rule.code.endsWith("*") && code.startsWith(rule.code.slice(0, -1))) score = rule.code.length;
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return { requirement: best?.requirement ?? "UNKNOWN", rule: best };
}
