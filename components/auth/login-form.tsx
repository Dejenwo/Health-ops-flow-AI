"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { mfaVerifyAction, signInAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REASONS: Record<string, string> = {
  idle: "You were signed out after a period of inactivity.",
  expired: "Your session expired. Sign in again.",
  "signed-out": "Your session ended. Sign in again.",
  "signed-out-everywhere": "You were signed out on every device.",
};

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(signInAction, null);
  const next = params.get("next") ?? "";
  const reason = REASONS[params.get("reason") ?? ""];
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {reason ? <p className="text-sm text-muted-foreground" role="status">{reason}</p> : null}
      {params.get("reset") ? <p className="text-sm text-primary" role="status">Password updated. Sign in with the new password.</p> : null}
      {state && !state.ok ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-primary">Forgot password</Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

export function MfaForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(mfaVerifyAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      {state && !state.ok ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="code">Authentication code</Label>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="123456" />
        <p className="text-xs text-muted-foreground">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Verifying…" : "Verify"}</Button>
    </form>
  );
}

/**
 * Work-email SSO entry. Hidden behind a button so it never competes with the password form,
 * and it navigates with GET because the Content Security Policy only lets forms post to this site.
 */
export function SsoEntry() {
  const params = useSearchParams();
  const ssoError = params.get("sso_error");
  const [open, setOpen] = useState(Boolean(ssoError));
  const [email, setEmail] = useState("");
  if (!open) {
    return (
      <div className="space-y-2">
        {ssoError ? <p className="text-sm text-destructive" role="alert">{ssoError}</p> : null}
        <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
          <KeyRound aria-hidden /> Sign in with SSO
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const next = params.get("next") ?? "";
        // A full navigation is required: the route handler redirects to the identity provider's site.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/api/auth/sso/start?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
      }}
    >
      {ssoError ? <p className="text-sm text-destructive" role="alert">{ssoError}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="sso-email">Work email for SSO</Label>
        <Input id="sso-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@yourclinic.org" />
        <p className="text-xs text-muted-foreground">We&apos;ll send you to your organization&apos;s Microsoft, Google or other sign-in page.</p>
      </div>
      <Button type="submit" className="w-full">Continue with SSO</Button>
    </form>
  );
}
