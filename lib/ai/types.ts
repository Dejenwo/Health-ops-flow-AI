import type { AiAnalysis, AiTextDraft } from "@/lib/domain/types";
import { AI_DISCLAIMER as DISCLAIMER } from "@/lib/domain/types";

/**
 * What a model is allowed to see. Direct identifiers are excluded by construction:
 * no patient name, date of birth, MRN, member ID value, address, or staff names.
 */
export interface AnalysisInput {
  authorizationNumber: string;
  status: string;
  priority: string;
  reviewType: string;
  procedure: string;
  lines: { codeType: string; code: string; modifiers: string[]; description: string; requestedUnits: number; unitType: string; approvedUnits: number | null }[];
  diagnoses: { code: string; description: string }[];
  placeOfService: string;
  siteOfCare: string;
  payerName: string;
  payerType: string;
  memberIdOnFile: boolean;
  requestedServiceDate: string;
  clinicalReason: string;
  documentCategories: string[];
  documentExcerpts: { category: string; text: string }[];
  readinessGaps: string[];
  alerts: string[];
  decisionOutcome: string | null;
  denialReason: string | null;
  appealDeadline: string | null;
  ageDays: number;
  assigneeOnFile: boolean;
}

export interface AIProvider {
  readonly name: "mock" | "anthropic" | "openai";
  readonly model: string;
  analyzeAuthorization(input: AnalysisInput): Promise<AiAnalysis>;
  summarizeDocuments(input: AnalysisInput): Promise<AiTextDraft>;
  identifyMissingInformation(input: AnalysisInput): Promise<AiTextDraft>;
  generateChecklist(input: AnalysisInput): Promise<AiTextDraft>;
  draftAuthorizationSummary(input: AnalysisInput): Promise<AiTextDraft>;
  draftPayerFollowup(input: AnalysisInput): Promise<AiTextDraft>;
  summarizePayerResponse(input: AnalysisInput, responseText: string): Promise<AiTextDraft>;
}

export function withDisclaimer(text: string): AiTextDraft {
  return { text, disclaimer: DISCLAIMER };
}

export function emptyAnalysis(): AiAnalysis {
  return {
    caseSummary: "",
    availableInformation: [],
    potentiallyMissingInformation: [],
    documentationChecklist: [],
    administrativeNextSteps: [],
    questionsForHumanReview: [],
    limitations: [
      "This output is administrative only. It does not diagnose, determine medical necessity, or approve or deny coverage.",
    ],
    disclaimer: DISCLAIMER,
  };
}
