"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginMfaAction, confirmMfaAction, disableMfaAction, orgSecurityAction, revokeSessionsAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaPanel({ enabled, recoveryCodesLeft, required }: { enabled: boolean; recoveryCodesLeft: number; required: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (codes) {
    return (
      <section className="space-y-3 rounded-xl border p-4 text-sm">
        <h2 className="font-medium">Save your recovery codes</h2>
        <p className="text-muted-foreground">Each code works once if you lose your device. They will not be shown again.</p>
        <ul className="grid grid-cols-2 gap-1 font-mono">
          {codes.map((code) => <li key={code}>{code}</li>)}
        </ul>
        <Button onClick={() => { setCodes(null); router.refresh(); }}>I saved them</Button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border p-4 text-sm">
      <h2 className="font-medium">Two-factor sign-in</h2>
      {message ? <p role="alert" className="text-destructive">{message}</p> : null}
      {enabled ? (
        <>
          <p>On. {recoveryCodesLeft} recovery code{recoveryCodesLeft === 1 ? "" : "s"} left.</p>
          {required ? (
            <p className="text-muted-foreground">Your organization requires two-factor sign-in, so it cannot be turned off.</p>
          ) : (
            <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              const password = String(new FormData(event.currentTarget).get("password") ?? "");
              const result = await disableMfaAction(password);
              setBusy(false);
              if (!result.ok) setMessage(result.error);
              else router.refresh();
            }}>
              <div>
                <Label htmlFor="mfa-off-password">Password</Label>
                <Input id="mfa-off-password" name="password" type="password" required autoComplete="current-password" />
              </div>
              <Button type="submit" variant="outline" disabled={busy}>Turn off</Button>
            </form>
          )}
        </>
      ) : setup ? (
        <>
          <p>Scan this code with an authenticator app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded bg-white p-2" />
          <p className="text-xs text-muted-foreground">Can&apos;t scan? Enter this key: <code className="break-all">{setup.secret}</code></p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const code = String(new FormData(event.currentTarget).get("code") ?? "");
            const result = await confirmMfaAction(code);
            setBusy(false);
            if (!result.ok) setMessage(result.error);
            else {
              setMessage(null);
              setCodes(result.data?.recoveryCodes ?? []);
            }
          }}>
            <div>
              <Label htmlFor="mfa-code">Code</Label>
              <Input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </div>
            <Button type="submit" disabled={busy}>Turn on</Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">Protect your account with a code from an authenticator app at each sign-in.</p>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            const result = await beginMfaAction();
            setBusy(false);
            if (!result.ok) setMessage(result.error);
            else setSetup(result.data ?? null);
          }}>Set up two-factor sign-in</Button>
        </>
      )}
    </section>
  );
}

export function SessionsPanel() {
  return (
    <section className="space-y-3 rounded-xl border p-4 text-sm">
      <h2 className="font-medium">Sessions</h2>
      <p className="text-muted-foreground">Sign out of HealthFlow on every browser and device, including this one.</p>
      <form action={revokeSessionsAction}>
        <Button type="submit" variant="outline">Sign out everywhere</Button>
      </form>
    </section>
  );
}

export function OrgSecurityForm({ requireMfa, idleTimeoutMinutes }: { requireMfa: boolean; idleTimeoutMinutes: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form className="space-y-3 rounded-xl border p-4 text-sm" onSubmit={async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const result = await orgSecurityAction({
        requireMfa: form.get("requireMfa") === "on",
        idleTimeoutMinutes: String(form.get("idleTimeoutMinutes") ?? "15"),
      });
      setMessage(result.ok ? "Organization security saved. New limits apply at each person's next sign-in." : result.error);
      if (result.ok) router.refresh();
    }}>
      <h2 className="font-medium">Organization policy</h2>
      {message ? <p role="status">{message}</p> : null}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="requireMfa" defaultChecked={requireMfa} />
        Require two-factor sign-in for every member
      </label>
      <p className="text-xs text-muted-foreground">Members without it are signed out and asked to set it up at their next sign-in.</p>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="idle-minutes">Sign out after inactivity (minutes, 5–60)</Label>
        <Input id="idle-minutes" name="idleTimeoutMinutes" type="number" min={5} max={60} defaultValue={idleTimeoutMinutes} />
      </div>
      <Button type="submit">Save policy</Button>
    </form>
  );
}
