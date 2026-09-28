import { notFound } from "next/navigation";
import { AuthorizationWorkspace } from "@/components/authorizations/workspace";
import { rulesForOrganization } from "@/lib/services/auth-rules";
import { can } from "@/lib/domain/permissions";
import { getAuthorizationWorkspace, recordAuthorizationView } from "@/lib/services/authorizations";
import { activeMembers } from "@/lib/services/directory";
import { getRequestContext } from "@/lib/services/context";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Authorization ${id.slice(0, 8)}` };
}

export default async function AuthorizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRequestContext();
  const data = getAuthorizationWorkspace(ctx, id);
  if (!data) notFound();
  recordAuthorizationView(ctx, id);
  const members = activeMembers(ctx).map((member) => ({ id: member.userId, label: member.name }));
  return (
    <AuthorizationWorkspace
      authRules={rulesForOrganization(ctx)}
      data={data}
      members={members}
      canWrite={can(ctx.role, "authorizations.write")}
      canAssign={can(ctx.role, "authorizations.assign")}
      canTransition={can(ctx.role, "authorizations.transition")}
      canAi={can(ctx.role, "ai.run")}
    />
  );
}
