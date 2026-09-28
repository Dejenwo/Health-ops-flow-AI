import { PageHeader } from "@/components/page-header";
import { TeamManager } from "@/components/team/team-manager";
import { can } from "@/lib/domain/permissions";
import { listTeam } from "@/lib/services/admin";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await getRequestContext();
  const team = listTeam(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title="Team" description="Roles are enforced on the server. Owners cannot be removed if they are the last owner." />
      <TeamManager
        actorId={ctx.userId}
        actorRole={ctx.role}
        canInvite={can(ctx.role, "team.invite")}
        canChange={can(ctx.role, "team.role.change")}
        members={team.members.map((member) => ({
          id: member.id,
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
          status: member.status,
          lastActiveAt: member.lastActiveAt,
        }))}
        invitations={team.invitations.map((invite) => ({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt }))}
      />
    </div>
  );
}
