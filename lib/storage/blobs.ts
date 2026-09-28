import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { syntheticDocumentText } from "@/lib/demo/seed";
import { openBytes, sealBytes } from "@/lib/security/crypto";

const memory = new Map<string, Buffer>();

function directory(): string {
  return path.join(process.env.HF_DATA_DIR || path.join(process.cwd(), "data"), "uploads");
}

export function putBlob(key: string, data: Uint8Array): void {
  if (process.env.HF_STORE === "memory") {
    memory.set(key, Buffer.from(data));
    return;
  }
  const root = directory();
  const file = path.join(root, key);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Encrypted at rest with AES-256-GCM when HF_DATA_KEY is set.
  writeFileSync(file, sealBytes(data, "blob"), { mode: 0o600 });
}

export function getBlob(key: string, fallback?: { filename: string; category: string }): Buffer | null {
  if (process.env.HF_STORE === "memory") {
    return memory.get(key) ?? (key.startsWith("seed/") && fallback ? Buffer.from(syntheticDocumentText(fallback.filename, fallback.category)) : null);
  }
  const root = directory();
  const file = path.join(root, key);
  if (!file.startsWith(root + path.sep)) return null;
  if (existsSync(file)) return openBytes(readFileSync(file), "blob");
  if (key.startsWith("seed/") && fallback) {
    return Buffer.from(syntheticDocumentText(fallback.filename, fallback.category));
  }
  return null;
}

export function resetMemoryBlobs(): void {
  memory.clear();
}
