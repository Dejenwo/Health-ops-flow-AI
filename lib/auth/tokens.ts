import { createHash, randomBytes } from "crypto";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}
