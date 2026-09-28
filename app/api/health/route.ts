import { NextResponse } from "next/server";
import { dataMode } from "@/lib/store";

export function GET() {
  return NextResponse.json({ ok: true, mode: dataMode(), ai: process.env.AI_PROVIDER ?? "mock" });
}
