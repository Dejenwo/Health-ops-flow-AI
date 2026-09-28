/**
 * Text extraction for AI review. Runs on demand and is never persisted, so extracted PHI
 * does not accumulate in a second place. Images and scanned PDFs need OCR, which is a
 * separate, BAA-covered service and is reported as unavailable here rather than guessed.
 */
export const MAX_EXTRACT_CHARS = 6000;

export async function extractText(bytes: Uint8Array, mimeType: string): Promise<{ text: string; method: "text" | "pdf" | "unsupported" }> {
  if (mimeType === "text/plain") {
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, MAX_EXTRACT_CHARS), method: "text" };
  }
  if (mimeType === "application/pdf") {
    try {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await pdfText(pdf, { mergePages: true });
      const value = Array.isArray(text) ? text.join("\n") : text;
      return { text: value.slice(0, MAX_EXTRACT_CHARS), method: "pdf" };
    } catch {
      return { text: "", method: "unsupported" };
    }
  }
  return { text: "", method: "unsupported" };
}
