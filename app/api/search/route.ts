import { NextResponse } from "next/server";
import { globalSearch } from "@/lib/services/collaboration";
import { getOptionalContext } from "@/lib/services/context";

export async function GET(request: Request) {
  const ctx = await getOptionalContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length > 80) return NextResponse.json({ error: "Query is too long." }, { status: 400 });
  return NextResponse.json(globalSearch(ctx, q));
}
