"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { revokeScimTokenAction, rotateScimTokenAction } from "@/app/actions/sso";
import { Button } from "@/components/ui/button";

export function ScimPanel({
  status,
}: {
  status: { baseUrl: string; enabled: boolean; tokenPrefix: string | null; createdAt: string | null; lastUsedAt: string | null };
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (status.enabled && !window.confirm("Replace the current token? Your identity provider stops syncing until you paste the new one.")) return;
    setBusy(true);
    const result = await rotateScimTokenAction();
    setBusy(false);
    if (!result.ok) setMessage(result.error);
    else {
      setToken(result.data?.token ?? null);
      setMessage(null);
      router.refresh();
    }
  }

  async function revoke() {
    if (!window.confirm("Turn off automatic provisioning? People already provisioned keep their access.")) return;
    setBusy(true);
    const result = await revokeScimTokenAction();
    setBusy(false);
    setToken(null);
    setMessage(result.ok ? "Automatic provisioning is off." : result.error);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 text-sm" aria-labelledby="scim-heading">
      <div>
        <h2 id="scim-heading" className="font-semibold">Automatic provisioning (SCIM)</h2>
        <p className="text-muted-foreground">
          Your identity provider adds people when they&apos;re assigned to HealthFlow and removes their access the moment they&apos;re
          disabled or unassigned. Works with Microsoft Entra ID and Okta. Verify a domain above first.
        </p>
      </div>
      {message ? <p role="status" className="text-destructive">{message}</p> : null}
      <dl className="grid gap-1 sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">Tenant URL</dt>
        <dd className="break-all font-medium">{status.baseUrl}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          {status.enabled
            ? `On. Token ${status.tokenPrefix}…, created ${status.createdAt ? new Date(status.createdAt).toLocaleDateString() : ""}. ${
                status.lastUsedAt ? `Last sync ${new Date(status.lastUsedAt).toLocaleString()}.` : "No sync yet."
              }`
            : "Off"}
        </dd>
      </dl>
      {token ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft p-3" role="alert">
          <p className="font-medium">Copy this token now. It won&apos;t be shown again.</p>
          <p className="mt-1 flex items-center gap-2 break-all font-mono text-xs">
            {token}
            <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Copy token" onClick={() => void navigator.clipboard?.writeText(token)}>
              <Copy className="size-3.5" aria-hidden />
            </button>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">In Entra: Enterprise applications &gt; HealthFlow &gt; Provisioning &gt; Admin credentials. Paste the tenant URL and this token as the secret token.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void rotate()} disabled={busy}>{status.enabled ? "Replace token" : "Generate token"}</Button>
        {status.enabled ? <Button variant="outline" onClick={() => void revoke()} disabled={busy}>Turn off</Button> : null}
      </div>
    </section>
  );
}
