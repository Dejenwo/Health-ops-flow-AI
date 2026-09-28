import { NextResponse } from "next/server";
import { readDocument } from "@/lib/services/collaboration";
import { getOptionalContext } from "@/lib/services/context";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalContext();
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await context.params;
  const result = readDocument(ctx, id);
  if (!result) return new NextResponse("Not found", { status: 404 });
  const filename = result.document.filename.replace(/["\r\n]/g, "");
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": result.document.mimeType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
