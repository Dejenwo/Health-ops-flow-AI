import { isDemoMode } from "@/lib/config";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Transactional email through Resend's HTTP API. Messages must not contain PHI:
 * resets and invitations carry a link and nothing about patients or cases.
 * In demo mode without a key, nothing is sent and callers may show the link on screen.
 */
export async function sendEmail(message: OutboundEmail): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    if (isDemoMode()) return { delivered: false };
    throw new Error("Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new Error(`Email delivery failed with status ${response.status}.`);
  return { delivered: true };
}

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
}
