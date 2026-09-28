import { AI_DISCLAIMER } from "@/lib/domain/types";
import type { AiAnalysis, AiTextDraft } from "@/lib/domain/types";
import type { AIProvider, AnalysisInput } from "@/lib/ai/types";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { validationError } from "@/lib/domain/errors";

const SYSTEM = `You are an administrative assistant inside HealthFlow AI, a prior-authorization operations tool.
You organize information already provided. You do not diagnose, prescribe, recommend treatment, determine medical necessity, approve, deny, or submit anything.
Respond with JSON only. Never invent clinical facts, codes, or payer decisions that are not in the input.
Every user-visible string must be suitable to display with the notice: ${AI_DISCLAIMER}`;

function analysisShape(): string {
  return JSON.stringify({
    caseSummary: "string",
    availableInformation: ["string"],
    potentiallyMissingInformation: ["string"],
    documentationChecklist: ["string"],
    administrativeNextSteps: ["string"],
    questionsForHumanReview: ["string"],
    limitations: ["string"],
  });
}

function parseAnalysis(raw: string): AiAnalysis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw validationError("The model did not return JSON.");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<AiAnalysis>;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 12) : []);
  if (typeof parsed.caseSummary !== "string") throw validationError("The model response was incomplete.");
  return {
    caseSummary: parsed.caseSummary.slice(0, 2000),
    availableInformation: list(parsed.availableInformation),
    potentiallyMissingInformation: list(parsed.potentiallyMissingInformation),
    documentationChecklist: list(parsed.documentationChecklist),
    administrativeNextSteps: list(parsed.administrativeNextSteps),
    questionsForHumanReview: list(parsed.questionsForHumanReview),
    limitations: [
      ...list(parsed.limitations),
      "A person must review this output before use. It cannot approve, deny, or submit a case.",
    ],
    disclaimer: AI_DISCLAIMER,
  };
}

function parseText(raw: string): AiTextDraft {
  return { text: raw.trim().slice(0, 4000), disclaimer: AI_DISCLAIMER };
}

function aiTimeoutMs(): number {
  const value = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 30_000;
}

async function complete(options: {
  provider: "anthropic" | "openai";
  model: string;
  user: string;
}): Promise<string> {
  if (options.provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw validationError("ANTHROPIC_API_KEY is not configured.");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(aiTimeoutMs()),
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: options.user }],
      }),
    });
    if (!response.ok) throw validationError("The Anthropic request failed.");
    const body = (await response.json()) as { content?: { text?: string }[] };
    return body.content?.map((part) => part.text ?? "").join("\n") ?? "";
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw validationError("OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(aiTimeoutMs()),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      store: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: options.user },
      ],
    }),
  });
  if (!response.ok) throw validationError("The OpenAI request failed.");
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

export class RemoteAIProvider implements AIProvider {
  constructor(
    readonly name: "anthropic" | "openai",
    readonly model: string,
  ) {}

  private prompt(operation: string, input: AnalysisInput, extra?: string): string {
    return [
      `Operation: ${operation}`,
      "Return JSON with this shape:",
      analysisShape(),
      "Input (administrative fields only; direct identifiers removed):",
      JSON.stringify(input),
      extra ?? "",
    ].join("\n");
  }

  async analyzeAuthorization(input: AnalysisInput) {
    const raw = await complete({
      provider: this.name,
      model: this.model,
      user: this.prompt("analyzeAuthorization", input),
    });
    return parseAnalysis(raw);
  }

  private async textOp(operation: string, input: AnalysisInput, extra?: string) {
    const raw = await complete({
      provider: this.name,
      model: this.model,
      user: `${this.prompt(operation, input, extra)}\nIf you cannot fill the JSON object, return a short plain-text administrative draft instead.`,
    });
    try {
      const analysis = parseAnalysis(raw);
      return { text: analysis.caseSummary, disclaimer: AI_DISCLAIMER } satisfies AiTextDraft;
    } catch {
      return parseText(raw);
    }
  }

  summarizeDocuments(input: AnalysisInput) {
    return this.textOp("summarizeDocuments", input);
  }
  identifyMissingInformation(input: AnalysisInput) {
    return this.textOp("identifyMissingInformation", input);
  }
  generateChecklist(input: AnalysisInput) {
    return this.textOp("generateChecklist", input);
  }
  draftAuthorizationSummary(input: AnalysisInput) {
    return this.textOp("draftAuthorizationSummary", input);
  }
  draftPayerFollowup(input: AnalysisInput) {
    return this.textOp("draftPayerFollowup", input);
  }
  summarizePayerResponse(input: AnalysisInput, responseText: string) {
    return this.textOp("summarizePayerResponse", input, `Payer response text supplied by a person:\n${responseText.slice(0, 2000)}`);
  }
}

/**
 * Remote models receive PHI-bearing clinical context. They are enabled only when the operator
 * confirms a signed Business Associate Agreement with the vendor (AI_BAA_CONFIRMED=true).
 * Without it, a remote selection fails loudly instead of silently sending data.
 */
export function getAIProvider(): AIProvider {
  const choice = process.env.AI_PROVIDER ?? "mock";
  if (choice === "mock") return new MockAIProvider();
  if (choice !== "anthropic" && choice !== "openai") throw validationError(`Unknown AI_PROVIDER "${choice}".`);
  if (process.env.AI_BAA_CONFIRMED !== "true") {
    throw validationError("Remote AI is disabled until AI_BAA_CONFIRMED=true is set after a BAA with the model vendor is signed.");
  }
  if (choice === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw validationError("ANTHROPIC_API_KEY is not configured.");
    return new RemoteAIProvider("anthropic", process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5");
  }
  if (!process.env.OPENAI_API_KEY) throw validationError("OPENAI_API_KEY is not configured.");
  return new RemoteAIProvider("openai", process.env.OPENAI_MODEL || "gpt-4.1-mini");
}
