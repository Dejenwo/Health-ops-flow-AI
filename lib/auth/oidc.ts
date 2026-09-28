import { createHash, randomBytes } from "crypto";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";

/**
 * Minimal OpenID Connect relying party: authorization code flow with PKCE (S256), state and
 * nonce, and ID token validation against the provider's published keys. No implicit flow and no
 * access-token use: HealthFlow only needs to know who the person is.
 */

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
}

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, { at: number; value: OidcMetadata }>();
const jwksCache = new Map<string, { at: number; value: JSONWebKeySet }>();

export function clearOidcCache(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

async function getJson<T>(url: string): Promise<T> {
  if (!url.startsWith("https://") && process.env.HF_ALLOW_INSECURE_OIDC !== "true") {
    throw new Error("OIDC endpoints must use https.");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`OIDC request to ${new URL(url).host} failed (${response.status}).`);
  return (await response.json()) as T;
}

export async function discover(issuer: string): Promise<OidcMetadata> {
  const base = issuer.replace(/\/$/, "");
  const cached = discoveryCache.get(base);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await getJson<OidcMetadata>(`${base}/.well-known/openid-configuration`);
  if (value.issuer.replace(/\/$/, "") !== base) throw new Error("Discovery document issuer does not match.");
  discoveryCache.set(base, { at: Date.now(), value });
  return value;
}

async function jwks(uri: string): Promise<JSONWebKeySet> {
  const cached = jwksCache.get(uri);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await getJson<JSONWebKeySet>(uri);
  jwksCache.set(uri, { at: Date.now(), value });
  return value;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizationUrl(input: {
  metadata: OidcMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  loginHint?: string;
  extra?: Record<string, string>;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(input.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("response_mode", "query");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  for (const [key, value] of Object.entries(input.extra ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

export async function exchangeCode(input: {
  metadata: OidcMetadata;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const methods = input.metadata.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  if (methods.includes("client_secret_basic")) {
    const pair = `${encodeURIComponent(input.clientId)}:${encodeURIComponent(input.clientSecret)}`;
    headers.authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
  } else {
    body.set("client_id", input.clientId);
    body.set("client_secret", input.clientSecret);
  }
  const url = input.metadata.token_endpoint;
  if (!url.startsWith("https://") && process.env.HF_ALLOW_INSECURE_OIDC !== "true") throw new Error("OIDC endpoints must use https.");
  const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The identity provider rejected the sign-in code (${response.status}).`);
  const json = (await response.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("The identity provider did not return an ID token.");
  return json.id_token;
}

export async function verifyIdToken(input: {
  metadata: OidcMetadata;
  idToken: string;
  clientId: string;
  nonce: string;
}): Promise<JWTPayload & Record<string, unknown>> {
  const keys = createLocalJWKSet(await jwks(input.metadata.jwks_uri));
  const { payload } = await jwtVerify(input.idToken, keys, {
    issuer: input.metadata.issuer,
    audience: input.clientId,
    algorithms: ["RS256", "RS384", "RS512", "PS256", "ES256"],
    clockTolerance: 60,
    maxTokenAge: "10m",
  });
  if (payload.nonce !== input.nonce) throw new Error("ID token nonce does not match this sign-in.");
  return payload as JWTPayload & Record<string, unknown>;
}
