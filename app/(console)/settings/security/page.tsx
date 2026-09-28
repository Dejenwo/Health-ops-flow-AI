import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "@/components/settings/forms";
import { MfaPanel, OrgSecurityForm, SessionsPanel } from "@/components/settings/security-panel";
import { isDemoSessionSecret } from "@/lib/auth/session-token";
import { can } from "@/lib/domain/permissions";
import { encryptionEnabled } from "@/lib/security/crypto";
import { getSecurityState } from "@/lib/services/auth";
import { getSsoSettings } from "@/lib/services/sso";
import { SsoPanel } from "@/components/settings/sso-panel";
import { ScimPanel } from "@/components/settings/scim-panel";
import { getScimStatus } from "@/lib/services/scim";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Security settings" };

export default async function SecuritySettingsPage({ searchParams }: { searchParams: Promise<{ enroll?: string }> }) {
  const params = await searchParams;
  const ctx = await getRequestContext();
  const state = getSecurityState(ctx);
  const warnings = [
    isDemoSessionSecret() ? "SESSION_SECRET is not set. A development signing secret is in use." : null,
    encryptionEnabled() ? null : "HF_DATA_KEY is not set. Stored data and documents are not encrypted at rest.",
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Security"
        description={`Sessions end after ${state.idleTimeoutMinutes} minutes of inactivity and 12 hours at most. Every record view is audit-logged.`}
      />
      {params.enroll && !state.mfaEnabled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-50" role="alert">
          Your organization requires two-factor sign-in. Set it up to continue.
        </p>
      ) : null}
      {can(ctx.role, "settings.security")
        ? warnings.map((warning) => (
            <p key={warning} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-50">
              {warning}
            </p>
          ))
        : null}
      <MfaPanel enabled={state.mfaEnabled} recoveryCodesLeft={state.recoveryCodesLeft} required={state.orgRequiresMfa} />
      <PasswordForm />
      <SessionsPanel />
      {can(ctx.role, "settings.security") ? (
        <OrgSecurityForm requireMfa={state.orgRequiresMfa} idleTimeoutMinutes={state.idleTimeoutMinutes} />
      ) : null}
      {can(ctx.role, "settings.security") ? <SsoPanel settings={getSsoSettings(ctx)} /> : null}
      {can(ctx.role, "settings.security") ? <ScimPanel status={getScimStatus(ctx)} /> : null}
    </div>
  );
}
