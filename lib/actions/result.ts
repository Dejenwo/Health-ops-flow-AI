import { isAppError } from "@/lib/domain/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function actionError(error: unknown): ActionResult<never> {
  if (typeof error === "object" && error && "digest" in error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) throw error;
  }
  if (isAppError(error)) return { ok: false, error: error.message, ...(error.fields ? { fieldErrors: error.fields } : {}) };
  console.error(error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
