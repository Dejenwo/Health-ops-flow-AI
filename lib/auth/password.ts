import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * scrypt with N=2^15, r=8, p=1 (OWASP password storage guidance). Parameters are stored
 * with the hash so they can be raised later; older hashes are upgraded at next sign-in.
 * Format: scrypt$N$r$p$salt$hash. Legacy demo format: scrypt$salt$hash (N=4096).
 */
const CURRENT = { N: 32768, r: 8, p: 1 };
const KEYLEN = 32;

function derive(password: string, salt: string, params: { N: number; r: number; p: number }): Buffer {
  return scryptSync(password, salt, KEYLEN, { ...params, maxmem: 128 * params.N * params.r * 2 });
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = derive(password, salt, CURRENT).toString("hex");
  return `scrypt$${CURRENT.N}$${CURRENT.r}$${CURRENT.p}$${salt}$${hash}`;
}

function parse(stored: string): { params: { N: number; r: number; p: number }; salt: string; hash: string } | null {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return null;
  if (parts.length === 3) return { params: { N: 4096, r: 8, p: 1 }, salt: parts[1], hash: parts[2] };
  if (parts.length === 6) {
    const [N, r, p] = parts.slice(1, 4).map(Number);
    if (![N, r, p].every(Number.isInteger)) return null;
    return { params: { N, r, p }, salt: parts[4], hash: parts[5] };
  }
  return null;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed || !parsed.salt || !parsed.hash) return false;
  const actual = derive(password, parsed.salt, parsed.params);
  const expected = Buffer.from(parsed.hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.params.N < CURRENT.N || parsed.params.r !== CURRENT.r || parsed.params.p !== CURRENT.p;
}

/** A fixed hash used to spend the same time on unknown emails, so timing does not reveal accounts. */
let dummyHash: string | null = null;
export function burnPasswordCheck(password: string): void {
  dummyHash ??= hashPassword("healthflow-timing-equalizer");
  verifyPassword(password, dummyHash);
}
