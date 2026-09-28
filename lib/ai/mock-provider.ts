import type { AiAnalysis } from "@/lib/domain/types";
import { AI_DISCLAIMER } from "@/lib/domain/types";
import type { AIProvider, AnalysisInput } from "@/lib/ai/types";
import { withDisclaimer } from "@/lib/ai/types";

/**
 * Phrases staff usually look for when a payer asks for documentation of prior care.
 * The mock only reports whether the phrase appears. It does not judge medical necessity.
 */
const EVIDENCE_PHRASES = [
  "conservative",
  "physical therapy",
  "weeks",
  "failed",
  "nsaid",
  "injection",
  "imaging",
  "x-ray",
  "functional",
  "symptom",
];

function evidenceFound(input: AnalysisInput): string[] {
  const text = input.documentExcerpts.map((item) => item.text.toLowerCase()).join(" ");
  return EVIDENCE_PHRASES.filter((phrase) => text.includes(phrase));
}

function describeLines(input: AnalysisInput): string {
  return input.lines
    .map((line) => `${line.code} ${line.description} × ${line.requestedUnits} ${line.unitType.toLowerCase()}`)
    .join("; ");
}

export function buildMockAnalysis(input: AnalysisInput): AiAnalysis {
  const missing: string[] = [...input.readinessGaps];
  if (!input.assigneeOnFile) missing.push("No specialist is assigned.");
  const evidence = evidenceFound(input);
  const clinicalExcerpts = input.documentExcerpts.filter((item) => item.category !== "PAYER_CORRESPONDENCE");
  if (clinicalExcerpts.length > 0 && evidence.length === 0) {
    missing.push("The attached clinical text does not mention prior treatment or duration. Many payers ask for it.");
  }

  const available = [
    `Authorization ${input.authorizationNumber} is ${input.status.replaceAll("_", " ").toLowerCase()} (${input.reviewType.toLowerCase()} review).`,
    `Requested services: ${describeLines(input) || "none entered"}.`,
    `Diagnoses: ${input.diagnoses.map((entry) => `${entry.code} ${entry.description}`).join("; ") || "none entered"}.`,
    `Place of service ${input.placeOfService || "not set"}, site of care ${input.siteOfCare.replaceAll("_", " ").toLowerCase()}.`,
    `Payer: ${input.payerName} (${input.payerType.replaceAll("_", " ").toLowerCase()}).`,
    input.documentCategories.length ? `Documents on file: ${input.documentCategories.join(", ")}.` : "No documents are attached.",
  ];
  if (evidence.length) available.push(`Attached text mentions: ${evidence.join(", ")}.`);
  if (input.decisionOutcome) {
    available.push(
      `Payer decision recorded: ${input.decisionOutcome.replaceAll("_", " ").toLowerCase()}${input.denialReason ? ` (${input.denialReason.replaceAll("_", " ").toLowerCase()})` : ""}.`,
    );
  }

  const next: string[] = [];
  for (const alert of input.alerts) next.push(alert);
  if (missing.length) next.push("Collect the missing items before submission or follow-up.");
  if (input.status === "READY_FOR_REVIEW") next.push("A person with review responsibility should confirm the packet, then submit.");
  if (input.status === "ADDITIONAL_INFORMATION_REQUESTED") {
    next.push("Respond to the payer information request, then return the case to ready for review.");
  }
  if ((input.decisionOutcome === "DENIED" || input.decisionOutcome === "PARTIALLY_APPROVED") && input.appealDeadline) {
    next.push(`Decide on an appeal before ${input.appealDeadline}. A peer-to-peer review is often faster.`);
  }
  if (!next.length) next.push("No administrative blocker was detected from the fields on file. Continue routine monitoring.");

  return {
    caseSummary: `${input.authorizationNumber} requests ${input.procedure} (${input.lines.length} service line${input.lines.length === 1 ? "" : "s"}) from ${input.payerName}. Status is ${input.status.replaceAll("_", " ").toLowerCase()}. This summary organizes administrative facts already stored in HealthFlow. It is not a coverage determination.`,
    availableInformation: available,
    potentiallyMissingInformation: missing.length ? missing : ["No obvious administrative gaps detected from stored fields."],
    documentationChecklist: [
      "Confirm the member ID and group number match the payer's eligibility response.",
      "Confirm the ordering and rendering providers, place of service, and site of care.",
      "Confirm each CPT/HCPCS code, modifier and unit count matches the order. Do not invent codes.",
      "Attach clinical notes that show history, prior treatment and its duration if the payer's policy asks for them.",
      "Record the payer reference number and file the determination letter when the decision arrives.",
    ],
    administrativeNextSteps: next,
    questionsForHumanReview: [
      "Does a person at this organization agree the packet is complete enough to submit or follow up?",
      "Are the codes and units copied accurately from the order?",
      missing.length ? "Who will obtain the missing items, and by when?" : "Is any payer-specific form still required outside this checklist?",
    ],
    limitations: [
      "Mock provider. No external model was called.",
      "Output is administrative workflow support only.",
      "It does not diagnose, prescribe, recommend treatment, determine medical necessity, or approve or deny a case.",
      "A person must review every draft before it is saved or used.",
    ],
    disclaimer: AI_DISCLAIMER,
  };
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock" as const;
  readonly model = "healthflow-mock-admin-v2";

  async analyzeAuthorization(input: AnalysisInput) {
    return buildMockAnalysis(input);
  }

  async summarizeDocuments(input: AnalysisInput) {
    if (input.documentExcerpts.length === 0) {
      return withDisclaimer(
        input.documentCategories.length
          ? `Documents on this case (${input.documentCategories.join(", ")}) have no extractable text. Scanned images need OCR before they can be summarized.`
          : "No documents are stored on this case yet.",
      );
    }
    const parts = input.documentExcerpts.map((item) => `${item.category}: ${item.text.replace(/\s+/g, " ").slice(0, 240)}…`);
    return withDisclaimer(parts.join("\n"));
  }

  async identifyMissingInformation(input: AnalysisInput) {
    return withDisclaimer(buildMockAnalysis(input).potentiallyMissingInformation.map((item) => `• ${item}`).join("\n"));
  }

  async generateChecklist(input: AnalysisInput) {
    return withDisclaimer(buildMockAnalysis(input).documentationChecklist.map((item) => `• ${item}`).join("\n"));
  }

  async draftAuthorizationSummary(input: AnalysisInput) {
    return withDisclaimer(buildMockAnalysis(input).caseSummary);
  }

  async draftPayerFollowup(input: AnalysisInput) {
    const draft = [
      `Subject: Follow-up for authorization ${input.authorizationNumber}`,
      "",
      "Hello,",
      "",
      `I am writing from the provider office regarding authorization ${input.authorizationNumber} for ${describeLines(input)}.`,
      `The case has been in ${input.status.replaceAll("_", " ").toLowerCase()} status${input.ageDays ? ` for about ${input.ageDays} days` : ""}.`,
      input.alerts.some((alert) => alert.toLowerCase().includes("was due"))
        ? "Our records show the decision timeframe for this request has passed. Please confirm the status and expected decision date."
        : "Please confirm the payer reference and whether any additional documents are required.",
      "",
      "This draft was prepared for staff review. It has not been sent.",
    ].join("\n");
    return withDisclaimer(draft);
  }

  async summarizePayerResponse(input: AnalysisInput, responseText: string) {
    const clipped = responseText.trim().slice(0, 600);
    return withDisclaimer(
      `Staff-entered payer response for ${input.authorizationNumber}: ${clipped || "No response text was provided."} HealthFlow did not contact the payer.`,
    );
  }
}
