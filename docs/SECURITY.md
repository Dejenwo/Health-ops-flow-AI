# Security

## Boundaries

1. `proxy.ts` rejects missing, tampered, expired and idle sessions, enforces MFA enrollment,
   refreshes the activity stamp, and sets security headers including a per-request CSP nonce.
2. `lib/services/context.ts` rebuilds the caller from the database on every request: the account
   must exist, its `sessionVersion` must match the cookie, and the membership must be active.
3. Services check permissions (`lib/domain/permissions.ts`) and scope every query to the caller's
   organization.
4. Domain rules (`lib/domain/transitions.ts`, `readiness.ts`, `sla.ts`) decide what a case may do.
5. In Postgres, RLS and the triggers in `supabase/migrations/20260927120000_workflow_hardening.sql`
   enforce the same rules so a direct database client cannot skip them.

## Authentication

- Passwords: scrypt N=2^15, r=8, p=1, 12 characters minimum. Parameters are stored with the hash
  and older hashes are upgraded at sign-in. Unknown emails take the same time as wrong passwords.
- Lockout: 8 failures in 15 minutes per email. 5 wrong MFA codes per challenge window.
- MFA: RFC 6238 TOTP. Secrets are AES-GCM encrypted. The last accepted time step is stored so a
  code cannot be reused. Recovery codes are stored as SHA-256 hashes and work once.
- Sessions: HMAC-SHA256 signed cookie, httpOnly, SameSite=Lax, Secure in production.
  12-hour absolute lifetime, inactivity limit per organization (HIPAA automatic logoff).
- Revocation: `sessionVersion` is bumped by password change or reset, MFA changes, "Sign out
  everywhere", and by an admin turning on "Require MFA" for members without it.
- Reset links expire in 30 minutes, replace earlier links, and are emailed. Invitations expire in
  7 days and are bound to the invited email.

## Data protection

- `HF_DATA_KEY` (32 bytes) is the master key. HKDF derives separate keys for the store, documents
  and secrets. AES-256-GCM authenticates every file, so tampering or a wrong key fails loudly.
- Files are written with mode 600 in a directory with mode 700.
- Uploads: type allow-list, extension and magic-byte checks, 10 MB limit, sanitized names,
  downloads as attachments with `no-store`.
- Storage keys are confined to the data directory.

## Audit

Events are append-only in the service layer and in Postgres (trigger blocks update and delete).
Clients can write only access events through `record_audit()`; status changes are audited by a
database trigger. Metadata passes through `lib/security/redact.ts`, which drops credential-like
keys and keeps domain ids.

## AI

See `docs/AI_ARCHITECTURE.md`. In short: minimum necessary input, identifier filtering, no
status changes, human review required, remote models blocked until `AI_BAA_CONFIRMED=true`.

## Headers

`Content-Security-Policy` (nonce + `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`),
`Strict-Transport-Security` (2 years, preload), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, `Cache-Control: private, no-store` for signed-in pages.

## Reporting

Send vulnerabilities to the address in your deployment's security.txt. Do not include PHI in a report.
