import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto";

/**
 * AES-256-GCM envelope for data at rest (store file, uploaded documents, MFA secrets).
 * The master key comes from HF_DATA_KEY. Sub-keys are derived with HKDF so a leak of one
 * purpose's ciphertext format does not weaken another.
 */
const PREFIX = Buffer.from("HFENC1:");

function masterKey(): Buffer | null {
  const raw = process.env.HF_DATA_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

function subKey(purpose: string): Buffer | null {
  const master = masterKey();
  if (!master) return null;
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `healthflow:${purpose}`, 32));
}

export function encryptionEnabled(): boolean {
  return masterKey() !== null;
}

export function sealBytes(plain: Uint8Array, purpose: string): Buffer {
  const key = subKey(purpose);
  if (!key) return Buffer.from(plain);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([PREFIX, iv, cipher.getAuthTag(), body]);
}

export function openBytes(data: Buffer, purpose: string): Buffer {
  if (data.subarray(0, PREFIX.length).compare(PREFIX) !== 0) return data;
  const key = subKey(purpose);
  if (!key) throw new Error("Encrypted data found but HF_DATA_KEY is not set or is invalid.");
  const iv = data.subarray(PREFIX.length, PREFIX.length + 12);
  const tag = data.subarray(PREFIX.length + 12, PREFIX.length + 28);
  const body = data.subarray(PREFIX.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Secrets that must be encrypted even without HF_DATA_KEY (for example MFA seeds in demo mode)
 * fall back to a key derived from SESSION_SECRET.
 */
function secretKey(): Buffer {
  const derived = subKey("secrets");
  if (derived) return derived;
  const fallback = process.env.SESSION_SECRET || "healthflow-demo-session-secret-not-for-production";
  return createHash("sha256").update(`healthflow:secrets:${fallback}`).digest();
}

export function sealSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openSecret(sealed: string): string {
  const data = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
