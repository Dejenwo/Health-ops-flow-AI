import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { listMemberships } from "@/lib/services/auth";
import { listNotifications } from "@/lib/services/collaboration";
import { getRequestContext } from "@/lib/services/context";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx.profile.onboardingCompleted) redirect("/onboarding");
  return (
    <AppShell
      user={{ name: ctx.profile.fullName, email: ctx.email, role: ctx.role }}
      organization={{ id: ctx.organization.id, name: ctx.organization.name, synthetic: ctx.organization.synthetic }}
      memberships={listMemberships(ctx)}
      notifications={listNotifications(ctx)}
    >
      {children}
    </AppShell>
  );
}
