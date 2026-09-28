/**
 * Runtime configuration and production guards. `assertProductionConfig` runs at server start
 * (instrumentation.ts) and refuses to boot a production server that would mishandle PHI.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Demo mode seeds the synthetic clinic, shows demo accounts, and shows reset links on screen.
 * It is on by default in development and off by default in production.
 */
export function isDemoMode(): boolean {
  const flag = process.env.HF_DEMO_MODE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return !isProduction();
}

export function idleTimeoutDefaultMinutes(): number {
  const value = Number(process.env.SESSION_IDLE_MINUTES);
  return Number.isFinite(value) && value >= 5 && value <= 60 ? value : 15;
}

export const SESSION_ABSOLUTE_HOURS = 12;

export class ConfigError extends Error {}

export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const demo = env.HF_DEMO_MODE === "true";
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    problems.push("SESSION_SECRET must be set to at least 32 random characters.");
  }
  if (env.HF_STORE !== "memory") {
    const key = env.HF_DATA_KEY ? Buffer.from(env.HF_DATA_KEY, "base64") : null;
    if (!key || key.length !== 32) problems.push("HF_DATA_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32).");
  }
  if (env.VERCEL === "1" || env.AWS_LAMBDA_FUNCTION_NAME) {
    problems.push(
      "The file-backed store needs one long-lived Node process with a persistent volume. Serverless hosts are not supported until the Postgres adapter is enabled.",
    );
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "";
  if (!appUrl.startsWith("https://")) problems.push("NEXT_PUBLIC_APP_URL must be the public https:// origin.");
  if (env.COOKIE_SECURE === "false") problems.push("COOKIE_SECURE cannot be false in production.");
  if (!demo && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
    problems.push("RESEND_API_KEY and EMAIL_FROM are required so password resets and invitations are emailed, not shown on screen.");
  }
  const ai = env.AI_PROVIDER ?? "mock";
  if (ai !== "mock" && env.AI_BAA_CONFIRMED !== "true") {
    problems.push("AI_PROVIDER is a remote model. Set AI_BAA_CONFIRMED=true only after a BAA with that vendor is signed.");
  }
  if (demo) problems.push("HF_DEMO_MODE=true is not allowed in production. It exposes demo accounts and on-screen reset links.");
  return problems;
}

export function assertProductionConfig(): void {
  if (!isProduction()) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.HF_SKIP_CONFIG_CHECK === "true") {
    console.warn("[healthflow] HF_SKIP_CONFIG_CHECK=true: production config checks skipped. Never use this with real PHI.");
    return;
  }
  const problems = productionConfigProblems();
  if (problems.length) {
    throw new ConfigError(`HealthFlow refused to start in production:\n- ${problems.join("\n- ")}`);
  }
}
