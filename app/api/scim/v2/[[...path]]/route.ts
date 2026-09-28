import { NextResponse, type NextRequest } from "next/server";
import { handleScim } from "@/lib/services/scim";

/** SCIM 2.0 endpoint for Microsoft Entra ID, Okta and other identity providers. Bearer-token auth, no cookies. */
async function respond(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  let body: unknown;
  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "400", scimType: "invalidSyntax", detail: "Body must be JSON." },
        { status: 400, headers: { "content-type": "application/scim+json" } },
      );
    }
  }
  const result = handleScim({
    method: request.method,
    path: `/${path.join("/")}`,
    query: request.nextUrl.searchParams,
    authorization: request.headers.get("authorization"),
    body,
  });
  if (result.status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result.body, { status: result.status, headers: { "content-type": "application/scim+json", "cache-control": "no-store" } });
}

export const GET = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
