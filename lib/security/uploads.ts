import { validationError } from "@/lib/domain/errors";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/tiff": ["tif", "tiff"],
  "text/plain": ["txt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
} as const;

export type AllowedMime = keyof typeof ALLOWED_MIME_TYPES;

export function extensionOf(filename: string): string {
  const part = filename.split(".").pop()?.toLowerCase() ?? "";
  return part.replace(/[^a-z0-9]/g, "");
}

export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "document";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120);
  return cleaned || "document";
}

export function matchesMagic(bytes: Uint8Array, mime: AllowedMime): boolean {
  if (bytes.length < 4) return mime === "text/plain";
  if (mime === "application/pdf") {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  if (mime === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (mime === "image/tiff") {
    return (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d);
  }
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  if (mime === "text/plain") {
    return !bytes.includes(0);
  }
  return false;
}

export function assertSafeUpload(file: { name: string; type: string; size: number }, bytes: Uint8Array): AllowedMime {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw validationError("Files must be between 1 byte and 10 MB.");
  }
  const mime = file.type as AllowedMime;
  if (!ALLOWED_MIME_TYPES[mime]) {
    throw validationError("This file type is not allowed. Use PDF, PNG, JPEG, TIFF, TXT, or DOCX.");
  }
  const extension = extensionOf(file.name);
  if (!ALLOWED_MIME_TYPES[mime].includes(extension as never)) {
    throw validationError("The file extension does not match its type.");
  }
  if (!matchesMagic(bytes, mime)) {
    throw validationError("The file contents do not match the declared type.");
  }
  return mime;
}
