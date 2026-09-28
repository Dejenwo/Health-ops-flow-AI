/**
 * Minimum-necessary filter for text sent to an external model (HIPAA §164.502(b)).
 * It removes direct identifiers the model does not need to organize a prior-auth packet.
 * It is a best-effort filter, not de-identification under §164.514; a BAA with the model
 * vendor is still required before AI_PROVIDER is set to a remote model.
 */
const PATTERNS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]"],
  [/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]"],
  [/\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b\.?/g, "[address]"],
  [/\b(?:DOB|Date of birth)[:\s]*\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/gi, "[dob]"],
];

export function redactForModel(text: string, identifiers: string[] = []): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  const tokens = identifiers
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "[patient]");
  }
  return out;
}
