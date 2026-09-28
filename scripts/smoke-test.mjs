// HTTP smoke test for a running build. Usage:
//   SESSION_SECRET=... HF_DATA_DIR=... node scripts/smoke-test.mjs http://127.0.0.1:43123
// Signs a session cookie for the seeded demo owner (demo data, unencrypted store only) and checks
// security headers, CSP nonces, auth redirects, idle expiry and that key pages render.
import { createHmac } from "crypto";
import { readFileSync } from "fs";
import path from "path";

const base = process.argv[2] ?? "http://127.0.0.1:43123";
const secret = process.env.SESSION_SECRET;
const db = JSON.parse(readFileSync(path.join(process.env.HF_DATA_DIR ?? "data", "store.json"), "utf8"));
const owner = db.users.find((user) => user.email === "owner@northstar.demo");
const org = db.organizationMembers.find((member) => member.userId === owner.id).organizationId;
const pending = db.authorizationCases.find((item) => item.status === "PENDING" && item.organizationId === org);
const draft = db.authorizationCases.find((item) => item.status === "DRAFT" && item.organizationId === org);

function cookie(overrides = {}) {
  const now = Date.now();
  const payload = { sub: owner.id, org, role: "OWNER", onboarded: true, sv: owner.sessionVersion, iat: now, exp: now + 3_600_000, last: now, idle: 30, mfaEnroll: false, ...overrides };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `hf_session=${body}.${sig}`;
}

let failures = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${detail}`}`);
  if (!condition) failures += 1;
}

async function get(pathname, headers = {}) {
  return fetch(base + pathname, { headers, redirect: "manual" });
}

const home = await get("/");
const html = await home.text();
const csp = home.headers.get("content-security-policy") ?? "";
const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
check("marketing page renders", home.status === 200);
check("CSP has a per-request nonce and strict-dynamic", Boolean(nonce) && csp.includes("'strict-dynamic'") && !csp.includes("script-src 'self' 'unsafe-inline'"), csp);
const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
check(`all ${scripts.length} script tags carry the nonce`, scripts.length > 0 && scripts.every((tag) => tag.includes(`nonce="${nonce}"`)), scripts.find((tag) => !tag.includes("nonce")) ?? "");
check("HSTS in production", (home.headers.get("strict-transport-security") ?? "").includes("max-age=63072000"));
check("frame and sniffing protections", home.headers.get("x-frame-options") === "DENY" && home.headers.get("x-content-type-options") === "nosniff");
const second = await get("/");
check("nonce changes per request", /'nonce-([^']+)'/.exec(second.headers.get("content-security-policy") ?? "")?.[1] !== nonce);
check("no Google Fonts requests", !html.includes("fonts.googleapis.com"));

const anon = await get("/dashboard");
check("anonymous user is redirected to login", anon.status === 307 && (anon.headers.get("location") ?? "").includes("/login?next=%2Fdashboard"));
const api = await get(`/api/documents/00000000-0000-4000-8000-000000000999`);
check("anonymous API call gets 401", api.status === 401);

const idle = await get("/dashboard", { cookie: cookie({ last: Date.now() - 31 * 60_000 }) });
check("idle session is signed out", idle.status === 307 && (idle.headers.get("location") ?? "").includes("reason=idle"), idle.headers.get("location") ?? "");
const stale = await get("/dashboard", { cookie: cookie({ sv: owner.sessionVersion + 5 }) });
check("revoked session version is rejected", stale.status === 307 && (stale.headers.get("location") ?? "").includes("/login"), `${stale.status}`);
const enroll = await get("/dashboard", { cookie: cookie({ mfaEnroll: true }) });
check("MFA enrollment is enforced", enroll.status === 307 && (enroll.headers.get("location") ?? "").includes("/settings/security?enroll=1"));

const auth = { cookie: cookie({ last: Date.now() - 2 * 60_000 }) };
for (const [pathname, expected] of [
  ["/dashboard", "Payer decisions overdue"],
  ["/authorizations", "Alerts"],
  ["/authorizations?alert=PAYER_OVERDUE", "Authorizations"],
  [`/authorizations/${pending.id}`, "Record decision"],
  [`/authorizations/${draft.id}`, "Packet checklist"],
  [`/authorizations/${pending.id}/edit`, "is locked"],
  [`/authorizations/${draft.id}/edit`, "Service lines"],
  ["/authorizations/new", "Add service line"],
  ["/payers", "Payers"],
  ["/settings/security", "Two-factor sign-in"],
  ["/analytics", "Payer on-time rate"],
  ["/ai-assistant", "appeal deadlines"],
]) {
  const response = await get(pathname, auth);
  const body = await response.text();
  check(`${pathname} renders`, response.status === 200 && body.includes(expected), `${response.status} missing "${expected}"`);
  if (pathname === "/dashboard") {
    check("activity refresh re-issues the session cookie", (response.headers.get("set-cookie") ?? "").includes("hf_session="));
    check("authenticated pages are not cached", (response.headers.get("cache-control") ?? "").includes("no-store"));
  }
}

const after = JSON.parse(readFileSync(path.join(process.env.HF_DATA_DIR ?? "data", "store.json"), "utf8"));
check("case views were written to the audit log", after.auditEvents.some((event) => event.event === "authorization.viewed" && event.resourceId === pending.id));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
