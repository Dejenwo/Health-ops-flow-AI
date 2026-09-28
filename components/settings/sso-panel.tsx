"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Copy, Loader2 } from "lucide-react";
import { addSsoDomainAction, removeSsoDomainAction, ssoSettingsAction, verifySsoDomainAction } from "@/app/actions/sso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldClass } from "@/components/page-header";
import type { SsoProvider } from "@/lib/domain/types";

interface Settings {
  enabled: boolean;
  provider: SsoProvider;
  tenantId: string;
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  domains: { domain: string; verificationToken: string; verifiedAt: string | null }[];
  jitProvisioning: boolean;
  defaultRole: "VIEWER" | "SPECIALIST" | "MANAGER";
  requireSso: boolean;
  lastLoginAt: string | null;
  redirectUri: string;
  platform: Record<SsoProvider, boolean>;
}

const PROVIDER_LABEL: Record<SsoProvider, string> = {
  microsoft: "Microsoft Entra ID (Microsoft 365)",
  google: "Google Workspace",
  oidc: "Other OIDC provider (Okta, Ping, OneLogin…)",
};

export function SsoPanel({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [provider, setProvider] = useState<SsoProvider>(settings.provider);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const verified = settings.domains.filter((item) => item.verifiedAt).length;

  async function act(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    setMessage(result.ok ? { tone: "ok", text: success } : { tone: "error", text: result.error ?? "That did not work." });
    if (result.ok) router.refresh();
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-4 text-sm" aria-labelledby="sso-heading">
      <div>
        <h2 id="sso-heading" className="font-semibold">Single sign-on</h2>
        <p className="text-muted-foreground">
          Let your team sign in with their work accounts. Access ends when you disable someone in your identity provider, and MFA is enforced there.
        </p>
        {settings.lastLoginAt ? <p className="mt-1 text-xs text-muted-foreground">Last SSO sign-in {new Date(settings.lastLoginAt).toLocaleString()}</p> : null}
      </div>
      {message ? (
        <p role="status" className={message.tone === "ok" ? "text-success" : "text-destructive"}>{message.text}</p>
      ) : null}

      <div className="space-y-3">
        <h3 className="font-medium">1. Verify your email domains</h3>
        <p className="text-muted-foreground">
          Add each domain your staff use. Then add the TXT record shown to your DNS and click Verify. Public domains like gmail.com can&apos;t be used.
        </p>
        <ul className="space-y-2">
          {settings.domains.map((item) => (
            <li key={item.domain} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{item.domain}</span>
                <span className="flex items-center gap-2">
                  {item.verifiedAt ? (
                    <span className="inline-flex items-center gap-1 text-success"><CircleCheck className="size-4" aria-hidden /> Verified</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(`verify-${item.domain}`, async () => {
                      const result = await verifySsoDomainAction({ domain: item.domain });
                      if (result.ok && !result.data?.verified) return { ok: false, error: "The TXT record was not found yet. DNS changes can take up to an hour." };
                      return result;
                    }, `${item.domain} is verified.`)}>
                      {busy === `verify-${item.domain}` ? <Loader2 className="animate-spin" aria-hidden /> : null} Verify
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`remove-${item.domain}`, () => removeSsoDomainAction({ domain: item.domain }), `${item.domain} removed.`)}>
                    Remove
                  </Button>
                </span>
              </div>
              {!item.verifiedAt ? (
                <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[6rem_1fr]">
                  <dt className="text-muted-foreground">Type</dt><dd>TXT</dd>
                  <dt className="text-muted-foreground">Host</dt><dd className="break-all">_healthflow.{item.domain}</dd>
                  <dt className="text-muted-foreground">Value</dt>
                  <dd className="flex items-center gap-1 break-all">
                    healthflow-verification={item.verificationToken}
                    <button type="button" className="rounded p-1 hover:bg-muted" aria-label="Copy TXT value" onClick={() => void navigator.clipboard?.writeText(`healthflow-verification=${item.verificationToken}`)}>
                      <Copy className="size-3.5" aria-hidden />
                    </button>
                  </dd>
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const domain = String(new FormData(form).get("domain") ?? "");
          void act("add", () => addSsoDomainAction({ domain }), `${domain} added. Add the TXT record, then click Verify.`).then(() => form.reset());
        }}>
          <div className="space-y-1.5">
            <Label htmlFor="sso-domain">Domain</Label>
            <Input id="sso-domain" name="domain" placeholder="yourclinic.org" required />
          </div>
          <Button type="submit" variant="outline" disabled={busy !== null}>Add domain</Button>
        </form>
      </div>

      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void act("save", () => ssoSettingsAction({
          enabled: form.get("enabled") === "on",
          provider,
          tenantId: String(form.get("tenantId") ?? ""),
          issuer: String(form.get("issuer") ?? ""),
          clientId: String(form.get("clientId") ?? ""),
          clientSecret: String(form.get("clientSecret") ?? ""),
          jitProvisioning: form.get("jitProvisioning") === "on",
          defaultRole: String(form.get("defaultRole") ?? "SPECIALIST"),
          requireSso: form.get("requireSso") === "on",
        }), "Single sign-on settings saved.");
      }}>
        <h3 className="font-medium">2. Connect your identity provider</h3>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="sso-provider">Identity provider</Label>
          <select id="sso-provider" className={fieldClass} value={provider} onChange={(event) => setProvider(event.target.value as SsoProvider)}>
            {(Object.keys(PROVIDER_LABEL) as SsoProvider[]).map((key) => (
              <option key={key} value={key} disabled={!settings.platform[key]}>
                {PROVIDER_LABEL[key]}{settings.platform[key] ? "" : " (not available on this server)"}
              </option>
            ))}
          </select>
        </div>
        {provider === "microsoft" ? (
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="sso-tenant">Directory (tenant) ID</Label>
            <Input id="sso-tenant" name="tenantId" defaultValue={settings.tenantId} placeholder="00000000-0000-0000-0000-000000000000" />
            <p className="text-xs text-muted-foreground">In the Microsoft Entra admin center, under Overview. An admin must also consent to HealthFlow for your tenant.</p>
          </div>
        ) : null}
        {provider === "google" ? (
          <p className="text-xs text-muted-foreground">Only accounts in your verified Google Workspace domains can sign in. Personal Gmail accounts are refused.</p>
        ) : null}
        {provider === "oidc" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sso-issuer">Issuer URL</Label>
              <Input id="sso-issuer" name="issuer" defaultValue={settings.issuer} placeholder="https://yourcompany.okta.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-client-id">Client ID</Label>
              <Input id="sso-client-id" name="clientId" defaultValue={settings.clientId} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-client-secret">Client secret</Label>
              <Input id="sso-client-secret" name="clientSecret" type="password" autoComplete="off" placeholder={settings.hasClientSecret ? "Saved. Leave blank to keep it." : ""} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Register this redirect URI in your provider: <code className="break-all">{settings.redirectUri}</code>
            </p>
          </div>
        ) : null}

        <h3 className="pt-2 font-medium">3. Choose how people join</h3>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="jitProvisioning" defaultChecked={settings.jitProvisioning} className="mt-0.5" />
          <span>Create accounts automatically the first time someone from a verified domain signs in</span>
        </label>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="sso-role">Role for new accounts</Label>
          <select id="sso-role" name="defaultRole" defaultValue={settings.defaultRole} className={fieldClass}>
            <option value="VIEWER">Viewer</option>
            <option value="SPECIALIST">Specialist</option>
            <option value="MANAGER">Manager</option>
          </select>
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={verified === 0} className="mt-0.5" />
          <span>Turn on single sign-on{verified === 0 ? " (verify a domain first)" : ""}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="requireSso" defaultChecked={settings.requireSso} className="mt-0.5" />
          <span>
            Require SSO for everyone except owners
            <span className="block text-xs text-muted-foreground">Password sign-in stops for members, and their current password sessions end. Owners keep password and MFA as a way in if the identity provider is down.</span>
          </span>
        </label>
        <Button type="submit" disabled={busy !== null}>{busy === "save" ? <Loader2 className="animate-spin" aria-hidden /> : null} Save single sign-on</Button>
      </form>
    </section>
  );
}
